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

/** Data de hoje em formato ISO (YYYY-MM-DD), usado como fallback quando
 * hojeIso nao e informado (ex.: rhCalcularAvisoFerias). */
function rhTodayIso() {
  return new Date().toISOString().slice(0, 10);
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

function isoOfDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Período aquisitivo — sempre calculado a partir da data de admissão
// ---------------------------------------------------------------------------

/** Regra CLT padrão: 30 dias de férias por período aquisitivo de 12 meses. */
const FERIAS_DIAS_PADRAO = 30;

/** Regras de fracionamento (Art. 134 §1º da CLT): até 3 períodos, um deles
 * com pelo menos 14 dias e os demais com pelo menos 5 dias cada. Ajuste
 * aqui se a política da empresa for diferente. */
const FERIAS_MAX_PERIODOS = 3;
const FERIAS_MIN_DIAS_POR_PERIODO = 5;
const FERIAS_MIN_DIAS_UM_PERIODO = 14;

/** Calcula o período aquisitivo VIGENTE de um colaborador a partir da data
 * de admissão (ex.: admitido em 01/01/2026 → período 01/01/2026 a
 * 01/01/2027, renovando a cada aniversário de admissão). Não depende de
 * nada estar cadastrado em rh.ferias_saldos — é só matemática de datas.
 * Devolve `null` quando não há data de admissão para calcular. */
function rhPeriodoAquisitivoVigente(admissaoIso, hojeIso) {
  if (!admissaoIso) return null;
  const hoje = new Date((hojeIso || rhTodayIso()) + "T00:00:00");
  const admissao = new Date(admissaoIso + "T00:00:00");
  if (Number.isNaN(admissao.getTime())) return null;

  // Próximo aniversário de admissão (fim do período aquisitivo vigente):
  // soma anos de 1 em 1 a partir da admissão até passar de hoje.
  let fimPeriodo = new Date(admissao);
  while (fimPeriodo <= hoje) {
    fimPeriodo = new Date(fimPeriodo.getFullYear() + 1, fimPeriodo.getMonth(), fimPeriodo.getDate());
  }
  const inicioPeriodo = new Date(fimPeriodo.getFullYear() - 1, fimPeriodo.getMonth(), fimPeriodo.getDate());
  return { inicio: isoOfDate(inicioPeriodo), fim: isoOfDate(fimPeriodo) };
}

/** Saldo de férias "para exibição": sempre reflete o período aquisitivo
 * vigente (calculado a partir da admissão), mesmo que rh.ferias_saldos
 * ainda não tenha sido atualizado pelo RH para o ciclo atual.
 *
 * - Se o banco já tem uma linha de saldo cujo período aquisitivo bate com
 *   o vigente, usa os números reais do banco (podem refletir ajustes
 *   manuais do RH — ex. desconto de férias tiradas antes deste sistema).
 * - Se o banco está desatualizado (virou o ciclo) ou não existe ainda,
 *   calcula o saldo do período vigente a partir do histórico de
 *   solicitações APROVADAS dentro desse período (30 dias − dias já
 *   aprovados no período). Não escreve nada no banco — é só cálculo local;
 *   quem tem permissão de gravar em rh.ferias_saldos é o RH (RLS). */
function rhCalcularSaldoExibicao(colaborador, saldoRow, historico, hojeIso) {
  hojeIso = hojeIso || rhTodayIso();
  const vigente = rhPeriodoAquisitivoVigente(colaborador?.admissao, hojeIso);

  if (!vigente) {
    return saldoRow
      ? {
          saldoDias: saldoRow.saldo_dias,
          diasUsados: saldoRow.dias_usados,
          periodoAquisitivoInicio: saldoRow.periodo_aquisitivo_inicio,
          periodoAquisitivoFim: saldoRow.periodo_aquisitivo_fim,
          semCadastro: false,
        }
      : { saldoDias: 0, diasUsados: 0, periodoAquisitivoInicio: null, periodoAquisitivoFim: null, semCadastro: true };
  }

  if (saldoRow && saldoRow.periodo_aquisitivo_fim === vigente.fim) {
    return {
      saldoDias: saldoRow.saldo_dias,
      diasUsados: saldoRow.dias_usados,
      periodoAquisitivoInicio: saldoRow.periodo_aquisitivo_inicio || vigente.inicio,
      periodoAquisitivoFim: saldoRow.periodo_aquisitivo_fim,
      semCadastro: false,
    };
  }

  const diasUsados = (historico || [])
    .filter((s) => s.status === "APROVADA" && s.inicio >= vigente.inicio && s.inicio <= vigente.fim)
    .reduce((total, s) => total + s.dias, 0);

  return {
    saldoDias: Math.max(0, FERIAS_DIAS_PADRAO - diasUsados),
    diasUsados,
    periodoAquisitivoInicio: vigente.inicio,
    periodoAquisitivoFim: vigente.fim,
    semCadastro: false,
  };
}

/** Carrega colaborador + saldo (sempre para o período vigente, ver acima) +
 * histórico de UM colaborador, direto do banco. Se o colaborador ainda não
 * tiver linha em rh.ferias_saldos (RH não cadastrou ainda), calcula um
 * saldo "do zero" a partir da admissão em vez de travar — é uma limitação
 * de cadastro do RH, não um bug da tela. */
async function rhCarregarFeriasColaborador(colaboradorId) {
  const [{ data: colaborador, error: colabErr }, { data: saldoRow, error: saldoErr }, { data: solicRows, error: solicErr }] = await Promise.all([
    sb.from("colaboradores").select("id, nome, admissao").eq("id", colaboradorId).single(),
    sb.from("ferias_saldos").select("*").eq("colaborador_id", colaboradorId).maybeSingle(),
    sb.from("ferias_solicitacoes").select("*").eq("colaborador_id", colaboradorId).order("solicitado_em", { ascending: false }),
  ]);
  if (colabErr) throw colabErr;
  if (saldoErr) throw saldoErr;
  if (solicErr) throw solicErr;

  const historico = (solicRows || []).map(rhMapSolicitacaoFerias);
  const hojeIso = rhTodayIso();
  const saldo = rhCalcularSaldoExibicao(colaborador, saldoRow, historico, hojeIso);
  const proximas = historico.filter((s) => s.status === "APROVADA" && s.fim >= hojeIso).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));

  return { colaboradorId, colaborador, saldo, historico, proximas };
}

