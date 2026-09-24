/*
 * BSconta+ RH — Ocorrências consolidadas para os Relatórios
 * =============================================================================
 * Junta, numa lista única e filtrável, tudo o que o RH precisa consultar:
 *   - Faltas (dia útil sem entrada registrada), classificadas como
 *     JUSTIFICADA (há abono APROVADO justificado cobrindo o dia) ou
 *     NÃO JUSTIFICADA (sem abono, ou abono do tipo "falta não justificada");
 *   - Atrasos (rh.ponto_registros.atraso_min);
 *   - Abonos / atestados (rh.colaborador_abonos — migração 22);
 *   - Férias (rh.ferias_solicitacoes);
 *   - Ajustes de ponto (rh.solicitacoes, categoria "Ajuste de ponto").
 * Só LÊ dados — nada é gravado. Se a migração 22 ainda não estiver aplicada,
 * os abonos ficam vazios e o resto continua funcionando.
 *
 * Regra de "falta" (mesma lógica das telas de ponto): dia de trabalho do
 * colaborador (dias_trabalho), a partir da admissão e até o desligamento,
 * a partir do início do controle de ponto (Configurações > Regras de ponto,
 * ou o primeiro registro de ponto do sistema), anterior a hoje, sem entrada
 * registrada e sem férias aprovadas no dia.
 */

const RH_OCORRENCIA_CATEGORIAS = {
  FALTA: "Falta",
  ATRASO: "Atraso",
  ATESTADO: "Atestado",
  ABONO: "Abono",
  FERIAS: "Férias",
  AJUSTE: "Ajuste de ponto",
};

const RH_OCORRENCIA_STATUS = {
  PENDENTE: "Pendente",
  PRE_APROVADO: "Pré-aprovado",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  ARQUIVADO: "Arquivado",
  REGISTRADO: "Registrado",
};

const RH_JUSTIFICACAO = { JUSTIFICADA: "Justificada", NAO_JUSTIFICADA: "Não justificada", EM_ANALISE: "Aguardando abono" };

