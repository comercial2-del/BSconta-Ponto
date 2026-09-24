/*
 * BSconta+ RH — componentes de interface reutilizados pelas telas novas
 * (História do colaborador, Abonos, Benefícios individuais). Mesmos padrões
 * visuais do resto do sistema (modal-overlay/.modal, form-grid/.field,
 * status-badge, tl-*), montados uma vez e reaproveitados — sem duplicar
 * HTML de modal em cada página.
 * Depende de: js/ui.js, js/rh-historia-data.js.
 */

const RH_DEPARTAMENTOS_PADRAO = ["Fiscal", "Contábil", "Financeiro", "Administrativo", "Recursos Humanos", "Comercial", "Estagiário"];

function rhOpcoesHtml(mapa, selecionado) {
  return Object.entries(mapa)
    .map(([valor, info]) => `<option value="${valor}" ${valor === selecionado ? "selected" : ""}>${esc(typeof info === "string" ? info : info.label)}</option>`)
    .join("");
}

function rhOpcoesColaboradoresHtml(colaboradores, selecionadoId, { incluirVazio = false, labelVazio = "Selecione" } = {}) {
  return (incluirVazio ? `<option value="">${esc(labelVazio)}</option>` : "") +
    colaboradores
      .map((c) => `<option value="${c.id}" ${c.id === selecionadoId ? "selected" : ""}>${esc(c.nome)}${c.codigo ? ` · ${esc(c.codigo)}` : ""}${c.status === "INATIVO" ? " (inativo)" : ""}</option>`)
      .join("");
}

function rhDatalistHtml(id, valores) {
  const unicos = [...new Set(valores.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return `<datalist id="${id}">${unicos.map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;
}

/** Garante que o overlay do modal exista no <body> (cria uma vez) e liga o
 * fechar por X / clique fora / Esc — mesmo comportamento de wireModalClosers. */
function rhGarantirModal(id, larguraMax = "640px") {
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = id;
    overlay.innerHTML = `<div class="modal" style="max-width:${larguraMax}"></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.classList.remove("open"); });
  }
  return overlay;
}

function rhMontarModal(id, { titulo, subtitulo, corpo, rodape, larguraMax }) {
  const overlay = rhGarantirModal(id, larguraMax);
  overlay.querySelector(".modal").innerHTML = `
    <div class="modal-header">
      <div><h3>${esc(titulo)}</h3>${subtitulo ? `<p class="page-sub" style="margin:0.2rem 0 0">${esc(subtitulo)}</p>` : ""}</div>
      <button type="button" class="modal-close" data-close-modal>${ICONS.x}</button>
    </div>
    <form class="rh-modal-form">
      <div class="modal-body">${corpo}</div>
      <div class="modal-footer">${rodape}</div>
    </form>`;
  overlay.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", () => overlay.classList.remove("open")));
  requestAnimationFrame(() => overlay.classList.add("open"));
  return overlay;
}

// ---------------------------------------------------------------------------
// Linha do tempo
// ---------------------------------------------------------------------------
function rhEventoTituloHtml(ev) {
  const info = RH_TIPOS_EVENTO[ev.tipo_evento] || RH_TIPOS_EVENTO.OUTRO;
  return esc(info.label);
}

/** HTML da timeline agrupada por ano. `opts.podeEditar` mostra ações de
 * arquivar/restaurar (só RH); `opts.mostrarSalario` controla valores. */
