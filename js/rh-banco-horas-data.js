/*
 * BSconta+ Banco de horas — compensação automática (Supabase:
 * rh.banco_horas_movimentos + rh.banco_horas_compensacoes, script 30)
 * =============================================================================
 * O cálculo é feito NO BANCO por rh.banco_horas_processar() (roda sozinho
 * todo dia às 00:20 pelo pg_cron, e as telas do RH chamam de novo ao abrir,
 * para refletir ajustes recentes), a partir da apuração única
 * rh.ponto_apuracao() (script 33 — mesma regra da Folha de Ponto):
 *   * Saldo do dia = trabalhadas + abono − previstas (feriado e fim de
 *     semana: previstas 0; falta sem abono: −jornada; tolerância diária).
 *   * Saldo positivo = horas extras do dia; negativo = horas devidas.
 *   * Saldo inicial = rh.banco_horas_saldos_iniciais (saldo anterior).
 *   * Havendo horas extras acumuladas e horas devidas pendentes, o sistema
 *     abate automaticamente o menor dos dois (ex.: +5h e −2h → abate 2h →
 *     restam +3h) e registra a compensação.
 * Cada compensação aparece para o RH em Comunicados → "Comunicados do
 * Sistema" até ser visualizada; depois fica arquivada. O histórico completo
 * fica em Banco de Horas (rh/banco-horas.html).
 */

/** Recalcula o banco de horas (idempotente). Nunca trava a tela: se a
 * migração 30 não rodou ou falhar, só devolve null. */
async function rhProcessarBancoHoras() {
  try {
    const { data, error } = await sb.rpc("banco_horas_processar");
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn("rhProcessarBancoHoras:", e);
    return null;
  }
}

function rhMapCompensacao(r) {
  return {
    id: r.id,
    colaboradorId: r.colaborador_id,
    colaboradorNome: r.colaborador?.nome || "—",
    dataReferencia: r.data_referencia,
    extrasDisponiveisMin: r.extras_disponiveis_min,
    devidasMin: r.devidas_min,
    abatidoMin: r.abatido_min,
    extrasRestantesMin: r.extras_restantes_min,
    devidasRestantesMin: r.devidas_restantes_min,
    saldoAnteriorMin: r.saldo_anterior_min,
    saldoAposMin: r.saldo_apos_min,
    motivo: r.motivo,
    status: r.status,
    processadoEm: r.processado_em,
    recalculadoEm: r.recalculado_em,
    visualizadoEm: r.visualizado_em,
    visualizadoPor: r.visualizado_por,
  };
}

/** Compensações (mais recentes primeiro). Filtros opcionais:
 * colaboradorId, inicio/fim (data de referência, YYYY-MM-DD), somenteNovas. */
async function rhListarCompensacoes({ colaboradorId, inicio, fim, somenteNovas } = {}) {
  let q = sb
    .from("banco_horas_compensacoes")
    .select("*, colaborador:colaboradores(nome)")
    .order("data_referencia", { ascending: false })
    .order("processado_em", { ascending: false });
  if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
  if (inicio) q = q.gte("data_referencia", inicio);
  if (fim) q = q.lte("data_referencia", fim);
  if (somenteNovas) q = q.is("visualizado_em", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(rhMapCompensacao);
}

/** Extrato (movimentações por dia) — ordem cronológica. */
async function rhListarMovimentosBancoHoras({ colaboradorId, inicio, fim } = {}) {
  let q = sb
    .from("banco_horas_movimentos")
    .select("*, colaborador:colaboradores(nome)")
    .order("data", { ascending: true });
  if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
  if (inicio) q = q.gte("data", inicio);
  if (fim) q = q.lte("data", fim);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r) => ({
    colaboradorId: r.colaborador_id,
    colaboradorNome: r.colaborador?.nome || "—",
    data: r.data,
    tipo: r.tipo,
    extrasMin: r.extras_min,
    devidasMin: r.devidas_min,
    atrasoMin: r.atraso_min,
    intervaloExcedenteMin: r.intervalo_excedente_min,
    compensadoMin: r.compensado_min,
    extrasAntesMin: r.extras_antes_min,
    devidasAntesMin: r.devidas_antes_min,
    extrasAposMin: r.extras_apos_min,
    devidasAposMin: r.devidas_apos_min,
    saldoAposMin: r.saldo_apos_min,
    saldoDiaMin: r.saldo_dia_min != null ? r.saldo_dia_min : (r.extras_min || 0) - (r.devidas_min || 0),
    tipoDia: r.tipo_dia || null,
    descricao: r.descricao || null,
    trabalhadasMin: r.trabalhadas_min,
    previstasMin: r.previstas_min,
    abonoMin: r.abono_min,
  }));
}

