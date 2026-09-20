/*
 * BSconta+ RH — Service Worker (Web Push)
 * =============================================================================
 * Único propósito: receber e mostrar notificações push mesmo com NENHUMA aba
 * do sistema aberta, e levar a pessoa para a tela certa quando ela clica na
 * notificação. Não faz cache de páginas/arquivos (não é um app offline) —
 * isso é intencional, para não haver risco de a pessoa ver dados antigos
 * (holerite, ponto, etc.) por causa de um cache desatualizado.
 *
 * Registrado por js/rh-push-data.js (rhPushGarantirServiceWorker), com
 * escopo "/" (a raiz do site), para poder controlar tanto /rh/*.html quanto
 * /colaborador/*.html.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let dados = { title: "BSconta+ RH", body: "Você tem uma nova notificação." };
  try {
    if (event.data) dados = { ...dados, ...event.data.json() };
  } catch {
    if (event.data) dados.body = event.data.text();
  }

  const options = {
    body: dados.body,
    tag: dados.tag || undefined,
    data: { url: dados.url ? new URL(dados.url, self.location.origin).href : self.registration.scope },
    icon: new URL("assets/bsconta-icon.png", self.registration.scope).href,
    badge: new URL("assets/bsconta-icon.png", self.registration.scope).href,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(dados.title || "BSconta+ RH", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.endsWith(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
