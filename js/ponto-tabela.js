/* =============================================================================
 * Tabela "Registros detalhados" do ponto — compartilhada entre a tela do
 * colaborador (colaborador/ponto.html) e a do RH (rh/ponto.html).
 *
 * Colunas: Data · Entrada · Saída intervalo · Retorno · Saída ·
 *          Total trabalhado (com "de X previstas" e abono) · Saldo ·
 *          Local · Status (com "Alterado pelo RH")
 *
 * Cada página passa só o que é dela (status do dia, texto da saída quando
 * falta batida, link do mapa). O resto do visual vive aqui.
 * ============================================================================= */
(function injetarCssPontoTabela() {
  if (document.getElementById("pt-tabela-css")) return;
  const css = `
.table-scroll:has(.pt-table){overflow-x:visible!important;background:none!important}
.pt-table{width:100%;min-width:0!important;table-layout:auto;border-collapse:separate;border-spacing:0;font-variant-numeric:tabular-nums}
.pt-table thead th{background:var(--surface,#fff);font-size:.62rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#98a2b3;padding:.6rem .4rem;border-bottom:1px solid #eaecf0;text-align:left;white-space:normal!important;line-height:1.25}
.pt-table thead th.pt-grp{color:#667085}
.pt-table thead tr.pt-head-grp th{padding:.45rem .6rem .1rem;border-bottom:0;font-size:.6rem}
.pt-table thead tr.pt-head-grp th.pt-batidas-h{text-align:center;color:#2f5bea}
.pt-table thead tr.pt-head-grp th.pt-batidas-h span{display:block;border-bottom:2px solid rgba(47,91,234,.25);padding-bottom:.25rem}
.pt-table tbody td{white-space:normal!important;padding:.6rem .4rem;border-bottom:1px solid #f2f4f7;vertical-align:middle;font-size:.84rem;color:#344054}
.pt-table tbody tr:hover td{background:#f9fafb}
.pt-table .num{text-align:right}
.pt-table .ctr{text-align:center}
.pt-date b{display:block;font-weight:800;color:#1d2939;font-size:.86rem}
.pt-date small{display:block;font-size:.66rem;font-weight:700;color:#98a2b3;text-transform:uppercase;letter-spacing:.04em}
.pt-hora{display:inline-block;min-width:2.9rem;text-align:center;padding:.22rem .45rem;border-radius:7px;background:#f2f4f7;color:#1d2939;font-weight:700;font-size:.8rem}
.pt-hora.vazio{background:transparent;color:#d0d5dd;font-weight:600}
.pt-hora.falta{background:#fff7ed;color:#c2410c;font-size:.68rem}
.pt-hora.andamento{background:#eef4ff;color:#2f5bea;font-size:.68rem}
.pt-sub{display:block;margin-top:.2rem;font-size:.64rem;font-weight:700;color:#98a2b3;white-space:nowrap}
.pt-sub.red{color:#d92d20}.pt-sub.violet{color:#7a5af8}
.pt-total{text-align:right;background:rgba(47,91,234,.035)}
.pt-table thead th.pt-total-h{background:#f4f7ff;color:#2f5bea;text-align:right}
.pt-total b{font-size:.98rem;font-weight:800;color:#1d2939}
.pt-total b.parcial{color:#2f5bea}
.pt-total b.zero{color:#d0d5dd;font-weight:700}
.pt-saldo{display:inline-block;min-width:3.6rem;text-align:center;padding:.22rem .5rem;border-radius:999px;font-weight:800;font-size:.76rem;background:#f2f4f7;color:#667085}
.pt-saldo.pos{background:#ecfdf3;color:#067647}.pt-saldo.neg{background:#fef3f2;color:#d92d20}
.pt-saldo.hint{background:transparent;color:#98a2b3;font-weight:600;font-size:.68rem;min-width:0;padding:0}
.pt-table tr.pt-hoje td{background:#f5f8ff}
.pt-table tr.pt-hoje td:first-child{box-shadow:inset 3px 0 0 #2f5bea}
.pt-table tr.pt-folga td{background:#fcfcfd;color:#98a2b3}
.pt-table tr.pt-pend td:first-child{box-shadow:inset 3px 0 0 #f97316}
.pt-table tr.pt-falta td:first-child{box-shadow:inset 3px 0 0 #f04438}
.pt-status{display:flex;flex-direction:column;align-items:flex-start;gap:.3rem}
.pt-status .badge-alterado{font-size:.62rem}
html[data-theme="dark"] .pt-table thead th{background:var(--surface);border-bottom-color:var(--border);color:#98a2b3}
html[data-theme="dark"] .pt-table thead th.pt-total-h{background:rgba(47,91,234,.14);color:#93b0ff}
html[data-theme="dark"] .pt-table tbody td{border-bottom-color:var(--border);color:var(--text,#e4e7ec)}
html[data-theme="dark"] .pt-table tbody tr:hover td{background:rgba(255,255,255,.03)}
html[data-theme="dark"] .pt-date b,html[data-theme="dark"] .pt-total b{color:#f2f4f7}
html[data-theme="dark"] .pt-hora{background:rgba(255,255,255,.07);color:#f2f4f7}
html[data-theme="dark"] .pt-hora.vazio{background:transparent;color:#475467}
html[data-theme="dark"] .pt-hora.falta{background:rgba(249,115,22,.14);color:#fdba74}
html[data-theme="dark"] .pt-hora.andamento{background:rgba(47,91,234,.16);color:#93b0ff}
html[data-theme="dark"] .pt-total{background:rgba(47,91,234,.07)}
html[data-theme="dark"] .pt-saldo{background:rgba(255,255,255,.07);color:#98a2b3}
html[data-theme="dark"] .pt-saldo.pos{background:rgba(74,222,128,.12);color:#4ade80}
html[data-theme="dark"] .pt-saldo.neg{background:rgba(248,113,113,.12);color:#f87171}
html[data-theme="dark"] .pt-table tr.pt-hoje td{background:rgba(47,91,234,.08)}
html[data-theme="dark"] .pt-table tr.pt-folga td{background:transparent;color:#667085}
/* Celular/tablet: cada dia vira um cartão — sem rolagem lateral. */
@media (max-width:900px){
.pt-table thead{display:none}
.pt-table,.pt-table tbody,.pt-table tr{display:block;width:100%}
.pt-table tr{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.45rem .5rem;padding:.8rem .7rem;border:1px solid #eaecf0;border-radius:12px;margin-bottom:.6rem}
.pt-table tbody td{display:block;padding:0;border:0;background:transparent!important;text-align:left}
.pt-table tbody td::before{content:attr(data-label);display:block;font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#98a2b3;margin-bottom:.15rem}
.pt-table td.pt-date{grid-column:1/3}.pt-table td.pt-date::before{display:none}
.pt-table td.pt-total{grid-column:3/5;text-align:right}.pt-table td.pt-total::before{display:none}
.pt-table td.pt-local{grid-column:1/3}.pt-table td.pt-st{grid-column:3/5}
.pt-table td.ctr{text-align:center}
.pt-table tr.pt-hoje{border-color:#2f5bea;background:#f5f8ff}
.pt-table tr.pt-pend{border-left:3px solid #f97316}.pt-table tr.pt-falta{border-left:3px solid #f04438}
.pt-table tr.pt-hoje td:first-child,.pt-table tr.pt-pend td:first-child,.pt-table tr.pt-falta td:first-child{box-shadow:none}
html[data-theme="dark"] .pt-table tr{border-color:var(--border)}
html[data-theme="dark"] .pt-table tr.pt-hoje{background:rgba(47,91,234,.08)}
}
`;
  const el = document.createElement("style");
  el.id = "pt-tabela-css";
  el.textContent = css;
  document.head.appendChild(el);
})();

