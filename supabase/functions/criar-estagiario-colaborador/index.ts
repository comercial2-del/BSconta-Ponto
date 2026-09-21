// =============================================================================
// BSconta+ RH — Supabase Edge Function: cadastro de estagiário (e-mail manual
// + senha gerada automaticamente)
// =============================================================================
// Terceiro modo de "Como criar o acesso?" no cadastro de colaborador, ao lado
// de "invite-colaborador" (convite real por e-mail) e "criar-login-colaborador"
// (e-mail E senha gerados pelo sistema). Este aqui é um meio-termo pensado
// para estagiários: quem cadastra INFORMA o e-mail (não precisa ser uma
// caixa real que a pessoa vá checar — normalmente é um e-mail já existente
// do estagiário, ou um e-mail corporativo provisório), e o sistema GERA só a
// senha, sem mandar nenhum convite.
//
// Padrão da senha: EXATAMENTE o mesmo já usado pela função "Regenerar
// acesso" (supabase/functions/regenerar-acesso-colaborador) — "BSconta" +
// PrimeiroNome + 4 dígitos aleatórios (ex.: BScontaJoao4821). A geração do
// primeiro nome é a mesma função compartilhada usada por
// criar-login-colaborador (ver ../_shared/nome-colaborador.ts), para não
// duplicar essa lógica.
//
// Diferença importante para invite-colaborador e criar-login-colaborador:
// como o e-mail é digitado por quem cadastra (não gerado nem confirmado por
// convite), NÃO há tentativa automática de "e-mail alternativo" em caso de
// duplicidade — se o e-mail já estiver em uso, a função retorna erro e quem
// está cadastrando corrige o e-mail e tenta de novo.
//
// Este arquivo NÃO cria, recria nem regenera acesso de colaboradores já
// existentes: só aceita cadastro de colaborador novo (sem colaboradorId).
// Colaboradores já cadastrados continuam exatamente como estão — para eles,
// a única forma de mexer no acesso continua sendo "Regenerar acesso" (já
// existente, não alterado por este arquivo).
//
// Por que precisa ser Edge Function (não front-end): criar um login em
// auth.users exige a service_role key, que nunca pode chegar ao navegador.
//
// -----------------------------------------------------------------------------
// COMO IMPLANTAR (mesmo processo das demais funções — ver o cabeçalho de
// invite-colaborador para os passos completos da Supabase CLI):
//   supabase functions deploy criar-estagiario-colaborador
// Verificação de JWT: MANTER LIGADA (esta função exige um token real de
// RH/RH_ADMIN, igual às demais funções de cadastro/acesso).
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { primeiroNomeCapitalizado, sufixoAleatorio4Digitos } from "../_shared/nome-colaborador.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  // 1) Mesma checagem real de permissão das outras funções de cadastro:
  //    token do próprio chamador, conferido contra rh.perfis no servidor.
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
    return jsonResponse({ error: "Você não tem permissão de RH para cadastrar estagiários." }, 403);
  }

  // ---------------------------------------------------------------------
  // 2) Corpo da requisição.
  // ---------------------------------------------------------------------
  let payload: {
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
    return jsonResponse({ error: "Só um RH_ADMIN pode cadastrar já como RH ou RH_ADMIN." }, 403);
  }

  const nome = (payload.nome || "").trim();
  if (!nome) return jsonResponse({ error: "Nome é obrigatório." }, 400);

  const email = (payload.email || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Informe um e-mail válido para o estagiário." }, 400);
  }

  const cargo = (payload.cargo || "").trim();
  const departamento = (payload.departamento || "").trim();
  const admissao = payload.admissao || null;

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "rh" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---------------------------------------------------------------------
  // 3) Gera a senha no padrão "BSconta" + PrimeiroNome + 4 dígitos
  //    (mesmo padrão da função "Regenerar acesso") e cria o login já
  //    confirmado, para o e-mail informado manualmente. Como o e-mail é
  //    fixo (não gerado por esta função), não há tentativa de e-mail
  //    alternativo: se já existir, a função retorna erro para quem
  //    cadastrou corrigir e tentar de novo.
  // ---------------------------------------------------------------------
  const senha = "BSconta" + primeiroNomeCapitalizado(nome) + sufixoAleatorio4Digitos();

  const { data: criado, error: criarErr } = await adminClient.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // já confirmado — não existe fluxo de confirmação por e-mail aqui
    user_metadata: { nome, estagiario: true },
  });

  if (criarErr || !criado?.user?.id) {
    const msg = String(criarErr?.message || criarErr || "");
    if (/already been registered|already exists/i.test(msg)) {
      return jsonResponse({ error: `O e-mail "${email}" já está em uso por outro login. Use outro e-mail.` }, 409);
    }
    return jsonResponse({ error: "Falha ao criar o login do estagiário: " + msg }, 502);
  }
  const newUserId = criado.user.id;

  // ---------------------------------------------------------------------
  // 4) Cria o cadastro do colaborador e vincula o papel (rh.perfis) — mesmo
  //    padrão de criar-login-colaborador. Nunca mexe em colaborador já
  //    existente: este fluxo é só para estagiário novo.
  // ---------------------------------------------------------------------
  const { data: novo, error: novoErr } = await adminClient
    .from("colaboradores")
    .insert({ nome, email, cargo, departamento, admissao, status: "ATIVO", tipo: "ESTAGIARIO" })
    .select()
    .single();
  if (novoErr) {
    return jsonResponse({
      error: `O login FOI criado (${email}), mas falhou ao criar o cadastro de colaborador: ${novoErr.message}. Ação manual necessária: crie o cadastro em rh.colaboradores e vincule em rh.perfis (user_id="${newUserId}"), ou remova o usuário criado em Authentication > Users e tente de novo.`,
    }, 500);
  }

  const { error: perfilErr } = await adminClient
    .from("perfis")
    .insert({ user_id: newUserId, colaborador_id: novo.id, role, nome, email, ativo: true });
  if (perfilErr) {
    return jsonResponse({
      error: `O login FOI criado (${email}) e o colaborador foi salvo, mas falhou ao vincular o papel de acesso (rh.perfis): ${perfilErr.message}. Ação manual necessária: insira em rh.perfis (user_id="${newUserId}", colaborador_id="${novo.id}", role="${role}").`,
    }, 500);
  }

  return jsonResponse({
    ok: true,
    email,
    senha,
    colaborador: novo,
    userId: newUserId,
    role,
    aviso: "Guarde esta senha AGORA — ela não fica salva em nenhum lugar (nem aqui) e não pode ser recuperada depois, só trocada por uma nova (Regenerar acesso).",
  });
});
