/* ══════════════════════════════════════════════════════════════════════════
   CHAT COR — Cliente de Web Push   chat_push.js
   ─────────────────────────────────────────────────────────────────────────
   Registra o service worker, pede permissão de notificação e salva a
   inscrição no Supabase (tabela chat_push_subs). A partir daí, mensagens
   novas chegam como notificação do sistema mesmo com o APPCOR FECHADO.

   Depende de globais do index: supa, CU, toast, navTo.
   Carregar DEPOIS do chat_cor.js:
       <script src="chat_push.js?v=20260827"></script>

   iPhone/iPad: só funciona se o APPCOR estiver "Adicionado à Tela de Início"
   (instalado como atalho). No PC e no Android funciona direto no navegador.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // chave pública VAPID (é pública — pode ficar no cliente)
  var VAPID_PUBLIC = "BMdQoeNhhYXRKJRSxrEmWGUhrQD9eP1KDI1Ujq8oi5D03z3HxV_bizdvOKJl3Za0d_tlhd2fCnBF-x5deSEuW9g";

  var PERFIS = ["admin", "agenda", "cashback"];
  var _reg = null;          // registro do service worker
  var _timer = null;
  var _pediuGesto = false;  // já ligou o handler de gesto no botão?

  function _me() { return (typeof CU !== "undefined" && CU) ? CU : null; }
  function _suporta() {
    return ("serviceWorker" in navigator) &&
           ("PushManager" in window) &&
           ("Notification" in window);
  }
  function _b64ToU8(base64) {
    var pad = "=".repeat((4 - base64.length % 4) % 4);
    var b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function _registrarSW() {
    if (_reg) return _reg;
    _reg = await navigator.serviceWorker.register("chat_sw.js");
    return _reg;
  }

  // inscreve no push e salva no Supabase (só chama se permissão = granted)
  async function _inscrever() {
    var me = _me(); if (!me) return;
    try {
      var reg = await _registrarSW();
      await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: _b64ToU8(VAPID_PUBLIC)
        });
      }
      var j = sub.toJSON();
      if (!j || !j.keys) return;
      await supa.from("chat_push_subs").upsert({
        membro_id: me.id,
        endpoint: sub.endpoint,
        p256dh: j.keys.p256dh,
        auth: j.keys.auth,
        user_agent: navigator.userAgent
      }, { onConflict: "endpoint" });
    } catch (e) {
      console.warn("[chat_push] inscrição falhou:", e);
    }
  }

  // pede permissão (precisa de gesto do usuário em alguns navegadores)
  async function _ativarComGesto() {
    if (!_suporta()) {
      if (typeof toast === "function") toast("ℹ️", "Este navegador não suporta notificações em segundo plano.");
      return;
    }
    if (Notification.permission === "denied") {
      if (typeof toast === "function") toast("🔕", "Notificações bloqueadas — libere nas configurações do navegador.");
      return;
    }
    var p = Notification.permission;
    if (p !== "granted") {
      try { p = await Notification.requestPermission(); } catch (e) { p = Notification.permission; }
    }
    if (p === "granted") {
      await _inscrever();
      if (typeof toast === "function") toast("🔔", "Notificações do chat ativadas neste dispositivo.");
    }
  }

  // liga um handler no botão do chat: 1º clique pede permissão (é um gesto)
  function _armarGestoNoBotaoChat() {
    if (_pediuGesto) return;
    var btn = document.querySelector("#nav button[data-p='chat']");
    if (!btn) return;
    _pediuGesto = true;
    btn.addEventListener("click", function () {
      if (Notification.permission === "default") _ativarComGesto();
    });
  }

  // service worker manda a página abrir o chat NA CONVERSA da notificação
  function _ouvirCliqueNotif() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (!e.data || !e.data.chatOpen) return;
      try { window.focus(); } catch (x) {}
      if (window.ChatCOR && ChatCOR.abrirConversa) ChatCOR.abrirConversa(e.data.canal_id);
      else if (typeof navTo === "function") navTo("chat");
    });
  }

  function _vigiar() {
    if (_timer) return;
    _ouvirCliqueNotif();
    _timer = setInterval(function () {
      var me = _me();
      if (!me || PERFIS.indexOf(me.role) < 0) return;
      if (!_suporta()) return;
      _armarGestoNoBotaoChat();
      // se já autorizou antes, re-inscreve em silêncio (garante endpoint atual)
      if (Notification.permission === "granted") { _inscrever(); }
    }, 3000);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", _vigiar);
  else _vigiar();

  // API pública: botão "Ativar notificações" pode chamar ChatPush.ativar()
  window.ChatPush = { ativar: _ativarComGesto, inscrever: _inscrever };
})();
