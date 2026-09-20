// =============================================================================
// BSconta+ RH — Supabase Edge Function: login automático de uso interno
// =============================================================================
// Diferença real desta função para a "invite-colaborador":
//   - invite-colaborador: manda um e-mail REAL (via Supabase Auth) para a
//     pessoa definir a própria senha. Exige uma caixa de e-mail que exista e
//     receba mensagens de verdade. Ninguém (nem o RH) fica sabendo a senha.
//   - criar-login-colaborador (esta): não manda e-mail nenhum. Gera, no
//     servidor, um e-mail e uma senha no padrão "BSconta" + primeiro nome do
//     colaborador (ex.: BScontaAngella@gmail.com / senha BScontaAngella),
//     cria o login já confirmado (auth.admin.createUser com
//     email_confirm:true) e devolve as duas coisas na resposta, UMA ÚNICA
//     VEZ, para o RH que fez a chamada. Depois desta resposta, a senha em
//     texto puro não é guardada em lugar nenhum — se for perdida, é
//     necessário gerar uma nova (não existe "recuperar", só "trocar").
//
// ATENÇÃO — decisão explícita do cliente, com risco assumido: o e-mail usa
// o domínio REAL @gmail.com (não um domínio interno inexistente). Isso
// significa que, se algum dia alguém clicar em "Esqueci minha senha" para
// um desses logins, o Supabase vai tentar mandar um e-mail de recuperação
// de verdade para esse endereço @gmail.com — que a BSconta NÃO controla.
// Se esse endereço existir e pertencer a outra pessoa, ela poderia receber
// esse link. Também por decisão do cliente, a senha é a MESMA string do
// e-mail (sem o "@gmail.com") — ou seja, previsível para quem souber o
// e-mail. Isso é aceitável apenas porque o uso é estritamente interno.
//
// Por que precisa ser Edge Function (não front-end): criar um login em
// auth.users exige a service_role key, que nunca pode chegar ao navegador.
//
// -----------------------------------------------------------------------------
// COMO IMPLANTAR (mesmo processo da invite-colaborador — ver o cabeçalho
// daquele arquivo para os passos completos da Supabase CLI):
//   supabase functions deploy criar-login-colaborador
// Verificação de JWT: MANTER LIGADA (esta função exige um token real de
// RH/RH_ADMIN — o mesmo motivo da invite-colaborador).
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Domínio usado nos e-mails de login gerados por esta função. Por decisão
// explícita do cliente é o domínio REAL @gmail.com (ver aviso de risco no
// cabeçalho do arquivo) — não um domínio interno inventado. Trocar aqui muda
// o padrão para os PRÓXIMOS logins gerados (não afeta os que já existem).
const DOMINIO_LOGIN_INTERNO = "gmail.com";

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

/** Primeiro nome do colaborador, sem acento e capitalizado — "Ângela Dos
 * Santos" -> "Angela", "MARLON GOMES DA SILVA" -> "Marlon". Usado como base
 * do padrão "BSconta" + PrimeiroNome pedido pelo cliente. */