function rhTimelineHtml(eventos, { podeEditar = false, mostrarSalario = true } = {}) {
  if (!eventos.length) {
    return emptyStateHtml({ icon: ICONS.timeline, title: "Nenhum evento neste filtro", desc: "Ajuste os filtros ou registre um novo evento na história." });
  }
  let anoAtual = null;
  const partes = [];
  eventos.forEach((ev) => {
    const ano = (ev.data_evento || "").slice(0, 4);
    if (ano !== anoAtual) {
      anoAtual = ano;
      partes.push(`<div class="tl-year"><span>${esc(ano)}</span></div>`);
    }
    const info = RH_TIPOS_EVENTO[ev.tipo_evento] || RH_TIPOS_EVENTO.OUTRO;
    const chips = [];
    if (ev.cargo) chips.push(`<span class="tl-chip">${ICONS.briefcase}Cargo: <strong>${esc(ev.cargo)}</strong></span>`);
    if (ev.departamento) chips.push(`<span class="tl-chip">${ICONS.building}Depto.: <strong>${esc(ev.departamento)}</strong></span>`);
    if (mostrarSalario && ev.salario != null) chips.push(`<span class="tl-chip">${ICONS.dollarSign}${esc(ev.salario_rotulo || "Salário")}: <strong>${rhBrl(ev.salario)}</strong></span>`);
    else if (mostrarSalario && ev.salario_nao_informado) chips.push(`<span class="tl-chip">${ICONS.dollarSign}Salário: <strong>não informado</strong></span>`);
    if (ev.beneficio) chips.push(`<span class="tl-chip">${ICONS.heart}Benefício: <strong>${esc(ev.beneficio)}</strong></span>`);
    if (ev.valor != null) chips.push(`<span class="tl-chip">Valor: <strong>${rhBrl(ev.valor)}</strong></span>`);
    const diffSalario = mostrarSalario && ev.salario != null && ev.salario_anterior != null && Number(ev.salario) !== Number(ev.salario_anterior)
      ? `<div class="tl-diff"><span class="de">${rhBrl(ev.salario_anterior)}</span>→<span>${rhBrl(ev.salario)}</span></div>`
      : "";
    const ant = ev.dados_anteriores || {};
    const diffCargo = ev.tipo_evento !== "ENTRADA" && ant.cargo && ev.cargo && ant.cargo !== ev.cargo
      ? `<div class="tl-diff" style="background:var(--indigo-50);color:var(--indigo-700)"><span class="de">${esc(ant.cargo)}</span>→<span>${esc(ev.cargo)}</span></div>`
      : "";
    const acoes = podeEditar && !ev.virtual
      ? `<div class="tl-actions">${ev.arquivado
          ? `<button type="button" data-restaurar-evento="${ev.id}" title="Restaurar evento">${ICONS.refresh}</button>`
          : `<button type="button" data-arquivar-evento="${ev.id}" title="Arquivar evento (não exclui)">${ICONS.archive}</button>`}</div>`
      : "";
    partes.push(`
      <div class="tl-item tone-${info.tone}">
        <span class="tl-dot">${ICONS[info.icon] || ICONS.fileText}</span>
        <div class="tl-card ${ev.arquivado ? "is-archived" : ""}">
          <div class="tl-card-top">
            <div>
              <p class="tl-title">${rhEventoTituloHtml(ev)}</p>
              <p class="tl-date">${rhDataLonga(ev.data_evento)}</p>
            </div>
            <div style="display:flex;align-items:center;gap:.4rem">
              ${ev.arquivado ? '<span class="badge badge-neutral">Arquivado</span>' : ""}
              ${podeEditar && ev.visivel_colaborador === false ? '<span class="badge badge-neutral" title="Não aparece para o colaborador">Interno</span>' : ""}
              ${acoes}
            </div>
          </div>
          ${chips.length ? `<div class="tl-chips">${chips.join("")}</div>` : ""}
          ${diffSalario}${diffCargo}
          ${ev.descricao ? `<p class="tl-desc">${esc(ev.descricao)}</p>` : ""}
          ${ev.observacao ? `<p class="tl-desc" style="font-style:italic">Obs.: ${esc(ev.observacao)}</p>` : ""}
          ${podeEditar && (ev.responsavel_nome || ev.origem) && !ev.virtual
            ? `<p class="tl-foot"><span>${ev.origem === "AUTOMATICO" ? "Registrado automaticamente" : "Registrado"}${ev.responsavel_nome ? ` por ${esc(ev.responsavel_nome)}` : ""}</span>${ev.created_at ? `<span>${new Date(ev.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>` : ""}</p>`
            : ""}
        </div>
      </div>`);
  });
  return `<div class="timeline">${partes.join("")}</div>`;
}

