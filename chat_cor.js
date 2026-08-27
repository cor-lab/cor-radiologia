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
  var _urlCache = {};        // key(anexo) -> {url, exp}  (evita re-assinar a cada render)
  var MAX_ANEXO = 10 * 1024 * 1024;  // 10 MB
  var _busca = { termo: "", hits: [], idx: -1 };  // busca dentro da conversa

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
      var corpo;
      if (m.conteudo && m.conteudo.length) corpo = m.conteudo.length > 40 ? m.conteudo.slice(0, 40) + "…" : m.conteudo;
      else if (m.anexo_path) corpo = "📎 " + (m.anexo_nome || "arquivo");
      else corpo = "";
      if (typeof toast === "function") toast("💬", quem + ondeC + ": " + corpo);
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
    if (meu && !m.deletada) {
      var x = document.createElement("button"); x.className = "cc-x"; x.title = "Excluir mensagem"; x.textContent = "✕";
      x.addEventListener("click", function (ev) { ev.stopPropagation(); _excluirMsg(m); });
      bub.appendChild(x);
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