/** Valida e monta uma solicitação de férias com UM OU MAIS períodos (férias
 * integrais = um único período; férias parceladas = vários). Usada pelo
 * colaborador (cria PENDENTE) e reaproveitada pelo RH ao lançar férias já
 * aprovadas (ver rhLancarFeriasRH). Não grava nada — só valida e calcula os
 * dias de cada período; quem grava é o chamador. */
function rhValidarPeriodosFerias(periodos, { maxPeriodos = FERIAS_MAX_PERIODOS, exigirMinimos = true } = {}) {
  if (!Array.isArray(periodos) || !periodos.length) throw new Error("Informe ao menos um período de férias.");
  if (periodos.length > maxPeriodos) throw new Error(`No máximo ${maxPeriodos} períodos por solicitação.`);

  const periodosCalc = periodos.map((p, i) => {
    if (!p.inicio || !p.fim) throw new Error(`Informe início e fim do período ${i + 1}.`);
    if (p.fim < p.inicio) throw new Error(`No período ${i + 1}, a data de fim não pode ser antes da data de início.`);
    const dias = rhDiasEntre(p.inicio, p.fim);
    if (dias < 1) throw new Error(`Período ${i + 1} inválido.`);
    if (exigirMinimos && periodos.length > 1 && dias < FERIAS_MIN_DIAS_POR_PERIODO) {
      throw new Error(`Cada período precisa ter ao menos ${FERIAS_MIN_DIAS_POR_PERIODO} dias corridos (o período ${i + 1} tem ${dias}).`);
    }
    return { inicio: p.inicio, fim: p.fim, dias };
  });

  const ordenados = [...periodosCalc].sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  for (let i = 1; i < ordenados.length; i++) {
    if (ordenados[i].inicio <= ordenados[i - 1].fim) throw new Error("Os períodos informados não podem se sobrepor.");
  }

  if (exigirMinimos && periodosCalc.length > 1 && !periodosCalc.some((p) => p.dias >= FERIAS_MIN_DIAS_UM_PERIODO)) {
    throw new Error(`Ao fracionar as férias, pelo menos um dos períodos precisa ter ${FERIAS_MIN_DIAS_UM_PERIODO} dias ou mais.`);
  }

  return periodosCalc;
}