function primeiroNomeCapitalizado(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] || "";
  const semAcento = primeiro.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const soLetras = semAcento.replace(/[^a-zA-Z]/g, "");
  if (!soLetras) return "Colaborador";
  return soLetras.charAt(0).toUpperCase() + soLetras.slice(1).toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido. Use POST." }, 405);

  // ---------------------------------------------------------------------
  // 1) Mesma checagem real de permissão da invite-colaborador: token do
  //    próprio chamador, conferido contra rh.perfis no servidor.
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
    return jsonResponse({ error: "Você não tem permissão de RH para gerar logins." }, 403);
  }

  // ---------------------------------------------------------------------
  // 2) Corpo da requisição.
  // ---------------------------------------------------------------------
  let payload: {
    colaboradorId?: string;
    nome?: string;
    email?: string;
    cargo?: string;
    departamento?: string;
    admissao?: string;
    role?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido (esperado JSON)." }, 400);
  }

  let role = (payload.role || "COLABORADOR").trim().toUpperCase();
  if (!["COLABORADOR", "RH", "RH_ADMIN"].includes(role)) {
    return jsonResponse({ error: "Papel inválido. Use COLABORADOR, RH ou RH_ADMIN." }, 400);
  }
  if (role !== "COLABORADOR" && callerPerfil.role !== "RH_ADMIN") {
    return jsonResponse({ error: "Só um RH_ADMIN pode gerar login já como RH ou RH_ADMIN." }, 403);
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "rh" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---------------------------------------------------------------------
  // 3) Colaborador existente (ex.: Marlon/Nádia, cadastrados com e-mail
  //    provisório) OU novo cadastro (form "Cadastrar colaborador" com o
  //    modo "Login automático").
  // ---------------------------------------------------------------------
  let colaboradorExistente: { id: string; nome: string; email: string | null } | null = null;

  if (payload.colaboradorId) {
    const { data, error } = await adminClient
      .from("colaboradores")
      .select("id, nome, email")
      .eq("id", payload.colaboradorId)
      .maybeSingle();
    if (error) return jsonResponse({ error: "Erro ao buscar o colaborador: " + error.message }, 500);
    if (!data) return jsonResponse({ error: "Colaborador não encontrado." }, 404);
    colaboradorExistente = data;

    const { data: perfilExistente, error: perfilExistenteErr } = await adminClient
      .from("perfis")
      .select("user_id")
      .eq("colaborador_id", payload.colaboradorId)
      .maybeSingle();
    if (perfilExistenteErr) return jsonResponse({ error: "Erro ao checar login existente: " + perfilExistenteErr.message }, 500);
    if (perfilExistente) {
      return jsonResponse({
        error: `${data.nome} já tem um login neste sistema. Para trocar a senha, use "Esqueci minha senha" na tela de login, ou troque manualmente em Authentication > Users no painel do Supabase.`,
      }, 409);
    }
  }

  const nome = (payload.nome || colaboradorExistente?.nome || "").trim();
  if (!nome) return jsonResponse({ error: "Nome é obrigatório." }, 400);

  const cargo = (payload.cargo || "").trim();
  const departamento = (payload.departamento || "").trim();
  const admissao = payload.admissao || null;

  // ---------------------------------------------------------------------
  // 4) Monta o login no padrão "BSconta" + PrimeiroNome (ex.: BScontaAngella)
  //    e tenta criar — em caso de a base já existir (duas pessoas com o
  //    mesmo primeiro nome, por exemplo), tenta de novo acrescentando um
  //    número no final (BScontaAngella2, BScontaAngella3, ...), até 6
  //    tentativas. A senha é a MESMA string usada como parte local do
  //    e-mail (decisão explícita do cliente — ver aviso no cabeçalho).
  // ---------------------------------------------------------------------
  const baseLocal = "BSconta" + primeiroNomeCapitalizado(nome);

  let emailFinal = "";
  let senha = "";
  let newUserId: string | null = null;
  let ultimoErro = "";

  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const localPart = tentativa === 0 ? baseLocal : `${baseLocal}${tentativa + 1}`;
    const candidato = `${localPart}@${DOMINIO_LOGIN_INTERNO}`;
    const { data: criado, error: criarErr } = await adminClient.auth.admin.createUser({
      email: candidato,
      password: localPart,
      email_confirm: true, // já confirmado — não existe fluxo de confirmação por e-mail aqui
      user_metadata: { nome, login_interno: true },
    });
    if (!criarErr && criado?.user?.id) {
      emailFinal = candidato;
      senha = localPart;
      newUserId = criado.user.id;
      break;
    }
    ultimoErro = String(criarErr?.message || criarErr || "");
    if (!/already been registered|already exists/i.test(ultimoErro)) {
      return jsonResponse({ error: "Falha ao criar o login: " + ultimoErro }, 502);
    }
    // e-mail já usado — tenta o próximo número
  }

  if (!newUserId) {
    return jsonResponse({ error: "Não foi possível gerar um e-mail de login disponível após várias tentativas: " + ultimoErro }, 502);
  }

  // ---------------------------------------------------------------------
  // 5) Vincula ao colaborador (existente ou novo) e cria rh.perfis.
  // ---------------------------------------------------------------------
  let colaboradorFinal;

  if (colaboradorExistente) {
    const { data: atualizado, error: updErr } = await adminClient
      .from("colaboradores")
      .update({ email: emailFinal, updated_at: new Date().toISOString() })
      .eq("id", colaboradorExistente.id)
      .select()
      .single();
    if (updErr) {
      return jsonResponse({
        error: `O login FOI criado (${emailFinal}), mas falhou ao atualizar o e-mail do colaborador: ${updErr.message}. Ação manual: atualize rh.colaboradores.email para "${emailFinal}" onde id="${colaboradorExistente.id}".`,
      }, 500);
    }
    colaboradorFinal = atualizado;
  } else {
    const { data: novo, error: novoErr } = await adminClient
      .from("colaboradores")
      .insert({ nome, email: emailFinal, cargo, departamento, admissao, status: "ATIVO" })
      .select()
      .single();
    if (novoErr) {
      return jsonResponse({
        error: `O login FOI criado (${emailFinal}), mas falhou ao criar o cadastro de colaborador: ${novoErr.message}. Ação manual necessária: crie o cadastro em rh.colaboradores e vincule em rh.perfis (user_id="${newUserId}"), ou remova o usuário criado em Authentication > Users e tente de novo.`,
      }, 500);
    }
    colaboradorFinal = novo;
  }

  const { error: perfilErr } = await adminClient
    .from("perfis")
    .insert({ user_id: newUserId, colaborador_id: colaboradorFinal.id, role, nome, email: emailFinal, ativo: true });
  if (perfilErr) {
    return jsonResponse({
      error: `O login FOI criado (${emailFinal}) e o colaborador foi salvo, mas falhou ao vincular o papel de acesso (rh.perfis): ${perfilErr.message}. Ação manual necessária: insira em rh.perfis (user_id="${newUserId}", colaborador_id="${colaboradorFinal.id}", role="${role}").`,
    }, 500);
  }

  return jsonResponse({
    ok: true,
    email: emailFinal,
    senha,
    colaborador: colaboradorFinal,
    userId: newUserId,
    role,
    aviso: "Guarde esta senha AGORA — ela não fica salva em nenhum lugar (nem aqui) e não pode ser recuperada depois, só trocada por uma nova.",
  });
});