// ---------------------------------------------------------------------------
// Modal: registrar evento na história
// ---------------------------------------------------------------------------
function rhAbrirModalEvento({ colaborador, cargos = [], departamentos = [], session, onSaved }) {
  const corpo = `
    <div class="form-grid">
      <div class="field"><label>Tipo do evento</label><select id="ev-tipo" required>${rhOpcoesHtml(Object.fromEntries(Object.entries(RH_TIPOS_EVENTO)), "PROMOCAO")}</select></div>
      <div class="field"><label>Data</label><input type="date" id="ev-data" required value="${rhTodayIsoLocal()}" /></div>
      <div class="field"><label>Cargo</label><input type="text" id="ev-cargo" list="dl-cargos" value="${esc(colaborador.cargo || "")}" /></div>
      <div class="field"><label>Departamento</label><input type="text" id="ev-departamento" list="dl-deptos" value="${esc(colaborador.departamento || "")}" /></div>
      <div class="field"><label>Salário (R$)</label><input type="number" id="ev-salario" min="0" step="0.01" placeholder="Opcional" /></div>
      <div class="field"><label>Benefício</label><input type="text" id="ev-beneficio" placeholder="Opcional — ex.: Vale Alimentação" /></div>
      <div class="field"><label>Valor (R$)</label><input type="number" id="ev-valor" min="0" step="0.01" placeholder="Bonificação, benefício..." /></div>
      <div class="field full"><label>Descrição</label><textarea id="ev-descricao" rows="2" placeholder="O que aconteceu?"></textarea></div>
      <div class="field full"><label>Observação</label><textarea id="ev-observacao" rows="2" placeholder="Opcional"></textarea></div>
      <div class="field full" style="display:flex;flex-direction:column;gap:.55rem;margin-top:.2rem">
        <label class="check-row"><input type="checkbox" id="ev-aplicar" /> Atualizar também o cadastro atual (cargo, departamento e salário informados)</label>
        <label class="check-row"><input type="checkbox" id="ev-visivel" checked /> Visível para o colaborador na "Minha História"</label>
        <label class="check-row"><input type="checkbox" id="ev-informar" /> Informar o colaborador (notificação)</label>
      </div>
    </div>
    ${rhDatalistHtml("dl-cargos", cargos)}${rhDatalistHtml("dl-deptos", [...RH_DEPARTAMENTOS_PADRAO, ...departamentos])}
    <p class="field-hint" style="margin-top:.8rem">Os campos em branco não são alterados. O evento nunca é apagado — no máximo arquivado.</p>`;
  const overlay = rhMontarModal("modal-rh-evento", {
    titulo: "Registrar evento na história",
    subtitulo: colaborador.nome,
    corpo,
    rodape: `<button type="button" class="btn-ghost" data-close-modal>Cancelar</button><button type="submit" class="btn-primary auto" id="ev-submit">${ICONS.check}<span>Registrar evento</span></button>`,
  });
  const $ = (s) => overlay.querySelector(s);
  // Sugestão: eventos que mudam cargo/departamento/salário normalmente
  // também atualizam o cadastro atual — o RH pode desmarcar.
  const TIPOS_QUE_ALTERAM_CADASTRO = ["PROMOCAO", "ALTERACAO_CARGO", "ALTERACAO_DEPARTAMENTO", "ALTERACAO_SALARIAL"];
  const sugerirAplicar = () => { $("#ev-aplicar").checked = TIPOS_QUE_ALTERAM_CADASTRO.includes($("#ev-tipo").value); };
  $("#ev-tipo").addEventListener("change", sugerirAplicar);
  sugerirAplicar();
  overlay.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#ev-submit");
    const tipo = $("#ev-tipo").value;
    const aplicar = $("#ev-aplicar").checked;
    const ev = {
      colaboradorId: colaborador.id,
      tipo,
      data: $("#ev-data").value,
      cargo: $("#ev-cargo").value.trim(),
      departamento: $("#ev-departamento").value.trim(),
      salario: $("#ev-salario").value,
      beneficio: $("#ev-beneficio").value.trim(),
      valor: $("#ev-valor").value,
      descricao: $("#ev-descricao").value.trim(),
      observacao: $("#ev-observacao").value.trim(),
      visivel: $("#ev-visivel").checked,
      aplicarCadastro: aplicar,
    };
    if (aplicar) {
      const ok = await confirmDialog({
        title: "Atualizar o cadastro atual?",
        message: `Além de registrar o evento, o cadastro de ${colaborador.nome} passará a ter os dados informados (cargo/departamento/salário). A alteração fica registrada na auditoria.`,
        confirmLabel: "Registrar e atualizar",
      });
      if (!ok) return;
    }
    btn.disabled = true;
    try {
      const id = await rhRegistrarEventoHistoria(ev);
      if ($("#ev-informar").checked) {
        await rhNotificarSilencioso({
          colaboradorId: colaborador.id,
          tipo: "HISTORICO",
          titulo: (RH_TIPOS_EVENTO[tipo] || RH_TIPOS_EVENTO.OUTRO).label,
          mensagem: [fmtDate(ev.data), ev.cargo && `Cargo: ${ev.cargo}`, ev.departamento && `Departamento: ${ev.departamento}`, ev.descricao].filter(Boolean).join(" · "),
          referenciaTabela: "colaborador_historico",
          referenciaId: id,
          autor: session?.name,
        });
      }
      overlay.classList.remove("open");
      showToast("Evento registrado na história.", "success");
      onSaved && onSaved();
    } catch (err) {
      showToast(rhErroMigracao22(err), "error");
    } finally {
      btn.disabled = false;
    }
  });
}

function rhTodayIsoLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Modal: benefício concedido a um colaborador
// ---------------------------------------------------------------------------
function rhAbrirModalConcessao({ colaboradores, catalogo = [], concessao = null, colaboradorFixoId = null, session, onSaved }) {
  const c = concessao || {};
  const nomesCatalogo = catalogo.map((b) => b.nome);
  const corpo = `
    <div class="form-grid">
      <div class="field full"><label>Colaborador</label>
        <select id="cb-colaborador" required ${colaboradorFixoId || c.id ? "disabled" : ""}>${rhOpcoesColaboradoresHtml(colaboradores, c.colaborador_id || colaboradorFixoId, { incluirVazio: true })}</select>
      </div>
      <div class="field"><label>Benefício</label><input type="text" id="cb-beneficio" list="dl-beneficios" required value="${esc(c.beneficio || "")}" placeholder="Ex.: Vale Alimentação" /></div>
      <div class="field"><label>Periodicidade</label><select id="cb-periodicidade">${rhOpcoesHtml(RH_PERIODICIDADE, c.periodicidade || "MENSAL")}</select></div>
      <div class="field"><label>Data de início</label><input type="date" id="cb-inicio" required value="${esc(c.data_inicio || rhTodayIsoLocal())}" /></div>
      <div class="field"><label>Data de término</label><input type="date" id="cb-fim" value="${esc(c.data_fim || "")}" /></div>
      <div class="field"><label>Valor (R$)</label><input type="number" id="cb-valor" min="0" step="0.01" value="${c.valor ?? ""}" /></div>
      <div class="field"><label>Status</label><select id="cb-status">${rhOpcoesHtml({ ATIVO: "Ativo", SUSPENSO: "Suspenso", ENCERRADO: "Encerrado" }, c.status || "ATIVO")}</select></div>
      <div class="field"><label>Houve desconto?</label><select id="cb-tem-desconto"><option value="nao" ${c.possui_desconto ? "" : "selected"}>Não</option><option value="sim" ${c.possui_desconto ? "selected" : ""}>Sim</option></select></div>
      <div class="field"><label>Valor do desconto (R$)</label><input type="number" id="cb-desconto" min="0" step="0.01" value="${c.valor_desconto ?? ""}" ${c.possui_desconto ? "" : "disabled"} /></div>
      <div class="field full"><label>Descrição</label><textarea id="cb-descricao" rows="2">${esc(c.descricao || "")}</textarea></div>
      <div class="field full"><label>Observação interna</label><textarea id="cb-observacao" rows="2">${esc(c.observacao || "")}</textarea></div>
      <div class="field full"><label class="check-row"><input type="checkbox" id="cb-informar" ${c.id ? "" : "checked"} /> Informar o colaborador sobre este benefício</label></div>
    </div>
    ${rhDatalistHtml("dl-beneficios", nomesCatalogo)}
    <div class="notice" style="margin-top:.8rem" id="cb-preview"></div>`;
  const overlay = rhMontarModal("modal-rh-concessao", {
    titulo: c.id ? "Editar benefício do colaborador" : "Registrar benefício",
    subtitulo: "Valor, periodicidade e desconto de um benefício concedido a um colaborador.",
    corpo,
    rodape: `<button type="button" class="btn-ghost" data-close-modal>Cancelar</button><button type="submit" class="btn-primary auto" id="cb-submit">${ICONS.check}<span>Salvar benefício</span></button>`,
  });
  const $ = (s) => overlay.querySelector(s);
  const dados = () => ({
    id: c.id,
    colaborador_id: $("#cb-colaborador").value || c.colaborador_id || colaboradorFixoId,
    beneficio: $("#cb-beneficio").value.trim(),
    beneficio_id: catalogo.find((b) => b.nome === $("#cb-beneficio").value.trim())?.id || null,
    periodicidade: $("#cb-periodicidade").value,
    data_inicio: $("#cb-inicio").value,
    data_fim: $("#cb-fim").value,
    valor: $("#cb-valor").value,
    status: $("#cb-status").value,
    possui_desconto: $("#cb-tem-desconto").value === "sim",
    valor_desconto: $("#cb-desconto").value,
    descricao: $("#cb-descricao").value.trim(),
    observacao: $("#cb-observacao").value.trim(),
    responsavel_nome: session?.name,
  });
  const atualizarPreview = () => {
    const d = dados();
    $("#cb-desconto").disabled = !d.possui_desconto;
    $("#cb-preview").innerHTML = $("#cb-informar").checked && d.beneficio && d.data_inicio
      ? `<strong>Mensagem ao colaborador:</strong> ${esc(rhMensagemBeneficio({ ...d, valor: d.valor === "" ? null : Number(d.valor), valor_desconto: d.valor_desconto === "" ? null : Number(d.valor_desconto) }))}`
      : "O colaborador não será notificado.";
  };
  overlay.querySelectorAll("input,select,textarea").forEach((el) => el.addEventListener("input", atualizarPreview));
  overlay.querySelectorAll("select,input[type=checkbox]").forEach((el) => el.addEventListener("change", atualizarPreview));
  atualizarPreview();
  overlay.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = dados();
    if (!d.colaborador_id) { showToast("Selecione o colaborador.", "error"); return; }
    if (d.data_fim && d.data_fim < d.data_inicio) { showToast("A data de término não pode ser anterior ao início.", "error"); return; }
    const btn = $("#cb-submit");
    btn.disabled = true;
    try {
      await rhSalvarConcessao(d, { informar: $("#cb-informar").checked });
      overlay.classList.remove("open");
      showToast($("#cb-informar").checked ? "Benefício salvo e colaborador informado." : "Benefício salvo.", "success");
      onSaved && onSaved();
    } catch (err) {
      showToast(rhErroMigracao22(err), "error");
    } finally {
      btn.disabled = false;
    }
  });
}

