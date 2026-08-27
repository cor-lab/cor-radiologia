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

  function _beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ac = new AC(), o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = "sine"; o.frequency.value = 680;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.14, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.32);
      o.start(); o.stop(ac.currentTime + 0.34);
      o.onended = function () { try { ac.close(); } catch (e) {} };
    } catch (e) {}
  }

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
      + ".cc-main{flex:1;display:flex;flex-direction:column;min-width:0}"
      + ".cc-head{padding:12px 16px;border-bottom:1px solid var(--bd,#e5e7eb);font-weight:600;font-size:.95rem;display:flex;align-items:center;gap:8px}"
      + ".cc-head small{font-weight:400;color:var(--gr,#94a3b8);font-size:.78rem}"
      + ".cc-msgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:2px;background:var(--bg,#f1f5f9)}"
      + ".cc-daysep{align-self:center;font-size:.72rem;color:var(--gr,#94a3b8);background:var(--card,#fff);border:1px solid var(--bd,#e5e7eb);padding:2px 10px;border-radius:20px;margin:10px 0 6px}"
      + ".cc-row{display:flex;gap:9px;margin-top:9px;max-width:78%}"
      + ".cc-row.me{align-self:flex-end;flex-direction:row-reverse}"
      + ".cc-av{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700}"
      + ".cc-bub{background:var(--card,#fff);border:1px solid var(--bd,#e5e7eb);border-radius:12px;padding:7px 11px;min-width:0;color:#1f2937}"
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
      var g = _canais.filter(function (c) { return c.tipo !== "dm"; })[0] || _canais[0];
      _canalAtual = g.id;
    }
    _renderTudo();
    if (_canalAtual) await _abrirCanal(_canalAtual);
  }

  async function _abrirCanal(canalId) {
    _canalAtual = canalId;
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
  function _setBadge(n) {
    var el = document.getElementById("chatNavBadge"); if (!el) return;
    if (n > 0) { el.textContent = n > 99 ? "99+" : n; el.style.display = ""; } else { el.style.display = "none"; }
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
    if (!conhecido) { await _carregarCanais(); }

    if (m.autor_id === me.id) { if (m.canal_id === _canalAtual) _appendUma(m); return; }

    var aberto = (m.canal_id === _canalAtual) && _telaChatAtiva();
    if (m.canal_id === _canalAtual) _appendUma(m);

    if (aberto) { _marcarLido(m.canal_id); return; }

    _naoLidas[m.canal_id] = (_naoLidas[m.canal_id] || 0) + 1;
    _recalcularBadgeMemoria(); _renderLista();
    if (_bootstrap) {
      _beep();
      var quem = (m.autor_nome || "Alguém").split(" ")[0];
      var ondeC = _ehDM(m.canal_id) ? "" : (" em #" + _nomeCanal(m.canal_id));
      var corpo = m.conteudo.length > 40 ? m.conteudo.slice(0, 40) + "…" : m.conteudo;
      if (typeof toast === "function") toast("💬", quem + ondeC + ": " + corpo);
    }
  }
  function _onEditada(m) {
    if (!m || m.canal_id !== _canalAtual) return;
    var el = document.querySelector(".cc-row[data-id='" + m.id + "']"); if (!el) return;
    var txt = el.querySelector(".cc-txt"); if (!txt) return;
    if (m.deletada) { txt.className = "cc-txt cc-del"; txt.textContent = "mensagem removida"; }
    else txt.textContent = m.conteudo;
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
          "<div class='cc-head' id='cc-head'>—</div>" +
          "<div class='cc-msgs' id='cc-msgs'></div>" +
          "<div class='cc-foot' id='cc-foot'>" +
            "<textarea id='cc-input' rows='1' placeholder='Escreva uma mensagem…'></textarea>" +
            "<button class='cc-send' id='cc-send'>Enviar</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    _renderLista(); _atualizarHead();

    var nc = document.getElementById("cc-new-canal"); if (nc) nc.addEventListener("click", _novoCanal);
    var send = document.getElementById("cc-send"); if (send) send.addEventListener("click", _enviar);
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
    var head = document.getElementById("cc-head"); if (!head) return;
    var c = _canalObj(_canalAtual);
    if (!c) { head.textContent = "—"; return; }
    if (c.tipo === "dm") {
      var o = _dmOutro[c.id] || { nome: "Usuário" };
      head.innerHTML = "<span class='cc-mini' style='width:26px;height:26px;background:" + _esc(o.bg || "#64748b") + ";color:" + _esc(o.cor || "#fff") + "'>" + _esc(o.ini || "?") + "</span> " + _esc(o.nome) + " <small>conversa privada</small>";
    } else {
      head.innerHTML = "# " + _esc(c.nome || "canal") + (c.descricao ? " <small>" + _esc(c.descricao) + "</small>" : "");
    }
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
    var txt = document.createElement("div");
    if (m.deletada) { txt.className = "cc-txt cc-del"; txt.textContent = "mensagem removida"; }
    else { txt.className = "cc-txt"; txt.textContent = m.conteudo; }
    bub.appendChild(txt);
    var hr = document.createElement("div"); hr.className = "cc-hr"; hr.textContent = _horaFmt(m.criada_em) + (m.editada_em ? " · editada" : "");
    bub.appendChild(hr);
    row.appendChild(av); row.appendChild(bub); return row;
  }
  function _scrollFim() { var box = document.getElementById("cc-msgs"); if (box) box.scrollTop = box.scrollHeight; }

  // ══ Boot ══
  function _boot() {
    _liberarPerms(); _injetarNav(); _vigiarSessao();
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
