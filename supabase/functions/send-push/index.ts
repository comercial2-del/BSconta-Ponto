// =============================================================================
// BSconta+ RH — Supabase Edge Function: envio real de notificações Web Push
// =============================================================================
// Por que isto precisa ser uma Edge Function: mandar uma notificação push de
// verdade exige a CHAVE PRIVADA VAPID (a "senha" que prova ao navegador que a
// notificação realmente vem do nosso servidor) — essa chave nunca pode ir
// para o front-end (senão qualquer pessoa poderia mandar push para qualquer
// inscrição). Ela fica só aqui, como variável de ambiente/secret da função.
//
// Duas formas de chamar esta função (dois "modos"), no MESMO endpoint:
//
//   1) MODO LOTE (lembrete de bater ponto, sem tab aberta) — chamado
//      periodicamente pelo pg_cron + pg_net (ver
//      db/supabase/17_pg_cron_push_reminders.sql), autenticado por um
//      segredo compartilhado (header "x-cron-secret"), porque uma chamada de
//      cron não tem usuário logado/JWT. Percorre todos os colaboradores
//      ATIVOS, calcula (por dentro da própria função, em horário de
//      Brasília) se algum está a ~10 minutos do horário de entrada ou saída
//      previsto (considerando a jornada configurável de cada um — dias da
//      semana e horário — e pulando quem já bateu o ponto ou está de folga
//      hoje), evita repetir o mesmo lembrete duas vezes no dia
//      (rh.lembretes_ponto_enviados) e manda o push de verdade.
//
//   2) MODO SOB DEMANDA (um RH manda uma notificação avulsa para UM
//      colaborador específico — ex.: o botão "Lembrar colaborador" em
//      Documentos, pedindo pra pessoa ir assinar um documento pendente) —
//      chamado com o token (JWT) do próprio RH logado, igual à Edge Function
//      invite-colaborador. Body: { colaboradorId, titulo, mensagem, url? }.
//
// Em ambos os modos, o envio em si usa a biblioteca "web-push" (o padrão de
// mercado para Web Push API), importada via npm: (suportado nativamente pelo
// Deno/Supabase Edge Runtime — não precisa de nenhum bundler).
//
// Se uma inscrição (rh.push_subscriptions) estiver morta (o navegador não
// existe mais / notificações foram revogadas do lado do usuário — a Web Push
// API devolve HTTP 404/410 nesse caso), a função apaga essa inscrição do
// banco automaticamente, para não ficar tentando pra sempre.
//
// -----------------------------------------------------------------------------
// LIMITAÇÃO HONESTA: se NENHUM colaborador tiver ativado "Notificações do
// navegador" (rh/configuracoes.html ou perfil do colaborador), esta função
// não tem para quem mandar nada — ela sempre responde dizendo quantos push
// foram de fato enviados, nunca finge sucesso. Também só funciona enquanto o
// navegador/dispositivo da pessoa estiver ligado e com o Chrome/Edge/Firefox
// em execução (mesmo que a ABA esteja fechada) — isso é uma limitação do
// próprio sistema operacional/navegador, não desta implementação.
//
// -----------------------------------------------------------------------------
// COMO IMPLANTAR (passo manual):
//   1) Gere um par de chaves VAPID (ou use o par já gerado — ver
//      SETUP-SUPABASE.md, Passo 4.14) e configure como secrets da função:
//        supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." \
//          VAPID_SUBJECT="mailto:seu-email@empresa.com" \
//          CRON_SHARED_SECRET="uma-string-aleatoria-longa" \\ SITE_BASE_PATH="/BSconta-Ponto" (defina isso se o site estiver publicado num subcaminho, como o GitHub Pages de um repositorio - deixe vazio/omitido se o site estiver na raiz do dominio)
//   2) supabase functions deploy send-push --no-verify-jwt
//      (--no-verify-jwt é necessário porque o modo lote é chamado pelo
//      pg_cron/pg_net, que não manda um JWT de usuário — a função faz a
//      própria verificação de autenticação/autorização internamente, para
//      os dois modos, exatamente como o Supabase recomenda para este caso.)
//   3) Pré-requisito: db/supabase/16_push_notifications.sql (tabelas) e, para
//      o modo lote funcionar automaticamente, 17_pg_cron_push_reminders.sql.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:comercial2@bsconta.com.br";
const CRON_SHARED_SECRET = Deno.env.get("CRON_SHARED_SECRET") || ""; const SITE_BASE_PATH = (Deno.env.get("SITE_BASE_PATH") || "").replace(/\/$/, "");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const DIAS_SEMANA_CODIGO = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

/** Hora/dia "agora", já no horário de Brasília — independente do fuso do
 * servidor onde a Edge Function estiver rodando de fato. */