/** Colaborador solicita férias — insere uma ou mais linhas reais PENDENTE
 * (única operação que a política de RLS permite a ele). Aceita um único
 * período (férias integrais) ou vários (férias parceladas, respeitando as
 * regras de rhValidarPeriodosFerias). Valida localmente antes de gravar
 * (datas coerentes, dentro do saldo disponível) para dar um erro amigável
 * em vez de deixar o banco rejeitar sem explicação. */
async function rhCriarSolicitacaoFerias({ colaboradorId, periodos, inicio, fim, saldoDisponivel, observacoes }) {
  // Compatibilidade: também aceita a forma antiga { inicio, fim } de um
  // período só, além da forma nova { periodos: [...] }.
  const listaPeriodos = periodos || (inicio && fim ? [{ inicio, fim }] : null);
  const periodosCalc = rhValidarPeriodosFerias(listaPeriodos);

  const diasTotal = periodosCalc.reduce((a, p) => a + p.dias, 0);
  if (typeof saldoDisponivel === "number" && diasTotal > saldoDisponivel) {
    throw new Error(
      periodosCalc.length > 1
        ? `Você tem apenas ${saldoDisponivel} dia(s) disponível(is) neste período aquisitivo — o total solicitado é ${diasTotal} dia(s).`
        : `Você tem apenas ${saldoDisponivel} dia(s) disponível(is) neste período aquisitivo.`
    );
  }

  const linhas = [];
  for (const p of periodosCalc) {
    const payload = {
      protocolo: rhGerarProtocoloFerias(),
      colaborador_id: colaboradorId,
      inicio: p.inicio,
      fim: p.fim,
      dias: p.dias,
      status: "PENDENTE",
      observacoes:
        periodosCalc.length > 1
          ? [`Férias parceladas — período ${linhas.length + 1} de ${periodosCalc.length}.`, observacoes || ""].filter(Boolean).join(" ")
          : observacoes || null,
    };
    const { data, error } = await sb.from("ferias_solicitacoes").insert(payload).select().single();
    if (error) throw error;
    linhas.push(rhMapSolicitacaoFerias(data));
  }
  return linhas;
}

/** RH: lista todas as solicitações de férias de todos os colaboradores, já
 * trazendo o nome/admissão do colaborador via join (rh.is_rh_staff() libera
 * SELECT em ferias_solicitacoes de qualquer colaborador) e o saldo de dias
 * disponíveis + período aquisitivo vigente de cada um (ver
 * rhCalcularSaldoExibicao), para a tela rh/ferias.html mostrar tudo em uma
 * tabela só sem precisar de uma consulta por colaborador. */