function rhConcessaoCardHtml(c, { podeEditar = false, mostrarColaborador = false } = {}) {
  return `
    <div class="mini-card">
      <div style="min-width:0;flex:1">
        <p class="t">${esc(c.beneficio)} ${statusBadgeHtml(c.status, STATUS_LABELS)}</p>
        <p class="s">${mostrarColaborador && c.colaborador ? `<strong>${esc(c.colaborador.nome)}</strong> · ` : ""}Desde ${fmtDate(c.data_inicio)}${c.data_fim ? ` até ${fmtDate(c.data_fim)}` : ""} · ${esc(RH_PERIODICIDADE[c.periodicidade] || c.periodicidade)}</p>
        <div class="benefit-values">
          <span class="tl-chip">Valor: <strong>${rhBrl(c.valor)}</strong></span>
          <span class="tl-chip">Desconto: <strong>${c.possui_desconto ? rhBrl(c.valor_desconto) : "Não"}</strong></span>
          ${c.informado_em ? `<span class="tl-chip">${ICONS.bell}Informado em ${new Date(c.informado_em).toLocaleDateString("pt-BR")}</span>` : ""}
        </div>
        ${c.descricao ? `<p class="s" style="margin-top:.45rem">${esc(c.descricao)}</p>` : ""}
      </div>
      ${podeEditar ? `<button type="button" class="btn-ghost" style="width:auto;padding:.4rem .7rem" data-editar-concessao="${c.id}">${ICONS.edit}<span>Editar</span></button>` : ""}
    </div>`;
}

