/*
 * BSconta+ Banco de horas — compensação automática (Supabase:
 * rh.banco_horas_movimentos + rh.banco_horas_compensacoes, script 30)
 * =============================================================================
 * O cálculo é feito NO BANCO por rh.banco_horas_processar() (roda sozinho
 * todo dia às 00:20 pelo pg_cron, e as telas do RH chamam de novo ao abrir,
 * para refletir ajustes recentes). Regras:
 *   * Horas extras do dia = trabalhado além da jornada prevista.
 *   * Horas devidas do dia = atraso + intervalo acima do mínimo não
 *     compensado no mesmo dia.
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
  const cab = ["Colaborador", "Data", "Tipo", "Horas extras geradas (h)", "Horas devidas (h)", "Atraso (h)", "Intervalo acima do mínimo (h)", "Compensado (h)", "Extras após (h)", "Devidas após (h)", "Saldo após (h)"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = linhas.map((m) => [
    m.colaboradorNome, fmtDate(m.data), m.tipo === "SALDO_INICIAL" ? "Saldo acumulado anterior" : "Dia",
    h(m.extrasMin), h(m.devidasMin), h(m.atrasoMin), h(m.intervaloExcedenteMin), h(m.compensadoMin),
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
