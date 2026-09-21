/*
 * BSconta+ RH — Autenticação REAL (Supabase Auth)
 * =============================================================================
 * Substitui por completo o login fake de js/demo-data.js (getSession /
 * loginDemo / requireRole / logout baseados em sessionStorage com dados
 * fictícios). A partir deste arquivo:
 *
 *   - "Estar logado" = ter uma sessão real do Supabase Auth (e-mail + senha
 *     verificados pelo Supabase, token JWT real, expiração real).
 *   - "Ter acesso" = ter uma linha em rh.perfis ligando esse login a um papel
 *     (COLABORADOR, RH ou RH_ADMIN). Sem essa linha, o login funciona mas o
 *     sistema de RH nega acesso (é um bloqueio de negócio, não um bug).
 *   - O que cada papel pode LER/ESCREVER de verdade é decidido pelo RLS no
 *     banco (db/supabase/01_schema_rh.sql) — este arquivo só decide para
 *     qual portal mandar a pessoa; ele nunca é a barreira de segurança real.
 *
 * Depende de, NESTA ORDEM, antes deste script:
 *   1) <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   2) <script src=".../js/supabase-client.js"></script>   (cria window.sb)
 *
 * Mantém o nome global `logout()` (chamado por js/ui.js nos botões "Sair")
 * para não precisar editar ui.js — mas agora é assíncrono e de verdade
 * encerra a sessão no Supabase.
 */

const RH_SESSION_CACHE_KEY = "bsconta_rh_real_session_v1";

function rhReadCachedSession() {
  try {
    return JSON.parse(sessionStorage.getItem(RH_SESSION_CACHE_KEY) || "null");
  } catch {
    return null;
  }
}
function rhWriteCachedSession(session) {
  try {
    sessionStorage.setItem(RH_SESSION_CACHE_KEY, JSON.stringify(session));
  } catch {
    /* sessionStorage indisponível: só perde o cache, não é crítico */
  }
}
function rhClearCachedSession() {
  try {
    sessionStorage.removeItem(RH_SESSION_CACHE_KEY);
  } catch {
    /* nada a fazer */
  }
}

/** Substitui a tela inteira por uma mensagem de erro clara — usado quando o
 * problema é de configuração/conexão (não algo que um clique resolva), para
 * nunca mostrar uma tela em branco ou travada sem explicação. */
function rhShowFatalError(message) {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,sans-serif;";
  el.innerHTML = `<div style="max-width:560px;text-align:center;">
    <h2 style="margin-bottom:12px;color:#8a1f1f;font-size:18px;">Não foi possível carregar o sistema</h2>
    <p style="color:#444;line-height:1.6;font-size:14px;">${message}</p>
    <button type="button" id="rh-fatal-voltar" style="margin-top:18px;padding:10px 18px;border-radius:8px;border:1px solid #ccc;background:#f7f7f7;cursor:pointer;">Voltar para o login</button>
  </div>`;
  document.body.innerHTML = "";
  document.body.appendChild(el);
  document.getElementById("rh-fatal-voltar")?.addEventListener("click", () => {
    window.location.href = `${window.BASE_PATH || ""}login.html`;
  });
}

/** Busca o papel (rh.perfis) e, se houver, os dados do colaborador
 * (rh.colaboradores) ligados ao usuário autenticado. Retorna null quando o
 * login é real mas ainda não tem papel definido no RH (situação legítima:
 * conta criada mas ninguém rodou 02_promover_primeiro_rh_admin.sql ou o
 * fluxo de convite ainda). Lança erro para falhas de conexão/consulta —
 * quem chama decide como mostrar isso (nunca fingimos que "funcionou"). */