// ---------------------------------------------------------------------------
// Modal: abono
// ---------------------------------------------------------------------------
function rhAbrirModalAbono({ colaboradores, abono = null, colaboradorFixoId = null, session, onSaved }) {
  const a = abono || {};
  const corpo = `
    <div class="form-grid">
      <div class="field full"><label>Colaborador</label>
        <select id="ab-colaborador" required ${colaboradorFixoId || a.id ? "disabled" : ""}>${rhOpcoesColaboradoresHtml(colaboradores, a.colaborador_id || colaboradorFixoId, { incluirVazio: true })}</select>
      </div>
      <div class="field"><label>Tipo</label><select id="ab-tipo" required>${rhOpcoesHtml(RH_TIPOS_ABONO, a.tipo || "ATESTADO")}</select></div>
      <div class="field"><label>Classificação</label><select id="ab-justificada"><option value="sim">Justificada</option><option value="nao">Não justificada</option></select></div>
      <div class="field"><label>Data inicial</label><input type="date" id="ab-inicio" required value="${esc(a.data_inicio || rhTodayIsoLocal())}" /></div>
      <div class="field"><label>Data final</label><input type="date" id="ab-fim" required value="${esc(a.data_fim || a.data_inicio || rhTodayIsoLocal())}" /></div>
      <div class="field"><label>Quantidade de dias</label><div class="field-static" id="ab-dias">—</div></div>
      <div class="field"><label>Status</label><select id="ab-status">${rhOpcoesHtml(RH_STATUS_ABONO, a.status || "PENDENTE")}</select></div>
      <div class="field full"><label>Motivo</label><input type="text" id="ab-motivo" value="${esc(a.motivo || "")}" placeholder="Ex.: Consulta médica" /></div>
      <div class="field full"><label>Descrição</label><textarea id="ab-descricao" rows="2">${esc(a.descricao || "")}</textarea></div>
      <div class="field full"><label>Documento / atestado</label>
        ${rhDropzoneHtml("ab-anexo")}
        ${a.anexo_nome ? `<p class="field-hint">Documento atual: <strong>${esc(a.anexo_nome)}</strong>. Enviar outro substitui o atual.</p>` : ""}
      </div>
      <div class="field full"><label>Observação</label><textarea id="ab-observacao" rows="2">${esc(a.observacao || "")}</textarea></div>
      <div class="field full"><label class="check-row"><input type="checkbox" id="ab-informar" checked /> Informar o colaborador</label></div>
    </div>
    <p class="field-hint" style="margin-top:.6rem">Somente abonos <strong>Aprovados</strong> abonam o dia na Jornada de Ponto (o dia deixa de contar como falta).</p>`;
  const overlay = rhMontarModal("modal-rh-abono", {
    titulo: a.id ? "Editar abono" : "Novo abono",
    subtitulo: "Registre ausências e ocorrências que precisam ser justificadas.",
    corpo,
    rodape: `<button type="button" class="btn-ghost" data-close-modal>Cancelar</button><button type="submit" class="btn-primary auto" id="ab-submit">${ICONS.check}<span>Salvar abono</span></button>`,
  });
  const $ = (s) => overlay.querySelector(s);
  const anexoAbono = rhWireDropzone(overlay, "ab-anexo");
  $("#ab-justificada").value = (a.justificada ?? RH_TIPOS_ABONO[a.tipo || "ATESTADO"].justificada) ? "sim" : "nao";
  const atualizarDias = () => {
    const i = $("#ab-inicio").value, f = $("#ab-fim").value;
    if (i && f && f >= i) $("#ab-dias").textContent = `${Math.round((new Date(f + "T00:00:00") - new Date(i + "T00:00:00")) / 86400000) + 1} dia(s)`;
    else $("#ab-dias").textContent = "—";
  };
  $("#ab-tipo").addEventListener("change", () => { $("#ab-justificada").value = RH_TIPOS_ABONO[$("#ab-tipo").value]?.justificada ? "sim" : "nao"; });
  $("#ab-inicio").addEventListener("change", () => { if (!$("#ab-fim").value || $("#ab-fim").value < $("#ab-inicio").value) $("#ab-fim").value = $("#ab-inicio").value; atualizarDias(); });
  $("#ab-fim").addEventListener("change", atualizarDias);
  atualizarDias();
  overlay.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const colaboradorId = $("#ab-colaborador").value || a.colaborador_id || colaboradorFixoId;
    if (!colaboradorId) { showToast("Selecione o colaborador.", "error"); return; }
    if ($("#ab-fim").value < $("#ab-inicio").value) { showToast("A data final não pode ser anterior à inicial.", "error"); return; }
    const btn = $("#ab-submit");
    btn.disabled = true;
    try {
      let anexo = {};
      const arquivo = anexoAbono.arquivo();
      if (arquivo) {
        const up = await rhEnviarAnexoAbono(colaboradorId, arquivo);
        anexo = { anexo_path: up.path, anexo_nome: up.nome };
      }
      const statusNovo = $("#ab-status").value;
      const salvo = await rhSalvarAbono({
        id: a.id,
        colaborador_id: colaboradorId,
        tipo: $("#ab-tipo").value,
        justificada: $("#ab-justificada").value === "sim",
        data_inicio: $("#ab-inicio").value,
        data_fim: $("#ab-fim").value,
        motivo: $("#ab-motivo").value.trim(),
        descricao: $("#ab-descricao").value.trim(),
        observacao: $("#ab-observacao").value.trim(),
        status: statusNovo,
        responsavel_nome: session?.name,
        ...anexo,
      });
      if ($("#ab-informar").checked && (!a.id || a.status !== statusNovo)) {
        const tipoLabel = RH_TIPOS_ABONO[salvo.tipo]?.label || salvo.tipo;
        const periodo = salvo.data_inicio === salvo.data_fim ? fmtDate(salvo.data_inicio) : `${fmtDate(salvo.data_inicio)} a ${fmtDate(salvo.data_fim)}`;
        await rhNotificarSilencioso({
          colaboradorId,
          tipo: "ABONO",
          titulo: `${tipoLabel} — ${RH_STATUS_ABONO[salvo.status] || salvo.status}`,
          mensagem: `Ocorrência de ${periodo} registrada pelo RH (${salvo.justificada ? "justificada" : "não justificada"}).${salvo.motivo ? " Motivo: " + salvo.motivo + "." : ""}`,
          referenciaTabela: "colaborador_abonos",
          referenciaId: salvo.id,
          autor: session?.name,
        });
      }
      overlay.classList.remove("open");
      showToast("Abono salvo.", "success");
      onSaved && onSaved(salvo);
    } catch (err) {
      showToast(rhErroMigracao22(err), "error");
    } finally {
      btn.disabled = false;
    }
  });
}