function agoraBrasilia() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const map: Record<string, string> = {};
  fmt.formatToParts(new Date()).forEach((p) => (map[p.type] = p.value));
  const weekdayIdx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday as string] ?? 0;
  return {
    dataIso: `${map.year}-${map.month}-${map.day}`,
    minutosDoDia: Number(map.hour) * 60 + Number(map.minute),
    diaCodigo: DIAS_SEMANA_CODIGO[weekdayIdx],
  };
}

function minutosDe(hhmm: string | null) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

async function enviarParaInscricao(adminClient: ReturnType<typeof createClient>, sub: { id: string; endpoint: string; p256dh: string; auth_secret: string }, payload: Record<string, unknown>) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    const statusCode = (err as { statusCode?: number })?.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      // Inscrição morta (navegador desinstalado, permissão revogada, etc.) —
      // limpa do banco em vez de tentar pra sempre.
      await adminClient.from("push_subscriptions").delete().eq("id", sub.id);
      return { ok: false, expirada: true };
    }
    console.error("send-push: falha ao enviar para inscrição " + sub.id, err);
    return { ok: false, erro: String((err as Error)?.message || err) };
  }
}

async function modoLote(adminClient: ReturnType<typeof createClient>) {
  const agora = agoraBrasilia();

  const { data: colaboradores, error: colabErr } = await adminClient
    .from("colaboradores")
    .select("id, nome, horario_entrada, horario_saida, dias_trabalho")
    .eq("status", "ATIVO");
  if (colabErr) throw colabErr;

  let verificados = 0;
  let elegiveis = 0;
  let enviados = 0;
  let semInscricao = 0;
  let erros = 0;

  for (const colab of colaboradores || []) {
    verificados++;
    const diasTrabalho: string[] | null = colab.dias_trabalho && colab.dias_trabalho.length ? colab.dias_trabalho : null;
    if (diasTrabalho && !diasTrabalho.includes(agora.diaCodigo)) continue; // dia de folga — nada a lembrar

    const alvos: Array<{ tipo: "entrada" | "saida"; hhmm: string | null }> = [
      { tipo: "entrada", hhmm: colab.horario_entrada },
      { tipo: "saida", hhmm: colab.horario_saida },
    ];

    for (const alvo of alvos) {
      const alvoMin = minutosDe(alvo.hhmm);
      if (alvoMin == null) continue;
      const diffMin = alvoMin - agora.minutosDoDia;
      // Janela de 10 a 4 minutos antes do horário previsto — larga o
      // suficiente para não passar batido entre execuções do pg_cron
      // (recomendado a cada 5 minutos), estreita o suficiente para o aviso
      // ainda fazer sentido ("está próximo"), e reforçada pela tabela de
      // dedup abaixo (nunca manda duas vezes o mesmo lembrete no mesmo dia,
      // mesmo que a janela seja atingida em mais de uma execução).
      if (diffMin > 10 || diffMin <= 4) continue;

      // Já bateu esse ponto hoje? Não teria sentido lembrar.
      const { data: registroHoje } = await adminClient
        .from("ponto_registros")
        .select("entrada, saida")
        .eq("colaborador_id", colab.id)
        .eq("data", agora.dataIso)
        .maybeSingle();
      if (alvo.tipo === "entrada" && registroHoje?.entrada) continue;
      if (alvo.tipo === "saida" && registroHoje?.saida) continue;

      // Dedup: já mandamos este lembrete hoje?
      const { data: jaEnviado } = await adminClient
        .from("lembretes_ponto_enviados")
        .select("colaborador_id")
        .eq("colaborador_id", colab.id)
        .eq("data", agora.dataIso)
        .eq("tipo", alvo.tipo)
        .maybeSingle();
      if (jaEnviado) continue;

      elegiveis++;

      // Quem é o usuário de login deste colaborador? (para achar as
      // inscrições de push, que são por user_id, não por colaborador_id.)
      const { data: perfil } = await adminClient.from("perfis").select("user_id").eq("colaborador_id", colab.id).maybeSingle();
      if (!perfil?.user_id) {
        semInscricao++;
        continue;
      }
      const { data: inscricoes } = await adminClient.from("push_subscriptions").select("id, endpoint, p256dh, auth_secret").eq("user_id", perfil.user_id);
      if (!inscricoes || !inscricoes.length) {
        semInscricao++;
        continue;
      }

      const label = alvo.tipo === "entrada" ? "entrada" : "saída";
      const payload = {
        title: "BSconta+ RH — Lembrete de ponto",
        body: `Seu horário de ${label} está próximo (${alvo.hhmm}). Não esqueça de bater o ponto.`,
        tag: `ponto-${alvo.tipo}-${agora.dataIso}`,
        url: `${SITE_BASE_PATH}/colaborador/ponto.html`,
      };

      let algumEnviado = false;
      for (const sub of inscricoes) {
        const resultado = await enviarParaInscricao(adminClient, sub, payload);
        if (resultado.ok) algumEnviado = true;
        else if (!resultado.expirada) erros++;
      }

      if (algumEnviado) {
        enviados++;
        // Marca como enviado (dedup) só quando pelo menos um push real saiu
        // — se todas as inscrições estavam mortas/erraram, tenta de novo na
        // próxima execução em vez de desistir silenciosamente do dia.
        await adminClient.from("lembretes_ponto_enviados").insert({ colaborador_id: colab.id, data: agora.dataIso, tipo: alvo.tipo }).select();
      }
    }
  }

  return { ok: true, modo: "lote", horarioBrasilia: `${agora.dataIso} ${Math.floor(agora.minutosDoDia / 60)}:${String(agora.minutosDoDia % 60).padStart(2, "0")}`, verificados, elegiveis, enviados, semInscricao, erros };
}