async function rhFetchPerfilCompleto(userId, userEmail) {
  const { data: perfil, error: perfilErr } = await sb.from("perfis").select("role, colaborador_id, ativo, nome, email, preferencias_notificacao, primeiro_acesso, acesso_atualizado_em").eq("user_id", userId).maybeSingle();
  if (perfilErr) throw perfilErr;
  if (!perfil) return null;

  let colaborador = null;
  if (perfil.colaborador_id) {
    const { data: colab, error: colabErr } = await sb.from("colaboradores").select("*").eq("id", perfil.colaborador_id).maybeSingle();
    if (colabErr) throw colabErr;
    colaborador = colab;
  }

  return {
    role: perfil.role, // 'COLABORADOR' | 'RH' | 'RH_ADMIN'
    employeeId: perfil.colaborador_id || null,
    contaAtiva: perfil.ativo !== false,
    primeiroAcesso: perfil.primeiro_acesso === true,
    acessoAtualizadoEm: perfil.acesso_atualizado_em || null,
    preferenciasNotificacao: perfil.preferencias_notificacao || {},
    name: colaborador?.nome || perfil.nome || userEmail,
    email: colaborador?.email || perfil.email || userEmail,
    cargo: colaborador?.cargo || (perfil.role === "RH_ADMIN" ? "Administrador de RH" : perfil.role === "RH" ? "Analista de RH" : ""),
    departamento: colaborador?.departamento || (perfil.role !== "COLABORADOR" ? "Recursos Humanos" : ""),
    admissao: colaborador?.admissao || null,
    codigoColaborador: colaborador?.codigo || null,
    photo: colaborador?.foto_url || null,
    status: colaborador?.status || "ATIVO",
    // Jornada CONTRATADA (para o lembrete de ponto) — não confundir com o
    // horário REAL batido, que fica em rh.ponto_registros.
    horarioPrevisto: colaborador ? { entrada: colaborador.horario_entrada || null, saida: colaborador.horario_saida || null } : null,
  };
}

function rhMensagemErroSupabase(err) {
  const msg = String(err?.message || err || "");
  if (/schema must be one of|rh\.perfis|relation .*rh\..* does not exist/i.test(msg)) {
    return "O banco de dados do RH ainda não foi configurado neste projeto Supabase (schema \"rh\" ausente ou não exposto na API). Veja SETUP-SUPABASE.md — Passos 1 e 2.";
  }
  return "Erro ao falar com o banco de dados: " + msg;
}

/**
 * Guarda de acesso real para as páginas do portal (equivalente a
 * requireRole() do protótipo antigo, mas checando de verdade no Supabase).
 * Uso: `const session = await requireRoleReal("COLABORADOR");` (ou "RH") como
 * a PRIMEIRA linha do script da página, seguida de `if (!session) return;`
 * — quando retorna null, a função já redirecionou ou já mostrou o erro.
 */
async function requireRoleReal(expectedRole) {
  if (typeof window.sb === "undefined" || !window.sb) {
    rhShowFatalError(
      "O cliente do Supabase não foi inicializado. Confira se o &lt;script&gt; do supabase-js (CDN) está carregado ANTES de js/supabase-client.js nesta página."
    );
    return null;
  }

  const { data: authData, error: authErr } = await sb.auth.getSession();
  if (authErr) {
    rhShowFatalError("Erro ao verificar sua sessão de login: " + authErr.message);
    return null;
  }
  const authSession = authData?.session;
  if (!authSession) {
    rhClearCachedSession();
    window.location.href = `${window.BASE_PATH || ""}login.html`;
    return null;
  }

  let perfilCompleto;
  try {
    perfilCompleto = await rhFetchPerfilCompleto(authSession.user.id, authSession.user.email);
  } catch (e) {
    rhShowFatalError(rhMensagemErroSupabase(e));
    return null;
  }

  if (!perfilCompleto) {
    rhShowFatalError(
      "Seu login foi reconhecido, mas ainda não existe um papel para você no sistema de RH (tabela rh.perfis). " +
      "Peça a um RH_ADMIN para te cadastrar em Configurações &gt; Usuários, ou — se este for o primeiro acesso — " +
      "rode db/supabase/02_promover_primeiro_rh_admin.sql com o seu e-mail."
    );
    return null;
  }

  if (perfilCompleto.status === "INATIVO") {
    await sb.auth.signOut();
    rhClearCachedSession();
    rhShowFatalError("Este cadastro está marcado como INATIVO no RH. Fale com o setor de Recursos Humanos.");
    return null;
  }

  if (perfilCompleto.contaAtiva === false) {
    await sb.auth.signOut();
    rhClearCachedSession();
    rhShowFatalError("Seu acesso ao sistema foi desativado por um RH_ADMIN em Configurações &gt; Usuários e permissões. Fale com o setor de Recursos Humanos se isso for um engano.");
    return null;
  }

  if (perfilCompleto.primeiroAcesso && !window.location.pathname.replace(/\\/g, "/").endsWith("/trocar-senha.html")) {
    window.location.href = `${window.BASE_PATH || ""}trocar-senha.html`;
    return null;
  }

  const isPortalRH = perfilCompleto.role === "RH" || perfilCompleto.role === "RH_ADMIN";
  const querPortalRH = expectedRole === "RH";
  if (isPortalRH !== querPortalRH) {
    window.location.href = isPortalRH ? `${window.BASE_PATH || ""}rh/dashboard.html` : `${window.BASE_PATH || ""}colaborador/dashboard.html`;
    return null;
  }

  const session = { role: querPortalRH ? "RH" : "COLABORADOR", roleReal: perfilCompleto.role, userId: authSession.user.id, ...perfilCompleto };
  rhWriteCachedSession(session);
  return session;
}

