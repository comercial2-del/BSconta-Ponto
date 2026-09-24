/*
 * BSconta+ RH — História do colaborador, benefícios individuais, abonos,
 * notificações e regras de ponto (camada de dados REAL — Supabase)
 * =============================================================================
 * Tabelas/funções criadas por db/supabase/22_historia_abonos_beneficios.sql:
 *   rh.colaborador_historico   (linha do tempo; salário cifrado → RPC historico_listar)
 *   rh.colaborador_beneficios  (benefício concedido a UM colaborador)
 *   rh.colaborador_abonos      (atestado, falta justificada/não justificada, folga...)
 *   rh.notificacoes            (histórico do que foi informado ao colaborador)
 *   rh.configuracoes_ponto     (intervalo mínimo / horário mínimo do almoço)
 *   rh.auditoria               (quem alterou o quê — preenchida só por trigger)
 *
 * Tudo aqui é ADITIVO: nenhuma função existente é alterada, e nenhuma função
 * deste arquivo apaga linhas — "remover" é sempre arquivar.
 * RLS no banco garante que o colaborador só lê o que é dele.
 */

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------
const RH_TIPOS_EVENTO = {
  ENTRADA: { label: "Entrada na empresa", tone: "indigo", icon: "building" },
  PROMOCAO: { label: "Promoção", tone: "green", icon: "trendingUp" },
  ALTERACAO_CARGO: { label: "Alteração de cargo", tone: "blue", icon: "briefcase" },
  ALTERACAO_DEPARTAMENTO: { label: "Mudança de departamento", tone: "teal", icon: "building" },
  ALTERACAO_SALARIAL: { label: "Alteração salarial", tone: "green", icon: "dollarSign" },
  BONIFICACAO: { label: "Bonificação", tone: "amber", icon: "award" },
  BENEFICIO_CONCEDIDO: { label: "Benefício concedido", tone: "violet", icon: "heart" },
  ALTERACAO_BENEFICIO: { label: "Alteração de benefício", tone: "violet", icon: "heart" },
  ADVERTENCIA: { label: "Advertência", tone: "red", icon: "alertCircle" },
  FERIAS: { label: "Férias", tone: "teal", icon: "palmTree" },
  ALTERACAO_VINCULO: { label: "Mudança no vínculo", tone: "slate", icon: "users" },
  ABONO: { label: "Abono", tone: "blue", icon: "clipboardCheck" },
  OUTRO: { label: "Outro evento", tone: "slate", icon: "fileText" },
};

const RH_TIPOS_ABONO = {
  ATESTADO: { label: "Atestado", justificada: true },
  FERIAS: { label: "Férias", justificada: true },
  FALTA_JUSTIFICADA: { label: "Falta justificada", justificada: true },
  FALTA_NAO_JUSTIFICADA: { label: "Falta não justificada", justificada: false },
  AUSENCIA_AUTORIZADA: { label: "Ausência autorizada", justificada: true },
  COMPROMISSO_EXTERNO: { label: "Compromisso externo autorizado", justificada: true },
  FOLGA: { label: "Folga", justificada: true },
  OUTRO: { label: "Outro", justificada: true },
};

const RH_STATUS_ABONO = {
  PENDENTE: "Pendente",
  PRE_APROVADO: "Pré-aprovado",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  ARQUIVADO: "Arquivado",
};

const RH_PERIODICIDADE = {
  MENSAL: "Mensal", QUINZENAL: "Quinzenal", SEMANAL: "Semanal", DIARIO: "Diário", ANUAL: "Anual", UNICO: "Pagamento único", OUTRO: "Outro",
};

/** Mensagem amigável quando a migração 22 ainda não foi aplicada. */
function rhErroMigracao22(err) {
  const msg = String(err?.message || err || "");
  if (/PGRST205|does not exist|schema cache|Could not find/i.test(msg) || err?.code === "PGRST205" || err?.code === "42P01" || err?.code === "PGRST202") {
    return "Esta funcionalidade precisa da migração db/supabase/22_historia_abonos_beneficios.sql aplicada no Supabase.";
  }
  return typeof rhMensagemErroSupabase === "function" ? rhMensagemErroSupabase(err) : msg;
}