async function modoSobDemanda(req: Request, adminClient: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Não autenticado — token ausente." }, 401);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "rh" },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: callerAuth, error: callerAuthErr } = await callerClient.auth.getUser();
  if (callerAuthErr || !callerAuth?.user) return jsonResponse({ error: "Sessão inválida ou expirada. Faça login novamente." }, 401);

  const { data: callerPerfil, error: callerPerfilErr } = await callerClient.from("perfis").select("role").eq("user_id", callerAuth.user.id).maybeSingle();
  if (callerPerfilErr) return jsonResponse({ error: "Erro ao verificar seu papel de acesso: " + callerPerfilErr.message }, 500);
  if (!callerPerfil || !["RH", "RH_ADMIN"].includes(callerPerfil.role)) {
    return jsonResponse({ error: "Você não tem permissão de RH para enviar notificações." }, 403);
  }

  let payload: { colaboradorId?: string; titulo?: string; mensagem?: string; url?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Corpo da requisição inválido (esperado JSON)." }, 400);
  }
  const colaboradorId = (payload.colaboradorId || "").trim();
  const titulo = (payload.titulo || "BSconta+ RH").trim();
  const mensagem = (payload.mensagem || "").trim();
  if (!colaboradorId) return jsonResponse({ error: "colaboradorId é obrigatório." }, 400);
  if (!mensagem) return jsonResponse({ error: "mensagem é obrigatória." }, 400);

  const { data: perfilColab, error: perfilColabErr } = await adminClient.from("perfis").select("user_id").eq("colaborador_id", colaboradorId).maybeSingle();
  if (perfilColabErr) return jsonResponse({ error: "Erro ao localizar o colaborador: " + perfilColabErr.message }, 500);
  if (!perfilColab?.user_id) {
    return jsonResponse({ ok: true, enviados: 0, mensagem: "Este colaborador ainda não tem um login vinculado (rh.perfis) — não é possível notificar." });
  }

  const { data: inscricoes, error: inscricoesErr } = await adminClient.from("push_subscriptions").select("id, endpoint, p256dh, auth_secret").eq("user_id", perfilColab.user_id);
  if (inscricoesErr) return jsonResponse({ error: "Erro ao buscar inscrições de notificação: " + inscricoesErr.message }, 500);
  if (!inscricoes || !inscricoes.length) {
    return jsonResponse({
      ok: true,
      enviados: 0,
      mensagem: "Este colaborador ainda não ativou as notificações do navegador (Meu Perfil > Segurança e notificações) — nenhum push pôde ser enviado. Considere avisá-lo por outro canal.",
    });
  }

  let enviados = 0;
  for (const sub of inscricoes) {
    const resultado = await enviarParaInscricao(adminClient, sub, { title: titulo, body: mensagem, tag: `avulso-${colaboradorId}-${Date.now()}`, url: payload.url || `${SITE_BASE_PATH}/colaborador/documentos.html` });
    if (resultado.ok) enviados++;
  }

  return jsonResponse({ ok: true, enviados, totalInscricoes: inscricoes.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido. Use POST." }, 405);

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return jsonResponse({ error: "Chaves VAPID não configuradas nos secrets da função (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY). Veja SETUP-SUPABASE.md — Passo 4.14." }, 500);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "rh" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cronSecretHeader = req.headers.get("x-cron-secret");
  const ehChamadaDeCron = !!CRON_SHARED_SECRET && cronSecretHeader === CRON_SHARED_SECRET;

  try {
    if (ehChamadaDeCron) {
      const resultado = await modoLote(adminClient);
      return jsonResponse(resultado);
    }
    return await modoSobDemanda(req, adminClient);
  } catch (err) {
    console.error("send-push: erro inesperado.", err);
    return jsonResponse({ error: "Erro inesperado: " + String((err as Error)?.message || err) }, 500);
  }
});