async function rhCarregarFeriasRH() {
  const [{ data: solicRows, error: solicErr }, { data: saldoRows, error: saldoErr }] = await Promise.all([
    sb.from("ferias_solicitacoes").select("*, colaborador:colaboradores(id,nome,admissao)").order("solicitado_em", { ascending: false }),
    sb.from("ferias_saldos").select("*"),
  ]);
  if (solicErr) throw solicErr;
  if (saldoErr) throw saldoErr;

  const linhas = (solicRows || []).map((row) => ({
    ...rhMapSolicitacaoFerias(row),
    colaboradorId: row.colaborador_id,
    colaborador: row.colaborador?.nome || "—",
    colaboradorAdmissao: row.colaborador?.admissao || null,
  }));

  const saldoPorColaborador = new Map((saldoRows || []).map((s) => [s.colaborador_id, s]));
  const historicoPorColaborador = new Map();
  linhas.forEach((l) => {
    if (!historicoPorColaborador.has(l.colaboradorId)) historicoPorColaborador.set(l.colaboradorId, []);
    historicoPorColaborador.get(l.colaboradorId).push(l);
  });

  const hojeIso = rhTodayIso();
  linhas.forEach((l) => {
    const saldo = rhCalcularSaldoExibicao(
      { admissao: l.colaboradorAdmissao },
      saldoPorColaborador.get(l.colaboradorId) || null,
      historicoPorColaborador.get(l.colaboradorId) || [],
      hojeIso
    );
    l.saldoDiasDisponiveis = saldo.saldoDias;
    l.periodoAquisitivoInicio = saldo.periodoAquisitivoInicio;
    l.periodoAquisitivoFim = saldo.periodoAquisitivoFim;
  });

  return linhas;
}

/** RH: lista de lembretes de férias de TODOS os colaboradores ativos, para
 * alimentar o sino de notificações (renderTopHeader) e/ou um banner. Busca
 * os colaboradores ativos + o histórico de férias de cada um e devolve só
 * quem precisa de atenção (ver rhAvisoFeriasColaborador), do mais urgente
 * para o menos urgente. */
async function rhListarLembretesFerias() {
  const [{ data: colaboradores, error: colabErr }, feriasRH] = await Promise.all([
    sb.from("colaboradores").select("id, nome, admissao").neq("status", "INATIVO").order("nome"),
    rhCarregarFeriasRH(),
  ]);
  if (colabErr) throw colabErr;

  const hojeIso = rhTodayIso();
  return (colaboradores || [])
    .map((c) => rhAvisoFeriasColaborador(c, feriasRH.filter((f) => f.colaboradorId === c.id), hojeIso))
    .filter(Boolean)
    .sort((a, b) => a.diasParaVencer - b.diasParaVencer);
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
  const periodosCalc = rhValidarPeriodosFerias(periodos, { maxPeriodos: 4, exigirMinimos: false });
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

/** Item "Lembrete de férias": calcula o fim do período aquisitivo VIGENTE de
 * um colaborador (admissão + 1 ano, repetido a cada aniversário) a partir da
 * data de admissão — sem depender de rh.ferias_saldos.periodo_aquisitivo_fim
 * estar preenchido (RH nem sempre cadastra isso). Devolve `null` quando
 * ainda não é hora de avisar (mais de AVISO_DIAS de antecedência). */
const RH_FERIAS_AVISO_DIAS = 60;
function rhCalcularAvisoFerias(colaborador, hojeIso) {
  if (!colaborador?.admissao) return null;
  hojeIso = hojeIso || rhTodayIso();
  const vigente = rhPeriodoAquisitivoVigente(colaborador.admissao, hojeIso);
  if (!vigente) return null;

  const hoje = new Date(hojeIso + "T00:00:00");
  const fimPeriodo = new Date(vigente.fim + "T00:00:00");
  const diasParaVencer = Math.round((fimPeriodo - hoje) / 86400000);
  if (diasParaVencer > RH_FERIAS_AVISO_DIAS) return null;

  return {
    periodoAquisitivoInicio: vigente.inicio,
    periodoAquisitivoFim: vigente.fim,
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
  return { ...info, colaboradorId: colaborador.id, colaboradorNome: colaborador.nome, colaboradorAdmissao: colaborador.admissao };
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