/** Situação atual de cada colaborador (último movimento): extras
 * disponíveis, devidas pendentes, saldo. Mapa colaboradorId → resumo. */
async function rhResumoBancoHoras() {
  const { data, error } = await sb
    .from("banco_horas_movimentos")
    .select("colaborador_id, data, extras_apos_min, devidas_apos_min, saldo_apos_min")
    .order("data", { ascending: false });
  if (error) throw error;
  const mapa = {};
  (data || []).forEach((r) => {
    if (mapa[r.colaborador_id]) return;
    mapa[r.colaborador_id] = { ateData: r.data, extrasMin: r.extras_apos_min, devidasMin: r.devidas_apos_min, saldoMin: r.saldo_apos_min };
  });
  return mapa;
}

/** RH: marca compensações como visualizadas (vão para "Arquivados"). */
async function rhMarcarCompensacoesVisualizadas(ids, nome) {
  if (!ids || !ids.length) return 0;
  const { data, error } = await sb.rpc("banco_horas_marcar_visualizado", { p_ids: ids, p_nome: nome || null });
  if (error) throw error;
  return data || 0;
}

/** Texto objetivo do comunicado (o mesmo formato pedido pelo RH). */
function rhTextoComunicadoCompensacao(c) {
  const h = (m) => fmtMinutos(m);
  return [
    `Colaborador: ${c.colaboradorNome}`,
    `Horas extras disponíveis: ${h(c.extrasDisponiveisMin)}`,
    `Horas devidas: ${h(c.devidasMin)}`,
    `Horas abatidas automaticamente: ${h(c.abatidoMin)}`,
    `Saldo restante: ${h(c.extrasRestantesMin)}${c.devidasRestantesMin > 0 ? ` (ainda devendo ${h(c.devidasRestantesMin)})` : ""}`,
    `Data da compensação: ${new Date(c.processadoEm).toLocaleDateString("pt-BR")} (referente a ${fmtDate(c.dataReferencia)})`,
  ].join("\n");
}

