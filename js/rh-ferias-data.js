/*
 * BSconta+ Férias — camada de dados REAL (Supabase: rh.ferias_saldos +
 * rh.ferias_solicitacoes)
 * =============================================================================
 * Substitui DEMO.ferias / DEMO.rhFerias (js/demo-data.js, em memória, perdido
 * ao recarregar a página) pelas tabelas de verdade no banco.
 *
 * RLS relevante (ver db/supabase/01_schema_rh.sql):
 *   - Colaborador só LÊ o próprio saldo (rh.ferias_saldos) e as próprias
 *     solicitações (rh.ferias_solicitacoes) — não pode alterar saldo.
 *   - Colaborador só pode INSERIR uma solicitação de férias com
 *     status = 'PENDENTE' (política "self insert pendente"); não pode
 *     aprovar/recusar a própria solicitação nem editar saldo.
 *   - Só RH/RH_ADMIN (rh.is_rh_staff()) pode aprovar/recusar (mudar status)
 *     e só o RH pode debitar o saldo (rh.ferias_saldos) quando aprova.
 */

function rhGerarProtocoloFerias() {
  return `FER-${Date.now().toString(36).toUpperCase()}`;
}

function rhDiasEntre(inicioIso, fimIso) {
  const a = new Date(inicioIso + "T00:00:00");
  const b = new Date(fimIso + "T00:00:00");
  const diffMs = b.getTime() - a.getTime();
  return Math.round(diffMs / 86400000) + 1;
}

function rhMapSolicitacaoFerias(row) {
  return {
    id: row.id,
    protocolo: row.protocolo,
    inicio: row.inicio,
    fim: row.fim,
    dias: row.dias,
    status: row.status,
    solicitadoEm: row.solicitado_em,
    observacoes: row.observacoes || "",
  };
}

/** Carrega o saldo + histórico de UM colaborador, direto do banco. Se o
 * colaborador ainda não tiver linha em rh.ferias_saldos (RH não cadastrou
 * ainda), devolve um saldo "zerado" em vez de travar — é uma limitação de
 * cadastro do RH, não um bug da tela. */
async function rhCarregarFeriasColaborador(colaboradorId) {
  const [{ data: saldoRow, error: saldoErr }, { data: solicRows, error: solicErr }] = await Promise.all([
    sb.from("ferias_saldos").select("*").eq("colaborador_id", colaboradorId).maybeSingle(),
    sb.from("ferias_solicitacoes").select("*").eq("colaborador_id", colaboradorId).order("solicitado_em", { ascending: false }),
  ]);
  if (saldoErr) throw saldoErr;
  if (solicErr) throw solicErr;

  const saldo = saldoRow
    ? {
        saldoDias: saldoRow.saldo_dias,
        diasUsados: saldoRow.dias_usados,
        periodoAquisitivoInicio: saldoRow.periodo_aquisitivo_inicio,
        periodoAquisitivoFim: saldoRow.periodo_aquisitivo_fim,
      }
    : { saldoDias: 0, diasUsados: 0, periodoAquisitivoInicio: null, periodoAquisitivoFim: null, semCadastro: true };

  const historico = (solicRows || []).map(rhMapSolicitacaoFerias);
  const hojeIso = new Date().toISOString().slice(0, 10);
  const proximas = historico.filter((s) => s.status === "APROVADA" && s.fim >= hojeIso).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));

  return { colaboradorId, saldo, historico, proximas };
}

/** Colaborador solicita férias — insere uma linha real PENDENTE (única
 * operação que a política de RLS permite a ele). Valida localmente antes de
 * gravar (datas coerentes, dentro do saldo disponível) para dar um erro
 * amigável em vez de deixar o banco rejeitar sem explicação. */
async function rhCriarSolicitacaoFerias({ colaboradorId, inicio, fim, saldoDisponivel, observacoes }) {
  if (!inicio || !fim) throw new Error("Informe as datas de início e fim.");
  if (fim < inicio) throw new Error("A data de fim não pode ser antes da data de início.");
  const dias = rhDiasEntre(inicio, fim);
  if (dias < 1) throw new Error("Período inválido.");
  if (typeof saldoDisponivel === "number" && dias > saldoDisponivel) {
    throw new Error(`Você tem apenas ${saldoDisponivel} dia(s) disponível(is) neste período aquisitivo.`);
  }

  const payload = {
    protocolo: rhGerarProtocoloFerias(),
    colaborador_id: colaboradorId,
    inicio,
    fim,
    dias,
    status: "PENDENTE",
    observacoes: observacoes || null,
  };
  const { data, error } = await sb.from("ferias_solicitacoes").insert(payload).select().single();
  if (error) throw error;
  return rhMapSolicitacaoFerias(data);
}

/** RH: lista todas as solicitações de férias de todos os colaboradores, já
 * trazendo o nome do colaborador via join (rh.is_rh_staff() libera SELECT em
 * ferias_solicitacoes de qualquer colaborador). */
async function rhCarregarFeriasRH() {
  const { data, error } = await sb
    .from("ferias_solicitacoes")
    .select("*, colaborador:colaboradores(id,nome)")
    .order("solicitado_em", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    ...rhMapSolicitacaoFerias(row),
    colaboradorId: row.colaborador_id,
    colaborador: row.colaborador?.nome || "—",
  }));
}

/** RH aprova ou recusa uma solicitação. Se aprovada, debita o saldo de
 * verdade em rh.ferias_saldos (cria a linha de saldo com valores padrão se o
 * colaborador ainda não tiver uma — RH_ADMIN pode ajustar depois em
 * Configurações/Colaboradores). */
async function rhResolverFerias(solicitacaoId, aprovado) {
  const { data: solicitacao, error: getErr } = await sb.from("ferias_solicitacoes").select("*").eq("id", solicitacaoId).single();
  if (getErr) throw getErr;

  if (aprovado) {
    const { data: saldoAtual, error: saldoErr } = await sb
      .from("ferias_saldos")
      .select("*")
      .eq("colaborador_id", solicitacao.colaborador_id)
      .maybeSingle();
    if (saldoErr) throw saldoErr;

    const saldoBase = saldoAtual || { colaborador_id: solicitacao.colaborador_id, saldo_dias: 30, dias_usados: 0 };
    if (solicitacao.dias > saldoBase.saldo_dias) {
      throw new Error(`Este colaborador só tem ${saldoBase.saldo_dias} dia(s) de saldo — não é possível aprovar ${solicitacao.dias} dia(s). Ajuste o saldo antes de aprovar.`);
    }
    const novoPayload = {
      colaborador_id: solicitacao.colaborador_id,
      periodo_aquisitivo_inicio: saldoBase.periodo_aquisitivo_inicio || null,
      periodo_aquisitivo_fim: saldoBase.periodo_aquisitivo_fim || null,
      saldo_dias: saldoBase.saldo_dias - solicitacao.dias,
      dias_usados: (saldoBase.dias_usados || 0) + solicitacao.dias,
      updated_at: new Date().toISOString(),
    };
    const { error: upsertErr } = await sb.from("ferias_saldos").upsert(novoPayload, { onConflict: "colaborador_id" });
    if (upsertErr) throw upsertErr;
  }

  const { error: updErr } = await sb
    .from("ferias_solicitacoes")
    .update({ status: aprovado ? "APROVADA" : "RECUSADA" })
    .eq("id", solicitacaoId);
  if (updErr) throw updErr;
  return true;
}