function rhIsoMaisDias(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rhHojeIsoOcorr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function rhCarregarOcorrencias({ inicio, fim }) {
  const hoje = rhHojeIsoOcorr();
  fim = fim || hoje;
  const [colabRes, pontoRes, primeiroPontoRes, feriasRes, ajustesRes] = await Promise.all([
    sb.from("colaboradores").select("id, codigo, nome, cargo, departamento, status, admissao, data_desligamento, dias_trabalho").order("nome"),
    sb.from("ponto_registros").select("colaborador_id, data, status, entrada, atraso_min, alterado_pelo_rh").gte("data", inicio).lte("data", fim),
    sb.from("ponto_registros").select("data").order("data", { ascending: true }).limit(1),
    sb.from("ferias_solicitacoes").select("id, colaborador_id, inicio, fim, dias, status, observacoes").lte("inicio", fim).gte("fim", inicio),
    sb.from("solicitacoes").select("id, colaborador_id, status, ajuste_ponto, created_at").eq("categoria", "Ajuste de ponto"),
  ]);
  for (const r of [colabRes, pontoRes, primeiroPontoRes, feriasRes, ajustesRes]) if (r.error) throw r.error;

  let abonos = [];
  try { abonos = await rhListarAbonos({ inicio, fim }); } catch (e) { abonos = []; }
  const config = typeof rhCarregarConfigPonto === "function" ? await rhCarregarConfigPonto() : {};
  const controleInicio = config.controle_ponto_inicio || primeiroPontoRes.data?.[0]?.data || hoje;

  const colabs = colabRes.data || [];
  const porColab = new Map(colabs.map((c) => [c.id, c]));
  const pontoIdx = new Map();
  (pontoRes.data || []).forEach((r) => pontoIdx.set(`${r.colaborador_id}|${r.data}`, r));
  const ferias = feriasRes.data || [];
  const linhas = [];

  const base = (c) => ({ colaboradorId: c.id, colaborador: c.nome, codigo: c.codigo || "", departamento: c.departamento || "", cargo: c.cargo || "" });

  // --- Faltas e atrasos (dia a dia) ---
  const ultimoDia = fim < hoje ? fim : rhIsoMaisDias(hoje, -1);
  colabs.forEach((c) => {
    if (c.status === "AFASTADO") return;
    let d = inicio > controleInicio ? inicio : controleInicio;
    if (c.admissao && d < c.admissao) d = c.admissao;
    const limite = c.data_desligamento && c.data_desligamento < ultimoDia ? c.data_desligamento : ultimoDia;
    let guard = 0;
    while (d <= limite && guard++ < 800) {
      const reg = pontoIdx.get(`${c.id}|${d}`);
      const diaUtil = rhEhDiaDeTrabalho(c.dias_trabalho, d);
      if (reg && reg.entrada) {
        if ((reg.atraso_min || 0) > (typeof RH_TOLERANCIA_ATRASO_MIN !== "undefined" ? RH_TOLERANCIA_ATRASO_MIN : 15)) {
          linhas.push({ ...base(c), data: d, dataFim: d, categoria: "ATRASO", situacao: "Atraso", justificacao: null, tipo: `${reg.atraso_min} min`, motivo: reg.alterado_pelo_rh ? "Alterado pelo RH" : "", status: "REGISTRADO", dias: 1 });
        }
      } else if (diaUtil || reg?.status === "falta") {
        const emFerias = ferias.some((f) => f.colaborador_id === c.id && f.status === "APROVADA" && f.inicio <= d && f.fim >= d);
        if (!emFerias) {
          const abonosDia = abonos.filter((a) => a.colaborador_id === c.id && a.data_inicio <= d && a.data_fim >= d && a.status !== "ARQUIVADO" && a.status !== "RECUSADO");
          const aprovado = abonosDia.find((a) => a.status === "APROVADO");
          const emAnalise = abonosDia.find((a) => a.status === "PENDENTE" || a.status === "PRE_APROVADO");
          let justificacao = "NAO_JUSTIFICADA", tipo = "", motivo = reg ? "" : "Sem registro de ponto";
          if (aprovado) {
            justificacao = aprovado.justificada ? "JUSTIFICADA" : "NAO_JUSTIFICADA";
            tipo = RH_TIPOS_ABONO[aprovado.tipo]?.label || aprovado.tipo;
            motivo = aprovado.motivo || tipo;
          } else if (emAnalise) {
            justificacao = "EM_ANALISE";
            tipo = RH_TIPOS_ABONO[emAnalise.tipo]?.label || emAnalise.tipo;
            motivo = `${tipo} aguardando aprovação`;
          }
          linhas.push({ ...base(c), data: d, dataFim: d, categoria: "FALTA", situacao: "Falta", justificacao, tipo, motivo, status: aprovado ? "APROVADO" : emAnalise ? "PENDENTE" : "REGISTRADO", dias: 1 });
        }
      }
      d = rhIsoMaisDias(d, 1);
    }
  });

  // --- Abonos / atestados ---
  abonos.forEach((a) => {
    const c = porColab.get(a.colaborador_id);
    if (!c) return;
    const tipoLabel = RH_TIPOS_ABONO[a.tipo]?.label || a.tipo;
    linhas.push({
      ...base(c), data: a.data_inicio, dataFim: a.data_fim, categoria: a.tipo === "ATESTADO" ? "ATESTADO" : "ABONO",
      situacao: tipoLabel, justificacao: a.justificada ? "JUSTIFICADA" : "NAO_JUSTIFICADA", tipo: tipoLabel,
      motivo: a.motivo || a.descricao || "", status: a.status, dias: a.dias,
    });
  });

  // --- Férias ---
  const mapaFerias = { PENDENTE: "PENDENTE", EM_ANALISE: "PENDENTE", PRE_APROVADA: "PRE_APROVADO", APROVADA: "APROVADO", RECUSADA: "RECUSADO" };
  ferias.forEach((f) => {
    const c = porColab.get(f.colaborador_id);
    if (!c) return;
    linhas.push({ ...base(c), data: f.inicio, dataFim: f.fim, categoria: "FERIAS", situacao: "Férias", justificacao: "JUSTIFICADA", tipo: "Férias", motivo: f.observacoes || "", status: mapaFerias[f.status] || f.status, dias: f.dias });
  });

  // --- Ajustes de ponto ---
  const mapaAjuste = { PENDENTE: "PENDENTE", EM_ANALISE: "PENDENTE", RESOLVIDA: "APROVADO", RECUSADA: "RECUSADO" };
  (ajustesRes.data || []).forEach((s) => {
    const dia = s.ajuste_ponto?.data;
    if (!dia || dia < inicio || dia > fim) return;
    const c = porColab.get(s.colaborador_id);
    if (!c) return;
    const itens = rhItensAjustePonto(s.ajuste_ponto);
    linhas.push({ ...base(c), data: dia, dataFim: dia, categoria: "AJUSTE", situacao: "Ajuste de ponto", justificacao: null, tipo: itens.map((i) => `${i.campoLabel} ${i.horario}`).join(", "), motivo: s.ajuste_ponto?.justificativa || "", status: mapaAjuste[s.status] || s.status, dias: 1 });
  });

  linhas.sort((a, b) => (a.data === b.data ? a.colaborador.localeCompare(b.colaborador, "pt-BR") : b.data.localeCompare(a.data)));
  return { linhas, controleInicio, colaboradores: colabs };
}

/** Aplica os filtros da Pesquisa Personalizada. Campos vazios = sem filtro. */
function rhFiltrarOcorrencias(linhas, f) {
  const texto = (f.busca || "").trim().toLowerCase();
  return linhas.filter((l) => {
    if (f.inicio && l.dataFim < f.inicio) return false;
    if (f.fim && l.data > f.fim) return false;
    if (f.colaboradorId && l.colaboradorId !== f.colaboradorId) return false;
    if (f.codigo && !String(l.codigo).toLowerCase().includes(f.codigo.toLowerCase())) return false;
    if (f.departamento && l.departamento !== f.departamento) return false;
    if (f.cargo && l.cargo !== f.cargo) return false;
    if (f.categorias && f.categorias.length && !f.categorias.includes(l.categoria)) return false;
    if (f.justificacao && l.justificacao !== f.justificacao) return false;
    if (f.status && l.status !== f.status) return false;
    if (texto && !`${l.colaborador} ${l.motivo} ${l.tipo}`.toLowerCase().includes(texto)) return false;
    return true;
  });
}

const RH_OCORRENCIA_COLUNAS = [
  { id: "data", label: "Data", valor: (l) => (l.data === l.dataFim ? fmtDate(l.data) : `${fmtDate(l.data)} a ${fmtDate(l.dataFim)}`), padrao: true },
  { id: "colaborador", label: "Colaborador", valor: (l) => l.colaborador, padrao: true },
  { id: "codigo", label: "Código", valor: (l) => l.codigo || "—", padrao: false },
  { id: "departamento", label: "Departamento", valor: (l) => l.departamento || "—", padrao: true },
  { id: "cargo", label: "Cargo", valor: (l) => l.cargo || "—", padrao: false },
  { id: "situacao", label: "Situação", valor: (l) => l.situacao, padrao: true },
  { id: "justificacao", label: "Justificação", valor: (l) => (l.justificacao ? RH_JUSTIFICACAO[l.justificacao] : "—"), padrao: true },
  { id: "motivo", label: "Motivo", valor: (l) => l.motivo || l.tipo || "—", padrao: true },
  { id: "dias", label: "Dias", valor: (l) => String(l.dias ?? 1), padrao: false },
  { id: "status", label: "Status", valor: (l) => RH_OCORRENCIA_STATUS[l.status] || l.status || "—", padrao: true },
];

function rhOcorrenciasParaCsv(linhas, colunas) {
  const cols = RH_OCORRENCIA_COLUNAS.filter((c) => colunas.includes(c.id));
  const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = cols.map((c) => escCsv(c.label)).join(";");
  const body = linhas.map((l) => cols.map((c) => escCsv(c.valor(l))).join(";")).join("\r\n");
  return "﻿" + header + "\r\n" + body;
}
