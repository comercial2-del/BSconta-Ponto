// =============================================================================
// BSconta+ RH — Supabase Edge Function: convite real de novo colaborador
// =============================================================================
// Por que isto precisa ser uma Edge Function (código no SERVIDOR, não no
// front-end): criar um login novo (auth.users) exige a "secret key"
// (service_role) do Supabase — a chave que dá acesso total ao projeto. Essa
// chave NUNCA pode ir para o navegador (qualquer pessoa que abrisse o
// DevTools poderia roubá-la e controlar o banco inteiro). Rodando aqui, ela
// fica só no servidor da Supabase, acessível via variável de ambiente que a
// própria plataforma injeta (SUPABASE_SERVICE_ROLE_KEY) — nunca escrita em
// nenhum arquivo deste repositório.
//
// O que esta função faz de verdade, em uma chamada só:
//   1) Confirma que quem está chamando é RH ou RH_ADMIN de verdade (não só
//      confia no que o front-end diz — refaz a checagem no servidor, com o
//      token da própria pessoa, exatamente como o RLS faria).
//   2) Confere se o e-mail já existe (em rh.colaboradores e em auth.users),
//      pra não criar duplicado nem estourar um erro confuso.
//   3) Convida de verdade (auth.admin.inviteUserByEmail) — a Supabase manda
//      um e-mail real pro novo colaborador com um link de "definir senha".
//      Ninguém (nem o RH, nem esta função) fica sabendo a senha da pessoa.
//   4) Cria a linha em rh.colaboradores e a linha em rh.perfis (ligando o
//      novo login ao papel — COLABORADOR por padrão; só RH_ADMIN pode
//      convidar já como RH/RH_ADMIN).
//   5) Se algo falhar DEPOIS do convite (ex.: e-mail duplicado só aparece na
//      hora), avisa exatamente o que ficou pendente, em vez de dizer que deu
//      tudo certo.
//
// -----------------------------------------------------------------------------
// COMO IMPLANTAR (passo manual — não pode ser feito por automação daqui):
//   1) Instale a Supabase CLI (npm i -g supabase, ou veja
//      https://supabase.com/docs/guides/cli).
//   2) No terminal, dentro da pasta deste repositório:
//        supabase login
//        supabase link --project-ref zqhuhaqothpxusnaijog
//        supabase functions deploy invite-colaborador
//   3) A função passa a existir em:
//        https://zqhuhaqothpxusnaijog.supabase.co/functions/v1/invite-colaborador
//      O front-end já está preparado para chamá-la via
//      `sb.functions.invoke("invite-colaborador", { body: {...} })`
//      (ver js/rh-supabase-auth.js, função rhConvidarColaborador).
//   4) Pré-requisito: os scripts SQL (01 a 04) já precisam ter sido
//      executados (ver SETUP-SUPABASE.md) — esta função consulta e grava nas
//      tabelas rh.colaboradores e rh.perfis, que só existem depois disso.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!; // publishable key, injetada automaticamente
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // secret key, injetada automaticamente — nunca fica no front-end

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido. Use POST." }, 405);

  // ---------------------------------------------------------------------
  // 1) Quem está chamando? Usa o JWT do próprio usuário (enviado pelo
  //    front-end no header Authorization) contra o schema "rh" — se a
  //    pessoa não for RH/RH_ADMIN de verdade em rh.perfis, é bloqueada
  //    aqui, no servidor, mesmo que alguém tente chamar esta função
  //    direto (sem passar pela tela).
  // ---------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Não autenticado — token ausente." }, 401);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "rh" },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: callerAuth, error: callerAuthErr } = await callerClient.auth.getUser();
  if (callerAuthErr || !callerAuth?.user) {
    return jsonResponse({ error: "Sessão inválida ou expirada. Faça login novamente." }, 401);
  }

  const { data: callerPerfil, error: callerPerfilErr } = await callerClient
    .from("perfis")
    .select("role")
    .eq("user_id", callerAuth.user.id)
    .maybeSingle();
  if (callerPerfilErr) return jsonResponse({ error: "Erro ao verificar seu papel de acesso: " + callerPerfilErr.message }, 500);
  if (!callerPerfil || !["RH", "RH_ADMIN"].includes(callerPerfil.role)) {
    return jsonResponse({ error: "Você não tem permissão de RH para convidar colaboradores." }, 403);
  }

  // ---------------------------------------------------------------------
  // 2) Valida o corpo da requisição.
  // ---------------------------------------------------------------------
  let payload: {
    nome?: string;
    email?: string;
    cargo?: string;
    departamento?: string;
    admissao?: string;
    role?: string;
    criarColaborador?: boolean;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido (esperado JSON)." }, 400);
  }

  const nome = (payload.nome || "").trim();
  const email = (payload.email || "").trim().toLowerCase();
  const cargo = (payload.cargo || "").trim();
  const departamento = (payload.departamento || "").trim();
  const admissao = payload.admissao || null;
  let role = (payload.role || "COLABORADOR").trim().toUpperCase();
  // "criarColaborador: false" é usado por Configurações > Usuários e
  // permissões (rh/configuracoes.html) pra convidar uma conta de acesso ao
  // sistema (RH/RH_ADMIN, ou colaborador ainda sem cadastro de RH) SEM criar
  // uma linha em rh.colaboradores — a linha de rh.perfis fica com
  // colaborador_id nulo e guarda nome/e-mail direto nela.
  const criarColaborador = payload.criarColaborador !== false;

  if (!nome) return jsonResponse({ error: "Nome é obrigatório." }, 400);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return jsonResponse({ error: "E-mail inválido." }, 400);
  if (!["COLABORADOR", "RH", "RH_ADMIN"].includes(role)) {
    return jsonResponse({ error: "Papel inválido. Use COLABORADOR, RH ou RH_ADMIN." }, 400);
  }
  // Só RH_ADMIN pode convidar alguém já como RH ou RH_ADMIN — mesma regra
  // do RLS de rh.perfis (rh.is_rh_admin()), reforçada aqui também.
  if (role !== "COLABORADOR" && callerPerfil.role !== "RH_ADMIN") {
    return jsonResponse({ error: "Só um RH_ADMIN pode convidar alguém como RH ou RH_ADMIN." }, 403);
  }

  // Cliente com a chave secreta — só a partir daqui, e só para as duas
  // operações que exigem privilégio de administrador (convidar login e
  // gravar nas tabelas, contornando o RLS de propósito porque quem
  // validou a permissão já fomos nós, acima).
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "rh" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---------------------------------------------------------------------
  // 3) Duplicidade — checa ANTES de convidar, pra dar um erro claro em vez
  //    de um erro genérico do Admin API.
  // ---------------------------------------------------------------------
  if (criarColaborador) {
    const { data: colabExistente, error: colabExistenteErr } = await adminClient
      .from("colaboradores")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (colabExistenteErr) return jsonResponse({ error: "Erro ao checar duplicidade: " + colabExistenteErr.message }, 500);
    if (colabExistente) return jsonResponse({ error: "Já existe um colaborador cadastrado com este e-mail." }, 409);
  }

  // ---------------------------------------------------------------------
  // 4) Convite real — cria o login em auth.users e dispara o e-mail real
  //    de "defina sua senha" (Supabase Auth, não simulado).
  // ---------------------------------------------------------------------
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { nome },
  });
  if (inviteErr) {
    const msg = String(inviteErr.message || inviteErr);
    if (/already been registered|already exists/i.test(msg)) {
      return jsonResponse({ error: "Este e-mail já tem um login no sistema (pode já ter acesso a outro sistema da empresa no mesmo projeto Supabase)." }, 409);
    }
    return jsonResponse({ error: "Falha ao enviar o convite: " + msg }, 502);
  }
  const newUserId = invited.user?.id;
  if (!newUserId) return jsonResponse({ error: "O convite foi enviado, mas a resposta da Supabase não trouxe o ID do usuário — verifique manualmente em Authentication > Users." }, 502);

  // ---------------------------------------------------------------------
  // 5) Sem cadastro de colaborador (convite "de sistema", ex.: um RH que
  //    não tem ficha de RH): só cria a linha em rh.perfis, com nome/e-mail
  //    guardados direto nela (não há rh.colaboradores pra buscar depois).
  // ---------------------------------------------------------------------
  if (!criarColaborador) {
    const { error: perfilSoErr } = await adminClient
      .from("perfis")
      .insert({ user_id: newUserId, colaborador_id: null, role, nome, email, ativo: true });
    if (perfilSoErr) {
      return jsonResponse({
        error: "O convite de login FOI enviado para " + email + ", mas falhou ao vincular o papel de acesso (rh.perfis): " + perfilSoErr.message +
          ". Ação manual necessária: insira manualmente em rh.perfis (user_id=" + newUserId + ", role='" + role + "', nome='" + nome + "', email='" + email + "').",
      }, 500);
    }
    return jsonResponse({
      ok: true,
      mensagem: `Convite enviado para ${email}. A pessoa recebe um e-mail real da Supabase para definir a própria senha.`,
      userId: newUserId,
      role,
    });
  }

  // ---------------------------------------------------------------------
  // 5b) Fluxo padrão (com cadastro de RH): cria o colaborador e o perfil.
  //    Se qualquer um destes dois passos falhar, o convite (passo 4) JÁ foi
  //    enviado e não pode ser desfeito por aqui — a resposta deixa isso
  //    explícito.
  // ---------------------------------------------------------------------
  const { data: novoColaborador, error: novoColaboradorErr } = await adminClient
    .from("colaboradores")
    .insert({ nome, email, cargo, departamento, admissao, status: "ATIVO" })
    .select()
    .single();
  if (novoColaboradorErr) {
    return jsonResponse({
      error: "O convite de login FOI enviado para " + email + ", mas falhou ao criar o cadastro de colaborador: " + novoColaboradorErr.message +
        ". Ação manual necessária: crie o cadastro em rh.colaboradores e vincule em rh.perfis, ou remova o usuário criado em Authentication > Users e tente de novo.",
    }, 500);
  }

  const { error: perfilErr } = await adminClient
    .from("perfis")
    .insert({ user_id: newUserId, colaborador_id: novoColaborador.id, role, nome, email, ativo: true });
  if (perfilErr) {
    return jsonResponse({
      error: "O convite foi enviado e o colaborador " + nome + " foi cadastrado, mas falhou ao vincular o papel de acesso (rh.perfis): " + perfilErr.message +
        ". Ação manual necessária: insira manualmente em rh.perfis (user_id=" + newUserId + ", colaborador_id=" + novoColaborador.id + ", role='" + role + "').",
    }, 500);
  }

  return jsonResponse({
    ok: true,
    mensagem: `Convite enviado para ${email}. A pessoa recebe um e-mail real da Supabase para definir a própria senha.`,
    colaborador: novoColaborador,
    userId: newUserId,
    role,
  });
});