const PT_DIA_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Minutos trabalhados no dia: apuração do banco quando houver, senão o
 * total gravado no registro. null = sem informação. */
function ptMinutosTrabalhados(h) {
  if (Number(h.trabalhadasMin) > 0) return Number(h.trabalhadasMin);
  if (h.horasTrabalhadas != null && Number(h.horasTrabalhadas) > 0) return Math.round(Number(h.horasTrabalhadas) * 60);
  if (h.horasTrabalhadas != null) return 0;
  return null;
}

/**
 * @param {Array} rows linhas do período (já na ordem de exibição)
 * @param {Object} o
 *   hoje           ISO de hoje
 *   comApuracao    se as linhas têm saldo da apuração do banco de horas
 *   statusHtml(h)  pílula de status do dia
 *   saidaVazia(h)  {texto, cls} quando não há saída ("Em andamento", "Não registrada")
 *   localHtml(h)   badge de local + link do mapa
 */
function pontoTabelaHtml(rows, o) {
  const hoje = o.hoje;
  const hora = (v, vazio) => (v ? `<span class="pt-hora">${esc(v)}</span>` : vazio ? `<span class="pt-hora ${vazio.cls}">${esc(vazio.texto)}</span>` : `<span class="pt-hora vazio">—</span>`);

  const linha = (h) => {
    const ehHoje = h.data === hoje;
    const dt = new Date(h.data + "T12:00:00");
    const folga = ["FERIADO", "FIM_DE_SEMANA"].includes(h.tipoDia);
    const falta = ["FALTA", "FALTA_JUSTIFICADA"].includes(h.tipoDia) && !h.entrada;
    const pend = !!(h.pendenteAjuste || h.batidasFaltando?.length);
    const cls = ehHoje ? "pt-hoje" : pend ? "pt-pend" : falta ? "pt-falta" : folga ? "pt-folga" : "";

    // Batidas que faltam (ponto não finalizado) ficam em laranja.
    const faltando = new Set((h.batidasFaltando || []).map((s) => String(s).toLowerCase()));
    const marcaFalta = (chave) => ([...faltando].some((s) => s.includes(chave)) ? { texto: "não registrada", cls: "falta" } : null);
    const temBatida = !!h.entrada;
    const vazioIntervaloSaida = temBatida ? marcaFalta("saída intervalo") || marcaFalta("saida intervalo") : null;
    const vazioRetorno = temBatida ? marcaFalta("retorno") : null;
    const vazioSaida = temBatida ? (o.saidaVazia ? o.saidaVazia(h) : null) : null;

    // Total trabalhado
    const min = ptMinutosTrabalhados(h);
    const parcial = ehHoje && temBatida && !h.saida;
    let totalHtml;
    if (!temBatida && !min) totalHtml = `<b class="zero">—</b>`;
    else totalHtml = `<b class="${parcial ? "parcial" : ""}">${min != null ? fmtMinutos(min) : "—"}</b>`;
    const subs = [];
    if (parcial) subs.push(`<span class="pt-sub">até agora</span>`);
    else if (o.comApuracao && h.previstasMin) subs.push(`<span class="pt-sub">de ${fmtMinutos(h.previstasMin)}</span>`);
    if (h.abonoMin) subs.push(`<span class="pt-sub violet">+${fmtMinutos(h.abonoMin)} abono</span>`);

    // Saldo
    let saldoHtml;
    if (o.comApuracao) {
      saldoHtml = ehHoje
        ? `<span class="pt-saldo hint">entra amanhã</span>`
        : h.contaNoBanco === false
        ? `<span class="pt-saldo hint" title="Antes do início da apuração — já incluído no saldo anterior">—</span>`
        : h.saldoMin
        ? `<span class="pt-saldo ${h.saldoMin < 0 ? "neg" : "pos"}">${fmtMinutos(h.saldoMin, { sinal: true })}</span>`
        : `<span class="pt-saldo">0:00</span>`;
    } else {
      const partes = [];
      if (h.horasExtras) partes.push(`<span class="pt-saldo pos">${fmtDuracao(h.horasExtras, { sinal: true })}</span>`);
      if (h.atrasoMin) partes.push(`<span class="pt-saldo neg" title="Atraso">${fmtMinutos(-h.atrasoMin)}</span>`);
      saldoHtml = partes.join(" ") || `<span class="pt-saldo">0:00</span>`;
    }

    const excessoAlmoco = Number(h.descontoAlmocoH) > 0
      ? `<span class="pt-sub red" title="Intervalo passou do mínimo (1h) e não foi compensado no dia — conta como horas negativas no banco de horas.">${fmtMinutos(-Math.round(Number(h.descontoAlmocoH) * 60))} intervalo</span>`
      : "";

    return `<tr class="${cls}">
      <td class="pt-date" data-label="Data"><b>${fmtDate(h.data)}</b><small>${PT_DIA_SEMANA[dt.getDay()]}${ehHoje ? " · hoje" : ""}</small></td>
      <td class="ctr" data-label="Entrada">${hora(h.entrada)}</td>
      <td class="ctr" data-label="Saída intervalo">${hora(h.intervaloSaida, vazioIntervaloSaida)}</td>
      <td class="ctr" data-label="Retorno">${hora(h.intervaloVolta, vazioRetorno)}${excessoAlmoco}</td>
      <td class="ctr" data-label="Saída">${hora(h.saida, vazioSaida)}</td>
      <td class="pt-total" data-label="Total trabalhado">${totalHtml}${subs.join("")}</td>
      <td class="num" data-label="Saldo">${saldoHtml}</td>
      <td class="pt-local" data-label="Local">${o.localHtml ? o.localHtml(h) : ""}</td>
      <td class="pt-st" data-label="Status"><div class="pt-status">${o.statusHtml(h)}${h.alteradoPeloRH ? `<span class="badge-alterado" title="${esc(h.alteradoPeloRH.motivo)} — ${fmtDate(String(h.alteradoPeloRH.em || "").slice(0, 10))}">${ICONS.edit}Alterado pelo RH</span>` : ""}</div></td>
    </tr>`;
  };

  return `
  <table class="pt-table">
    <thead>
      <tr class="pt-head-grp"><th></th><th class="pt-batidas-h" colspan="4"><span>Batidas</span></th><th colspan="4"></th></tr>
      <tr><th>Data</th><th class="ctr">Entrada</th><th class="ctr">Saída intervalo</th><th class="ctr">Retorno</th><th class="ctr">Saída</th><th class="pt-total-h">Total trabalhado</th><th class="num">${o.comApuracao ? "Saldo do dia" : "Extras / atraso"}</th><th>Local</th><th>Status</th></tr>
    </thead>
    <tbody>${rows.map(linha).join("")}</tbody>
  </table>`;
}