function rhAbonoPeriodoTexto(a) {
  return a.data_inicio === a.data_fim ? fmtDate(a.data_inicio) : `${fmtDate(a.data_inicio)} a ${fmtDate(a.data_fim)}`;
}

function rhJustificacaoPillHtml(justificada) {
  return justificada
    ? '<span class="badge pill-justificada">Justificada</span>'
    : '<span class="badge pill-nao-justificada">Não justificada</span>';
}

// ---------------------------------------------------------------------------
// Anexo (atestado / documento) — área de arrastar e soltar no mesmo padrão
// visual da tela de Documentos (.dropzone / .selected-file), no lugar do
// <input type="file"> cru do navegador.
// ---------------------------------------------------------------------------
function rhDropzoneHtml(id, { titulo = "Arraste o arquivo aqui", hint = "PDF ou foto (JPG, PNG) — até 15 MB", accept = ".pdf,.png,.jpg,.jpeg,.webp,.heic" } = {}) {
  return `
    <div class="dropzone dropzone-doc rh-dropzone" id="${id}-zone" tabindex="0" role="button" aria-label="Anexar arquivo">
      ${ICONS.upload}
      <p><strong>${esc(titulo)}</strong> ou clique para escolher</p>
      <span class="hint">${esc(hint)}</span>
      <input type="file" id="${id}" accept="${accept}" hidden />
      <div class="selected-file" id="${id}-sel" hidden></div>
    </div>`;
}

/** Liga a área de anexo. Devolve { arquivo(), limpar() } e chama
 * `onChange(file|null)` sempre que o arquivo muda. */