/** CSV (separador ;) para o relatório de compensações. */
function rhCompensacoesParaCsv(linhas) {
  const h = (m) => (Number(m) / 60).toFixed(2).replace(".", ",");
  const cab = ["Colaborador", "Data de referência", "Data do processamento", "Horas extras disponíveis (h)", "Horas devidas (h)", "Horas compensadas (h)", "Saldo anterior (h)", "Saldo após (h)", "Extras restantes (h)", "Devidas restantes (h)", "Situação", "Motivo", "Visualizado em", "Visualizado por"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = linhas.map((c) => [
    c.colaboradorNome, fmtDate(c.dataReferencia), new Date(c.processadoEm).toLocaleString("pt-BR"),
    h(c.extrasDisponiveisMin), h(c.devidasMin), h(c.abatidoMin), h(c.saldoAnteriorMin), h(c.saldoAposMin),
    h(c.extrasRestantesMin), h(c.devidasRestantesMin), c.status === "CANCELADA" ? "Cancelada" : "Ativa", c.motivo,
    c.visualizadoEm ? new Date(c.visualizadoEm).toLocaleString("pt-BR") : "", c.visualizadoPor || "",
  ]);
  return "﻿" + [cab, ...rows].map((r) => r.map(q).join(";")).join("\n");
}

/** CSV do extrato (histórico das movimentações). */
function rhMovimentosParaCsv(linhas) {
  const h = (m) => (Number(m) / 60).toFixed(2).replace(".", ",");
  const cab = ["Colaborador", "Data", "Tipo", "Situação do dia", "Trabalhadas (h)", "Previstas (h)", "Abono (h)", "Saldo do dia (h)", "Horas extras geradas (h)", "Horas devidas (h)", "Compensado (h)", "Extras após (h)", "Devidas após (h)", "Saldo após (h)"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = linhas.map((m) => [
    m.colaboradorNome, fmtDate(m.data), m.tipo === "SALDO_INICIAL" ? "Saldo acumulado anterior" : "Dia",
    m.descricao || (typeof RH_TIPO_DIA_LABEL !== "undefined" ? RH_TIPO_DIA_LABEL[m.tipoDia] : m.tipoDia) || "",
    m.trabalhadasMin != null ? h(m.trabalhadasMin) : "", m.previstasMin != null ? h(m.previstasMin) : "", m.abonoMin != null ? h(m.abonoMin) : "", h(m.saldoDiaMin),
    h(m.extrasMin), h(m.devidasMin), h(m.compensadoMin),
    h(m.extrasAposMin), h(m.devidasAposMin), h(m.saldoAposMin),
  ]);
  return "﻿" + [cab, ...rows].map((r) => r.map(q).join(";")).join("\n");
}

function rhBaixarArquivo(nome, conteudo, tipo = "text/csv;charset=utf-8") {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// ---------------------------------------------------------------------------
// Saldo anterior (saldo inicial) e tolerância por colaborador — script 33
// ---------------------------------------------------------------------------

/** "+1:30", "-0:42", "2:05", "-12" (horas) → minutos. null se inválido. */
function rhParseSaldoHHMM(txt) {
  const s = String(txt || "").trim().replace(",", ":").replace(/h$/i, "");
  if (!s) return 0;
  const m = s.match(/^([+-]?)(\d{1,4})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const min = Number(m[2]) * 60 + Number(m[3] || 0);
  if (m[3] && Number(m[3]) > 59) return null;
  return m[1] === "-" ? -min : min;
}
function rhFmtSaldoHHMM(min) {
  const n = Number(min) || 0;
  const a = Math.abs(n);
  return `${n < 0 ? "-" : n > 0 ? "+" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
}

/** Mapa colaboradorId → { minutos, dataReferencia, origem }. */
async function rhListarSaldosIniciais() {
  const { data, error } = await sb.from("banco_horas_saldos_iniciais").select("*");
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.colaborador_id, { minutos: r.minutos, dataReferencia: r.data_referencia, origem: r.origem }]));
}

async function rhSalvarSaldoInicial({ colaboradorId, minutos, dataReferencia, autor }) {
  const { error } = await sb.from("banco_horas_saldos_iniciais").upsert({
    colaborador_id: colaboradorId,
    minutos: Math.round(Number(minutos) || 0),
    data_referencia: dataReferencia,
    origem: "Informado pelo RH",
    updated_by_nome: autor || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "colaborador_id" });
  if (error) throw error;
}

async function rhSalvarToleranciaColaborador(colaboradorId, minutos) {
  const v = minutos === "" || minutos == null ? null : Math.max(0, Math.min(120, Math.round(Number(minutos))));
  const { error } = await sb.from("colaboradores").update({ tolerancia_diaria_min: v }).eq("id", colaboradorId);
  if (error) throw error;
}

/** Tolerâncias por colaborador (null = padrão da empresa). */
async function rhListarToleranciasColaboradores() {
  const { data, error } = await sb.from("colaboradores").select("id, tolerancia_diaria_min");
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.id, r.tolerancia_diaria_min]));
}
