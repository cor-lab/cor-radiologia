/* ══════════════════════════════════════════════════════════════════════════
   CHAT COR — Service Worker (Web Push)   chat_sw.js
   ─────────────────────────────────────────────────────────────────────────
   Roda em segundo plano, MESMO com o APPCOR fechado, e mostra a notificação
   do sistema quando o Supabase manda um push de mensagem nova.

   IMPORTANTE: este arquivo precisa ficar na RAIZ do site (mesma pasta do
   index.html), senão o navegador não deixa ele controlar a página.
   ══════════════════════════════════════════════════════════════════════════ */

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: "Chat COR", body: (event.data && event.data.text()) || "" }; }

  var title = data.title || "Chat COR";
  var opts = {
    body: data.body || "",
    tag: data.tag || "chat-cor",
    renotify: true,
    data: {
      canal_id: data.canal_id || null,
      url: (self.registration && self.registration.scope) || "/"
    }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var alvo = (event.notification.data && event.notification.data.url) || "/";
  var canal = event.notification.data && event.notification.data.canal_id;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (wins) {
      for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        if ("focus" in w) {
          w.focus();
          try { w.postMessage({ chatOpen: true, canal_id: canal }); } catch (e) {}
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(alvo);
    })
  );
});

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });
