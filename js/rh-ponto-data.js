/*
 * BSconta+ Ponto — camada de dados REAL (Supabase: rh.ponto_registros +
 * rh.solicitacoes)
 * =============================================================================
 * Substitui js/ponto-store.js (que guardava tudo no localStorage do
 * navegador — real, mas só naquele navegador, não entre dispositivos) pela
 * tabela de verdade no banco. Mantém a mesma forma de dado que as telas
 * (colaborador/ponto.html, rh/ponto.html) já usavam, para não precisar
 * reescrever toda a renderização — só troca de onde o dado vem/vai.
 *
 * RLS relevante (ver db/supabase/01_schema_rh.sql):
 *   - Colaborador só pode INSERT/UPDATE na própria linha de HOJE
 *     (rh.ponto_registros, data = current_date). Ajustes em dias passados
 *     só o RH pode aplicar (política "rh_staff all").
 *   - Pedido de ajuste de ponto = uma linha em rh.solicitacoes (categoria
 *     "Ajuste de ponto", status PENDENTE) — o colaborador só pode inserir
 *     pendente; só o RH pode mudar o status.
 * Por isso o "dia pendente" no calendário do colaborador não é mais escrito
 * em ponto_registros.pendente_ajuste por ele mesmo (a política não deixa) —
 * é calculado juntando com as solicitações pendentes dele (ver
 * rhMarcarDiasPendentes abaixo). Quando o RH aprova, ELE grava a correção
 * de verdade em rh.ponto_registros (inclusive pendente_ajuste/alterado_pelo_rh).
 */

// Só usado quando um colaborador não tem NENHUMA jornada configurada em
// rh.colaboradores (nem horario_entrada, nem horas_semanais+dias_trabalho) —
// nunca deveria acontecer depois de 13_colaboradores_desligamento_e_jornada.sql
// (que preenche um padrão pra todo mundo), mas fica como último fallback
// para não quebrar o cálculo se algum colaborador novo escapar disso.
const RH_META_DIARIA_FALLBACK = 8;

