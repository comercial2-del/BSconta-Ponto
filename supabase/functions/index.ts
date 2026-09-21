// =============================================================================
// BSconta+ RH — Supabase Edge Function: regenerar acesso de um colaborador
// que JÁ TEM login (botão "Regenerar acesso" em RH > Colaboradores > perfil)
// =============================================================================
// Pedido do cliente (21/09/2026): o botão "Regenerar acesso" NÃO deve mais
// trocar o e-mail de login da pessoa — só a senha. O e-mail atual
// (auth.users.email) é mantido exatamente como está; só é gerada uma senha
// nova, no padrão "BSconta" + PrimeiroNome + código aleatório de 4 dígitos
// (ex.: BScontaMarlon7391). A senha antiga deixa de funcionar assim que esta
// chamada tiver sucesso — não existe "recuperar", só "regenerar de novo".
//
// Diferença para a "criar-login-colaborador": aquela cria um login do zero
// (e-mail + senha novos, para quem ainda não tem login). Esta função exige
// que o colaborador já tenha um login (rh.perfis.user_id existente) e só
// mexe na senha dele — usa auth.admin.updateUserById, nunca
// auth.admin.createUser, e nunca escreve em rh.colaboradores.email nem em
// rh.perfis.email.
//
// Por que precisa ser Edge Function (não front-end): trocar a senha de
// OUTRO usuário exige a service_role key, que nunca pode chegar ao
// navegador.
//
// -----------------------------------------------------------------------------
// COMO IMPLANTAR (mesmo processo da invite-colaborador/criar-login-colaborador
// — Supabase CLI, a partir da raiz do repositório):
//   supabase functions deploy regenerar-acesso-colaborador
// Verificação de JWT: MANTER LIGADA (exige um token real de RH/RH_ADMIN).
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

/** Primeiro nome do colaborador, sem acento e capitalizado — "Ângela Dos
 * Santos" -> "Angela", "MARLON GOMES DA SILVA" -> "Marlon". Mesma lógica da
 * criar-login-colaborador, para manter o padrão "BSconta" + PrimeiroNome. */
function primeiroNomeCapitalizado(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] || "";
  const semAcento = primeiro.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const soLetras = semAcento.replace(/[^a-zA-Z]/g, "");
  if (!soLetras) return "Colaborador";
  return soLetras.charAt(0).toUpperCase() + soLetras.slice(1).toLowerCase();
}

/** Código aleatório de 4 dígitos (0000–9999), sempre com 4 caracteres
 * (com zeros à esquerda se necessário) — a parte "CodigoAleatorio" do
 * padrão pedido: "BSconta" + Nome + CodigoAleatorio. */
function codigoAleatorio4Digitos(): string {
  const n = Math.floor(Math.random() * 10000);
  return String(n).padStart(4, "0");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido. Use POST." }, 405);

  // ---------------------------------------------------------------------
  // 1) Mesma checagem real de permissão das outras Edge Functions de RH:
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
    return jsonResponse({ error: "Você não tem permissão de RH para regenerar acesso." }, 403);
  }

  // ---------------------------------------------------------------------
  // 2) Corpo da requisição.
  // ---------------------------------------------------------------------
  let payload: { colaboradorId?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido (esperado JSON)." }, 400);
  }
  if (!payload.colaboradorId) return jsonResponse({ error: "colaboradorId é obrigatório." }, 400);

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "rh" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---------------------------------------------------------------------
  // 3) O colaborador precisa existir e já ter um login (rh.perfis.user_id).
  //    Esta função NUNCA cria um login novo — para isso existe a
  //    criar-login-colaborador.
  // ---------------------------------------------------------------------
  const { data: colaborador, error: colaboradorErr } = await adminClient
    .from("colaboradores")
    .select("id, nome, email")
    .eq("id", payload.colaboradorId)
    .maybeSingle();
  if (colaboradorErr) return jsonResponse({ error: "Erro ao buscar o colaborador: " + colaboradorErr.message }, 500);
  if (!colaborador) return jsonResponse({ error: "Colaborador não encontrado." }, 404);

  const { data: perfil, error: perfilErr } = await adminClient
    .from("perfis")
    .select("user_id")
    .eq("colaborador_id", payload.colaboradorId)
    .maybeSingle();
  if (perfilErr) return jsonResponse({ error: "Erro ao buscar o login do colaborador: " + perfilErr.message }, 500);
  if (!perfil?.user_id) {
    return jsonResponse({
      error: `${colaborador.nome} ainda não tem login neste sistema. Use "Gerar login automático" para criar um primeiro.`,
    }, 409);
  }

  // ---------------------------------------------------------------------
  // 4) Gera a senha nova no padrão "BSconta" + PrimeiroNome + código
  //    aleatório de 4 dígitos, e troca SÓ a senha (auth.admin.updateUserById)
  //    — o e-mail de login (auth.users.email) fica exatamente como está.
  // ---------------------------------------------------------------------
  const novaSenha = "BSconta" + primeiroNomeCapitalizado(colaborador.nome) + codigoAleatorio4Digitos();

  const { error: updErr } = await adminClient.auth.admin.updateUserById(perfil.user_id, {
    password: novaSenha,
  });
  if (updErr) {
    return jsonResponse({ error: "Falha ao regenerar a senha: " + updErr.message }, 502);
  }

  return jsonResponse({
    ok: true,
    email: colaborador.email, // não mudou — devolvido só para exibir na tela de confirmação
    senha: novaSenha,
    colaborador,
    userId: perfil.user_id,
    aviso: "Guarde esta senha AGORA — ela não fica salva em nenhum lugar (nem aqui) e não pode ser recuperada depois, só regenerada de novo. O e-mail de login não mudou.",
  });
});
