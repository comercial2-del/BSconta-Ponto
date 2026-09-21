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

/** RH lança férias diretamente (já aprovadas) para um colaborador — usado
 * pelo botão "Lançar férias" em rh/ferias.html. Aceita um OU MAIS períodos
 * na mesma chamada, o que implementa o "férias fracionadas": em vez de uma
 * única solicitação PENDENTE (fluxo normal do colaborador), o RH cria
 * diretamente N solicitações já APROVADAS (uma por período/bloco) e debita
 * o total de dias do saldo de uma só vez. Cada período é uma linha própria
 * em rh.ferias_solicitacoes (mesma tabela/mesmo formato de sempre) — não é
 * um tipo de registro novo, só uma forma de lançar mais de um período de
 * uma vez. */
async function rhLancarFeriasRH({ colaboradorId, periodos }) {
  if (!colaboradorId) throw new Error("Selecione um colaborador.");
  if (!Array.isArray(periodos) || !periodos.length) throw new Error("Informe ao menos um período de férias.");

  const periodosCalc = periodos.map((p, i) => {
    if (!p.inicio || !p.fim) throw new Error(`Informe início e fim do período ${i + 1}.`);
    if (p.fim < p.inicio) throw new Error(`No período ${i + 1}, a data de fim não pode ser antes da data de início.`);
    const dias = rhDiasEntre(p.inicio, p.fim);
    if (dias < 1) throw new Error(`Período ${i + 1} inválido.`);
    return { inicio: p.inicio, fim: p.fim, dias };
  });
  const diasTotal = periodosCalc.reduce((a, p) => a + p.dias, 0);

  const { data: saldoAtual, error: saldoErr } = await sb.from("ferias_saldos").select("*").eq("colaborador_id", colaboradorId).maybeSingle();
  if (saldoErr) throw saldoErr;
  const saldoBase = saldoAtual || { colaborador_id: colaboradorId, saldo_dias: 30, dias_usados: 0 };
  if (diasTotal > saldoBase.saldo_dias) {
    throw new Error(`Este colaborador só tem ${saldoBase.saldo_dias} dia(s) de saldo — não é possível lançar ${diasTotal} dia(s) no total (${periodosCalc.length} período(s)).`);
  }

  const linhas = [];
  for (const p of periodosCalc) {
    const payload = {
      protocolo: rhGerarProtocoloFerias(),
      colaborador_id: colaboradorId,
      inicio: p.inicio,
      fim: p.fim,
      dias: p.dias,
      status: "APROVADA",
      observacoes: periodosCalc.length > 1 ? `Lançado pelo RH — férias fracionadas, período ${linhas.length + 1} de ${periodosCalc.length}.` : "Lançado pelo RH.",
    };
    const { data, error } = await sb.from("ferias_solicitacoes").insert(payload).select().single();
    if (error) throw error;
    linhas.push(rhMapSolicitacaoFerias(data));
  }

  const novoPayload = {
    colaborador_id: colaboradorId,
    periodo_aquisitivo_inicio: saldoBase.periodo_aquisitivo_inicio || null,
    periodo_aquisitivo_fim: saldoBase.periodo_aquisitivo_fim || null,
    saldo_dias: saldoBase.saldo_dias - diasTotal,
    dias_usados: (saldoBase.dias_usados || 0) + diasTotal,
    updated_at: new Date().toISOString(),
  };
  const { error: upsertErr } = await sb.from("ferias_saldos").upsert(novoPayload, { onConflict: "colaborador_id" });
  if (upsertErr) throw upsertErr;

  return linhas;
}

/** Gera N blocos consecutivos de 15 dias corridos a partir de uma data de
 * início — usado pela opção "Fracionar em blocos de 15 dias" do lançamento
 * de férias pelo RH. Cada bloco começa no dia seguinte ao fim do anterior
 * (sem sobreposição); o RH ainda pode ajustar cada data manualmente na
 * tela antes de confirmar. */
function rhBlocosFerias15(dataInicioIso, quantidadeBlocos) {
  const blocos = [];
  let cursor = new Date(dataInicioIso + "T00:00:00");
  for (let i = 0; i < quantidadeBlocos; i++) {
    const inicio = new Date(cursor);
    const fim = new Date(cursor);
    fim.setDate(fim.getDate() + 14); // 15 dias corridos (início inclusive)
    blocos.push({ inicio: isoOfDate(inicio), fim: isoOfDate(fim) });
    cursor = new Date(fim);
    cursor.setDate(cursor.getDate() + 1);
  }
  return blocos;
}

function isoOfDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Item "Lembrete de férias": calcula o fim do período aquisitivo VIGENTE de
 * um colaborador (admissão + 1 ano, repetido a cada aniversário) a partir da
 * data de admissão — sem depender de rh.ferias_saldos.periodo_aquisitivo_fim
 * estar preenchido (RH nem sempre cadastra isso). Devolve `null` quando
 * ainda não é hora de avisar (mais de AVISO_DIAS de antecedência). */
const RH_FERIAS_AVISO_DIAS = 60;
function rhCalcularAvisoFerias(colaborador, hojeIso) {
  if (!colaborador?.admissao) return null;
  const hoje = new Date((hojeIso || rhTodayIso()) + "T00:00:00");
  const admissao = new Date(colaborador.admissao + "T00:00:00");
  if (Number.isNaN(admissao.getTime())) return null;

  // Próximo aniversário de admissão (fim do período aquisitivo vigente):
  // soma anos de 1 em 1 a partir da admissão até passar de hoje.
  let fimPeriodo = new Date(admissao);
  while (fimPeriodo <= hoje) {
    fimPeriodo = new Date(fimPeriodo.getFullYear() + 1, fimPeriodo.getMonth(), fimPeriodo.getDate());
  }
  const inicioPeriodo = new Date(fimPeriodo.getFullYear() - 1, fimPeriodo.getMonth(), fimPeriodo.getDate());
  const diasParaVencer = Math.round((fimPeriodo - hoje) / 86400000);
  if (diasParaVencer > RH_FERIAS_AVISO_DIAS) return null;

  return {
    periodoAquisitivoInicio: isoOfDate(inicioPeriodo),
    periodoAquisitivoFim: isoOfDate(fimPeriodo),
    diasParaVencer,
    vencido: diasParaVencer < 0,
  };
}

/** Junta o cálculo acima com o histórico de solicitações do colaborador: só
 * mantém o aviso se ele ainda NÃO tem nenhuma férias pendente/aprovada
 * marcando esse período aquisitivo (evita avisar quem já programou). */
function rhAvisoFeriasColaborador(colaborador, historicoFerias, hojeIso) {
  const info = rhCalcularAvisoFerias(colaborador, hojeIso);
  if (!info) return null;
  const jaProgramada = (historicoFerias || []).some(
    (f) => (f.status === "APROVADA" || f.status === "PENDENTE" || f.status === "EM_ANALISE") && f.inicio >= info.periodoAquisitivoInicio && f.inicio <= info.periodoAquisitivoFim
  );
  if (jaProgramada) return null;
  return { ...info, colaboradorId: colaborador.id, colaboradorNome: colaborador.nome };
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
