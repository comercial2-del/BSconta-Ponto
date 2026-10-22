/*
 * BSconta+ — abas Vale-refeição / Vale-transporte / Gratificações (RH)
 * =============================================================================
 * Montadas em cima da tela rh/beneficios.html sem mexer no módulo de
 * Benefícios existente: a barra de abas fica acima de #content; a aba
 * "Benefícios" mostra o #content original e as outras usam #vl-content.
 * Também expõe rhVtAbrirConta(), usada no perfil do colaborador
 * (rh/colaboradores.html) para a configuração + extrato do VT.
 * Dados: js/rh-vales-data.js.
 */

function vlMoneyFmt(n) {
  return (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Modal genérico (criado sob demanda, usa as classes .modal do sistema). */
function vlModal(id, { titulo, sub, corpo, rodape, largura }) {
  let ov = document.getElementById(id);
  if (!ov) {
    ov = document.createElement("div");
    ov.id = id;
    ov.className = "modal-overlay";
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.classList.remove("open"); });
  }
  ov.innerHTML = `<div class="modal" style="max-width:${largura || 560}px">
    <div class="modal-header"><div><h3>${titulo}</h3>${sub ? `<p class="page-sub" style="margin:.2rem 0 0">${sub}</p>` : ""}</div><button type="button" class="modal-close" data-vl-close>${ICONS.x}</button></div>
    <div class="modal-body">${corpo}</div>
    ${rodape ? `<div class="modal-footer">${rodape}</div>` : ""}
  </div>`;
  ov.querySelectorAll("[data-vl-close]").forEach((b) => b.addEventListener("click", () => ov.classList.remove("open")));
  ov.classList.add("open");
  return ov;
}

