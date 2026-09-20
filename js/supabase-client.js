/*
 * BSconta+ RH — cliente real do Supabase
 * =============================================================================
 * Substitui toda a camada de "dados de demonstração" (DEMO, localStorage como
 * banco) por uma conexão real ao Supabase. A partir daqui, `sb` é o cliente
 * usado por todas as telas para autenticação e para ler/escrever nas tabelas
 * do schema `rh` (ver db/supabase/01_schema_rh.sql).
 *
 * A chave abaixo é a "publishable key" (equivalente à antiga "anon key") —
 * ela é SEGURA para ficar no front-end: por si só ela não dá acesso a nada,
 * o que protege os dados é o RLS (Row Level Security) configurado em cada
 * tabela no 01_schema_rh.sql. A chave "secret"/service_role NUNCA deve ir
 * para nenhum arquivo servido ao navegador — por isso o fluxo de "convidar
 * colaborador" (que precisa dela) roda numa Supabase Edge Function, não aqui
 * (ver supabase/functions/invite-colaborador/index.ts).
 *
 * Pré-requisito manual (uma vez só, no painel do Supabase): o schema "rh"
 * precisa estar em Project Settings > Data API > "Exposed schemas" para o
 * supabase-js conseguir consultar as tabelas dele.
 */
(function () {
  const SUPABASE_URL = "https://zqhuhaqothpxusnaijog.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_dD5KBuM8SkpHZVfUFcc0Dw_xv2pAMLu";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("supabase-js não foi carregado. Confira o <script> do CDN antes de supabase-client.js.");
    return;
  }

  // Guarda a referência da BIBLIOTECA antes de sobrescrever `window.supabase`
  // com a INSTÂNCIA do cliente (mesma convenção usada na documentação do
  // Supabase, mas aqui deixamos explícito para não confundir os dois).
  const supabaseLib = window.supabase;

  const sb = supabaseLib.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: "rh" },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  window.sb = sb;
})();