function rhWireDropzone(root, id, onChange) {
  const zone = root.querySelector(`#${id}-zone`);
  const input = root.querySelector(`#${id}`);
  const sel = root.querySelector(`#${id}-sel`);
  let arquivo = null;
  const mostrar = () => {
    if (!arquivo) { sel.hidden = true; sel.innerHTML = ""; zone.classList.remove("has-file"); onChange && onChange(null); return; }
    zone.classList.add("has-file");
    sel.hidden = false;
    const tamanho = arquivo.size > 1024 * 1024 ? `${(arquivo.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(arquivo.size / 1024))} KB`;
    sel.innerHTML = `${ICONS.fileText}<div><strong>${esc(arquivo.name)}</strong><span>${tamanho}</span></div><button type="button" class="btn-ghost doc-file-remove" aria-label="Remover arquivo">${ICONS.x}</button>`;
    sel.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); arquivo = null; input.value = ""; mostrar(); });
    onChange && onChange(arquivo);
  };
  const aceitar = (f) => {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { showToast("O arquivo deve ter no máximo 15 MB.", "error"); return; }
    arquivo = f; mostrar();
  };
  zone.addEventListener("click", (e) => { if (e.target.closest(".selected-file")) return; input.click(); });
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => aceitar(input.files?.[0]));
  ["dragover", "dragenter"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("is-dragging"); }));
  zone.addEventListener("drop", (e) => aceitar(e.dataTransfer.files?.[0]));
  return { arquivo: () => arquivo, limpar: () => { arquivo = null; input.value = ""; mostrar(); } };
}

/** Selo do documento de um abono: "Ver documento" ou o aviso de que o
 * colaborador não anexou nada (para o RH decidir / pedir o documento). */
function rhAbonoDocumentoHtml(a, { podePedir = false } = {}) {
  if (a.anexo_path) {
    return `<button type="button" class="doc-chip" data-ver-anexo="${a.id}" title="${esc(a.anexo_nome || "Documento")}">${ICONS.fileText}<span>${esc(a.anexo_nome || "Ver documento")}</span></button>`;
  }
  return `<span class="doc-missing" title="O colaborador não anexou documento">${ICONS.alertCircle}<span>Sem documento</span></span>${podePedir && ["PENDENTE", "PRE_APROVADO"].includes(a.status) ? `<button type="button" class="link-btn" data-pedir-doc="${a.id}">Pedir documento</button>` : ""}`;
}

/** RH pede o documento que faltou: registra o pedido na observação do
 * abono (fica visível no histórico) e avisa o colaborador. */
async function rhPedirDocumentoAbono(abono, autorNome) {
  const nota = `Documento solicitado pelo RH em ${new Date().toLocaleDateString("pt-BR")}.`;
  const { error } = await sb.from("colaborador_abonos").update({ observacao: [abono.observacao, nota].filter(Boolean).join(" ") }).eq("id", abono.id);
  if (error) throw error;
  const tipoLabel = RH_TIPOS_ABONO[abono.tipo]?.label || abono.tipo;
  await rhNotificarSilencioso({
    colaboradorId: abono.colaborador_id,
    tipo: "ABONO",
    titulo: "Envie o documento do seu abono",
    mensagem: `O RH precisa do documento (${tipoLabel}) da ocorrência de ${rhAbonoPeriodoTexto(abono)}. Anexe em Ponto / Jornada → Abonos.`,
    referenciaTabela: "colaborador_abonos",
    referenciaId: abono.id,
    autor: autorNome,
  });
}

/** RH exclui o DOCUMENTO de um abono (o abono em si continua). Remove o
 * arquivo do armazenamento e anota na observação quem excluiu e quando. */
async function rhExcluirDocumentoAbono(abono, autorNome) {
  if (abono.anexo_path) {
    const { error: stErr } = await sb.storage.from("abonos-rh").remove([abono.anexo_path]);
    if (stErr) throw stErr;
  }
  const nota = `Documento "${abono.anexo_nome || "anexo"}" excluído por ${autorNome || "RH"} em ${new Date().toLocaleDateString("pt-BR")}.`;
  const { error } = await sb
    .from("colaborador_abonos")
    .update({ anexo_path: null, anexo_nome: null, observacao: [abono.observacao, nota].filter(Boolean).join(" ") })
    .eq("id", abono.id);
  if (error) throw error;
}