function rhParseHora(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function rhHoraCurta(t) {
  return t ? String(t).slice(0, 5) : null;
}
function rhTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const RH_DIAS_SEMANA_CODIGO = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

/** Dado uma data ISO (ou "hoje", se omitida), diz se é dia de trabalho para
 * quem tem `diasTrabalho` configurado (ex.: ["SEG","TER","QUA","QUI","SEX"]).
 * Sem configuração (null/vazio), assume que TODO dia é dia de trabalho —
 * mantém o comportamento antigo pra quem, por algum motivo, escapou do
 * backfill de 13_colaboradores_desligamento_e_jornada.sql. */
function rhEhDiaDeTrabalho(diasTrabalho, dataIso) {
  if (!diasTrabalho || !diasTrabalho.length) return true;
  const [y, m, d] = (dataIso || rhTodayIso()).split("-").map(Number);
  const codigo = RH_DIAS_SEMANA_CODIGO[new Date(y, m - 1, d).getDay()];
  return diasTrabalho.includes(codigo);
}

/** Deriva a config de jornada REAL de um colaborador (linha de
 * rh.colaboradores, ou um subconjunto dela com pelo menos horario_entrada /
 * meta_diaria_horas / horas_semanais / dias_trabalho) — usada tanto para
 * gravar o cálculo do dia quanto para classificar "atraso" nas telas do RH.
 * Meta diária: usa rh.colaboradores.meta_diaria_horas quando definida;
 * senão deriva de horas_semanais / nº de dias trabalhados por semana
 * (ex.: 40h em 5 dias = 8h/dia; 44h em 6 dias = ~7h20/dia); no último caso,
 * o fallback fixo de 8h. */
function rhConfigJornada(colaborador) {
  const diasTrabalho = colaborador?.dias_trabalho && colaborador.dias_trabalho.length ? colaborador.dias_trabalho : null;
  let metaDiariaHoras = RH_META_DIARIA_FALLBACK;
  if (colaborador?.meta_diaria_horas != null) {
    metaDiariaHoras = Number(colaborador.meta_diaria_horas);
  } else if (colaborador?.horas_semanais && diasTrabalho) {
    metaDiariaHoras = Number(colaborador.horas_semanais) / diasTrabalho.length;
  }
  return {
    horarioEntradaPrevisto: rhHoraCurta(colaborador?.horario_entrada) || null,
    metaDiariaHoras,
    diasTrabalho,
  };
}

const RH_COLABORADOR_JORNADA_COLS = "horario_entrada, horario_saida, meta_diaria_horas, horas_semanais, dias_trabalho";

/** Busca só as colunas de jornada de UM colaborador, já convertidas em
 * config (ver rhConfigJornada). Usada antes de gravar/recalcular um dia, e
 * pelas telas do RH que precisam classificar "atraso" de verdade por
 * pessoa, em vez de assumir 08:00/8h fixos pra todo mundo. */
async function rhBuscarConfigJornada(colaboradorId) {
  const { data, error } = await sb.from("colaboradores").select(RH_COLABORADOR_JORNADA_COLS).eq("id", colaboradorId).single();
  if (error) throw error;
  return rhConfigJornada(data);
}

/** Classifica o dia de hoje de UM colaborador para as telas agregadas do RH
 * (dashboard, relatórios, ponto) — nunca mais "h*60+m-8*60>5" fixo: usa o
 * horário de entrada PREVISTO real da pessoa (config.horarioEntradaPrevisto)
 * e, quando ela não tem jornada nesse dia da semana (dias_trabalho), não
 * conta como falta — é "sem_expediente" (dia de descanso dela), uma
 * categoria própria em vez de inflar a contagem de faltas. */
function rhClassificarStatusHoje({ entradaReal, config, dataIso }) {
  const dia = dataIso || rhTodayIso();
  if (!rhEhDiaDeTrabalho(config?.diasTrabalho, dia)) return "sem_expediente";
  if (!entradaReal) return "falta";
  if (!config?.horarioEntradaPrevisto) return "completo"; // sem horário previsto configurado: não há como julgar atraso
  const atrasoMin = rhParseHora(entradaReal) - rhParseHora(config.horarioEntradaPrevisto);
  return atrasoMin > 5 ? "atraso" : "completo";
}

/** Mesma lógica de cálculo que js/ponto-store.js usava — só que aqui opera
 * sobre o formato de linha do banco (snake_case), usa a jornada REAL do
 * colaborador (ver rhConfigJornada — antes era "08:00"/8h fixos pra todo
 * mundo) e devolve os campos que serão gravados de volta em
 * rh.ponto_registros. */
function rhCalcularDia({ entrada, intervalo_saida, intervalo_volta, saida }, config = {}) {
  const metaDiaria = config.metaDiariaHoras != null ? config.metaDiariaHoras : RH_META_DIARIA_FALLBACK;
  const horarioPrevistoMin = config.horarioEntradaPrevisto ? rhParseHora(config.horarioEntradaPrevisto) : null;

  const entMin = rhParseHora(rhHoraCurta(entrada));
  const saiMin = rhParseHora(rhHoraCurta(saida));
  const intSaiMin = rhParseHora(rhHoraCurta(intervalo_saida));
  const intVoltaMin = rhParseHora(rhHoraCurta(intervalo_volta));

  let status = "falta";
  let horasTrabalhadas = null;
  let atrasoMin = 0;

  if (entMin !== null) {
    // Sem horário previsto configurado para este colaborador, não há base
    // pra julgar atraso — trata como "completo" (presente) em vez de
    // inventar uma hora de referência que não é a dele.
    atrasoMin = horarioPrevistoMin != null ? Math.max(0, entMin - horarioPrevistoMin) : 0;
    status = atrasoMin > 5 ? "atraso" : "completo";
    let minutos = 0;
    const fim = saiMin !== null ? saiMin : null;
    if (intSaiMin !== null) {
      minutos += Math.max(0, intSaiMin - entMin);
      if (intVoltaMin !== null && fim !== null) minutos += Math.max(0, fim - intVoltaMin);
    } else if (fim !== null) {
      minutos += Math.max(0, fim - entMin);
    }
    horasTrabalhadas = fim !== null ? minutos / 60 : null;
  }
  const horasExtras = horasTrabalhadas != null ? Math.max(0, horasTrabalhadas - metaDiaria) : 0;

  return { status, horas_trabalhadas: horasTrabalhadas, horas_extras: horasExtras, atraso_min: atrasoMin };
}

function rhMapPontoRow(row) {
  return {
    data: row.data,
    status: row.status,
    entrada: rhHoraCurta(row.entrada),
    intervaloSaida: rhHoraCurta(row.intervalo_saida),
    intervaloVolta: rhHoraCurta(row.intervalo_volta),
    saida: rhHoraCurta(row.saida),
    horasTrabalhadas: row.horas_trabalhadas != null ? Number(row.horas_trabalhadas) : null,
    horasExtras: row.horas_extras != null ? Number(row.horas_extras) : 0,
    atrasoMin: row.atraso_min || 0,
    local: row.local,
    geo: row.geo,
    alteradoPeloRH: row.alterado_pelo_rh,
    pendenteAjuste: row.pendente_ajuste,
  };
}

/** Carrega o estado completo (hoje + histórico) de UM colaborador, direto
 * do banco. `hoje` sempre existe no objeto retornado (mesmo sem nenhuma
 * linha ainda no banco — nesse caso é um "dia vazio" só em memória, que só
 * é gravado de verdade no primeiro bater de ponto). */
async function rhCarregarPonto(colaboradorId) {
  const hojeIso = rhTodayIso();
  const [{ data: rows, error }, { data: colaborador, error: colabErr }] = await Promise.all([
    sb.from("ponto_registros").select("*").eq("colaborador_id", colaboradorId).order("data"),
    sb.from("colaboradores").select(RH_COLABORADOR_JORNADA_COLS).eq("id", colaboradorId).single(),
  ]);
  if (error) throw error;
  if (colabErr) throw colabErr;
  const config = rhConfigJornada(colaborador);

  const todasLinhas = rows || [];
  const linhaHoje = todasLinhas.find((r) => r.data === hojeIso);

  const hoje = linhaHoje
    ? rhMapPontoRow(linhaHoje)
    : { data: hojeIso, status: "hoje", entrada: null, intervaloSaida: null, intervaloVolta: null, saida: null, local: null, geo: null };

  // "historico" é a lista usada pelas telas de Histórico (calendário, busca
  // por data, tabela detalhada) e por isso precisa conter TODOS os dias com
  // dado — inclusive hoje. Antes esta lista excluía a data de hoje
  // (`.filter(r => r.data !== hojeIso)`), o que fazia a aba "Histórico"
  // nunca encontrar o registro do dia atual: `porData()`/`registrosDoPeriodo()`
  // em colaborador/ponto.html só procuram nesta lista, então o dia de hoje
  // sempre caía no fallback de "Sem registro"/"Fim de semana", mesmo com
  // ponto batido e salvo corretamente no banco (a aba "Hoje" lê de `hoje`,
  // por isso sempre mostrava certo). Corrige a causa raiz aqui, na origem
  // do dado, em vez de remendar cada tela que consome `historico`.
  const historico = todasLinhas.map(rhMapPontoRow);
  if (!linhaHoje) historico.push({ ...hoje });
  historico.sort((a, b) => a.data.localeCompare(b.data));

  // O saldo de banco de horas continua contando só os dias JÁ FECHADOS
  // (exclui hoje explicitamente por data, não mais "por ausência da lista")
  // — hoje ainda está em andamento, então atraso/hora-extra do dia não deve
  // entrar no saldo acumulado até a jornada terminar.
  const historicoFechado = historico.filter((r) => r.data !== hojeIso);
  const horasDevendo = historicoFechado.reduce((acc, r) => acc + (Number(r.atrasoMin) || 0) / 60, 0);
  const horasAcumuladas = historicoFechado.reduce((acc, r) => acc + (Number(r.horasExtras) || 0), 0);

  return {
    colaboradorId,
    hoje,
    historico,
    metaDiaria: config.metaDiariaHoras,
    diasTrabalho: config.diasTrabalho,
    saldoBancoHoras: horasAcumuladas - horasDevendo,
  };
}

/** Grava o dia de HOJE do colaborador logado — único dia que a política de
 * RLS permite ao próprio colaborador escrever. Faz upsert (cria se for o
 * primeiro ponto do dia, atualiza nas próximas batidas). Busca a jornada
 * REAL do colaborador (rh.colaboradores) antes de calcular — nunca mais
 * "08:00"/8h fixos pra todo mundo (ver rhConfigJornada / rhCalcularDia). */
async function rhSalvarPontoHoje(colaboradorId, diaHoje) {
  const config = await rhBuscarConfigJornada(colaboradorId);
  const calculo = rhCalcularDia({ entrada: diaHoje.entrada, intervalo_saida: diaHoje.intervaloSaida, intervalo_volta: diaHoje.intervaloVolta, saida: diaHoje.saida }, config);
  const payload = {
    colaborador_id: colaboradorId,
    data: rhTodayIso(),
    entrada: diaHoje.entrada || null,
    intervalo_saida: diaHoje.intervaloSaida || null,
    intervalo_volta: diaHoje.intervaloVolta || null,
    saida: diaHoje.saida || null,
    local: diaHoje.local || null,
    geo: diaHoje.geo || null,
    ...calculo,
  };
  const { data, error } = await sb.from("ponto_registros").upsert(payload, { onConflict: "colaborador_id,data" }).select().single();
  if (error) throw error;
  return rhMapPontoRow(data);
}

/** Extrai a lista de itens {campo, campoLabel, horario} de um ajuste de
 * ponto, aceitando tanto o formato atual (`ajuste.itens`, um ou mais
 * registros por solicitação) quanto o formato antigo, singular
 * (`{campo, campoLabel, horario}` direto no objeto) — necessário porque
 * pode haver solicitações antigas ainda PENDENTES no banco, criadas antes
 * desta mudança, e elas continuam precisando ser aprovadas/recusadas
 * normalmente. */
function rhItensAjustePonto(ajuste) {
  if (!ajuste) return [];
  if (Array.isArray(ajuste.itens) && ajuste.itens.length) return ajuste.itens;
  if (ajuste.campo) return [{ campo: ajuste.campo, campoLabel: ajuste.campoLabel, horario: ajuste.horario }];
  return [];
}

/** Cria o pedido de ajuste de ponto — uma linha real em rh.solicitacoes
 * (não mais um "flag" dentro do próprio registro de ponto, porque a
 * política de RLS não deixa o colaborador editar um dia que não seja hoje;
 * o RH é quem aplica a correção de fato quando aprova).
 * `itens` é uma lista de {campo, campoLabel, horario} — um por registro do
 * dia que precisa ser ajustado (pode ser 1, alguns, ou os 4). `modo` é só
 * metadado de exibição ("dia" = ajuste do dia inteiro, "pontos" = um ou
 * mais registros específicos), não muda como a aprovação é aplicada. */
async function rhCriarAjustePonto({ colaboradorId, colaboradorNome, data, modo, itens, justificativa }) {
  if (!Array.isArray(itens) || !itens.length) throw new Error("Informe pelo menos um horário para ajustar.");
  const protocolo = `PTO-${Date.now().toString(36).toUpperCase()}`;
  const modoLabel = modo === "dia" ? "Ajuste do dia inteiro" : itens.length > 1 ? "Ajuste de múltiplos registros" : "Ajuste de registro";
  const resumo = itens.map((it) => `${it.campoLabel} → ${it.horario}`).join(", ");
  const descricao = `${modoLabel} em ${data} — ${resumo}. Motivo: ${justificativa}`;
  const { data: row, error } = await sb
    .from("solicitacoes")
    .insert({
      protocolo,
      colaborador_id: colaboradorId,
      categoria: "Ajuste de ponto",
      descricao,
      status: "PENDENTE",
      prioridade: "normal",
      ajuste_ponto: { data, modo: modo || "pontos", itens, justificativa: justificativa || "" },
    })
    .select()
    .single();
  if (error) throw error;
  return row;
}

/** Para o calendário do colaborador mostrar "Ajuste pendente" nos dias
 * certos: busca as solicitações de ajuste de ponto ainda PENDENTES dele e
 * devolve um mapa data → objeto de ajuste (com `itens`, ver rhItensAjustePonto). */
async function rhDiasComAjustePendente(colaboradorId) {
  const { data, error } = await sb
    .from("solicitacoes")
    .select("ajuste_ponto")
    .eq("colaborador_id", colaboradorId)
    .eq("categoria", "Ajuste de ponto")
    .eq("status", "PENDENTE");
  if (error) throw error;
  const mapa = {};
  (data || []).forEach((s) => {
    if (s.ajuste_ponto?.data) mapa[s.ajuste_ponto.data] = s.ajuste_ponto;
  });
  return mapa;
}

/** RH: aprova ou recusa um pedido de ajuste de ponto. Se aprovado, aplica
 * TODOS os itens do pedido de uma vez (um dia pode ter vários registros
 * corrigidos/lançados na mesma solicitação) no dia informado
 * (rh.ponto_registros), recalculando status/horas/atraso uma única vez com
 * o resultado final, e marca "alterado_pelo_rh". */
async function rhResolverAjustePonto(solicitacaoId, aprovado, resolvidoPorNome) {
  const { data: solicitacao, error: getErr } = await sb.from("solicitacoes").select("*").eq("id", solicitacaoId).single();
  if (getErr) throw getErr;
  const ajuste = solicitacao.ajuste_ponto;
  if (!ajuste) throw new Error("Esta solicitação não tem dados de ajuste de ponto associados.");
  const itens = rhItensAjustePonto(ajuste);
  if (!itens.length) throw new Error("Esta solicitação não tem nenhum registro de ajuste.");

  if (aprovado) {
    const { data: linhaAtual } = await sb
      .from("ponto_registros")
      .select("*")
      .eq("colaborador_id", solicitacao.colaborador_id)
      .eq("data", ajuste.data)
      .maybeSingle();

    const colunaPorCampo = { entrada: "entrada", intervaloSaida: "intervalo_saida", intervaloVolta: "intervalo_volta", saida: "saida" };
    const base = {
      entrada: linhaAtual?.entrada || null,
      intervalo_saida: linhaAtual?.intervalo_saida || null,
      intervalo_volta: linhaAtual?.intervalo_volta || null,
      saida: linhaAtual?.saida || null,
    };
    for (const item of itens) {
      const coluna = colunaPorCampo[item.campo];
      if (!coluna) throw new Error("Campo de ajuste desconhecido: " + item.campo);
      base[coluna] = item.horario;
    }
    const config = await rhBuscarConfigJornada(solicitacao.colaborador_id);
    const calculo = rhCalcularDia(base, config);
    const resumo = itens.map((it) => `${it.campoLabel} definido para ${it.horario}`).join("; ");

    const payload = {
      colaborador_id: solicitacao.colaborador_id,
      data: ajuste.data,
      ...base,
      ...calculo,
      local: linhaAtual?.local || null,
      geo: linhaAtual?.geo || null,
      pendente_ajuste: null,
      alterado_pelo_rh: { por: resolvidoPorNome || "RH", em: new Date().toISOString(), motivo: `Ajuste aprovado — ${resumo}.` },
    };
    const { error: upsertErr } = await sb.from("ponto_registros").upsert(payload, { onConflict: "colaborador_id,data" });
    if (upsertErr) throw upsertErr;
  }

  const { error: updErr } = await sb
    .from("solicitacoes")
    .update({ status: aprovado ? "RESOLVIDA" : "RECUSADA" })
    .eq("id", solicitacaoId);
  if (updErr) throw updErr;
  return true;
}
