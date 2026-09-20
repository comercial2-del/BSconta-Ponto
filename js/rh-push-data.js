/*
 * BSconta+ RH — Notificações do navegador (Web Push) — camada de dados REAL
 * =============================================================================
 * Liga o navegador da pessoa (via Service Worker, js/sw.js) a uma inscrição
 * de Web Push de verdade, gravada em rh.push_subscriptions
 * (db/supabase/16_push_notifications.sql). É o que permite o lembrete de
 * bater ponto (e avisos avulsos do RH, como "vá assinar seu documento")
 * chegarem mesmo com a aba do sistema fechada — ver
 * supabase/functions/send-push/index.ts para o envio em si.
 *
 * Cada navegador/dispositivo tem a própria inscrição (uma linha própria);
 * ativar num celular não desativa num notebook, e vice-versa — é assim que
 * a Web Push API funciona de verdade (bem diferente de simplesmente marcar
 * uma caixinha "quero notificação" no perfil).
 *
 * Chave pública VAPID — pode ficar no front-end sem problema (é pública por
 * natureza, é o par da chave PRIVADA que fica só na Edge Function); usada
 * para o navegador provar, matematicamente, para os servidores de push do
 * Google/Mozilla/etc. que só QUEM TEM a chave privada correspondente
 * (nossa Edge Function) pode mandar notificação para esta inscrição.
 * Gerada uma única vez com Node (crypto.generateKeyPairSync) — ver
 * SETUP-SUPABASE.md, Passo 4.14, para como gerar um par novo se precisar.
 */
const RH_VAPID_PUBLIC_KEY = "BKRH5gB8Dpglul--NciXqE0_beojOHL-f8llDC-_lHISyeFU-ULHn8aj9VccFpS3_0PAfuaBwKWYq5fIcPPeU7A";

function rhPushSuportado() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Base64url -> Uint8Array, formato exigido pela PushManager.subscribe
 * (applicationServerKey) — a Web Push API não aceita a string direto. */
function rhUrlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Registra o Service Worker uma vez (idempotente — chamadas seguintes
 * devolvem o mesmo registration). O arquivo js/sw.js foi movido para a RAIZ
 * do site (sw.js) de propósito: o escopo máximo de um Service Worker é a
 * pasta onde o arquivo está servido, a não ser que o servidor mande o
 * cabeçalho HTTP "Service-Worker-Allowed" — algo que não podemos garantir
 * num hosting estático simples. Ficando na raiz, o escopo "/" (que cobre
 * tanto /rh/*.html quanto /colaborador/*.html) funciona sem precisar de
 * nenhuma configuração extra de servidor. */
function rhSwScope() { const m = window.location.pathname.match(/^(.*\/)(?:rh|colaborador)\/[^/]*$/); return m ? m[1] : window.location.pathname.replace(/[^/]*$/, ""); } async function rhPushGarantirServiceWorker() {
  if (!rhPushSuportado()) throw new Error("Este navegador não tem suporte a notificações push.");
  const scope = rhSwScope(); return navigator.serviceWorker.register(`${scope}sw.js`, { scope });
}

/** Estado atual, PARA ESTE NAVEGADOR: permissão concedida e existe uma
 * inscrição ativa de fato (não só a permissão do Notification API). */
async function rhPushStatusAtual() {
  if (!rhPushSuportado()) return { suportado: false, permissao: "unsupported", inscrito: false };
  const permissao = Notification.permission; // "default" | "granted" | "denied"
  if (permissao !== "granted") return { suportado: true, permissao, inscrito: false };
  try {
    const registration = await navigator.serviceWorker.getRegistration(rhSwScope());
    const sub = await registration?.pushManager?.getSubscription();
    return { suportado: true, permissao, inscrito: !!sub };
  } catch {
    return { suportado: true, permissao, inscrito: false };
  }
}

/** Ativa: pede permissão (se ainda não tiver sido negada/concedida),
 * inscreve no PushManager do navegador e grava a inscrição de verdade em
 * rh.push_subscriptions (upsert por "endpoint" — se a pessoa já tinha
 * inscrição neste MESMO navegador, atualiza em vez de duplicar). */
async function rhPushAtivar() {
  if (!rhPushSuportado()) throw new Error("Este navegador não tem suporte a notificações push (tente Chrome, Edge ou Firefox atualizados).");
  const registration = await rhPushGarantirServiceWorker();

  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") {
    throw new Error(permissao === "denied" ? "Permissão de notificações negada. Ative manualmente nas configurações do site no navegador para ligar de novo." : "Permissão de notificações não foi concedida.");
  }

  let sub = await registration.pushManager.getSubscription();
  if (!sub) {
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: rhUrlBase64ToUint8Array(RH_VAPID_PUBLIC_KEY),
    });
  }

  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) throw new Error("Sessão expirada — faça login novamente antes de ativar as notificações.");

  const raw = sub.toJSON();
  const { error } = await sb.from("push_subscriptions").upsert(
    {
      user_id: userData.user.id,
      endpoint: raw.endpoint,
      p256dh: raw.keys?.p256dh,
      auth_secret: raw.keys?.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" }
  );
  if (error) throw error;
  return true;
}

/** Desativa: cancela a inscrição no navegador E remove a linha do banco
 * (senão a Edge Function continuaria achando que deve mandar push para um
 * endpoint que a pessoa, do lado do navegador, já cancelou). */
async function rhPushDesativar() {
  if (!rhPushSuportado()) return true;
  const registration = await navigator.serviceWorker.getRegistration(rhSwScope());
  const sub = await registration?.pushManager?.getSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  const { error } = await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
  return true;
}