// ---------------------------------------------------------------------------
// Conta corrente do VT (configuração + extrato) — usada no VT e no cadastro
// ---------------------------------------------------------------------------
async function rhVtAbrirConta(colaboradorId, { aoSalvar } = {}) {
  const ov = vlModal("vl-modal-conta", { titulo: "Vale-transporte", corpo: `<div class="loading-wrap"><div class="spinner"></div></div>`, largura: 760 });
  let cfg, extrato;
  try {
    [cfg, extrato] = await Promise.all([rhVtConfigColaborador(colaboradorId), rhVtExtrato(colaboradorId)]);
  } catch (err) {
    ov.querySelector(".modal-body").innerHTML = `<p class="vl-erro">${esc(rhErroMigracao35(err))}</p>`;
    return;
  }
  const saldoAtual = extrato.length ? extrato[0].saldoFinal : 0;
  vlModal("vl-modal-conta", {
    titulo: `Vale-transporte — ${esc(cfg.nome)}`,
    sub: "Configuração do cadastro e conta corrente (saldo no cartão) mês a mês.",
    largura: 760,
    corpo: `
      <div class="vl-conta">
        <div class="vl-conta-cfg">
          <div class="field"><label>Modalidade de trabalho</label>
            <div class="vl-seg" id="vl-cfg-mod">${Object.entries(VL_MODALIDADES).map(([k, v]) => `<button type="button" data-mod="${k}" class="${cfg.vt_modalidade === k ? "on" : ""}">${v}</button>`).join("")}</div>
          </div>
          <div class="field"><label>Valor por dia (ida + volta)</label><input id="vl-cfg-valor" type="text" class="vl-in-full" inputmode="decimal" value="${vlMoneyFmt(cfg.vt_valor_dia)}" /></div>
          <div class="field" id="vl-cfg-dias-wrap" ${cfg.vt_modalidade === "HIBRIDO" ? "" : "hidden"}><label>Dias presenciais por mês (híbrido)</label><input id="vl-cfg-dias" class="vl-in-full" type="number" min="0" max="31" value="${cfg.vt_dias_padrao ?? ""}" placeholder="Em branco = todos os dias úteis" /></div>
          <div class="vl-saldo-box"><span>Saldo atual no cartão</span><b>R$ ${vlMoneyFmt(saldoAtual)}</b>${extrato.length && extrato[0].previsto ? `<small>previsto — confirme no próximo mês</small>` : ""}</div>
        </div>
        <div class="vl-conta-ext">
          <div class="table-scroll vl-tbl-wrap"><table class="vl-tbl vl-tbl-compacta"><thead><tr><th>Competência</th><th class="n">Saldo inicial</th><th class="n">Carregado</th><th class="n">Utilizado</th><th class="n">Saldo final</th></tr></thead><tbody>
            ${extrato.length ? extrato.map((e) => `<tr><td><b>${vlRotuloMesCurto(e.competencia)}</b>${e.fechado ? "" : ` <span class="vl-tag">aberto</span>`}</td><td class="n">${vlMoneyFmt(e.saldoInicial)}</td><td class="n">${vlMoneyFmt(e.carregado)}</td><td class="n">${vlMoneyFmt(e.utilizado)}</td><td class="n"><b>${vlMoneyFmt(e.saldoFinal)}</b>${e.previsto ? "*" : ""}</td></tr>`).join("") : `<tr><td colspan="5" class="vl-vazio">Nenhum mês lançado ainda. Os meses aparecem aqui quando a planilha de VT é preenchida.</td></tr>`}
          </tbody></table></div>
          <p class="vl-nota">* previsto: saldo inicial + carregado − necessidade do mês. Vira o valor real quando o saldo do mês seguinte for informado.</p>
        </div>
      </div>`,
    rodape: `<button type="button" class="btn-ghost" data-vl-close>Fechar</button><button type="button" class="btn-primary auto" id="vl-cfg-salvar">${ICONS.check}<span>Salvar configuração</span></button>`,
  });
  let mod = cfg.vt_modalidade;
  document.querySelectorAll("#vl-cfg-mod [data-mod]").forEach((b) => b.addEventListener("click", () => {
    mod = b.dataset.mod;
    document.querySelectorAll("#vl-cfg-mod [data-mod]").forEach((x) => x.classList.toggle("on", x === b));
    document.getElementById("vl-cfg-dias-wrap").hidden = mod !== "HIBRIDO";
  }));
  document.getElementById("vl-cfg-salvar").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await rhVtSalvarConfig(colaboradorId, {
        modalidade: mod,
        valorDia: vlNumInput(document.getElementById("vl-cfg-valor").value),
        diasPadrao: mod === "HIBRIDO" ? document.getElementById("vl-cfg-dias").value : null,
      });
      showToast("Configuração de VT salva no cadastro.", "success");
      document.getElementById("vl-modal-conta").classList.remove("open");
      if (aoSalvar) aoSalvar();
    } catch (err) {
      showToast(rhErroMigracao35(err), "error");
      btn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Abas na tela de Benefícios
// ---------------------------------------------------------------------------
function rhValesInit(session) {
  const content = document.getElementById("content");
  if (!content || document.getElementById("vl-tabs")) return;
  const tabsEl = document.createElement("div");
  tabsEl.id = "vl-tabs";
  tabsEl.className = "vl-tabs";
  content.parentNode.insertBefore(tabsEl, content);
  const area = document.createElement("div");
  area.id = "vl-content";
  area.hidden = true;
  content.parentNode.insertBefore(area, content.nextSibling);

  const TABS = [
    ["beneficios", "Benefícios", ICONS.heart],
    ["vr", "Vale-refeição", ICONS.utensils],
    ["vt", "Vale-transporte", ICONS.car],
    ["gratificacoes", "Gratificações", ICONS.award],
  ];
  // periodos["vr-2026-10"] = período escolhido agora pelo RH (recalcula as linhas abertas).
  const st = { tab: "beneficios", comp: vlCompetenciaAtual(), dados: null, periodos: {} };
  const h = (location.hash || "").replace("#", "");
  if (TABS.some(([k]) => k === h)) st.tab = h;
  const autor = session?.name || null;

  function desenharTabs() {
    tabsEl.innerHTML = TABS.map(([k, l, i]) => `<button type="button" data-vl-tab="${k}" class="${st.tab === k ? "on" : ""}">${i}<span>${l}</span></button>`).join("");
    tabsEl.querySelectorAll("[data-vl-tab]").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.vlTab)));
  }
  // Usado pela aba Benefícios e pelos botões "Editar valores no benefício".
  window.rhValesIrPara = (tab) => irPara(tab);
  function irPara(tab) {
    st.tab = tab;
    try { history.replaceState(null, "", tab === "beneficios" ? location.pathname : `#${tab}`); } catch (e) { /* ok */ }
    desenharTabs();
    content.hidden = tab !== "beneficios";
    area.hidden = tab === "beneficios";
    if (tab !== "beneficios") carregar();
  }

  function cabecalho(titulo, sub) {
    return `<div class="row-between" style="margin-bottom:1rem"><div><h1 class="page-title">${titulo}</h1><p class="page-sub">${sub}</p></div></div>`;
  }
  function navMes() {
    return `<div class="period-buttons vl-mes"><button type="button" data-vl-mes="-1" aria-label="Mês anterior">${ICONS.chevronLeft}</button><button type="button" class="active">${vlRotuloMes(st.comp)}</button><button type="button" data-vl-mes="1" aria-label="Próximo mês">${ICONS.chevronRight}</button></div>`;
  }
  function ligarNavMes() {
    area.querySelectorAll("[data-vl-mes]").forEach((b) => b.addEventListener("click", () => { st.comp = vlSomarMes(st.comp, Number(b.dataset.vlMes)); carregar(); }));
  }
  function bannerFechado(linhas) {
    const l = linhas.find((x) => x.fechado_em) || {};
    return `<div class="vl-banner">${ICONS.checkCircle}<span>Mês fechado${l.fechado_em ? ` em ${fmtDate(String(l.fechado_em).slice(0, 10))}` : ""}${l.fechado_por ? ` por ${esc(l.fechado_por)}` : ""}. Os valores estão travados — use <b>Reabrir mês</b> para corrigir.</span></div>`;
  }

  async function buscar(tab) {
    const novo = st.periodos[`${tab}-${st.comp}`];
    const d = tab === "vr" ? await rhVrCarregar(st.comp, novo) : await rhVtCarregar(st.comp, novo);
    delete st.periodos[`${tab}-${st.comp}`];
    // Linhas abertas que mudaram (novo período ou valor alterado no benefício) gravam sozinhas.
    const alteradas = d.linhas.filter((l) => l.alterado);
    if (alteradas.length) {
      if (tab === "vr") await rhVrSalvarLinhas(d.comp, alteradas, d.periodo);
      else await rhVtSalvarLinhas(d.comp, alteradas, d.periodo);
      alteradas.forEach((l) => { l.alterado = false; });
    }
    return d;
  }
  async function carregar() {
    area.innerHTML = `<div class="loading-wrap"><div class="spinner"></div></div>`;
    try {
      if (st.tab === "vr") { st.dados = await buscar("vr"); renderVR(); }
      else if (st.tab === "vt") { st.dados = await buscar("vt"); renderVT(); }
      else if (st.tab === "gratificacoes") { st.dados = await rhGratCarregar(st.comp); renderGR(); }
    } catch (err) {
      area.innerHTML = `<div class="card card-p">${emptyStateHtml({ icon: ICONS.alertCircle, title: "Não foi possível carregar", desc: rhErroMigracao35(err) })}</div>`;
    }
  }

  const dm = (iso) => fmtDate(iso).slice(0, 5);
  function periodoHtml(d) {
    const dias = Math.round((new Date(d.periodo.fim + "T00:00:00") - new Date(d.periodo.inicio + "T00:00:00")) / 86400000) + 1;
    return `<div class="vl-param">${ICONS.calendar}<span>Período:</span><b>${dm(d.periodo.inicio)} a ${fmtDate(d.periodo.fim)}</b><small style="color:var(--text-faint)">(${dias} dias)</small>${d.fechado ? "" : `<button type="button" class="btn-ghost vl-btn-sm" id="vl-periodo">${ICONS.edit}<span>Alterar</span></button>`}</div>`;
  }
  function fonteHtml(d, tipo) {
    if (!d.vinculo) return "";
    const b = d.vinculo.beneficios[0];
    return `<div class="vl-param">${ICONS.heart}<span>Valor/dia vem do benefício:</span><b>${esc(d.vinculo.beneficios.map((x) => x.nome).join(", "))}</b><button type="button" class="btn-ghost vl-btn-sm" data-vl-benef="${b.id}">${ICONS.edit}<span>Editar valores</span></button></div>`;
  }
  function ligarFonte() {
    area.querySelectorAll("[data-vl-benef]").forEach((b) => b.addEventListener("click", () => {
      irPara("beneficios");
      if (typeof window.rhAbrirBeneficio === "function") window.rhAbrirBeneficio(b.dataset.vlBenef);
    }));
  }
  /** Modal do período (dia X até dia Y). `fechar` = também fecha o mês. */
  function modalPeriodo(tipo, { fechar = false } = {}) {
    const d = st.dados;
    const nome = tipo === "vr" ? "vale-refeição" : "vale-transporte";
    const ov = vlModal("vl-modal-periodo", {
      titulo: fechar ? `Fechar ${nome} de ${vlRotuloMes(d.comp)}` : `Período do ${nome}`,
      sub: "De que dia até que dia vale este benefício no mês. Os dias são contados de novo para quem ainda está aberto.",
      largura: 500,
      corpo: `<div class="form-grid" style="margin:0">
          <div class="field"><label>Do dia</label><input id="vl-p-ini" type="date" class="vl-in-full" value="${d.periodo.inicio}" /></div>
          <div class="field"><label>Até o dia</label><input id="vl-p-fim" type="date" class="vl-in-full" value="${d.periodo.fim}" /></div>
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.7rem">
          <button type="button" class="btn-ghost vl-btn-sm" data-vl-ate="padrao">Padrão (${dm(d.padrao.inicio)} a ${dm(d.padrao.fim)})</button>
          ${tipo === "vr" ? `<button type="button" class="btn-ghost vl-btn-sm" data-vl-ate="21">Dia 1 a 21</button><button type="button" class="btn-ghost vl-btn-sm" data-vl-ate="30">Dia 1 a 30</button>` : ""}
        </div>
        <p class="vl-nota" id="vl-p-resumo"></p>`,
      rodape: `<button type="button" class="btn-ghost" data-vl-close>Cancelar</button><button type="button" class="btn-primary auto" id="vl-p-ok">${fechar ? ICONS.checkCircle : ICONS.check}<span>${fechar ? "Fechar mês" : "Aplicar período"}</span></button>`,
    });
    const ini = ov.querySelector("#vl-p-ini"), fim = ov.querySelector("#vl-p-fim");
    const resumo = () => {
      const ok = ini.value && fim.value && ini.value <= fim.value;
      const dias = ok ? Math.round((new Date(fim.value + "T00:00:00") - new Date(ini.value + "T00:00:00")) / 86400000) + 1 : 0;
      ov.querySelector("#vl-p-resumo").innerHTML = ok
        ? `${dias} dia(s) corridos — conta só os dias de trabalho de cada pessoa (sem feriados e férias aprovadas).${fechar ? ` <b>${d.linhas.length} colaborador(es)</b>; depois de fechado, os valores ficam travados (dá para reabrir).` : ""}`
        : `<span style="color:var(--red-600)">O dia final precisa ser igual ou depois do inicial.</span>`;
      ov.querySelector("#vl-p-ok").disabled = !ok;
    };
    ov.querySelectorAll("[data-vl-ate]").forEach((b) => b.addEventListener("click", () => {
      const [y, m] = d.comp.split("-").map(Number);
      if (b.dataset.vlAte === "padrao") { ini.value = d.padrao.inicio; fim.value = d.padrao.fim; }
      else { const ultimo = new Date(y, m, 0).getDate(); ini.value = vlIso(new Date(y, m - 1, 1)); fim.value = vlIso(new Date(y, m - 1, Math.min(Number(b.dataset.vlAte), ultimo))); }
      resumo();
    }));
    ini.addEventListener("input", resumo); fim.addEventListener("input", resumo);
    resumo();
    ov.querySelector("#vl-p-ok").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const novo = { inicio: ini.value, fim: fim.value };
      try {
        // Grava primeiro o que está na tela (faltas, observações…) para nada se perder.
        [...timers.values()].forEach(clearTimeout); timers.clear();
        const abertas = d.linhas.filter((l) => !l.fechado);
        if (tipo === "vr") await rhVrSalvarLinhas(d.comp, abertas, d.periodo);
        else await rhVtSalvarLinhas(d.comp, abertas, d.periodo);
        if (novo.inicio !== d.periodo.inicio || novo.fim !== d.periodo.fim) st.periodos[`${tipo}-${d.comp}`] = novo;
        const atual = await buscar(tipo);
        if (fechar) {
          if (tipo === "vr") await rhVrFecharMes(atual.comp, atual.linhas, autor, atual.periodo);
          else await rhVtFecharMes(atual.comp, atual.linhas, autor, atual.periodo);
          showToast(`${tipo === "vr" ? "Vale-refeição" : "Vale-transporte"} de ${vlRotuloMes(atual.comp)} fechado (${dm(atual.periodo.inicio)} a ${fmtDate(atual.periodo.fim)}).`, "success");
        } else {
          if (tipo === "vr") await rhVrSalvarLinhas(atual.comp, atual.linhas.filter((l) => !l.fechado), atual.periodo);
          else await rhVtSalvarLinhas(atual.comp, atual.linhas.filter((l) => !l.fechado), atual.periodo);
          showToast(`Período ${dm(atual.periodo.inicio)} a ${fmtDate(atual.periodo.fim)} aplicado.`, "success");
        }
        ov.classList.remove("open");
        carregar();
      } catch (err) { showToast(rhErroMigracao35(err), "error"); btn.disabled = false; }
    });
  }

  // Salva a linha alguns instantes depois da última digitação.
  const timers = new Map();
  function agendarSalvar(chave, fn) {
    clearTimeout(timers.get(chave));
    timers.set(chave, setTimeout(async () => {
      timers.delete(chave);
      try { await fn(); marcarSalvo(); } catch (err) { showToast(rhErroMigracao35(err), "error"); }
    }, 700));
    const s = document.getElementById("vl-salvo");
    if (s) { s.textContent = "Salvando…"; s.className = "vl-salvo pend"; }
  }
  function marcarSalvo() {
    const s = document.getElementById("vl-salvo");
    if (s && !timers.size) { s.textContent = "Tudo salvo"; s.className = "vl-salvo ok"; }
  }

  function inputNum(campo, valor, i, { dinheiro = false, travado = false, largo = false } = {}) {
    return `<input class="vl-in${largo || dinheiro ? " w" : ""}" data-campo="${campo}" data-i="${i}" inputmode="${dinheiro ? "decimal" : "numeric"}" value="${dinheiro ? vlMoneyFmt(valor) : valor}" ${travado ? "disabled" : ""} />`;
  }

  // ------------------------------- VR ---------------------------------------
  function renderVR() {
    const d = st.dados;
    const trav = d.fechado;
    const total = d.linhas.reduce((a, l) => a + vrTotal(l), 0);
    area.innerHTML = `
      ${cabecalho("Vale-refeição", d.vinculo ? "Quem tem o benefício de alimentação/refeição e o valor por dia de cada um. Dias do período × valor por dia = total." : "Dias úteis × valor por dia, mês a mês. Ajuste só faltas e afastamentos — o resto já vem calculado.")}
      <div class="vl-bar">${navMes()}
        ${periodoHtml(d)}
        ${d.vinculo ? fonteHtml(d, "vr") : `<div class="vl-param">${ICONS.settings}<span>Valor por dia (todos):</span><b>R$ ${vlMoneyFmt(d.valorDia)}</b><button type="button" class="btn-ghost vl-btn-sm" id="vl-vr-alterar">${ICONS.edit}<span>Alterar</span></button></div>`}
        <span class="vl-esp"></span><span id="vl-salvo" class="vl-salvo ok">${d.linhas.some((l) => !l.salvo) && !trav ? "Valores sugeridos" : "Tudo salvo"}</span>
        <button type="button" class="btn-ghost" id="vl-exportar">${ICONS.download}<span>Exportar Excel</span></button>
        ${trav ? `<button type="button" class="btn-ghost" id="vl-reabrir">${ICONS.refresh}<span>Reabrir mês</span></button>` : `<button type="button" class="btn-primary auto" id="vl-fechar">${ICONS.checkCircle}<span>Fechar mês</span></button>`}
      </div>
      ${trav ? bannerFechado(d.linhas) : ""}
      <div id="vl-kpi"></div>
      <div class="card card-p" style="margin-top:1rem">
        <div class="table-scroll vl-tbl-wrap"><table class="vl-tbl"><thead><tr><th>Colaborador</th><th class="n">Dias no período</th><th class="n">Faltas / afast.</th><th class="n">Férias</th><th class="n">Dias a pagar</th><th class="n">Valor/dia</th><th class="n">Total</th><th>Observação</th></tr></thead>
        <tbody>${d.linhas.map((l, i) => `<tr data-i="${i}">
          <td><b>${esc(l.nome)}</b></td>
          <td class="n">${inputNum("dias_uteis", l.dias_uteis, i, { travado: trav })}</td>
          <td class="n">${inputNum("faltas", l.faltas, i, { travado: trav })}</td>
          <td class="n">${inputNum("ferias_dias", l.ferias_dias, i, { travado: trav })}</td>
          <td class="n"><b data-out="dias">${Math.max(0, l.dias_uteis - l.faltas - l.ferias_dias)}</b></td>
          <td class="n">${vlMoneyFmt(l.valor_dia)}${l.semValorBeneficio && !l.fechado ? `<br><small style="color:var(--orange-600)" title="Sem valor no benefício — usando o valor geral">valor geral</small>` : ""}</td>
          <td class="n"><b data-out="total">${vlMoneyFmt(vrTotal(l))}</b></td>
          <td><input class="vl-in txt" data-campo="observacao" data-i="${i}" value="${esc(l.observacao)}" placeholder="—" ${trav ? "disabled" : ""} /></td>
        </tr>`).join("") || `<tr><td colspan="8" class="vl-vazio">Nenhum colaborador ativo neste mês.</td></tr>`}</tbody>
        <tfoot><tr><td>Total do mês</td><td></td><td></td><td></td><td class="n" id="vl-f-dias">${d.linhas.reduce((a, l) => a + Math.max(0, l.dias_uteis - l.faltas - l.ferias_dias), 0)}</td><td></td><td class="n" id="vl-f-total">R$ ${vlMoneyFmt(total)}</td><td></td></tr></tfoot></table></div>
        <p class="vl-nota">${d.vinculo ? "Quem aparece aqui e o valor por dia vêm da aba <b>Benefícios</b> (categoria Alimentação / Refeição). " : ""}Dias no período vêm do calendário (dias de trabalho do cadastro, sem feriados) e Férias das férias aprovadas — dá para ajustar. Meses fechados guardam o valor e o período da época.</p>
      </div>`;
    kpisVR();
    ligarNavMes();
    area.querySelectorAll("input[data-campo]").forEach((inp) => inp.addEventListener("input", () => {
      const i = Number(inp.dataset.i), l = d.linhas[i], c = inp.dataset.campo;
      l[c] = c === "observacao" ? inp.value : Math.max(0, Math.round(vlNumInput(inp.value)));
      const tr = area.querySelector(`tr[data-i="${i}"]`);
      tr.querySelector('[data-out="dias"]').textContent = Math.max(0, l.dias_uteis - l.faltas - l.ferias_dias);
      tr.querySelector('[data-out="total"]').textContent = vlMoneyFmt(vrTotal(l));
      document.getElementById("vl-f-dias").textContent = d.linhas.reduce((a, x) => a + Math.max(0, x.dias_uteis - x.faltas - x.ferias_dias), 0);
      document.getElementById("vl-f-total").textContent = "R$ " + vlMoneyFmt(d.linhas.reduce((a, x) => a + vrTotal(x), 0));
      kpisVR();
      agendarSalvar(`vr-${l.colaborador_id}`, async () => { await rhVrSalvarLinha(d.comp, l, d.periodo); l.salvo = true; });
    }));
    document.getElementById("vl-vr-alterar")?.addEventListener("click", alterarValorVR);
    document.getElementById("vl-periodo")?.addEventListener("click", () => modalPeriodo("vr"));
    ligarFonte();
    document.getElementById("vl-exportar").addEventListener("click", () => vlExportarCsv(`vale-refeicao-${d.comp}.csv`,
      ["Colaborador", "Dias úteis", "Faltas/afast.", "Férias", "Dias a pagar", "Valor/dia", "Total", "Observação"],
      d.linhas.map((l) => [l.nome, l.dias_uteis, l.faltas, l.ferias_dias, Math.max(0, l.dias_uteis - l.faltas - l.ferias_dias), l.valor_dia, vrTotal(l), l.observacao])));
    document.getElementById("vl-fechar")?.addEventListener("click", () => fecharMes("vr"));
    document.getElementById("vl-reabrir")?.addEventListener("click", () => reabrirMes("vr"));
  }
  function kpisVR() {
    const d = st.dados;
    renderKpiGrid(document.getElementById("vl-kpi"), [
      { label: "Colaboradores", value: d.linhas.length, tone: "indigo", icon: ICONS.users },
      { label: "Dias úteis no período", value: d.diasUteisMes, tone: "amber", icon: ICONS.calendar },
      { label: d.vinculo ? "Valor por dia (média)" : "Valor por dia", value: d.vinculo && d.linhas.length ? vlRound(d.linhas.reduce((a, l) => a + l.valor_dia, 0) / d.linhas.length) : d.valorDia, format: "currency", tone: "green", icon: ICONS.utensils },
      { label: "Total do mês", value: d.linhas.reduce((a, l) => a + vrTotal(l), 0), format: "currency", tone: "red", icon: ICONS.dollarSign },
    ]);
  }
  function alterarValorVR() {
    const d = st.dados;
    const ov = vlModal("vl-modal-vr", {
      titulo: "Valor do vale-refeição por dia",
      sub: "Vale para todos os colaboradores.",
      largura: 440,
      corpo: `<div class="field"><label>Novo valor por dia (R$)</label><input id="vl-vr-novo" type="text" class="vl-in-full" inputmode="decimal" value="${vlMoneyFmt(d.valorDia)}" /></div>
        <p class="vl-nota">Passa a valer em <b>${vlRotuloMes(d.comp)}</b> e nos meses seguintes que ainda não foram fechados. Meses já fechados mantêm o valor da época.</p>`,
      rodape: `<button type="button" class="btn-ghost" data-vl-close>Cancelar</button><button type="button" class="btn-primary auto" id="vl-vr-salvar">${ICONS.check}<span>Salvar</span></button>`,
    });
    ov.querySelector("#vl-vr-novo").focus();
    ov.querySelector("#vl-vr-salvar").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      try {
        const v = await rhVrAlterarValorDia(vlNumInput(ov.querySelector("#vl-vr-novo").value), autor, d.comp);
        ov.classList.remove("open");
        showToast(`Vale-refeição agora é R$ ${vlMoneyFmt(v)} por dia.`, "success");
        carregar();
      } catch (err) { showToast(err.message && !err.code ? err.message : rhErroMigracao35(err), "error"); e.currentTarget.disabled = false; }
    });
  }

  // ------------------------------- VT ---------------------------------------
  function situacaoVT(l) {
    const nec = vtNecessidade(l), car = vtCarregar(l);
    if (nec === 0) return `<span class="vl-sit neutra">Sem recarga</span>`;
    if (l.valor_dia === 0) return `<span class="vl-sit alerta">Sem valor/dia</span>`;
    if (car === 0) return `<span class="vl-sit ok">Saldo cobre</span>`;
    return l.saldo_cartao > 0 ? `<span class="vl-sit meio">Usou saldo</span>` : `<span class="vl-sit ok">Recarga cheia</span>`;
  }
  function renderVT() {
    const d = st.dados;
    const trav = d.fechado;
    area.innerHTML = `
      ${cabecalho("Vale-transporte", "Cada colaborador tem uma conta corrente: o saldo que sobra no cartão abate a próxima recarga.")}
      <div class="vl-bar">${navMes()}
        ${periodoHtml(d)}
        ${fonteHtml(d, "vt")}
        <span class="vl-esp"></span><span id="vl-salvo" class="vl-salvo ok">${d.linhas.some((l) => !l.salvo) && !trav ? "Valores sugeridos" : "Tudo salvo"}</span>
        <button type="button" class="btn-ghost" id="vl-exportar">${ICONS.download}<span>Exportar Excel</span></button>
        ${trav ? `<button type="button" class="btn-ghost" id="vl-reabrir">${ICONS.refresh}<span>Reabrir mês</span></button>` : `<button type="button" class="btn-primary auto" id="vl-fechar">${ICONS.checkCircle}<span>Fechar mês</span></button>`}
      </div>
      ${trav ? bannerFechado(d.linhas) : ""}
      <div id="vl-kpi"></div>
      <div class="card card-p" style="margin-top:1rem">
        <div class="table-scroll vl-tbl-wrap"><table class="vl-tbl"><thead><tr><th>Colaborador</th><th>Modalidade</th><th class="n">Valor/dia</th><th class="n">Dias presenciais</th><th class="n">Necessidade</th><th class="n">Saldo no cartão</th><th class="n">A carregar</th><th>Situação</th><th></th></tr></thead>
        <tbody>${d.linhas.map((l, i) => `<tr data-i="${i}">
          <td><b>${esc(l.nome)}</b></td>
          <td><select class="vl-sel vl-mod-${l.modalidade}" data-campo="modalidade" data-i="${i}" ${trav ? "disabled" : ""}>${Object.entries(VL_MODALIDADES).map(([k, v]) => `<option value="${k}" ${l.modalidade === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
          <td class="n">${l.doBeneficio ? `${vlMoneyFmt(l.valor_dia)}${l.semValorBeneficio && !l.fechado ? `<br><small style="color:var(--orange-600)" title="Sem valor no benefício — usando o do cadastro">do cadastro</small>` : ""}` : inputNum("valor_dia", l.valor_dia, i, { dinheiro: true, travado: trav })}</td>
          <td class="n">${inputNum("dias_presenciais", l.dias_presenciais, i, { travado: trav })}</td>
          <td class="n" data-out="nec">${vlMoneyFmt(vtNecessidade(l))}</td>
          <td class="n">${inputNum("saldo_cartao", l.saldo_cartao, i, { dinheiro: true, travado: trav })}</td>
          <td class="n"><b data-out="car">${vlMoneyFmt(vtCarregar(l))}</b></td>
          <td data-out="sit">${situacaoVT(l)}</td>
          <td class="n"><button type="button" class="btn-ghost vl-btn-sm" data-conta="${l.colaborador_id}" title="Configuração e extrato">${ICONS.fileText}<span>Extrato</span></button></td>
        </tr>`).join("") || `<tr><td colspan="9" class="vl-vazio">Nenhum colaborador ativo neste período.</td></tr>`}</tbody>
        <tfoot><tr><td>Total do mês</td><td></td><td></td><td class="n" id="vl-f-dias"></td><td class="n" id="vl-f-nec"></td><td class="n" id="vl-f-saldo"></td><td class="n" id="vl-f-car"></td><td></td><td></td></tr></tfoot></table></div>
        <p class="vl-nota">A carregar = necessidade (dias presenciais × valor/dia) − saldo que sobrou no cartão, nunca negativo. ${d.vinculo ? "Quem aparece aqui e o valor por dia vêm da aba <b>Benefícios</b> (categoria Transporte); a modalidade fica no cadastro de cada pessoa." : "Modalidade e valor/dia ficam salvos no cadastro de cada pessoa."} O saldo já vem previsto a partir do mês anterior — confira com o extrato do cartão.</p>
      </div>`;
    totaisVT();
    ligarNavMes();
    area.querySelectorAll("[data-campo]").forEach((inp) => inp.addEventListener(inp.tagName === "SELECT" ? "change" : "input", () => {
      const i = Number(inp.dataset.i), l = d.linhas[i], c = inp.dataset.campo;
      const tr = area.querySelector(`tr[data-i="${i}"]`);
      if (c === "modalidade") {
        l.modalidade = inp.value;
        inp.className = `vl-sel vl-mod-${l.modalidade}`;
        l.dias_presenciais = l.modalidade === "HOME_OFFICE" ? 0 : l.modalidade === "PRESENCIAL" ? l.sugerido.uteis : l.dias_presenciais;
        tr.querySelector('[data-campo="dias_presenciais"]').value = l.dias_presenciais;
      } else if (c === "dias_presenciais") l.dias_presenciais = Math.max(0, Math.round(vlNumInput(inp.value)));
      else l[c] = vlNumInput(inp.value);
      tr.querySelector('[data-out="nec"]').textContent = vlMoneyFmt(vtNecessidade(l));
      tr.querySelector('[data-out="car"]').textContent = vlMoneyFmt(vtCarregar(l));
      tr.querySelector('[data-out="sit"]').innerHTML = situacaoVT(l);
      totaisVT();
      agendarSalvar(`vt-${l.colaborador_id}`, async () => {
        await rhVtSalvarLinha(d.comp, l, d.periodo);
        l.salvo = true;
        // Modalidade (e o valor/dia, quando não vem do benefício) também ficam no cadastro da pessoa.
        if (l.cadMod !== l.modalidade || (!l.doBeneficio && l.cadValor !== l.valor_dia)) {
          await rhVtSalvarConfig(l.colaborador_id, l.doBeneficio ? { modalidade: l.modalidade } : { modalidade: l.modalidade, valorDia: l.valor_dia });
          l.cadMod = l.modalidade; l.cadValor = l.valor_dia;
        }
      });
    }));
    // Formata dinheiro ao sair do campo.
    area.querySelectorAll('[data-campo="valor_dia"], [data-campo="saldo_cartao"]').forEach((inp) => inp.addEventListener("blur", () => { inp.value = vlMoneyFmt(vlNumInput(inp.value)); }));
    area.querySelectorAll("[data-conta]").forEach((b) => b.addEventListener("click", () => rhVtAbrirConta(b.dataset.conta, { aoSalvar: carregar })));
    document.getElementById("vl-periodo")?.addEventListener("click", () => modalPeriodo("vt"));
    ligarFonte();
    document.getElementById("vl-exportar").addEventListener("click", () => vlExportarCsv(`vale-transporte-${d.comp}.csv`,
      ["Colaborador", "Modalidade", "Valor/dia", "Dias presenciais", "Necessidade", "Saldo no cartão", "A carregar", "Observação"],
      d.linhas.map((l) => [l.nome, VL_MODALIDADES[l.modalidade], l.valor_dia, l.dias_presenciais, vtNecessidade(l), l.saldo_cartao, vtCarregar(l), l.observacao])));
    document.getElementById("vl-fechar")?.addEventListener("click", () => fecharMes("vt"));
    document.getElementById("vl-reabrir")?.addEventListener("click", () => reabrirMes("vt"));
  }
  function totaisVT() {
    const d = st.dados;
    const nec = d.linhas.reduce((a, l) => a + vtNecessidade(l), 0);
    const car = d.linhas.reduce((a, l) => a + vtCarregar(l), 0);
    document.getElementById("vl-f-dias").textContent = d.linhas.reduce((a, l) => a + l.dias_presenciais, 0);
    document.getElementById("vl-f-nec").textContent = "R$ " + vlMoneyFmt(nec);
    document.getElementById("vl-f-saldo").textContent = "R$ " + vlMoneyFmt(d.linhas.reduce((a, l) => a + l.saldo_cartao, 0));
    document.getElementById("vl-f-car").textContent = "R$ " + vlMoneyFmt(car);
    renderKpiGrid(document.getElementById("vl-kpi"), [
      { label: "Recebem VT", value: d.linhas.filter((l) => vtNecessidade(l) > 0).length, tone: "indigo", icon: ICONS.users },
      { label: "Necessidade do mês", value: nec, format: "currency", tone: "amber", icon: ICONS.car },
      { label: "Saldo aproveitado", value: nec - car, format: "currency", tone: "green", icon: ICONS.refresh },
      { label: "Total a carregar", value: car, format: "currency", tone: "red", icon: ICONS.dollarSign },
    ]);
  }

  // ------------------------- Fechar / reabrir mês -----------------------------
  async function fecharMes(tipo) {
    // Fechamento pede o período (do dia X até o dia Y) antes de travar o mês.
    if (st.dados && st.dados.periodo) { modalPeriodo(tipo, { fechar: true }); return; }
    const d = st.dados;
    const nome = tipo === "vr" ? "vale-refeição" : "vale-transporte";
    const total = tipo === "vr" ? d.linhas.reduce((a, l) => a + vrTotal(l), 0) : d.linhas.reduce((a, l) => a + vtCarregar(l), 0);
    const ok = await confirmDialog({
      title: `Fechar ${nome} de ${vlRotuloMes(d.comp)}`,
      message: `${d.linhas.length} colaborador(es), total de R$ ${vlMoneyFmt(total)}. Depois de fechado, os valores ficam travados (dá para reabrir se precisar corrigir).`,
      confirmLabel: "Fechar mês",
      icon: ICONS.checkCircle,
    });
    if (!ok) return;
    try {
      [...timers.values()].forEach(clearTimeout); timers.clear();
      if (tipo === "vr") await rhVrFecharMes(d.comp, d.linhas, autor);
      else await rhVtFecharMes(d.comp, d.linhas, autor);
      showToast(`${tipo === "vr" ? "Vale-refeição" : "Vale-transporte"} de ${vlRotuloMes(d.comp)} fechado.`, "success");
      carregar();
    } catch (err) { showToast(rhErroMigracao35(err), "error"); }
  }
  async function reabrirMes(tipo) {
    const d = st.dados;
    const ok = await confirmDialog({ title: `Reabrir ${vlRotuloMes(d.comp)}`, message: "Os valores voltam a ficar editáveis. Nada é apagado.", confirmLabel: "Reabrir", icon: ICONS.refresh });
    if (!ok) return;
    try {
      if (tipo === "vr") await rhVrReabrirMes(d.comp); else await rhVtReabrirMes(d.comp);
      showToast("Mês reaberto para edição.", "success");
      carregar();
    } catch (err) { showToast(rhErroMigracao35(err), "error"); }
  }

  // --------------------------- Gratificações ---------------------------------
  function renderGR() {
    const d = st.dados;
    const total = d.linhas.reduce((a, g) => a + g.valor_bruto, 0);
    area.innerHTML = `
      ${cabecalho("Gratificações", "Planilha bruta do mês: valores sem descontos, prontos para a folha.")}
      <div class="vl-bar">${navMes()}<span class="vl-esp"></span><span id="vl-salvo" class="vl-salvo ok">Tudo salvo</span>
        <button type="button" class="btn-ghost" id="vl-exportar">${ICONS.download}<span>Exportar Excel</span></button>
        <button type="button" class="btn-primary auto" id="vl-gr-nova">${ICONS.plus}<span>Nova gratificação</span></button></div>
      <div id="vl-kpi"></div>
      <div class="card card-p" style="margin-top:1rem">
        <div class="table-scroll vl-tbl-wrap"><table class="vl-tbl"><thead><tr><th>Colaborador</th><th>Motivo / descrição</th><th class="n">Valor bruto</th><th>Lançado por</th><th></th></tr></thead>
        <tbody>${d.linhas.map((g, i) => `<tr data-i="${i}">
          <td><b>${esc(g.nome)}</b></td>
          <td><input class="vl-in txt" data-gcampo="descricao" data-i="${i}" value="${esc(g.descricao || "")}" placeholder="—" /></td>
          <td class="n"><input class="vl-in w" data-gcampo="valor" data-i="${i}" inputmode="decimal" value="${vlMoneyFmt(g.valor_bruto)}" /></td>
          <td>${esc(g.lancado_por || "—")}</td>
          <td class="n"><button type="button" class="btn-ghost vl-btn-sm danger" data-gexcluir="${g.id}" aria-label="Excluir">${ICONS.trash}</button></td>
        </tr>`).join("") || `<tr><td colspan="5" class="vl-vazio">Nenhuma gratificação em ${vlRotuloMes(d.comp)}. Clique em “Nova gratificação”.</td></tr>`}</tbody>
        <tfoot><tr><td>Total bruto do mês</td><td></td><td class="n" id="vl-f-total">R$ ${vlMoneyFmt(total)}</td><td></td><td></td></tr></tfoot></table></div>
        <p class="vl-nota">Uma linha por gratificação — a mesma pessoa pode ter mais de uma no mês.</p>
      </div>`;
    kpisGR();
    ligarNavMes();
    area.querySelectorAll("[data-gcampo]").forEach((inp) => inp.addEventListener("input", () => {
      const g = d.linhas[Number(inp.dataset.i)];
      if (inp.dataset.gcampo === "valor") {
        g.valor_bruto = vlNumInput(inp.value);
        document.getElementById("vl-f-total").textContent = "R$ " + vlMoneyFmt(d.linhas.reduce((a, x) => a + x.valor_bruto, 0));
        kpisGR();
      } else g.descricao = inp.value;
      agendarSalvar(`gr-${g.id}`, () => rhGratAtualizar(g.id, { descricao: g.descricao, valor: g.valor_bruto }));
    }));
    area.querySelectorAll('[data-gcampo="valor"]').forEach((inp) => inp.addEventListener("blur", () => { inp.value = vlMoneyFmt(vlNumInput(inp.value)); }));
    area.querySelectorAll("[data-gexcluir]").forEach((b) => b.addEventListener("click", async () => {
      const g = d.linhas.find((x) => x.id === b.dataset.gexcluir);
      const ok = await confirmDialog({ title: "Excluir gratificação", message: `Excluir a gratificação de ${g.nome} (R$ ${vlMoneyFmt(g.valor_bruto)})?`, confirmLabel: "Excluir", danger: true });
      if (!ok) return;
      try { await rhGratExcluir(g.id); showToast("Gratificação excluída.", "success"); carregar(); } catch (err) { showToast(rhErroMigracao35(err), "error"); }
    }));
    document.getElementById("vl-gr-nova").addEventListener("click", novaGratificacao);
    document.getElementById("vl-exportar").addEventListener("click", () => vlExportarCsv(`gratificacoes-${d.comp}.csv`,
      ["Colaborador", "Motivo / descrição", "Valor bruto", "Lançado por"], d.linhas.map((g) => [g.nome, g.descricao || "", g.valor_bruto, g.lancado_por || ""])));
  }
  function kpisGR() {
    const d = st.dados;
    renderKpiGrid(document.getElementById("vl-kpi"), [
      { label: "Gratificações no mês", value: d.linhas.length, tone: "indigo", icon: ICONS.award },
      { label: "Colaboradores", value: new Set(d.linhas.map((g) => g.colaborador_id)).size, tone: "amber", icon: ICONS.users },
      { label: "Total bruto", value: d.linhas.reduce((a, g) => a + g.valor_bruto, 0), format: "currency", tone: "green", icon: ICONS.dollarSign },
      { label: "Mês anterior", value: d.totalAnterior, format: "currency", tone: "red", icon: ICONS.trendingUp },
    ]);
  }
  function novaGratificacao() {
    const d = st.dados;
    const ov = vlModal("vl-modal-gr", {
      titulo: "Nova gratificação",
      sub: `Competência ${vlRotuloMes(d.comp)} — valor bruto.`,
      largura: 480,
      corpo: `<div class="form-grid" style="margin:0">
        <div class="field full"><label>Colaborador</label><select id="vl-gr-colab" class="vl-in-full"><option value="">Selecione</option>${d.colaboradores.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("")}</select></div>
        <div class="field full"><label>Motivo / descrição</label><input id="vl-gr-desc" type="text" class="vl-in-full" placeholder="Ex.: meta de fechamento trimestral" /></div>
        <div class="field"><label>Valor bruto (R$)</label><input id="vl-gr-valor" type="text" class="vl-in-full" inputmode="decimal" placeholder="0,00" /></div>
      </div>`,
      rodape: `<button type="button" class="btn-ghost" data-vl-close>Cancelar</button><button type="button" class="btn-primary auto" id="vl-gr-salvar">${ICONS.plus}<span>Lançar</span></button>`,
    });
    ov.querySelector("#vl-gr-salvar").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await rhGratCriar(d.comp, { colaboradorId: ov.querySelector("#vl-gr-colab").value, descricao: ov.querySelector("#vl-gr-desc").value, valor: vlNumInput(ov.querySelector("#vl-gr-valor").value) }, autor);
        ov.classList.remove("open");
        showToast("Gratificação lançada.", "success");
        carregar();
      } catch (err) { showToast(err.message && !err.code ? err.message : rhErroMigracao35(err), "error"); btn.disabled = false; }
    });
  }

  desenharTabs();
  irPara(st.tab);
}