/** Se já existir uma sessão real válida, manda direto pro portal certo.
 * Usado em login.html/index.html no lugar do antigo `if (getSession())`. */
async function rhRedirecionarSeJaLogado() {
  if (typeof window.sb === "undefined" || !window.sb) return false;
  const { data: authData } = await sb.auth.getSession();
  if (!authData?.session) return false;
  try {
    const perfil = await rhFetchPerfilCompleto(authData.session.user.id, authData.session.user.email);
    if (!perfil) return false;
    const isRh = perfil.role === "RH" || perfil.role === "RH_ADMIN";
    window.location.replace(isRh ? `${window.BASE_PATH || ""}rh/dashboard.html` : `${window.BASE_PATH || ""}colaborador/dashboard.html`);
    return true;
  } catch {
    return false;
  }
}

/** Login real: e-mail + senha verificados pelo Supabase Auth. Lança o erro
 * original do Supabase (nunca inventamos uma mensagem de sucesso falsa). */
async function rhLoginReal(email, senha) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data;
}

/** Recuperação de senha real — dispara o e-mail de verdade pelo Supabase. */
async function rhEsqueciSenha(email) {
  const redirectTo = new URL(`${window.BASE_PATH || ""}login.html`, window.location.href).href;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/**
 * Convite real de novo colaborador — chama a Edge Function
 * supabase/functions/invite-colaborador/index.ts (que precisa estar
 * IMPLANTADA no projeto Supabase; veja o cabeçalho daquele arquivo).
 * Faz o servidor: confirmar que quem chama é RH/RH_ADMIN, checar duplicidade,
 * enviar o convite real (Supabase Auth manda o e-mail), criar o colaborador
 * e vincular o papel — nada disso é feito no front-end nem fingido aqui.
 * Lança o erro real (mensagem do servidor) quando algo falha.
 */
async function rhConvidarColaborador({ nome, email, cargo, departamento, admissao, role, criarColaborador }) {
  const { data, error } = await sb.functions.invoke("invite-colaborador", {
    body: { nome, email, cargo, departamento, admissao, role: role || "COLABORADOR", criarColaborador: criarColaborador !== false },
  });
  if (error) {
    // supabase-js só preenche `error` para falhas de rede/invocação; quando a
    // função responde com status != 2xx, o corpo (com o "error" de verdade
    // escrito pela function) normalmente vem em error.context — tenta extrair.
    let detalhe = error.message || String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) detalhe = body.error;
    } catch {
      /* mantém detalhe genérico */
    }
    throw new Error(detalhe);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Login automático de USO INTERNO (sem e-mail real) — chama a Edge Function
 * supabase/functions/criar-login-colaborador/index.ts. Diferente de
 * rhConvidarColaborador: aqui o SERVIDOR gera um e-mail interno e uma senha
 * de verdade e devolve as duas coisas nesta resposta (uma única vez — a
 * senha não fica salva em nenhum lugar depois disso, nem no banco, nem
 * aqui). Use `colaboradorId` para gerar login de um colaborador que já
 * existe no cadastro (ex.: veio da planilha, com e-mail provisório); deixe
 * de fora para criar um colaborador novo já com login.
 */
async function rhCriarLoginColaborador({ colaboradorId, nome, email, cargo, departamento, admissao, role }) {
  const { data, error } = await sb.functions.invoke("criar-login-colaborador", {
    body: { colaboradorId, nome, email, cargo, departamento, admissao, role: role || "COLABORADOR" },
  });
  if (error) {
    let detalhe = error.message || String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) detalhe = body.error;
    } catch {
      /* mantém detalhe genérico */
    }
    throw new Error(detalhe);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Cadastro de ESTAGIÁRIO — chama a Edge Function
 * supabase/functions/criar-estagiario-colaborador/index.ts. Meio-termo entre
 * rhConvidarColaborador e rhCriarLoginColaborador: aqui quem está cadastrando
 * INFORMA o e-mail manualmente (`email` é obrigatório), e o SERVIDOR gera só
 * a senha, no mesmo padrão já usado por "Regenerar acesso" ("BSconta" +
 * PrimeiroNome + 4 dígitos aleatórios). A senha volta nesta resposta, uma
 * única vez (não fica salva em nenhum lugar depois). Não aceita
 * `colaboradorId` — é só para cadastrar um estagiário novo; colaboradores já
 * existentes não são afetados por esta função.
 */
async function rhCriarEstagiarioColaborador({ nome, email, cargo, departamento, admissao, role }) {
  const { data, error } = await sb.functions.invoke("criar-estagiario-colaborador", {
    body: { nome, email, cargo, departamento, admissao, role: role || "COLABORADOR" },
  });
  if (error) {
    let detalhe = error.message || String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) detalhe = body.error;
    } catch {
      /* mantém detalhe genérico */
    }
    throw new Error(detalhe);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Regenera SÓ A SENHA de um colaborador que já tem login — chama a Edge
 * Function supabase/functions/regenerar-acesso-colaborador/index.ts. O
 * e-mail de login não muda (fica o mesmo de sempre); a senha nova segue o
 * padrão "BSconta" + PrimeiroNome + código aleatório de 4 dígitos. Mantém
 * o mesmo id do colaborador e o mesmo user_id de autenticação — todo o
 * histórico (ponto, férias, documentos, solicitações) continua ligado à
 * mesma pessoa. A senha antiga deixa de funcionar assim que esta chamada
 * tiver sucesso. Se o colaborador ainda não tiver login, a função retorna
 * erro — use rhCriarLoginColaborador para criar um primeiro.
 */
async function rhRegenerarAcessoColaborador({ colaboradorId }) {
  const { data, error } = await sb.functions.invoke("regenerar-acesso-colaborador", {
    body: { colaboradorId },
  });
  if (error) {
    let detalhe = error.message || String(error);
    try {
      const body = await error.context?.json?.();
      if (body?.error) detalhe = body.error;
    } catch {
      /* mantém detalhe genérico */
    }
    throw new Error(detalhe);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Troca a PRÓPRIA senha (usada em trocar-senha.html, no primeiro acesso ou
 * sempre que a pessoa quiser trocar por conta própria) e, em caso de
 * sucesso, avisa o banco que o primeiro acesso foi concluído
 * (rh.concluir_primeiro_acesso — só mexe na própria linha, nunca na de
 * outra pessoa).
 */
async function rhAlterarSenhaPropria(novaSenha) {
  const { error: authErr } = await sb.auth.updateUser({ password: novaSenha });
  if (authErr) throw authErr;
  const { error: rpcErr } = await sb.rpc("concluir_primeiro_acesso");
  if (rpcErr) throw rpcErr;
  rhClearCachedSession();
}

/** Substitui o logout() fake de demo-data.js — mesmo nome global (ui.js já
 * chama `logout` nos botões "Sair"), agora encerrando a sessão de verdade. */
async function logout() {
  rhClearCachedSession();
  if (window.sb) {
    try {
      await sb.auth.signOut();
    } catch {
      /* mesmo se falhar ao avisar o servidor, ainda manda pro login */
    }
  }
  window.location.href = `${window.BASE_PATH || ""}login.html`;
}

/** Substitui o rhNavBadges() fake de demo-data.js (lia DEMO.rhSolicitacoesTodas
 * / DEMO.rhFerias / DEMO.rhDocumentos — listas fixas que nunca mudavam,
 * então os números nos badges do menu do RH nunca refletiam a fila real).
 * Consulta direto rh.solicitacoes / rh.ferias_solicitacoes / rh.documentos —
 * de propósito não depende de nenhum outro js/rh-*-data.js estar carregado
 * na página, porque este arquivo (rh-supabase-auth.js) é o único incluído em
 * TODAS as telas do RH. Cada chamador já é `async function () {...}` (a
 * mesma IIFE que faz `await requireRoleReal(...)`), então basta usar
 * `await rhNavBadges()` no lugar da chamada síncrona antiga. */
async function rhNavBadges() {
  try {
    const [geraisRes, feriasRes, docsRes, colabRes, feriasTodasRes] = await Promise.all([
      sb.from("solicitacoes").select("id", { count: "exact", head: true }).in("status", ["PENDENTE", "EM_ANALISE"]),
      sb.from("ferias_solicitacoes").select("id", { count: "exact", head: true }).in("status", ["PENDENTE", "EM_ANALISE"]),
      sb.from("documentos").select("id", { count: "exact", head: true }).in("status", ["PENDENTE", "AGUARDANDO_IMPORTACAO"]),
      // Item "Lembrete de férias": colaboradores com o período aquisitivo
      // vigente perto de vencer (ou já vencido) e ainda sem férias
      // programadas — ver rhContarAvisosFerias abaixo.
      sb.from("colaboradores").select("id, nome, admissao").neq("status", "INATIVO"),
      sb.from("ferias_solicitacoes").select("colaborador_id, inicio, status").in("status", ["APROVADA", "PENDENTE", "EM_ANALISE"]),
    ]);
    if (geraisRes.error) throw geraisRes.error;
    if (feriasRes.error) throw feriasRes.error;
    if (docsRes.error) throw docsRes.error;
    if (colabRes.error) throw colabRes.error;
    if (feriasTodasRes.error) throw feriasTodasRes.error;
    const avisosFerias = rhContarAvisosFerias(colabRes.data || [], feriasTodasRes.data || []);
    return {
      "solicitacoes.html": (geraisRes.count || 0) + (feriasRes.count || 0),
      "ferias.html": (feriasRes.count || 0) + avisosFerias,
      "documentos.html": docsRes.count || 0,
    };
  } catch (err) {
    // Um badge errado não deve travar a tela inteira — melhor mostrar o menu
    // sem número do que dar erro fatal por causa de um contador.
    console.error("rhNavBadges: falha ao contar pendências para os badges do menu.", err);
    return {};
  }
}

/** Lembrete automático de férias (item pedido pelo RH): conta quantos
 * colaboradores ativos estão com o período aquisitivo vigente (admissão +
 * 1 ano, repetido a cada aniversário) a ≤60 dias de vencer — ou já vencido —
 * e ainda sem nenhuma férias aprovada/pendente marcando esse período.
 * Cálculo autocontido de propósito (sem depender de js/rh-ferias-data.js,
 * que não está incluído em todas as telas do RH — ver comentário acima de
 * rhNavBadges). A mesma regra (com mais detalhe por pessoa) é usada em
 * rh/ferias.html e no aviso do próprio colaborador. */
const RH_FERIAS_AVISO_DIAS_BADGE = 60;
function rhContarAvisosFerias(colaboradores, solicitacoes) {
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  let total = 0;
  colaboradores.forEach((c) => {
    if (!c.admissao) return;
    const admissao = new Date(c.admissao + "T00:00:00");
    if (Number.isNaN(admissao.getTime())) return;
    let fimPeriodo = new Date(admissao);
    while (fimPeriodo <= hoje) fimPeriodo = new Date(fimPeriodo.getFullYear() + 1, fimPeriodo.getMonth(), fimPeriodo.getDate());
    const inicioPeriodo = new Date(fimPeriodo.getFullYear() - 1, fimPeriodo.getMonth(), fimPeriodo.getDate());
    const diasParaVencer = Math.round((fimPeriodo - hoje) / 86400000);
    if (diasParaVencer > RH_FERIAS_AVISO_DIAS_BADGE) return;
    const inicioIso = isoOf(inicioPeriodo);
    const fimIso = isoOf(fimPeriodo);
    const jaProgramada = solicitacoes.some((f) => f.colaborador_id === c.id && f.inicio >= inicioIso && f.inicio <= fimIso);
    if (!jaProgramada) total++;
  });
  return total;
}
