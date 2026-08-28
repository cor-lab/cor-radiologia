/* ══════════════════════════════════════════════════════════════════════════
   CHAT INTERNO COR  —  chat_cor.js
   ─────────────────────────────────────────────────────────────────────────
   Módulo 100% externo ao index.html (padrão dos outros: reportes.js etc).
   Conversas GRAVADAS no Supabase + pop-up de alerta em tempo real
   (som + toast + badge), no mesmo estilo do reportes_dentista.

   Dois modos de conversa:
     • CANAIS (chat central da equipe) — ex.: "Geral", visível a todos.
     • MENSAGENS DIRETAS (DM 1-a-1) — privadas entre 2 usuários (RLS garante
       que ninguém de fora lê).

   INTEGRAÇÃO NO index.html  ->  UMA linha só, junto dos outros módulos:
       <script src="chat_cor.js?v=20260827"></script>

   Backend: projeto Supabase flpvzvtbhuyjjdqyrsza
   Tabelas: chat_canais / chat_mensagens / chat_leituras / chat_membros
   RPC:     chat_abrir_dm(p_outro uuid)
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var PERFIS_CHAT = ["admin", "agenda", "cashback"];
  var _CHAT_VER = "5.6 (20260827n)";   // versão deste módulo (aparece no menu 🔔)
  try { console.info("[chat_cor] versão " + _CHAT_VER); } catch (e) {}

  var _iniciado = false, _sessaoTimer = null;
  var _canais = [];          // todos os canais visíveis (canal + dm)
  var _canalAtual = null;
  var _leituras = {};        // canalId -> ISO
  var _naoLidas = {};        // canalId -> contador
  var _rtChannel = null;
  var _bootstrap = false;
  var _usersById = {};       // id -> {nome,ini,bg,cor,role}  (p/ resolver nomes)
  var _dmOutro = {};         // canalId(dm) -> {id,nome,ini,bg,cor}
  var _dmCanalDe = {};       // userId -> canalId(dm) já existente
  var _urlCache = {};        // key(anexo) -> {url, exp}  (evita re-assinar a cada render)
  var MAX_ANEXO = 10 * 1024 * 1024;  // 10 MB
  var _busca = { termo: "", hits: [], idx: -1 };  // busca dentro da conversa
  var _pend = {};            // mensagem_id -> {canal_id, resumo, autor_nome, criada_em}  (minhas pendências)
  var _painelPendAberto = false;

  function _me() { return (typeof CU !== "undefined" && CU) ? CU : null; }
  function _esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function _horaFmt(iso) { try { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function _diaFmt(iso) {
    try {
      var d = new Date(iso), h = new Date();
      if (d.toDateString() === h.toDateString()) return "Hoje";
      var o = new Date(h); o.setDate(h.getDate() - 1);
      if (d.toDateString() === o.toDateString()) return "Ontem";
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch (e) { return ""; }
  }

  // ── Som e aviso visual: níveis configuráveis, salvos por dispositivo ──
  // _somNivel: "alto" | "baixo" | "off"    _popNivel: "forte" | "discreto" | "off"
  var _somNivel = "alto", _popNivel = "forte", _popFixar = true;
  try { _somNivel = localStorage.getItem("cc_somNivel") || "alto"; } catch (e) {}
  try { _popNivel = localStorage.getItem("cc_popNivel") || "forte"; } catch (e) {}
  try { _popFixar = localStorage.getItem("cc_popFixar") !== "0"; } catch (e) {}  // padrão LIGADO
  var _ac = null;
  function _acCtx() {
    if (!_ac) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) { try { _ac = new AC(); } catch (e) {} } }
    return _ac;
  }
  function _unlockAudio() { var ac = _acCtx(); if (ac && ac.state === "suspended") { try { ac.resume(); } catch (e) {} } }
  function _minimizado() { try { return document.hidden || !document.hasFocus(); } catch (e) { return false; } }

  function _toque(ac, start, vol, alto) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = alto ? "square" : "sine";           // square = mais estridente/audível
    o.frequency.setValueAtTime(alto ? 988 : 860, start);
    o.frequency.exponentialRampToValueAtTime(alto ? 620 : 600, start + 0.22);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
    o.start(start); o.stop(start + 0.36);
  }
  // intenso = janela minimizada/sem foco -> alarme mais alto e mais longo (repete)
  function _alarme(intenso) {
    if (_somNivel === "off") return;
    try {
      var ac = _acCtx(); if (!ac) return;
      if (ac.state === "suspended") { try { ac.resume(); } catch (e) {} }
      var vol = _somNivel === "baixo" ? 0.12 : 0.4;
      var reps = intenso ? 5 : 1;                 // minimizado: 5 toques (~2s)
      var t0 = ac.currentTime + 0.01;
      for (var i = 0; i < reps; i++) _toque(ac, t0 + i * 0.42, vol, intenso);
    } catch (e) {}
  }
  function _beep() { _alarme(false); }            // compat (teste rápido)

  // ══ CSS ══
  function _injetarEstilo() {
    if (document.getElementById("cc-style")) return;
    var css = ""
      + "#page-chat{padding:0}"
      + ".cc-wrap{display:flex;height:calc(100vh - 150px);min-height:420px;border:1px solid var(--bd,#e5e7eb);border-radius:14px;overflow:hidden;background:var(--card,#fff)}"
      + ".cc-side{width:244px;flex-shrink:0;border-right:1px solid var(--bd,#e5e7eb);display:flex;flex-direction:column;background:var(--bg2,#f8fafc)}"
      + ".cc-grp{padding:12px 12px 4px;display:flex;align-items:center;justify-content:space-between}"
      + ".cc-grp b{font-size:.74rem;letter-spacing:.04em;text-transform:uppercase;color:var(--gr,#94a3b8)}"
      + ".cc-newbtn{border:none;background:var(--g,#4ab848);color:#fff;width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:.95rem;line-height:1}"
      + ".cc-list{overflow-y:auto;padding:2px 8px}"
      + ".cc-canais{flex:1;overflow-y:auto;padding:2px 8px 10px}"
      + ".cc-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;cursor:pointer;font-size:.86rem;color:var(--tx,#334155)}"
      + ".cc-item:hover{background:var(--bg,#eef2f7)}"
      + ".cc-item.on{background:var(--g,#4ab848);color:#fff;font-weight:600}"
      + ".cc-item .cc-hash{opacity:.6}"
      + ".cc-mini{width:24px;height:24px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.66rem;font-weight:700}"
      + ".cc-item .cc-cnt{margin-left:auto;background:#ef4444;color:#fff;font-size:.68rem;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 5px;font-weight:700}"
      + ".cc-item.on .cc-cnt{background:#fff;color:#ef4444}"
      + ".cc-main{position:relative;flex:1;display:flex;flex-direction:column;min-width:0}"
      + ".cc-head{padding:12px 16px;border-bottom:1px solid var(--bd,#e5e7eb);font-weight:600;font-size:.95rem;display:flex;align-items:center;gap:8px}"
      + ".cc-head small{font-weight:400;color:var(--gr,#94a3b8);font-size:.78rem}"
      + ".cc-msgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:2px;background:var(--bg,#f1f5f9)}"
      + ".cc-daysep{align-self:center;font-size:.72rem;color:var(--gr,#94a3b8);background:var(--card,#fff);border:1px solid var(--bd,#e5e7eb);padding:2px 10px;border-radius:20px;margin:10px 0 6px}"
      + ".cc-row{display:flex;gap:9px;margin-top:9px;max-width:78%}"
      + ".cc-row.me{align-self:flex-end;flex-direction:row-reverse}"
      + ".cc-av{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700}"
      + ".cc-bub{position:relative;background:var(--card,#fff);border:1px solid var(--bd,#e5e7eb);border-radius:12px;padding:7px 11px;min-width:0;color:#1f2937}"
      + ".cc-x{position:absolute;top:-8px;right:-8px;border:none;background:#ef4444;color:#fff;width:20px;height:20px;border-radius:50%;font-size:.62rem;line-height:20px;text-align:center;cursor:pointer;display:none;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.25)}"
      + ".cc-row:hover .cc-x{display:block}"
      + ".cc-hbtn{border:none;background:transparent;cursor:pointer;font-size:1rem;padding:4px 6px;border-radius:8px;color:var(--tx,#334155)}"
      + ".cc-hbtn:hover{background:var(--bg,#eef2f7)}"
      + ".cc-search{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--bd,#e5e7eb);background:var(--bg2,#f8fafc)}"
      + ".cc-search input{flex:1;border:1px solid var(--bd,#e5e7eb);border-radius:9px;padding:7px 11px;font:inherit;font-size:.88rem;outline:none}"
      + ".cc-search input:focus{border-color:var(--g,#4ab848)}"
      + ".cc-search .cc-scnt{font-size:.78rem;color:var(--gr,#94a3b8);min-width:44px;text-align:center}"
      + ".cc-search button{border:1px solid var(--bd,#e5e7eb);background:#fff;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:.8rem;color:var(--tx,#334155)}"
      + ".cc-search button:hover{background:var(--bg,#eef2f7)}"
      + ".cc-hit .cc-bub{outline:2px solid #fde047}"
      + ".cc-hit-atual .cc-bub{outline:2px solid #f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.25)}"
      + ".cc-ctrls{position:absolute;top:-11px;right:-6px;display:none;gap:4px}"
      + ".cc-row:hover .cc-ctrls{display:flex}"
      + ".cc-ctrls button{border:none;width:22px;height:22px;border-radius:50%;cursor:pointer;font-size:.62rem;line-height:22px;text-align:center;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.25);background:#fff}"
      + ".cc-ctrls .cc-pin{filter:grayscale(1);opacity:.75}"
      + ".cc-ctrls .cc-pin.on{filter:none;opacity:1;background:#fef3c7}"
      + ".cc-ctrls .cc-del2{background:#ef4444;color:#fff}"
      + ".cc-pend .cc-bub{box-shadow:-3px 0 0 #f59e0b}"
      + ".cc-pend .cc-ctrls{display:flex}"
      + ".cc-pend .cc-ctrls .cc-pin{display:inline-block}"
      + ".cc-ppanel{padding:12px 14px;overflow-y:auto}"
      + ".cc-ppi{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--bd,#e5e7eb);border-left:3px solid #f59e0b;border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--card,#fff)}"
      + ".cc-ppi .cc-ppc{flex:1;min-width:0}"
      + ".cc-ppi .cc-ppr{font-size:.88rem;color:var(--tx,#334155);word-break:break-word}"
      + ".cc-ppi .cc-ppm{font-size:.72rem;color:var(--gr,#94a3b8);margin-top:3px}"
      + ".cc-ppi .cc-ppb{display:flex;gap:6px;flex-shrink:0}"
      + ".cc-ppi .cc-ppb button{border:1px solid var(--bd,#e5e7eb);background:var(--bg2,#f8fafc);border-radius:8px;padding:6px 9px;font-size:.76rem;cursor:pointer;white-space:nowrap}"
      + ".cc-ppi .cc-ppb .cc-ok{background:var(--g,#4ab848);color:#fff;border-color:var(--g,#4ab848)}"
      + ".cc-nhost{position:fixed;top:14px;right:14px;display:flex;flex-direction:column;gap:9px;z-index:99999;max-width:330px}"
      + ".cc-note{display:flex;gap:11px;align-items:center;border-radius:13px;padding:11px 13px;cursor:pointer;transform:translateX(120%);opacity:0;transition:.3s cubic-bezier(.2,.9,.3,1);box-shadow:0 10px 30px rgba(0,0,0,.22);border-left:5px solid var(--g,#4ab848);background:linear-gradient(120deg,#ffffff 55%,#ecfdf3)}"
      + ".cc-note.show{transform:translateX(0);opacity:1}"
      + ".cc-note-av{width:40px;height:40px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.82rem;box-shadow:0 2px 6px rgba(0,0,0,.18)}"
      + ".cc-note-body{min-width:0}"
      + ".cc-note-nm{font-size:.82rem;font-weight:800;color:#166534;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
      + ".cc-note-tx{font-size:.86rem;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}"
      + ".cc-note-ic{margin-left:auto;font-size:1.1rem;align-self:flex-start;opacity:.9}"
      + ".cc-note-x{position:absolute;top:-8px;right:-8px;border:none;background:#64748b;color:#fff;width:22px;height:22px;border-radius:50%;font-size:.66rem;cursor:pointer;padding:0;box-shadow:0 1px 4px rgba(0,0,0,.3)}"
      + ".cc-note{position:relative}"
      + "@keyframes ccpulse{0%{box-shadow:0 10px 30px rgba(0,0,0,.28),0 0 0 0 rgba(224,0,0,.55)}70%{box-shadow:0 10px 30px rgba(0,0,0,.28),0 0 0 16px rgba(224,0,0,0)}100%{box-shadow:0 10px 30px rgba(0,0,0,.28),0 0 0 0 rgba(224,0,0,0)}}"
      + "@keyframes ccshake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}"
      + ".cc-note.forte{border-left-width:8px;padding:14px 16px;background:linear-gradient(120deg,#fff 50%,#fee2e2);animation:ccpulse 1.1s ease-out 4}"
      + ".cc-note.forte .cc-note-av{width:46px;height:46px;font-size:.9rem}"
      + ".cc-note.forte .cc-note-nm{font-size:.98rem}"
      + ".cc-note.forte .cc-note-tx{font-size:1rem}"
      + ".cc-note.forte.intenso{border-left-color:#e00000;animation:ccpulse 1s ease-out infinite,ccshake .5s ease-in-out 3}"
      + ".cc-cfg{position:absolute;top:46px;right:8px;z-index:100000;background:var(--card,#fff);border:1px solid var(--bd,#e5e7eb);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.2);padding:12px;width:238px}"
      + ".cc-cfg h5{margin:2px 0 6px;font-size:.74rem;letter-spacing:.03em;text-transform:uppercase;color:var(--gr,#94a3b8)}"
      + ".cc-cfg .cc-seg{display:flex;gap:6px;margin-bottom:12px}"
      + ".cc-cfg .cc-seg button{flex:1;border:1px solid var(--bd,#e5e7eb);background:var(--bg2,#f8fafc);border-radius:8px;padding:7px 4px;font-size:.76rem;cursor:pointer;color:var(--tx,#334155)}"
      + ".cc-cfg .cc-seg button.on{background:var(--g,#4ab848);border-color:var(--g,#4ab848);color:#fff;font-weight:700}"
      + ".cc-cfg .cc-testar{width:100%;border:1px dashed var(--bd,#e5e7eb);background:transparent;border-radius:8px;padding:8px;font-size:.8rem;cursor:pointer;color:var(--tx,#334155)}"
      + ".cc-row.me .cc-bub{background:var(--g,#4ab848);border-color:var(--g,#4ab848);color:#fff}"
      + ".cc-bub .cc-nome{font-size:.74rem;font-weight:700;margin-bottom:2px;opacity:.85}"
      + ".cc-row.me .cc-av{display:none}"
      + ".cc-bub .cc-txt{font-size:.9rem;line-height:1.4;white-space:pre-wrap;word-break:break-word}"
      + ".cc-bub .cc-hr{font-size:.66rem;opacity:.6;margin-top:3px;text-align:right}"
      + ".cc-del{font-style:italic;opacity:.6;font-size:.82rem}"
      + ".cc-foot{border-top:1px solid var(--bd,#e5e7eb);padding:10px 12px;display:flex;gap:8px;align-items:flex-end;background:var(--card,#fff)}"
      + ".cc-foot textarea{flex:1;resize:none;border:1px solid var(--bd,#e5e7eb);border-radius:10px;padding:9px 12px;font:inherit;font-size:.9rem;max-height:120px;outline:none}"
      + ".cc-foot textarea:focus{border-color:var(--g,#4ab848)}"
      + ".cc-send{border:none;background:var(--g,#4ab848);color:#fff;border-radius:10px;padding:0 16px;height:40px;cursor:pointer;font-weight:600;font-size:.9rem;flex-shrink:0}"
      + ".cc-send:disabled{opacity:.5;cursor:default}"
      + ".cc-clip{border:1px solid var(--bd,#e5e7eb);background:var(--bg2,#f8fafc);color:var(--tx,#334155);border-radius:10px;width:40px;height:40px;cursor:pointer;font-size:1.1rem;flex-shrink:0}"
      + ".cc-clip:hover{background:var(--bg,#eef2f7)}"
      + ".cc-img{max-width:230px;max-height:230px;border-radius:9px;margin-top:4px;cursor:pointer;display:block}"
      + ".cc-file{display:flex;align-items:center;gap:9px;margin-top:4px;padding:8px 10px;border:1px solid var(--bd,#e5e7eb);border-radius:9px;background:rgba(0,0,0,.03);text-decoration:none;color:inherit;max-width:250px}"
      + ".cc-row.me .cc-file{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.35)}"
      + ".cc-file .cc-fi{font-size:1.4rem;flex-shrink:0}"
      + ".cc-file .cc-fn{font-size:.83rem;font-weight:600;word-break:break-word;line-height:1.2}"
      + ".cc-file .cc-fs{font-size:.7rem;opacity:.7}"
      + ".cc-empty{margin:auto;color:var(--gr,#94a3b8);font-size:.9rem;text-align:center;padding:20px}"
      + ".cc-pick{padding:10px 14px;overflow-y:auto}"
      + ".cc-pick h4{font-size:.9rem;margin:6px 2px 10px;color:var(--tx,#334155)}"
      + ".cc-pick .cc-item{border:1px solid var(--bd,#e5e7eb);margin-bottom:6px}"
      + "@media(max-width:640px){.cc-side{width:140px}.cc-wrap{height:calc(100vh - 130px)}.cc-row{max-width:90%}}";
    var st = document.createElement("style"); st.id = "cc-style"; st.textContent = css;
    document.head.appendChild(st);
  }

  // ══ Navbar + página ══
  function _liberarPerms() {
    try { if (typeof PERMS !== "undefined") PERFIS_CHAT.forEach(function (r) { if (PERMS[r]) PERMS[r].chat = 1; }); } catch (e) {}
  }
  function _injetarNav() {
    var nav = document.getElementById("nav");
    if (nav && !nav.querySelector("button[data-p='chat']")) {
      var b = document.createElement("button");
      b.setAttribute("data-p", "chat");
      b.style.display = "none";
      b.innerHTML = "💬 Chat<span id='chatNavBadge' class='rp-nav-badge' style='display:none'>0</span>";
      nav.appendChild(b);
      b.addEventListener("click", function () {
        setTimeout(function () { if (_canalAtual) _marcarLido(_canalAtual); }, 60);
      });
    }
    if (!document.getElementById("page-chat")) {
      var ref = document.getElementById("page-dashboard") || document.querySelector(".page");
      var pg = document.createElement("div");
      pg.id = "page-chat"; pg.className = "page";
      pg.innerHTML = "<div class='cc-empty'>Carregando chat…</div>";
      if (ref && ref.parentNode) ref.parentNode.appendChild(pg); else document.body.appendChild(pg);
    }
  }

  // ══ Sessão ══
  function _vigiarSessao() {
    if (_sessaoTimer) return;
    _sessaoTimer = setInterval(function () {
      var me = _me();
      if (me && me.id && PERFIS_CHAT.indexOf(me.role) >= 0) { if (!_iniciado) _iniciar(); }
      else { if (_iniciado) _desligar(); }
    }, 1500);
  }
  async function _iniciar() {
    _iniciado = true; _bootstrap = false;
    _injetarEstilo();
    try {
      await _carregarUsuarios();
      await _carregarLeituras();
      await _carregarPendencias();
      await _carregarCanais();
      await _recalcularBadge();
      _assinarRealtime();
      _bootstrap = true;
    } catch (e) { console.warn("[chat_cor] init:", e); }
  }
  function _desligar() {
    _iniciado = false;
    try { if (_rtChannel) supa.removeChannel(_rtChannel); } catch (e) {}
    _rtChannel = null;
    _canais = []; _canalAtual = null; _leituras = {}; _naoLidas = {}; _dmOutro = {}; _usersById = {};
    _setBadge(0);
    var pg = document.getElementById("page-chat");
    if (pg) pg.innerHTML = "<div class='cc-empty'>Carregando chat…</div>";
  }

  // ══ Dados ══
  async function _carregarUsuarios() {
    var me = _me(); if (!me) return;
    var r = await supa.from("usuarios").select("id,nome,ini,bg,cor,role,ativo").eq("ativo", true);
    _usersById = {};
    if (!r.error && r.data) r.data.forEach(function (u) {
      _usersById[u.id] = { id: u.id, nome: u.nome, ini: u.ini || "?", bg: u.bg || "#4ab848", cor: u.cor || "#fff", role: u.role };
    });
  }
  // usuários com quem dá pra iniciar DM (equipe interna, menos eu)
  function _usuariosParaDM() {
    var me = _me(); var out = [];
    for (var id in _usersById) if (_usersById.hasOwnProperty(id)) {
      var u = _usersById[id];
      if (u.id !== (me && me.id) && PERFIS_CHAT.indexOf(u.role) >= 0) out.push(u);
    }
    out.sort(function (a, b) { return (a.nome || "").localeCompare(b.nome || ""); });
    return out;
  }

  async function _carregarLeituras() {
    var me = _me(); if (!me) return;
    var r = await supa.from("chat_leituras").select("canal_id,ultima_lida_em").eq("membro_id", me.id);
    _leituras = {};
    if (!r.error && r.data) r.data.forEach(function (l) { _leituras[l.canal_id] = l.ultima_lida_em; });
  }

  async function _carregarCanais() {
    var r = await supa.from("chat_canais")
      .select("id,nome,descricao,tipo,arquivado").eq("arquivado", false)
      .order("criado_em", { ascending: true });
    _canais = (!r.error && r.data) ? r.data : [];

    // resolve o "outro" de cada DM
    var me = _me();
    var dmIds = _canais.filter(function (c) { return c.tipo === "dm"; }).map(function (c) { return c.id; });
    _dmOutro = {}; _dmCanalDe = {};
    if (dmIds.length) {
      var rm = await supa.from("chat_membros").select("canal_id,membro_id").in("canal_id", dmIds);
      if (!rm.error && rm.data) rm.data.forEach(function (m) {
        if (me && m.membro_id !== me.id) {
          var u = _usersById[m.membro_id] || { nome: "Usuário", ini: "?", bg: "#64748b", cor: "#fff" };
          _dmOutro[m.canal_id] = u;
          _dmCanalDe[m.membro_id] = m.canal_id;
        }
      });
    }

    if (!_canalAtual && _canais.length) {
      var salvo = null; try { salvo = localStorage.getItem("cc_ultimo_canal"); } catch (e) {}
      if (salvo && _canais.some(function (c) { return c.id === salvo; })) {
        _canalAtual = salvo;   // restaura a última conversa aberta
      } else {
        var g = _canais.filter(function (c) { return c.tipo !== "dm"; })[0] || _canais[0];
        _canalAtual = g.id;
      }
    }
    _renderTudo();
    if (_canalAtual) await _abrirCanal(_canalAtual);
  }

  // Atualização LEVE da lista de canais (não reconstrói a tela nem reabre a
  // conversa) — usada quando chega mensagem de uma conversa nova, pra NÃO
  // limpar os pop-ups fixados nem apagar as mensagens já na tela.
  async function _atualizarListaCanais() {
    var r = await supa.from("chat_canais")
      .select("id,nome,descricao,tipo,arquivado").eq("arquivado", false)
      .order("criado_em", { ascending: true });
    if (r.error || !r.data) return;
    _canais = r.data;
    var me = _me();
    var dmIds = _canais.filter(function (c) { return c.tipo === "dm"; }).map(function (c) { return c.id; });
    _dmOutro = {}; _dmCanalDe = {};
    if (dmIds.length) {
      var rm = await supa.from("chat_membros").select("canal_id,membro_id").in("canal_id", dmIds);
      if (!rm.error && rm.data) rm.data.forEach(function (m) {
        if (me && m.membro_id !== me.id) {
          var u = _usersById[m.membro_id] || { nome: "Usuário", ini: "?", bg: "#64748b", cor: "#fff" };
          _dmOutro[m.canal_id] = u;
          _dmCanalDe[m.membro_id] = m.canal_id;
        }
      });
    }
    _renderLista();
  }

  async function _abrirCanal(canalId) {
    _canalAtual = canalId;
    try { localStorage.setItem("cc_ultimo_canal", canalId); } catch (e) {}  // lembra a última conversa
    _limparNotifCanal(canalId);   // fecha pop-ups fixados dessa conversa (= lido)
    _painelPendAberto = false;
    _fecharBusca();
    _renderLista();
    var box = document.getElementById("cc-msgs");
    if (box) box.innerHTML = "<div class='cc-empty'>Carregando…</div>";
    var r = await supa.from("chat_mensagens").select("*").eq("canal_id", canalId)
      .order("criada_em", { ascending: true }).limit(500);
    _renderMensagens((!r.error && r.data) ? r.data : []);
    await _marcarLido(canalId);
    _atualizarHead();
    _mostrarRodape(true);
  }

  async function _abrirDM(userId) {
    try {
      var r = await supa.rpc("chat_abrir_dm", { p_outro: userId });
      if (r.error) { if (typeof toast === "function") toast("⚠️", "Não foi possível abrir a conversa."); return; }
      var canalId = r.data;
      await _carregarCanais();       // traz o novo canal + membros
      await _abrirCanal(canalId);
    } catch (e) { if (typeof toast === "function") toast("⚠️", "Falha ao abrir a conversa."); }
  }

  async function _marcarLido(canalId) {
    var me = _me(); if (!me || !canalId) return;
    var agora = new Date().toISOString();
    _leituras[canalId] = agora; _naoLidas[canalId] = 0;
    _renderLista(); _recalcularBadgeMemoria();
    try { await supa.from("chat_leituras").upsert({ canal_id: canalId, membro_id: me.id, ultima_lida_em: agora }, { onConflict: "canal_id,membro_id" }); } catch (e) {}
  }

  async function _recalcularBadge() {
    var me = _me(); if (!me) return;
    _naoLidas = {};
    for (var i = 0; i < _canais.length; i++) {
      var c = _canais[i], desde = _leituras[c.id] || "1970-01-01T00:00:00Z";
      try {
        var r = await supa.from("chat_mensagens").select("id", { count: "exact", head: true })
          .eq("canal_id", c.id).eq("deletada", false).neq("autor_id", me.id).gt("criada_em", desde);
        _naoLidas[c.id] = r.count || 0;
      } catch (e) { _naoLidas[c.id] = 0; }
    }
    _recalcularBadgeMemoria(); _renderLista();
  }
  function _recalcularBadgeMemoria() {
    var tot = 0; for (var k in _naoLidas) if (_naoLidas.hasOwnProperty(k)) tot += (_naoLidas[k] || 0);
    _setBadge(tot);
  }
  // ── Marca de não-lidas na barra de tarefas (título + favicon + app badge) ──
  var _baseTitle = null, _origFav = null, _favEl = null;
  function _initBadgeSis() {
    if (_baseTitle === null) _baseTitle = document.title || "COR • Chat";
    if (_origFav === null) { var l = document.querySelector("link[rel~='icon']"); _origFav = l ? l.href : ""; }
  }
  function _ensureFavEl() {
    if (_favEl) return _favEl;
    _favEl = document.querySelector("link[rel~='icon']");
    if (!_favEl) { _favEl = document.createElement("link"); _favEl.rel = "icon"; document.head.appendChild(_favEl); }
    return _favEl;
  }
  function _drawRound(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function _setTitleBadge(n) { try { document.title = n > 0 ? ("(" + (n > 99 ? "99+" : n) + ") " + _baseTitle) : _baseTitle; } catch (e) {} }
  function _setAppBadge(n) { try { if (navigator.setAppBadge) { if (n > 0) navigator.setAppBadge(n); else if (navigator.clearAppBadge) navigator.clearAppBadge(); } } catch (e) {} }
  function _pintaBadge(base, n) {
    try {
      var c = document.createElement("canvas"); c.width = 64; c.height = 64; var ctx = c.getContext("2d");
      if (base) { try { ctx.drawImage(base, 0, 0, 64, 64); } catch (e) { base = null; } }
      if (!base) {
        _drawRound(ctx, 2, 2, 60, 60, 14, "#4ab848");
        ctx.fillStyle = "#fff"; ctx.font = "bold 22px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("COR", 32, 34);
      }
      if (n > 0) {
        ctx.beginPath(); ctx.arc(50, 14, 14, 0, 6.2832); ctx.fillStyle = "#e00000"; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold " + (n > 9 ? "13" : "18") + "px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(n > 9 ? "9+" : String(n), 50, 15);
      }
      _ensureFavEl().href = c.toDataURL("image/png");
    } catch (e) {}
  }
  function _setFaviconBadge(n) {
    if (_origFav) {
      if (n <= 0) { _ensureFavEl().href = _origFav; return; }
      var img = new Image();
      img.onload = function () { _pintaBadge(img, n); };
      img.onerror = function () { _pintaBadge(null, n); };
      img.src = _origFav;
    } else {
      _pintaBadge(null, n); // ícone base "COR" — com badge se n>0, sem badge se n<=0
    }
  }
  function _setBadge(n) {
    var el = document.getElementById("chatNavBadge");
    if (el) { if (n > 0) { el.textContent = n > 99 ? "99+" : n; el.style.display = ""; } else { el.style.display = "none"; } }
    _initBadgeSis();
    _setTitleBadge(n); _setFaviconBadge(n); _setAppBadge(n);
  }

  // ══ Envio ══
  async function _enviar() {
    var me = _me(); if (!me || !_canalAtual) return;
    var ta = document.getElementById("cc-input"); if (!ta) return;
    var txt = (ta.value || "").trim(); if (!txt) return;
    var btn = document.getElementById("cc-send");
    if (btn) btn.disabled = true; ta.disabled = true;
    var payload = {
      canal_id: _canalAtual, autor_id: me.id,
      autor_nome: me.nome || me.email || "—", autor_ini: me.ini || "?",
      autor_bg: me.bg || "linear-gradient(135deg,#4ab848,#7dcf6e)", autor_cor: me.cor || "#fff",
      conteudo: txt
    };
    try {
      var r = await supa.from("chat_mensagens").insert(payload).select().single();
      ta.value = ""; _autoGrow(ta);
      if (!r.error && r.data) { _appendUma(r.data); _marcarLido(_canalAtual); }
      else if (r.error && typeof toast === "function") toast("⚠️", "Falha ao enviar: " + (r.error.message || ""));
    } catch (e) { if (typeof toast === "function") toast("⚠️", "Falha ao enviar a mensagem."); }
    finally { ta.disabled = false; if (btn) btn.disabled = false; ta.focus(); }
  }

  // ══ Anexos (Cloudflare R2 via Edge Function chat-anexo) ══
  function _fmtTam(b) {
    b = Number(b || 0);
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(0) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function _ehImagem(tipo) { return /^image\//.test(tipo || ""); }

  // pede um link temporário (assinado) ao servidor; cacheia enquanto válido
  async function _urlAnexo(canalId, key) {
    var c = _urlCache[key];
    var agora = Date.now();
    if (c && c.exp > agora) return c.url;
    try {
      var r = await supa.functions.invoke("chat-anexo", { body: { action: "get", canal_id: canalId, key: key } });
      if (r.error || !r.data || !r.data.url) return null;
      _urlCache[key] = { url: r.data.url, exp: agora + 8 * 60 * 1000 }; // ~8 min
      return r.data.url;
    } catch (e) { return null; }
  }

  async function _enviarArquivo(file) {
    var me = _me(); if (!me || !_canalAtual || !file) return;
    if (file.size > MAX_ANEXO) { if (typeof toast === "function") toast("⚠️", "Arquivo acima de 10 MB."); return; }
    var clip = document.getElementById("cc-clip");
    if (clip) { clip.disabled = true; clip.textContent = "⏳"; }
    try {
      // 1) link de upload
      var r = await supa.functions.invoke("chat-anexo", {
        body: { action: "put", canal_id: _canalAtual, filename: file.name, tamanho: file.size }
      });
      if (r.error || !r.data || !r.data.url) { if (typeof toast === "function") toast("⚠️", "Falha ao preparar o envio."); return; }
      var putUrl = r.data.url, key = r.data.key;
      // 2) envia direto pro R2
      var up = await fetch(putUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!up.ok) { if (typeof toast === "function") toast("⚠️", "Falha no upload do arquivo."); return; }
      // 3) grava a mensagem com o anexo (legenda = texto atual, se houver)
      var ta = document.getElementById("cc-input");
      var caption = ta ? (ta.value || "").trim() : "";
      var payload = {
        canal_id: _canalAtual, autor_id: me.id,
        autor_nome: me.nome || me.email || "—", autor_ini: me.ini || "?",
        autor_bg: me.bg || "#4ab848", autor_cor: me.cor || "#fff",
        conteudo: caption,
        anexo_path: key, anexo_nome: file.name, anexo_tipo: file.type || "application/octet-stream", anexo_tam: file.size
      };
      var ins = await supa.from("chat_mensagens").insert(payload).select().single();
      if (!ins.error && ins.data) { if (ta) { ta.value = ""; _autoGrow(ta); } _appendUma(ins.data); _marcarLido(_canalAtual); }
      else if (ins.error && typeof toast === "function") toast("⚠️", "Anexo enviado, mas falhou ao registrar.");
    } catch (e) { if (typeof toast === "function") toast("⚠️", "Falha ao enviar o arquivo."); }
    finally { if (clip) { clip.disabled = false; clip.textContent = "📎"; } }
  }

  // monta o bloco visual do anexo (imagem ou cartão de arquivo) dentro do balão
  function _montarAnexo(m, bub) {
    if (_ehImagem(m.anexo_tipo)) {
      var img = document.createElement("img");
      img.className = "cc-img"; img.alt = m.anexo_nome || "imagem";
      img.title = m.anexo_nome || "";
      bub.appendChild(img);
      _urlAnexo(m.canal_id, m.anexo_path).then(function (url) {
        if (!url) return;
        img.src = url;
        img.addEventListener("click", function () { window.open(url, "_blank"); });
      });
    } else {
      var a = document.createElement("a");
      a.className = "cc-file"; a.target = "_blank"; a.rel = "noopener";
      var ic = document.createElement("span"); ic.className = "cc-fi"; ic.textContent = "📄";
      var wrap = document.createElement("div");
      var fn = document.createElement("div"); fn.className = "cc-fn"; fn.textContent = m.anexo_nome || "arquivo";
      var fs = document.createElement("div"); fs.className = "cc-fs"; fs.textContent = _fmtTam(m.anexo_tam) + " · baixar";
      wrap.appendChild(fn); wrap.appendChild(fs);
      a.appendChild(ic); a.appendChild(wrap);
      bub.appendChild(a);
      _urlAnexo(m.canal_id, m.anexo_path).then(function (url) { if (url) { a.href = url; try { a.setAttribute("download", m.anexo_nome || ""); } catch (e) {} } });
    }
  }

  // ── Toast colorido de mensagem nova (clicável) ──
  function _ccNotify(m, intenso) {
    if (_popNivel === "off") return;
    var host = document.getElementById("cc-notify-host");
    if (!host) { host = document.createElement("div"); host.id = "cc-notify-host"; host.className = "cc-nhost"; document.body.appendChild(host); }
    var card = document.createElement("div");
    card.className = "cc-note" + (_popNivel === "forte" ? " forte" : "") + (intenso ? " intenso" : "");
    var av = document.createElement("div"); av.className = "cc-note-av";
    av.style.background = m.autor_bg || "#4ab848"; av.style.color = m.autor_cor || "#fff"; av.textContent = m.autor_ini || "?";
    var body = document.createElement("div"); body.className = "cc-note-body";
    var nm = document.createElement("div"); nm.className = "cc-note-nm";
    nm.textContent = (m.autor_nome || "Alguém") + (_ehDM(m.canal_id) ? "" : " · #" + _nomeCanal(m.canal_id));
    var tx = document.createElement("div"); tx.className = "cc-note-tx";
    tx.textContent = (m.conteudo && m.conteudo.length) ? m.conteudo : (m.anexo_nome ? "📎 " + m.anexo_nome : "(mensagem)");
    body.appendChild(nm); body.appendChild(tx);
    var ic = document.createElement("div"); ic.className = "cc-note-ic"; ic.textContent = _popFixar ? "📌" : "💬";
    card.appendChild(av); card.appendChild(body); card.appendChild(ic);
    var canal = m.canal_id;
    card.setAttribute("data-canal", canal);
    function fecha() { card.classList.remove("show"); setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 320); }
    card.addEventListener("click", function () { _irParaConversa(canal); fecha(); });
    if (_popFixar) {
      // botão × pra descartar sem abrir (não fecha sozinho)
      var x = document.createElement("button"); x.className = "cc-note-x"; x.textContent = "✕";
      x.addEventListener("click", function (ev) { ev.stopPropagation(); fecha(); });
      card.appendChild(x);
    }
    host.appendChild(card);
    requestAnimationFrame(function () { card.classList.add("show"); });
    if (!_popFixar) {
      // discreto: 4s | forte: 8s | forte+minimizado: 12s
      var dur = _popNivel === "forte" ? (intenso ? 12000 : 8000) : 4000;
      setTimeout(fecha, dur);
    }
  }
  // remove os pop-ups fixados de um canal quando ele é aberto (= lido)
  function _limparNotifCanal(canalId) {
    var host = document.getElementById("cc-notify-host"); if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll(".cc-note[data-canal='" + canalId + "']"), function (c) {
      c.classList.remove("show"); setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 320);
    });
  }
  function _irParaConversa(canalId) {
    if (typeof navTo === "function") navTo("chat");
    _abrirCanal(canalId);
  }
  function _iconeSom() { return _somNivel === "off" ? "🔕" : (_somNivel === "baixo" ? "🔉" : "🔔"); }
  function _atualizarIconeSom() { var b = document.getElementById("cc-head-som"); if (b) b.textContent = _iconeSom(); }
  function _marcarSeg(p) {
    Array.prototype.forEach.call(p.querySelectorAll(".cc-seg[data-grp='som'] button"), function (b) { b.classList.toggle("on", b.getAttribute("data-v") === _somNivel); });
    Array.prototype.forEach.call(p.querySelectorAll(".cc-seg[data-grp='pop'] button"), function (b) { b.classList.toggle("on", b.getAttribute("data-v") === _popNivel); });
    Array.prototype.forEach.call(p.querySelectorAll(".cc-seg[data-grp='fix'] button"), function (b) { b.classList.toggle("on", b.getAttribute("data-v") === (_popFixar ? "on" : "off")); });
  }
  function _fecharConfig() {
    var ex = document.getElementById("cc-cfg"); if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    document.removeEventListener("click", _cfgFora, true);
  }
  function _cfgFora(e) {
    var p = document.getElementById("cc-cfg"); var b = document.getElementById("cc-head-som");
    if (!p) return;
    if (p.contains(e.target) || (b && b.contains(e.target))) return;
    _fecharConfig();
  }
  function _abrirConfig() {
    if (document.getElementById("cc-cfg")) { _fecharConfig(); return; }
    var main = document.querySelector(".cc-main"); if (!main) return;
    _unlockAudio();
    var p = document.createElement("div"); p.id = "cc-cfg"; p.className = "cc-cfg";
    p.innerHTML =
      "<h5>🔊 Som do aviso</h5>" +
      "<div class='cc-seg' data-grp='som'>" +
        "<button data-v='alto'>🔔 Alto</button><button data-v='baixo'>🔉 Baixo</button><button data-v='off'>🔕 Não</button></div>" +
      "<h5>💬 Pop-up de aviso</h5>" +
      "<div class='cc-seg' data-grp='pop'>" +
        "<button data-v='forte'>💥 Forte</button><button data-v='discreto'>· Discreto</button><button data-v='off'>Não</button></div>" +
      "<div class='cc-seg' data-grp='fix'>" +
        "<button data-v='on'>📌 Fixar até ler</button><button data-v='off'>Some sozinho</button></div>" +
      "<button class='cc-testar' id='cc-testar'>▶ Testar som + pop-up</button>" +
      "<div style='margin-top:9px;text-align:center;font-size:.68rem;color:var(--gr,#94a3b8)'>chat v" + _CHAT_VER + "</div>";
    main.appendChild(p);
    _marcarSeg(p);
    Array.prototype.forEach.call(p.querySelectorAll(".cc-seg[data-grp='som'] button"), function (b) {
      b.addEventListener("click", function () {
        _somNivel = b.getAttribute("data-v");
        try { localStorage.setItem("cc_somNivel", _somNivel); } catch (e) {}
        _marcarSeg(p); _atualizarIconeSom(); if (_somNivel !== "off") { _unlockAudio(); _alarme(false); }
      });
    });
    Array.prototype.forEach.call(p.querySelectorAll(".cc-seg[data-grp='pop'] button"), function (b) {
      b.addEventListener("click", function () {
        _popNivel = b.getAttribute("data-v");
        try { localStorage.setItem("cc_popNivel", _popNivel); } catch (e) {}
        _marcarSeg(p);
      });
    });
    Array.prototype.forEach.call(p.querySelectorAll(".cc-seg[data-grp='fix'] button"), function (b) {
      b.addEventListener("click", function () {
        _popFixar = b.getAttribute("data-v") === "on";
        try { localStorage.setItem("cc_popFixar", _popFixar ? "1" : "0"); } catch (e) {}
        _marcarSeg(p);
      });
    });
    var tb = document.getElementById("cc-testar");
    if (tb) tb.addEventListener("click", function () {
      _unlockAudio(); _alarme(true);
      var me = _me() || {};
      _ccNotify({ canal_id: _canalAtual, autor_nome: me.nome || "Teste", autor_ini: me.ini || "T", autor_bg: me.bg || "#4ab848", autor_cor: me.cor || "#fff", conteudo: "Exemplo de aviso de mensagem 🔔" }, true);
    });
    setTimeout(function () { document.addEventListener("click", _cfgFora, true); }, 0);
  }

  async function _novoCanal() {
    var me = _me(); if (!me) return;
    var nome = window.prompt("Nome do novo canal da equipe (ex: Recepção, Financeiro):");
    if (!nome) return; nome = nome.trim(); if (!nome) return;
    try {
      var r = await supa.from("chat_canais").insert({ tipo: "canal", nome: nome, criado_por: me.id }).select().single();
      if (r.error) { if (typeof toast === "function") toast("⚠️", "Não foi possível criar o canal."); return; }
      await _carregarCanais(); await _abrirCanal(r.data.id);
    } catch (e) {}
  }

  // ══ Realtime (som + toast + badge) ══
  function _assinarRealtime() {
    try { if (_rtChannel) supa.removeChannel(_rtChannel); } catch (e) {}
    _rtChannel = supa.channel("chat_cor_rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_mensagens" }, function (p) { _onNova(p.new); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_mensagens" }, function (p) { _onEditada(p.new); })
      .subscribe();
  }
  async function _onNova(m) {
    if (!m) return; var me = _me(); if (!me) return;

    // canal novo (ex.: alguém me mandou a 1ª DM) -> recarrega a lista
    var conhecido = _canais.some(function (c) { return c.id === m.canal_id; });
    if (!conhecido) { await _atualizarListaCanais(); }

    if (m.autor_id === me.id) { if (m.canal_id === _canalAtual) _appendUma(m); return; }

    var aberto = (m.canal_id === _canalAtual) && _telaChatAtiva();
    if (m.canal_id === _canalAtual) _appendUma(m);

    if (aberto) { _marcarLido(m.canal_id); return; }

    _naoLidas[m.canal_id] = (_naoLidas[m.canal_id] || 0) + 1;
    _recalcularBadgeMemoria(); _renderLista();
    if (_bootstrap) {
      var intenso = _minimizado();
      _alarme(intenso);
      _ccNotify(m, intenso);
    }
  }
  function _onEditada(m) {
    if (!m || m.canal_id !== _canalAtual) return;
    var el = document.querySelector(".cc-row[data-id='" + m.id + "']"); if (!el) return;
    var bub = el.querySelector(".cc-bub"); if (!bub) return;
    if (m.deletada) {
      // remove texto, imagem/arquivo e o botão excluir; deixa só o "mensagem removida"
      var nome = bub.querySelector(".cc-nome");
      var hr = bub.querySelector(".cc-hr");
      bub.innerHTML = "";
      if (nome) bub.appendChild(nome);
      var t = document.createElement("div"); t.className = "cc-txt cc-del"; t.textContent = "mensagem removida"; bub.appendChild(t);
      if (hr) bub.appendChild(hr);
    } else {
      var txt = bub.querySelector(".cc-txt"); if (txt) txt.textContent = m.conteudo;
    }
  }
  function _telaChatAtiva() {
    var pg = document.getElementById("page-chat");
    return !!(pg && pg.classList.contains("active"));
  }

  // ══ Helpers de canal ══
  function _canalObj(id) { for (var i = 0; i < _canais.length; i++) if (_canais[i].id === id) return _canais[i]; return null; }
  function _ehDM(id) { var c = _canalObj(id); return !!(c && c.tipo === "dm"); }
  function _nomeCanal(id) {
    var c = _canalObj(id); if (!c) return "conversa";
    if (c.tipo === "dm") { var o = _dmOutro[id]; return o ? o.nome : "conversa"; }
    return c.nome || "canal";
  }

  // ══ Render ══
  function _renderTudo() {
    var pg = document.getElementById("page-chat"); if (!pg) return;
    pg.innerHTML =
      "<div class='cc-wrap'>" +
        "<div class='cc-side'>" +
          "<div class='cc-grp'><b>Canais</b><button class='cc-newbtn' id='cc-new-canal' title='Novo canal'>+</button></div>" +
          "<div class='cc-canais' id='cc-lista-canais' style='flex:0 0 auto;max-height:32%'></div>" +
          "<div class='cc-grp'><b>Equipe</b></div>" +
          "<div class='cc-list' id='cc-lista-dms' style='flex:1 1 auto'></div>" +
        "</div>" +
        "<div class='cc-main'>" +
          "<div class='cc-head' id='cc-head'>" +
            "<span id='cc-head-title'>—</span><span style='flex:1'></span>" +
            "<button class='cc-hbtn' id='cc-head-som' title='Som das notificações'>🔔</button>" +
            "<button class='cc-hbtn' id='cc-head-pend' title='Minhas pendências'>📌 <span id='cc-pend-cnt' style='font-size:.82rem;font-weight:700'>0</span></button>" +
            "<button class='cc-hbtn' id='cc-head-search' title='Buscar na conversa'>🔍</button>" +
          "</div>" +
          "<div class='cc-search' id='cc-search' style='display:none'>" +
            "<input id='cc-search-inp' placeholder='Buscar nesta conversa…'>" +
            "<span class='cc-scnt' id='cc-search-cnt'>0/0</span>" +
            "<button id='cc-search-prev' title='Anterior'>▲</button>" +
            "<button id='cc-search-next' title='Próxima'>▼</button>" +
            "<button id='cc-search-x' title='Fechar'>✕</button>" +
          "</div>" +
          "<div class='cc-msgs' id='cc-msgs'></div>" +
          "<div class='cc-foot' id='cc-foot'>" +
            "<input type='file' id='cc-file' style='display:none'>" +
            "<button class='cc-clip' id='cc-clip' title='Anexar arquivo (até 10 MB)'>📎</button>" +
            "<textarea id='cc-input' rows='1' placeholder='Escreva uma mensagem…'></textarea>" +
            "<button class='cc-send' id='cc-send'>Enviar</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    _renderLista(); _atualizarHead();

    var nc = document.getElementById("cc-new-canal"); if (nc) nc.addEventListener("click", _novoCanal);
    var send = document.getElementById("cc-send"); if (send) send.addEventListener("click", _enviar);
    var clip = document.getElementById("cc-clip");
    var finp = document.getElementById("cc-file");
    if (clip && finp) {
      clip.addEventListener("click", function () { finp.click(); });
      finp.addEventListener("change", function () {
        if (finp.files && finp.files[0]) { _enviarArquivo(finp.files[0]); finp.value = ""; }
      });
    }
    // busca na conversa
    var hs = document.getElementById("cc-head-search");
    var si = document.getElementById("cc-search-inp");
    if (hs) hs.addEventListener("click", _toggleBusca);
    var hp = document.getElementById("cc-head-pend");
    if (hp) hp.addEventListener("click", _abrirPendencias);
    _atualizarPendCount();
    var hsom = document.getElementById("cc-head-som");
    if (hsom) { hsom.textContent = _iconeSom(); hsom.title = "Sons e avisos"; hsom.addEventListener("click", _abrirConfig); }
    if (si) {
      si.addEventListener("input", function () { _fazerBusca(si.value); });
      si.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); _irHit(_busca.idx + (e.shiftKey ? -1 : 1)); }
        else if (e.key === "Escape") { _fecharBusca(); }
      });
    }
    var sp = document.getElementById("cc-search-prev"); if (sp) sp.addEventListener("click", function () { _irHit(_busca.idx - 1); });
    var sn = document.getElementById("cc-search-next"); if (sn) sn.addEventListener("click", function () { _irHit(_busca.idx + 1); });
    var sx = document.getElementById("cc-search-x"); if (sx) sx.addEventListener("click", _fecharBusca);
    var ta = document.getElementById("cc-input");
    if (ta) {
      ta.addEventListener("input", function () { _autoGrow(ta); });
      ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); _enviar(); } });
    }
  }
  function _autoGrow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }

  function _renderLista() {
    var bc = document.getElementById("cc-lista-canais");
    var bd = document.getElementById("cc-lista-dms");
    if (!bc || !bd) return;
    var hc = "", hd = "";
    var canais = _canais.filter(function (c) { return c.tipo !== "dm"; });
    var dms = _canais.filter(function (c) { return c.tipo === "dm"; });

    if (!canais.length) hc = "<div class='cc-empty' style='margin:8px 4px;padding:6px'>—</div>";
    canais.forEach(function (c) {
      var cnt = _naoLidas[c.id] || 0;
      hc += "<div class='cc-item" + (c.id === _canalAtual ? " on" : "") + "' data-canal='" + _esc(c.id) + "'>" +
              "<span class='cc-hash'>#</span><span>" + _esc(c.nome || "canal") + "</span>" +
              (cnt > 0 ? "<span class='cc-cnt'>" + (cnt > 99 ? "99+" : cnt) + "</span>" : "") + "</div>";
    });

    // Lista FIXA de toda a equipe (estilo WhatsApp): cada colega sempre visível.
    var users = _usuariosParaDM();
    if (!users.length) hd = "<div class='cc-empty' style='margin:8px 4px;padding:6px;font-size:.8rem'>Nenhum outro usuário cadastrado.</div>";
    users.forEach(function (u) {
      var canalId = _dmCanalDe[u.id];
      var cnt = canalId ? (_naoLidas[canalId] || 0) : 0;
      var ativo = canalId && canalId === _canalAtual;
      hd += "<div class='cc-item" + (ativo ? " on" : "") + "' data-user='" + _esc(u.id) + "'>" +
              "<span class='cc-mini' style='background:" + _esc(u.bg) + ";color:" + _esc(u.cor) + "'>" + _esc(u.ini) + "</span>" +
              "<span>" + _esc(u.nome) + "</span>" +
              (cnt > 0 ? "<span class='cc-cnt'>" + (cnt > 99 ? "99+" : cnt) + "</span>" : "") + "</div>";
    });

    bc.innerHTML = hc; bd.innerHTML = hd;
    Array.prototype.forEach.call(document.querySelectorAll("#cc-lista-canais .cc-item"), function (el) {
      el.addEventListener("click", function () { _abrirCanal(el.getAttribute("data-canal")); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#cc-lista-dms .cc-item"), function (el) {
      el.addEventListener("click", function () { _abrirConversaCom(el.getAttribute("data-user")); });
    });
  }

  // abre a conversa 1-a-1 com um colega (cria a DM na 1ª vez, reabre depois)
  async function _abrirConversaCom(userId) {
    var canalId = _dmCanalDe[userId];
    if (canalId) await _abrirCanal(canalId);
    else await _abrirDM(userId);
  }

  function _atualizarHead() {
    var head = document.getElementById("cc-head-title"); if (!head) return;
    var c = _canalObj(_canalAtual);
    if (!c) { head.textContent = "—"; return; }
    if (c.tipo === "dm") {
      var o = _dmOutro[c.id] || { nome: "Usuário" };
      head.innerHTML = "<span class='cc-mini' style='width:26px;height:26px;background:" + _esc(o.bg || "#64748b") + ";color:" + _esc(o.cor || "#fff") + "'>" + _esc(o.ini || "?") + "</span> " + _esc(o.nome) + " <small>conversa privada</small>";
    } else {
      head.innerHTML = "# " + _esc(c.nome || "canal") + (c.descricao ? " <small>" + _esc(c.descricao) + "</small>" : "");
    }
  }

  // ══ Busca dentro da conversa (cliente, nas mensagens carregadas) ══
  function _toggleBusca() {
    var bar = document.getElementById("cc-search");
    if (!bar) return;
    if (bar.style.display === "none") {
      bar.style.display = "flex";
      var si = document.getElementById("cc-search-inp"); if (si) { si.focus(); si.select(); }
    } else { _fecharBusca(); }
  }
  function _fecharBusca() {
    var bar = document.getElementById("cc-search"); if (bar) bar.style.display = "none";
    var si = document.getElementById("cc-search-inp"); if (si) si.value = "";
    _limparRealce(); _busca = { termo: "", hits: [], idx: -1 };
    _atualizarContadorBusca();
  }
  function _limparRealce() {
    Array.prototype.forEach.call(document.querySelectorAll("#cc-msgs .cc-hit, #cc-msgs .cc-hit-atual"),
      function (r) { r.classList.remove("cc-hit"); r.classList.remove("cc-hit-atual"); });
  }
  function _fazerBusca(termo) {
    _limparRealce();
    _busca.termo = (termo || "").trim().toLowerCase();
    _busca.hits = []; _busca.idx = -1;
    if (_busca.termo) {
      Array.prototype.forEach.call(document.querySelectorAll("#cc-msgs .cc-row"), function (row) {
        var body = "";
        var t = row.querySelector(".cc-txt"); if (t && !t.classList.contains("cc-del")) body += " " + t.textContent;
        var fn = row.querySelector(".cc-fn"); if (fn) body += " " + fn.textContent;
        if (body.toLowerCase().indexOf(_busca.termo) >= 0) { row.classList.add("cc-hit"); _busca.hits.push(row); }
      });
    }
    if (_busca.hits.length) _irHit(0); else _atualizarContadorBusca();
  }
  function _irHit(i) {
    if (!_busca.hits.length) { _atualizarContadorBusca(); return; }
    _busca.hits.forEach(function (r) { r.classList.remove("cc-hit-atual"); });
    var n = _busca.hits.length;
    _busca.idx = ((i % n) + n) % n;
    var el = _busca.hits[_busca.idx];
    el.classList.add("cc-hit-atual");
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { el.scrollIntoView(); }
    _atualizarContadorBusca();
  }
  function _atualizarContadorBusca() {
    var cnt = document.getElementById("cc-search-cnt");
    if (cnt) cnt.textContent = _busca.hits.length ? ((_busca.idx + 1) + "/" + _busca.hits.length) : "0/0";
  }

  function _mostrarRodape(mostrar) {
    var f = document.getElementById("cc-foot"); if (f) f.style.display = mostrar ? "" : "none";
  }


  function _renderMensagens(msgs) {
    var box = document.getElementById("cc-msgs"); if (!box) return;
    if (!msgs.length) { box.innerHTML = "<div class='cc-empty'>Sem mensagens ainda.<br>Diga um oi! 👋</div>"; return; }
    box.innerHTML = ""; var ultimoDia = "";
    msgs.forEach(function (m) {
      var dia = _diaFmt(m.criada_em);
      if (dia !== ultimoDia) { ultimoDia = dia; var s = document.createElement("div"); s.className = "cc-daysep"; s.textContent = dia; box.appendChild(s); }
      box.appendChild(_linha(m));
    });
    _scrollFim();
  }
  function _appendUma(m) {
    var box = document.getElementById("cc-msgs"); if (!box) return;
    if (box.querySelector(".cc-row[data-id='" + m.id + "']")) return;
    var vazio = box.querySelector(".cc-empty"); if (vazio) box.innerHTML = "";
    var dia = _diaFmt(m.criada_em);
    var seps = box.querySelectorAll(".cc-daysep");
    var ultimo = seps.length ? seps[seps.length - 1].textContent : "";
    if (ultimo !== dia) { var s = document.createElement("div"); s.className = "cc-daysep"; s.textContent = dia; box.appendChild(s); }
    box.appendChild(_linha(m)); _scrollFim();
  }
  function _linha(m) {
    var me = _me(); var meu = me && m.autor_id === me.id;
    var row = document.createElement("div"); row.className = "cc-row" + (meu ? " me" : ""); row.setAttribute("data-id", m.id);
    var av = document.createElement("div"); av.className = "cc-av";
    av.style.background = m.autor_bg || "#4ab848"; av.style.color = m.autor_cor || "#fff"; av.textContent = m.autor_ini || "?";
    var bub = document.createElement("div"); bub.className = "cc-bub";
    if (!meu) { var nome = document.createElement("div"); nome.className = "cc-nome"; nome.textContent = m.autor_nome || "—"; bub.appendChild(nome); }
    if (m.deletada) {
      var txtd = document.createElement("div"); txtd.className = "cc-txt cc-del"; txtd.textContent = "mensagem removida"; bub.appendChild(txtd);
    } else {
      if (m.conteudo && m.conteudo.length) {
        var txt = document.createElement("div"); txt.className = "cc-txt"; txt.textContent = m.conteudo; bub.appendChild(txt);
      }
      if (m.anexo_path) _montarAnexo(m, bub);
    }
    var hr = document.createElement("div"); hr.className = "cc-hr"; hr.textContent = _horaFmt(m.criada_em) + (m.editada_em ? " · editada" : "");
    bub.appendChild(hr);
    if (!m.deletada) {
      var ctrls = document.createElement("div"); ctrls.className = "cc-ctrls";
      var ehPend = !!_pend[m.id];
      var pin = document.createElement("button");
      pin.className = "cc-pin" + (ehPend ? " on" : "");
      pin.title = ehPend ? "Concluir pendência" : "Marcar como pendência";
      pin.textContent = "📌";
      pin.addEventListener("click", function (ev) { ev.stopPropagation(); _togglePend(m); });
      ctrls.appendChild(pin);
      if (meu) {
        var x = document.createElement("button"); x.className = "cc-del2"; x.title = "Excluir mensagem"; x.textContent = "✕";
        x.addEventListener("click", function (ev) { ev.stopPropagation(); _excluirMsg(m); });
        ctrls.appendChild(x);
      }
      bub.appendChild(ctrls);
      if (ehPend) row.classList.add("cc-pend");
    }
    row.appendChild(av); row.appendChild(bub); return row;
  }

  async function _excluirMsg(m) {
    var me = _me(); if (!me || !m || m.autor_id !== me.id) return;
    if (!window.confirm("Excluir esta mensagem para todos?")) return;
    try {
      // apaga o arquivo no R2 (se houver) — best-effort
      if (m.anexo_path) {
        try { await supa.functions.invoke("chat-anexo", { body: { action: "del", canal_id: m.canal_id, key: m.anexo_path } }); } catch (e) {}
      }
      var r = await supa.from("chat_mensagens").update({ deletada: true }).eq("id", m.id);
      if (r.error) { if (typeof toast === "function") toast("⚠️", "Não foi possível excluir."); return; }
      _onEditada({ id: m.id, canal_id: m.canal_id, deletada: true }); // reflete já na tela
    } catch (e) { if (typeof toast === "function") toast("⚠️", "Falha ao excluir a mensagem."); }
  }

  // ══ Pendências (pessoais) ══
  function _resumoMsg(m) {
    if (m.conteudo && m.conteudo.length) return m.conteudo.length > 90 ? m.conteudo.slice(0, 90) + "…" : m.conteudo;
    if (m.anexo_nome) return "📎 " + m.anexo_nome;
    return "(mensagem)";
  }
  async function _carregarPendencias() {
    var me = _me(); if (!me) return;
    var r = await supa.from("chat_pendencias")
      .select("mensagem_id,canal_id,resumo,autor_nome,criada_em")
      .eq("user_id", me.id).order("criada_em", { ascending: false });
    _pend = {};
    if (!r.error && r.data) r.data.forEach(function (p) {
      _pend[p.mensagem_id] = { canal_id: p.canal_id, resumo: p.resumo, autor_nome: p.autor_nome, criada_em: p.criada_em };
    });
    _atualizarPendCount();
  }
  function _refletirPend(msgId, on) {
    var row = document.querySelector(".cc-row[data-id='" + msgId + "']"); if (!row) return;
    row.classList.toggle("cc-pend", !!on);
    var pin = row.querySelector(".cc-pin");
    if (pin) { pin.classList.toggle("on", !!on); pin.title = on ? "Concluir pendência" : "Marcar como pendência"; }
  }
  function _atualizarPendCount() {
    var n = Object.keys(_pend).length;
    var el = document.getElementById("cc-pend-cnt"); if (el) el.textContent = n;
    var btn = document.getElementById("cc-head-pend"); if (btn) btn.style.color = n ? "#f59e0b" : "";
  }
  async function _togglePend(m) {
    var me = _me(); if (!me || !m || !m.id) return;
    if (_pend[m.id]) {
      delete _pend[m.id];
      _refletirPend(m.id, false); _atualizarPendCount();
      try { await supa.from("chat_pendencias").delete().eq("user_id", me.id).eq("mensagem_id", m.id); } catch (e) {}
      if (_painelPendAberto) _abrirPendencias();
    } else {
      var reg = { canal_id: m.canal_id, resumo: _resumoMsg(m), autor_nome: m.autor_nome || "", criada_em: new Date().toISOString() };
      _pend[m.id] = reg;
      _refletirPend(m.id, true); _atualizarPendCount();
      try {
        await supa.from("chat_pendencias").insert({ user_id: me.id, mensagem_id: m.id, canal_id: m.canal_id, resumo: reg.resumo, autor_nome: reg.autor_nome });
        if (typeof toast === "function") toast("📌", "Marcado como pendência.");
      } catch (e) {}
    }
  }
  function _abrirPendencias() {
    _painelPendAberto = true;
    _fecharBusca(); _mostrarRodape(false);
    var head = document.getElementById("cc-head-title"); // mantém o título do canal
    var box = document.getElementById("cc-msgs"); if (!box) return;
    var ids = Object.keys(_pend);
    if (!ids.length) {
      box.innerHTML = "<div class='cc-empty'>Você não tem pendências. 🎉<br>Passe o mouse numa mensagem e clique no 📌 pra marcar.</div>";
      return;
    }
    var arr = ids.map(function (id) { return { id: id, p: _pend[id] }; });
    arr.sort(function (a, b) { return (b.p.criada_em || "").localeCompare(a.p.criada_em || ""); });
    var h = "<div class='cc-ppanel'><h4 style='margin:2px 2px 12px;font-size:.95rem'>📌 Minhas pendências (" + arr.length + ")</h4>";
    arr.forEach(function (it) {
      var conv = _nomeCanal(it.p.canal_id);
      h += "<div class='cc-ppi' data-id='" + _esc(it.id) + "' data-canal='" + _esc(it.p.canal_id) + "'>" +
             "<div class='cc-ppc'><div class='cc-ppr'>" + _esc(it.p.resumo || "(mensagem)") + "</div>" +
             "<div class='cc-ppm'>" + _esc(it.p.autor_nome || "") + " · " + _esc(conv) + "</div></div>" +
             "<div class='cc-ppb'><button class='cc-abrir'>Abrir</button><button class='cc-ok'>✓ Feito</button></div>" +
           "</div>";
    });
    h += "</div>";
    box.innerHTML = h;
    Array.prototype.forEach.call(box.querySelectorAll(".cc-ppi"), function (el) {
      var id = el.getAttribute("data-id"), canal = el.getAttribute("data-canal");
      el.querySelector(".cc-abrir").addEventListener("click", function () { _irParaMensagem(canal, id); });
      el.querySelector(".cc-ok").addEventListener("click", function () { _togglePend({ id: id, canal_id: canal }); });
    });
  }
  async function _irParaMensagem(canalId, msgId) {
    _painelPendAberto = false;
    await _abrirCanal(canalId);
    var row = document.querySelector(".cc-row[data-id='" + msgId + "']");
    if (row) {
      row.classList.add("cc-hit-atual");
      try { row.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { row.scrollIntoView(); }
      setTimeout(function () { row.classList.remove("cc-hit-atual"); }, 2600);
    } else if (typeof toast === "function") { toast("ℹ️", "Mensagem antiga — role a conversa pra cima."); }
  }
  function _scrollFim() { var box = document.getElementById("cc-msgs"); if (box) box.scrollTop = box.scrollHeight; }

  // ══ Boot ══
  function _boot() {
    _liberarPerms(); _injetarNav(); _vigiarSessao();
    // destrava o áudio no primeiro gesto do usuário (contorna o bloqueio dos navegadores)
    document.addEventListener("click", _unlockAudio, true);
    document.addEventListener("keydown", _unlockAudio, true);
    var me = _me();
    if (me && me.id && PERFIS_CHAT.indexOf(me.role) >= 0) _iniciar();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _boot); else _boot();

  window.ChatCOR = {
    onLogin: function () { if (!_iniciado) _iniciar(); },
    onLogout: _desligar,
    abrir: function () { if (typeof navTo === "function") navTo("chat"); },
    _estado: function () { return { canalAtual: _canalAtual, canais: _canais, naoLidas: _naoLidas }; }
  };
})();