function rhBrl(v) {
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function rhDataLonga(iso) {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Colaboradores (reaproveita rh.colaboradores — nunca cria cadastro novo)
// ---------------------------------------------------------------------------
async function rhListarColaboradoresBasico({ incluirInativos = true } = {}) {
  let q = sb.from("colaboradores").select("id, codigo, nome, cargo, departamento, status, admissao, data_desligamento, foto_url, tipo, dias_trabalho, horario_entrada, horas_semanais, meta_diaria_horas").order("nome");
  if (!incluirInativos) q = q.neq("status", "INATIVO");
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// História (linha do tempo)
// ---------------------------------------------------------------------------
/** Eventos da história de UM colaborador, em ordem cronológica, já com o
 * salário decifrado (RPC). Acrescenta um evento VIRTUAL de "Entrada na
 * empresa" a partir de rh.colaboradores.admissao quando não houver um
 * evento ENTRADA gravado — nada é gravado no banco por causa disso. */
async function rhCarregarHistoria(colaborador) {
  const { data, error } = await sb.rpc("historico_listar", { p_colaborador_id: colaborador.id });
  if (error) throw error;
  const eventos = (data || []).map((e) => ({ ...e, virtual: false }));
  const temEntrada = eventos.some((e) => e.tipo_evento === "ENTRADA" && !e.arquivado);
  if (!temEntrada && colaborador.admissao) {
    // Salário da entrada: o mais antigo conhecido no histórico (o "antes"
    // da primeira alteração salarial). Sem histórico salarial, mostra o
    // salário ATUAL do cadastro, identificado como atual (não como o de
    // admissão, que o sistema não tem registrado).
    const comSalario = eventos
      .filter((e) => !e.arquivado && (e.salario != null || e.salario_anterior != null))
      .sort((a, b) => a.data_evento.localeCompare(b.data_evento));
    let salarioEntrada = comSalario.length ? (comSalario[0].salario_anterior ?? comSalario[0].salario) : null;
    let salarioEhAtual = false;
    if (salarioEntrada == null) {
      try {
        const { data: dp } = await sb.rpc("colaboradores_dados_pessoais", { p_colaborador_id: colaborador.id });
        if (dp && dp[0] && dp[0].salario != null) { salarioEntrada = Number(dp[0].salario); salarioEhAtual = true; }
      } catch (e) { /* sem acesso ao salário: fica "não informado" */ }
    }
    const primeiro = eventos.filter((e) => e.dados_anteriores && (e.dados_anteriores.cargo || e.dados_anteriores.departamento))[0];
    eventos.unshift({
      id: "entrada-virtual",
      virtual: true,
      tipo_evento: "ENTRADA",
      data_evento: colaborador.admissao,
      cargo: primeiro?.dados_anteriores?.cargo || colaborador.cargo,
      departamento: primeiro?.dados_anteriores?.departamento || colaborador.departamento,
      salario: salarioEntrada,
      salario_rotulo: salarioEhAtual ? "Salário atual" : null,
      salario_nao_informado: salarioEntrada == null,
      descricao: "Data de admissão registrada no cadastro.",
      origem: "AUTOMATICO",
      visivel_colaborador: true,
      arquivado: false,
    });
  }
  eventos.sort((a, b) => (a.data_evento === b.data_evento ? String(a.created_at || "").localeCompare(String(b.created_at || "")) : a.data_evento.localeCompare(b.data_evento)));
  return eventos;
}

async function rhRegistrarEventoHistoria(ev) {
  const { data, error } = await sb.rpc("historico_registrar", {
    p_colaborador_id: ev.colaboradorId,
    p_tipo_evento: ev.tipo,
    p_data_evento: ev.data,
    p_cargo: ev.cargo || null,
    p_departamento: ev.departamento || null,
    p_salario: ev.salario === "" || ev.salario == null ? null : Number(ev.salario),
    p_beneficio: ev.beneficio || null,
    p_valor: ev.valor === "" || ev.valor == null ? null : Number(ev.valor),
    p_descricao: ev.descricao || null,
    p_observacao: ev.observacao || null,
    p_visivel_colaborador: ev.visivel !== false,
    p_aplicar_cadastro: !!ev.aplicarCadastro,
  });
  if (error) throw error;
  return data;
}

/** "Remover" um evento = arquivar (continua no banco e na auditoria). */
async function rhArquivarEventoHistoria(id, arquivado = true) {
  const { error } = await sb.from("colaborador_historico").update({ arquivado }).eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Benefícios concedidos a um colaborador
// ---------------------------------------------------------------------------
async function rhListarConcessoes(colaboradorId) {
  let q = sb.from("colaborador_beneficios").select("*, colaborador:colaboradores(id,nome,codigo,departamento)").order("data_inicio", { ascending: false });
  if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function rhMensagemBeneficio(c) {
  const partes = [`Seu benefício ${c.beneficio} foi cadastrado com início em ${fmtDate(c.data_inicio)}`];
  if (c.valor != null) partes[0] += ` no valor de ${rhBrl(c.valor)}${c.periodicidade ? ` (${(RH_PERIODICIDADE[c.periodicidade] || c.periodicidade).toLowerCase()})` : ""}`;
  partes[0] += ".";
  partes.push(c.possui_desconto ? `Desconto: ${rhBrl(c.valor_desconto)}.` : "Sem desconto.");
  if (c.descricao) partes.push(c.descricao);
  return partes.join(" ");
}

async function rhSalvarConcessao(c, { informar = false, registrarNaHistoria = true } = {}) {
  const payload = {
    colaborador_id: c.colaborador_id,
    beneficio_id: c.beneficio_id || null,
    beneficio: c.beneficio,
    descricao: c.descricao || null,
    valor: c.valor === "" || c.valor == null ? null : Number(c.valor),
    periodicidade: c.periodicidade || "MENSAL",
    possui_desconto: !!c.possui_desconto,
    valor_desconto: c.possui_desconto && c.valor_desconto !== "" && c.valor_desconto != null ? Number(c.valor_desconto) : null,
    data_inicio: c.data_inicio,
    data_fim: c.data_fim || null,
    status: c.status || "ATIVO",
    observacao: c.observacao || null,
  };
  let row;
  if (c.id) {
    const { data, error } = await sb.from("colaborador_beneficios").update(payload).eq("id", c.id).select().single();
    if (error) throw error;
    row = data;
  } else {
    const { data, error } = await sb.from("colaborador_beneficios").insert({ ...payload, responsavel_nome: c.responsavel_nome || null }).select().single();
    if (error) throw error;
    row = data;
  }
  if (registrarNaHistoria) {
    try {
      await rhRegistrarEventoHistoria({
        colaboradorId: row.colaborador_id,
        tipo: c.id ? "ALTERACAO_BENEFICIO" : "BENEFICIO_CONCEDIDO",
        data: row.data_inicio,
        beneficio: row.beneficio,
        valor: row.valor,
        descricao: [row.descricao, row.possui_desconto ? `Desconto: ${rhBrl(row.valor_desconto)}` : "Sem desconto", RH_PERIODICIDADE[row.periodicidade]].filter(Boolean).join(" · "),
      });
    } catch (e) {
      console.warn("Benefício salvo, mas não foi possível registrar na história:", e);
    }
  }
  if (informar) {
    await rhNotificarColaborador({
      colaboradorId: row.colaborador_id,
      tipo: "BENEFICIO",
      titulo: c.id ? "Benefício atualizado" : "Novo benefício cadastrado",
      mensagem: rhMensagemBeneficio(row),
      referenciaTabela: "colaborador_beneficios",
      referenciaId: row.id,
      autor: c.responsavel_nome,
    });
    await sb.from("colaborador_beneficios").update({ informado_em: new Date().toISOString() }).eq("id", row.id);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Notificações ao colaborador (histórico preservado — nunca apagadas)
// ---------------------------------------------------------------------------
async function rhNotificarColaborador({ colaboradorId, tipo = "GERAL", titulo, mensagem, referenciaTabela, referenciaId, autor }) {
  if (!colaboradorId || !titulo) return null;
  const { data, error } = await sb
    .from("notificacoes")
    .insert({ colaborador_id: colaboradorId, tipo, titulo, mensagem: mensagem || null, referencia_tabela: referenciaTabela || null, referencia_id: referenciaId || null, criado_por_nome: autor || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Versão "não bloqueante": uma falha ao notificar nunca desfaz a ação
 * principal (aprovar férias, ajuste, etc.) — só registra no console. */
async function rhNotificarSilencioso(args) {
  try {
    return await rhNotificarColaborador(args);
  } catch (e) {
    console.warn("Não foi possível registrar a notificação ao colaborador:", e);
    return null;
  }
}

async function rhListarNotificacoes(colaboradorId, limite = 50) {
  const { data, error } = await sb.from("notificacoes").select("*").eq("colaborador_id", colaboradorId).order("created_at", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Abonos
// ---------------------------------------------------------------------------
async function rhListarAbonos({ colaboradorId, status, inicio, fim } = {}) {
  let q = sb.from("colaborador_abonos").select("*, colaborador:colaboradores(id,nome,codigo,cargo,departamento)").order("data_inicio", { ascending: false });
  if (colaboradorId) q = q.eq("colaborador_id", colaboradorId);
  if (status) q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);
  if (inicio) q = q.gte("data_fim", inicio);
  if (fim) q = q.lte("data_inicio", fim);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function rhEnviarAnexoAbono(colaboradorId, arquivo) {
  const nomeLimpo = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${colaboradorId}/${Date.now()}-${nomeLimpo}`;
  const { error } = await sb.storage.from("abonos-rh").upload(path, arquivo, { upsert: false, contentType: arquivo.type || undefined });
  if (error) throw error;
  return { path, nome: arquivo.name };
}

async function rhUrlAnexoAbono(path) {
  const { data, error } = await sb.storage.from("abonos-rh").createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

async function rhSalvarAbono(a) {
  const payload = {
    colaborador_id: a.colaborador_id,
    tipo: a.tipo,
    justificada: a.justificada !== undefined ? !!a.justificada : (RH_TIPOS_ABONO[a.tipo]?.justificada ?? true),
    data_inicio: a.data_inicio,
    data_fim: a.data_fim || a.data_inicio,
    motivo: a.motivo || null,
    descricao: a.descricao || null,
    observacao: a.observacao || null,
    status: a.status || "PENDENTE",
  };
  if (a.anexo_path) {
    payload.anexo_path = a.anexo_path;
    payload.anexo_nome = a.anexo_nome || null;
  }
  if (a.id) {
    const { data, error } = await sb.from("colaborador_abonos").update(payload).eq("id", a.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await sb.from("colaborador_abonos").insert({ ...payload, responsavel_nome: a.responsavel_nome || null }).select().single();
  if (error) throw error;
  return data;
}

/** Muda o status de um abono (aprovar/pré-aprovar/recusar/arquivar) e
 * informa o colaborador. Nunca exclui. */
async function rhDecidirAbono(abono, novoStatus, autorNome, { informar = true, parecer = "" } = {}) {
  // O parecer do RH (motivo do sim/não) fica registrado na observação do
  // abono — com data e autor — e vai junto no aviso ao colaborador.
  const parecerLimpo = String(parecer || "").trim();
  const registro = parecerLimpo
    ? `Parecer do RH (${RH_STATUS_ABONO[novoStatus] || novoStatus}, ${autorNome || "RH"}, ${new Date().toLocaleDateString("pt-BR")}): ${parecerLimpo}`
    : "";
  const { data, error } = await sb
    .from("colaborador_abonos")
    .update({
      status: novoStatus,
      decidido_por_nome: autorNome || null,
      decidido_em: new Date().toISOString(),
      ...(registro ? { observacao: [abono.observacao, registro].filter(Boolean).join("\n") } : {}),
    })
    .eq("id", abono.id)
    .select()
    .single();
  if (error) throw error;
  if (informar && novoStatus !== "ARQUIVADO") {
    const tipoLabel = RH_TIPOS_ABONO[abono.tipo]?.label || abono.tipo;
    const periodo = abono.data_inicio === abono.data_fim ? fmtDate(abono.data_inicio) : `${fmtDate(abono.data_inicio)} a ${fmtDate(abono.data_fim)}`;
    await rhNotificarSilencioso({
      colaboradorId: abono.colaborador_id,
      tipo: "ABONO",
      titulo: `${tipoLabel} ${(RH_STATUS_ABONO[novoStatus] || novoStatus).toLowerCase()}`,
      mensagem: `Ocorrência de ${periodo} (${tipoLabel}) — situação: ${RH_STATUS_ABONO[novoStatus] || novoStatus}.${parecerLimpo ? " Parecer do RH: " + parecerLimpo : abono.motivo ? " Motivo: " + abono.motivo + "." : ""}`,
      referenciaTabela: "colaborador_abonos",
      referenciaId: abono.id,
      autor: autorNome,
    });
  }
  return data;
}

/** Abono APROVADO que cobre o dia `iso` para o colaborador (ou null). Só
 * APROVADO abona — pendente/pré-aprovado/recusado/arquivado não. */
function rhAbonoDoDia(abonos, colaboradorId, iso) {
  return (abonos || []).find((a) => a.status === "APROVADO" && a.colaborador_id === colaboradorId && a.data_inicio <= iso && a.data_fim >= iso) || null;
}

// ---------------------------------------------------------------------------
// Regras de ponto (intervalo)
// ---------------------------------------------------------------------------
const RH_CONFIG_PONTO_PADRAO = { intervalo_minimo_min: 60, almoco_inicio_minimo: null, controle_ponto_inicio: null };

async function rhCarregarConfigPonto() {
  try {
    const { data, error } = await sb.from("configuracoes_ponto").select("*").eq("id", 1).maybeSingle();
    if (error || !data) return { ...RH_CONFIG_PONTO_PADRAO, _padrao: true };
    return { ...data, almoco_inicio_minimo: data.almoco_inicio_minimo ? String(data.almoco_inicio_minimo).slice(0, 5) : null };
  } catch {
    return { ...RH_CONFIG_PONTO_PADRAO, _padrao: true };
  }
}

async function rhSalvarConfigPonto({ intervalo_minimo_min, almoco_inicio_minimo, controle_ponto_inicio, autor }) {
  const { error } = await sb
    .from("configuracoes_ponto")
    .update({
      intervalo_minimo_min: Number(intervalo_minimo_min),
      almoco_inicio_minimo: almoco_inicio_minimo || null,
      controle_ponto_inicio: controle_ponto_inicio || null,
      updated_at: new Date().toISOString(),
      updated_by_nome: autor || null,
    })
    .eq("id", 1);
  if (error) throw error;
}

/** Validação no navegador (a mesma regra também é aplicada NO BANCO, por
 * trigger — ver rh.ponto_validar_intervalo). Devolve null se pode bater, ou
 * uma mensagem explicando o bloqueio. `hora` = "HH:MM". */
function rhValidarBatidaIntervalo(etapa, hora, hoje, config) {
  const cfg = config || RH_CONFIG_PONTO_PADRAO;
  const min = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
  if (etapa === "intervaloSaida" && cfg.almoco_inicio_minimo && min(hora) < min(cfg.almoco_inicio_minimo)) {
    return `O intervalo não pode começar antes das ${cfg.almoco_inicio_minimo}.`;
  }
  if (etapa === "intervaloVolta" && hoje?.intervaloSaida && Number(cfg.intervalo_minimo_min) > 0) {
    const liberado = min(hoje.intervaloSaida) + Number(cfg.intervalo_minimo_min);
    if (min(hora) < liberado) {
      const hh = String(Math.floor(liberado / 60) % 24).padStart(2, "0");
      const mm = String(liberado % 60).padStart(2, "0");
      return `O intervalo mínimo é de ${cfg.intervalo_minimo_min} minutos. Retorno permitido a partir das ${hh}:${mm}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auditoria (só RH lê)
// ---------------------------------------------------------------------------
async function rhListarAuditoriaColaborador(colaboradorId, limite = 100) {
  const { data, error } = await sb.from("auditoria").select("*").eq("colaborador_id", colaboradorId).order("created_at", { ascending: false }).limit(limite);
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------------------------
// Sub-navegação da área de Jornada (Jornada | Ajustes | Abonos | História)
// ---------------------------------------------------------------------------
function rhSubnavJornadaHtml(ativo, { ajustesPendentes = 0 } = {}) {
  const itens = [
    { id: "hoje", href: "ponto.html", label: "Jornada de Ponto", icon: ICONS.users },
    { id: "ajustes", href: "ponto.html#ajustes", label: "Ajustes Pendentes", icon: ICONS.alertCircle, badge: ajustesPendentes },
    { id: "abonos", href: "abonos.html", label: "Abonos", icon: ICONS.clipboardCheck },
    { id: "historia", href: "historia.html", label: "Histórico do Colaborador", icon: ICONS.timeline },
  ];
  return `
    <div class="card card-p" style="padding:0.4rem">
      <div class="tabs subnav-jornada" style="border-bottom:none">
        ${itens.map((i) => `<a class="tab-btn ${i.id === ativo ? "active" : ""}" href="${i.href}">${i.icon}<span style="margin-left:0.4rem">${i.label}</span>${i.badge ? `<span class="badge badge-red" style="margin-left:0.4rem">${i.badge}</span>` : ""}</a>`).join("")}
      </div>
    </div>`;
}

/** Colaborador justifica uma falta / pede um abono: cria o abono DELE,
 * sempre PENDENTE (a política do banco não aceita outro status vindo do
 * colaborador). O RH analisa em Jornada / Ponto → Abonos. */
async function rhSolicitarAbonoColaborador({ colaboradorId, colaboradorNome, tipo, dataInicio, dataFim, motivo, descricao, arquivo }) {
  if (!motivo || !motivo.trim()) throw new Error("Informe o motivo.");
  if (dataFim && dataFim < dataInicio) throw new Error("A data final não pode ser anterior à inicial.");
  let anexo = {};
  if (arquivo) {
    if (arquivo.size > 15 * 1024 * 1024) throw new Error("O anexo deve ter no máximo 15 MB.");
    const up = await rhEnviarAnexoAbono(colaboradorId, arquivo);
    anexo = { anexo_path: up.path, anexo_nome: up.nome };
  }
  const { data, error } = await sb
    .from("colaborador_abonos")
    .insert({
      colaborador_id: colaboradorId,
      tipo,
      justificada: RH_TIPOS_ABONO[tipo]?.justificada ?? true,
      data_inicio: dataInicio,
      data_fim: dataFim || dataInicio,
      motivo: motivo.trim(),
      descricao: descricao || null,
      status: "PENDENTE",
      responsavel_nome: colaboradorNome ? `${colaboradorNome} (colaborador)` : null,
      ...anexo,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Faltas do próprio colaborador que ainda não têm abono (nem pendente):
 * dias de trabalho já passados, sem entrada registrada, a partir do
 * primeiro registro de ponto dele (ou da admissão, o que for mais tarde),
 * nos últimos `dias` dias. */
function rhFaltasSemJustificativa({ historico, diasTrabalho, admissao, abonos, dias = 60 }) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const registros = new Map((historico || []).map((h) => [h.data, h]));
  const primeiro = (historico || []).map((h) => h.data).sort()[0];
  if (!primeiro) return [];
  let inicio = new Date(hoje); inicio.setDate(inicio.getDate() - dias);
  let inicioIso = iso(inicio);
  if (primeiro > inicioIso) inicioIso = primeiro;
  if (admissao && admissao > inicioIso) inicioIso = admissao;
  const faltas = [];
  const d = new Date(inicioIso + "T00:00:00");
  while (d < hoje) {
    const dIso = iso(d);
    const rec = registros.get(dIso);
    const semEntrada = !rec || !rec.entrada;
    const coberto = (abonos || []).some((a) => a.status !== "RECUSADO" && a.status !== "ARQUIVADO" && a.data_inicio <= dIso && a.data_fim >= dIso);
    if (semEntrada && !coberto && !rec?.pendenteAjuste && (rhEhDiaDeTrabalho(diasTrabalho, dIso) || rec?.status === "falta")) faltas.push(dIso);
    d.setDate(d.getDate() + 1);
  }
  return faltas.reverse();
}

/** Colaborador anexa o documento depois (abono ainda PENDENTE). */
async function rhAnexarDocumentoAbono(abono, arquivo) {
  const up = await rhEnviarAnexoAbono(abono.colaborador_id, arquivo);
  const { error } = await sb.from("colaborador_abonos").update({ anexo_path: up.path, anexo_nome: up.nome }).eq("id", abono.id).eq("status", "PENDENTE");
  if (error) throw error;
}
