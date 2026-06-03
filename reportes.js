/* ═══════════════════════════════════════════════════════════════════════════
   reportes.js — Módulo "Reportes do Dentista" (App COR) — FASE 4
   ───────────────────────────────────────────────────────────────────────────
   Aba ADMIN-ONLY "🚩 Reportes". Mostra os reportes que os dentistas abrem no
   FotonWeb (DICOM incompleto, cortes adicionais, medidas, exame faltando, sem
   laudo, sugestão, outro) e deixa o admin gerenciar o status.

   Pipeline completo do módulo:
     Fase 1 (Supabase)   : tabela public.reportes_dentista + RLS + Realtime
     Fase 2 (FotonWeb)   : POST /api/dentista/reportar-exame  (backend)
     Fase 3 (FotonWeb)   : botão 🚩 + modal no frontend do FotonWeb
     Fase 4 (App COR)    : ESTE ARQUIVO — inbox admin + Realtime/som/toast/badge

   COMO SE LIGA NO index.html (NÃO remover esses hooks):
     • Nav      : <button data-p="reportes"> + <span id="rpNavBadge">
     • PERMS    : admin.reportes = 1 (demais roles = 0)
     • Página   : <div class="page" id="page-reportes"><div id="pgRp">
     • navTo map: reportes: window.rReportes
     • Login    : REPORTES.onLogin()  em doLoginSupa e restaurarSessao
     • Logout   : REPORTES.onLogout() em doLogoutSupa
     • Script   : <script src="reportes.js"></script> (depois do supabase-js)

   DEPENDÊNCIAS GLOBAIS (definidas no index.html):
     supa (client supabase-js v2, com sessão), supaFetch (REST autenticado),
     CU (usuário logado), toast(ico,msg).

   ⚠️ reportes_dentista.dentista_id é FK -> dentistas.id (id Supabase), NÃO
      firebird_id. Quem resolve isso é o FotonWeb na hora do INSERT (Fase 2).
      Aqui a gente só LÊ/ATUALIZA, então não precisa resolver nada.

   REALTIME: usa supa.channel(...).on('postgres_changes', {event:'INSERT'}).
   A RLS de SELECT da tabela é admin-only; por isso setamos o JWT do usuário
   no realtime via supa.realtime.setAuth(token) antes de assinar. Só o admin
   chama onLogin(), então só o admin assina.

   HISTÓRICO:
     2026-06-02 v1 — Criação. Inbox + filtros + ações + Realtime/som/toast/badge.
                     v1 SEM anexos (coluna anexos existe mas não é exibida ainda).
     2026-06-02 v2 — Fase 5: respostas pré-definidas. Botões de status trocados
                     por seletor de resposta (RESP) + observação; a resposta
                     define o status. Grava resposta_tipo + resolucao. O dentista
                     vê a resposta no FotonWeb (GET /api/dentista/meus-reportes).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ───────── Estado do módulo ─────────
  var _channel = null;     // canal Realtime (null = não assinado)
  var _rtStarting = false; // trava síncrona: assinatura em andamento (anti-duplicata)
  var _rtRetries = 0;      // tentativas consecutivas de reconexão (backoff)
  var _rtRetryTimer = null;// timer da reconexão agendada (null = nenhuma)
  var _list = [];          // reportes carregados (filtro atual)
  var _filter = "aberto";  // aberto | em_andamento | resolvido | descartado | todos
  var _badge = 0;          // contador de reportes 'aberto' (badge da nav)
  var _actx = null;        // AudioContext (lazy)
  var _cssInjected = false;

  // ───────── Catálogos (espelham os CHECKs da tabela / backend) ─────────
  var CAT = {
    dicom_incompleto:  { l: "DICOM incompleto",   i: "🧬" },
    cortes_adicionais: { l: "Cortes adicionais",  i: "✂️" },
    medidas:           { l: "Medidas",            i: "📐" },
    exame_faltando:    { l: "Exame faltando",     i: "❓" },
    sem_laudo:         { l: "Sem laudo",          i: "📄" },
    sugestao:          { l: "Sugestão",           i: "💡" },
    outro:             { l: "Outro",              i: "•" }
  };
  var ST = {
    aberto:       { l: "Aberto",       c: "#dc2626", bg: "#fee2e2" },
    em_andamento: { l: "Em andamento", c: "#b45309", bg: "#fef3c7" },
    resolvido:    { l: "Resolvido",    c: "#15803d", bg: "#dcfce7" },
    descartado:   { l: "Descartado",   c: "#6b7280", bg: "#f3f4f6" }
  };
  var FILTROS = ["aberto", "em_andamento", "resolvido", "descartado", "todos"];
  var FILTRO_LBL = {
    aberto: "Abertos", em_andamento: "Em andamento", resolvido: "Resolvidos",
    descartado: "Descartados", todos: "Todos"
  };

  // Respostas pré-definidas (Fase 5). Cada uma define o STATUS resultante.
  // 'outro' = texto livre, e o admin escolhe o status manualmente.
  // resposta_tipo bate com o CHECK da coluna no Supabase e com o backend.
  var RESP = {
    solucionado:   { l: "✅ Solucionado",          status: "resolvido" },
    reenviado:     { l: "📤 Reenviado",            status: "resolvido" },
    laudo_anexado: { l: "📋 Laudo anexado",        status: "resolvido" },
    em_avaliacao:  { l: "🔄 Em avaliação",         status: "em_andamento" },
    improcedente:  { l: "❌ Improcedente",          status: "descartado" },
    outro:         { l: "✏️ Outro (texto livre)",  status: null }
  };
  var RESP_ORDER = ["solucionado", "reenviado", "laudo_anexado", "em_avaliacao", "improcedente", "outro"];

  // ───────── Helpers locais (auto-contidos, não dependem do index) ─────────
  function esc(s) {
    s = (s == null) ? "" : String(s);
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    var p = String(iso).split("T")[0].split("-");
    if (p.length !== 3) return String(iso);
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function fmtDateTime(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return fmtDate(iso);
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function isAdmin() {
    return !!(window.CU && window.CU.role === "admin");
  }
  function notify(ico, msg) {
    if (typeof window.toast === "function") window.toast(ico, msg);
  }

  // ───────── Som (WebAudio, sem arquivo externo) ─────────
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!_actx) _actx = new Ctx();
      if (_actx.state === "suspended" && _actx.resume) _actx.resume();
      var now = _actx.currentTime;
      [880, 1175].forEach(function (f, i) {
        var o = _actx.createOscillator(), g = _actx.createGain();
        o.type = "sine"; o.frequency.value = f;
        o.connect(g); g.connect(_actx.destination);
        var t = now + i * 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.start(t); o.stop(t + 0.17);
      });
    } catch (e) { /* áudio bloqueado pelo navegador — toast+badge cobrem */ }
  }

  // ───────── CSS (injetado uma vez) ─────────
  function injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;
    var css =
      ".rp-nav-badge{display:inline-flex;align-items:center;justify-content:center;" +
      "min-width:18px;height:18px;padding:0 5px;margin-left:6px;border-radius:9px;" +
      "background:#dc2626;color:#fff;font-size:.68rem;font-weight:700;line-height:1;" +
      "vertical-align:middle}" +
      ".rp-wrap{max-width:980px;margin:0 auto}" +
      ".rp-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}" +
      ".rp-head h2{margin:0;font-size:1.15rem}" +
      ".rp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}" +
      ".rp-tab{padding:6px 12px;border-radius:999px;border:1px solid var(--border,#e5e7eb);" +
      "background:#fff;color:#374151;font-size:.8rem;font-weight:600;cursor:pointer}" +
      ".rp-tab.active{background:#1e5eb8;color:#fff;border-color:#1e5eb8}" +
      ".rp-refresh{padding:6px 12px;border-radius:8px;border:1px solid var(--border,#e5e7eb);" +
      "background:#fff;cursor:pointer;font-size:.8rem}" +
      ".rp-card{background:#fff;border:1px solid var(--border,#e5e7eb);border-left:4px solid #dc2626;" +
      "border-radius:10px;padding:14px 16px;margin-bottom:10px}" +
      ".rp-card .rp-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}" +
      ".rp-cat{font-weight:700;font-size:.95rem}" +
      ".rp-stbadge{padding:2px 9px;border-radius:999px;font-size:.7rem;font-weight:700}" +
      ".rp-when{color:#6b7280;font-size:.75rem;margin-left:auto}" +
      ".rp-meta{color:#374151;font-size:.82rem;margin-bottom:8px;display:flex;gap:16px;flex-wrap:wrap}" +
      ".rp-meta b{color:#111827}" +
      ".rp-desc{background:#f9fafb;border-radius:8px;padding:10px 12px;font-size:.88rem;" +
      "line-height:1.5;white-space:pre-wrap;color:#1f2937;margin-bottom:10px}" +
      ".rp-reso{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 12px;" +
      "font-size:.8rem;color:#166534;margin-bottom:10px}" +
      ".rp-acts{display:flex;gap:7px;flex-wrap:wrap}" +
      ".rp-resp{display:flex;gap:7px;flex-wrap:wrap;align-items:center;width:100%}" +
      ".rp-sel{padding:7px 10px;border:1px solid var(--border,#e5e7eb);border-radius:7px;" +
      "font-size:.82rem;background:#fff;color:#1f2937}" +
      ".rp-obs{flex:1;min-width:180px;padding:7px 10px;border:1px solid var(--border,#e5e7eb);" +
      "border-radius:7px;font-size:.82rem;color:#1f2937}" +
      ".rp-obs:focus,.rp-sel:focus{outline:none;border-color:#1e5eb8}" +
      ".rp-btn{padding:6px 12px;border-radius:7px;border:none;cursor:pointer;font-size:.78rem;font-weight:600}" +
      ".rp-btn.b-prog{background:#fef3c7;color:#b45309}" +
      ".rp-btn.b-ok{background:#1e5eb8;color:#fff}" +
      ".rp-btn.b-desc{background:#f3f4f6;color:#4b5563}" +
      ".rp-btn.b-reab{background:#fff;color:#1e5eb8;border:1px solid #1e5eb8}" +
      ".rp-empty{text-align:center;padding:48px 16px;color:#6b7280}" +
      ".rp-empty .ic{font-size:2.4rem;margin-bottom:8px}";
    var s = document.createElement("style");
    s.id = "rp-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ───────── Badge da nav (contagem de 'aberto') ─────────
  function setBadgeUI(n) {
    var el = document.getElementById("rpNavBadge");
    if (!el) return;
    if (n > 0) {
      el.textContent = String(n);
      el.style.display = "inline-flex";
    } else {
      el.style.display = "none";
    }
  }
  function refreshBadge() {
    if (!isAdmin()) return;
    // Busca os ids dos reportes 'aberto' e conta pelo tamanho da lista.
    // (P3-4) NÃO usamos Range:0-0 — com count via header, se o Content-Range
    // não vier exposto o fallback contaria só a 1 linha trazida. Sem Range,
    // o corpo traz todos os ids abertos (conjunto pequeno por definição),
    // então rows.length é sempre correto.
    supaFetch("/rest/v1/reportes_dentista?select=id&status=eq.aberto", {
      method: "GET"
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (rows) {
      _badge = (rows || []).length;
      setBadgeUI(_badge);
    }).catch(function (e) { console.warn("refreshBadge:", e && e.message); });
  }

  // ───────── Realtime ─────────
  function onInsert(payload) {
    var row = (payload && payload.new) || {};
    var cat = CAT[row.categoria] || { l: row.categoria || "Reporte", i: "🚩" };
    var quem = row.dentista_nome || "Dentista";
    var pac = row.paciente_nome ? (" — " + row.paciente_nome) : "";
    notify("🚩", "Novo reporte: " + cat.l + pac + " (" + quem + ")");
    beep();
    refreshBadge();
    // Se a aba Reportes está aberta e o filtro inclui 'aberto', recarrega a lista
    var pg = document.getElementById("page-reportes");
    if (pg && pg.classList.contains("active") && (_filter === "aberto" || _filter === "todos")) {
      loadList();
    }
  }

  // (P3) Agenda nova tentativa de assinatura com backoff exponencial.
  // Só dispara para falhas transitórias (CHANNEL_ERROR/TIMED_OUT), nunca para
  // CLOSED — fechamento normal acontece no teardown (logout) e não deve
  // reconectar. initRealtime() revalida isAdmin() no momento de disparar.
  var RT_MAX_DELAY = 30000;
  function scheduleRetry() {
    if (_rtRetryTimer || !isAdmin()) return;
    var delay = Math.min(RT_MAX_DELAY, 1000 * Math.pow(2, Math.min(_rtRetries, 5)));
    _rtRetries++;
    console.warn("[REPORTES] Reagendando Realtime em " + delay + "ms (tentativa " + _rtRetries + ").");
    _rtRetryTimer = setTimeout(function () {
      _rtRetryTimer = null;
      initRealtime();
    }, delay);
  }

  function initRealtime() {
    // _channel: já assinado. _rtStarting: assinatura em voo (a atribuição de
    // _channel só acontece dentro do .then() async, então sem esta trava
    // síncrona duas chamadas quase simultâneas — onLogin() + render() —
    // abririam dois canais → toast/som duplicados. (P2-1)
    if (_channel || _rtStarting || !isAdmin() || !window.supa) return;
    _rtStarting = true;
    // Autoriza o canal com o JWT do usuário (RLS de SELECT é admin-only)
    supa.auth.getSession().then(function (s) {
      var tok = s && s.data && s.data.session && s.data.session.access_token;
      if (tok) { try { supa.realtime.setAuth(tok); } catch (e) {} }
      _channel = supa.channel("reportes_dentista_stream")
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "reportes_dentista" },
          onInsert)
        .subscribe(function (status) {
          if (status === "SUBSCRIBED") {
            _rtRetries = 0; // reconectou: zera backoff
            console.log("[REPORTES] Realtime assinado.");
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            // (P3) Canal quebrou. Sem isto, _channel ficava preenchido e o
            // guard de initRealtime barrava qualquer nova tentativa pra sempre.
            // Remove o canal morto, libera as travas e reagenda com backoff.
            console.warn("[REPORTES] Realtime status:", status, "— recriando canal.");
            try { if (_channel && window.supa) supa.removeChannel(_channel); } catch (e) {}
            _channel = null;
            _rtStarting = false;
            scheduleRetry();
          }
        });
      _rtStarting = false;
    }).catch(function (e) {
      _rtStarting = false;
      console.warn("[REPORTES] initRealtime:", e && e.message);
      scheduleRetry();
    });
  }

  function teardownRealtime() {
    if (_rtRetryTimer) { clearTimeout(_rtRetryTimer); _rtRetryTimer = null; }
    _rtRetries = 0;
    if (_channel && window.supa) {
      try { supa.removeChannel(_channel); } catch (e) {}
    }
    _channel = null;
    _rtStarting = false;
    _badge = 0;
    setBadgeUI(0);
  }

  // ───────── Carregar / renderizar lista ─────────
  function loadList() {
    var pg = document.getElementById("pgRp");
    if (!pg) return;
    var q = "/rest/v1/reportes_dentista?select=*&order=created_at.desc&limit=300";
    if (_filter !== "todos") q += "&status=eq." + _filter;
    var listEl = document.getElementById("rpList");
    if (listEl) listEl.innerHTML = '<div class="rp-empty">Carregando…</div>';
    supaFetch(q, { method: "GET" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (rows) {
        _list = rows || [];
        renderList();
      })
      .catch(function (e) {
        if (listEl) listEl.innerHTML =
          '<div class="rp-empty">Erro ao carregar: ' + esc(e.message) + "</div>";
      });
  }

  function cardHTML(r) {
    var cat = CAT[r.categoria] || { l: r.categoria || "—", i: "🚩" };
    var st = ST[r.status] || { l: r.status || "—", c: "#6b7280", bg: "#f3f4f6" };
    var h = '<div class="rp-card" style="border-left-color:' + st.c + '">';
    h += '<div class="rp-top">';
    h += '<span class="rp-cat">' + cat.i + " " + esc(cat.l) + "</span>";
    h += '<span class="rp-stbadge" style="background:' + st.bg + ";color:" + st.c + '">' + esc(st.l) + "</span>";
    h += '<span class="rp-when">' + fmtDateTime(r.created_at) + "</span>";
    h += "</div>";
    h += '<div class="rp-meta">';
    h += "<span>Paciente: <b>" + esc(r.paciente_nome || "—") + "</b></span>";
    h += "<span>Dentista: <b>" + esc(r.dentista_nome || "—") + "</b></span>";
    if (r.fb_seq_atend) h += "<span>SEQ: <b>" + esc(r.fb_seq_atend) + "</b></span>";
    if (r.data_exame) h += "<span>Exame: <b>" + fmtDate(r.data_exame) + "</b></span>";
    h += "</div>";
    h += '<div class="rp-desc">' + esc(r.descricao || "") + "</div>";
    // Resposta já dada (status resolvido/descartado/em_andamento com resposta)
    if (r.resposta_tipo || r.resolucao) {
      var rl = RESP[r.resposta_tipo] ? RESP[r.resposta_tipo].l : "";
      h += '<div class="rp-reso">';
      h += "✓ Resposta: <b>" + esc(rl || "—") + "</b>";
      if (r.resolucao) h += " — " + esc(r.resolucao);
      if (r.resolvido_por) h += ' <span style="opacity:.7">(' + esc(r.resolvido_por) + ")</span>";
      h += "</div>";
    }
    h += '<div class="rp-acts">';
    if (r.status === "aberto" || r.status === "em_andamento") {
      // Form de resposta (2a): select de resposta + obs + (status só p/ "outro") + Responder
      var sid = "resp-" + r.id, oid = "respobs-" + r.id, stid = "respst-" + r.id;
      h += '<div class="rp-resp">';
      h += '<select class="rp-sel" id="' + sid + '" onchange="REPORTES.onRespChange(' + r.id + ')">';
      h += '<option value="">— Responder ao dentista —</option>';
      for (var i = 0; i < RESP_ORDER.length; i++) {
        var k = RESP_ORDER[i];
        h += '<option value="' + k + '">' + esc(RESP[k].l) + "</option>";
      }
      h += "</select>";
      // status manual (só aparece quando resposta = "outro")
      h += '<select class="rp-sel rp-sel-st" id="' + stid + '" style="display:none">';
      h += '<option value="em_andamento">Marcar: Em andamento</option>';
      h += '<option value="resolvido">Marcar: Resolvido</option>';
      h += '<option value="descartado">Marcar: Descartado</option>';
      h += "</select>";
      h += '<input class="rp-obs" id="' + oid + '" maxlength="500" placeholder="Observação (opcional) — o dentista vê">';
      h += '<button class="rp-btn b-ok" onclick="REPORTES.responder(' + r.id + ')">Responder</button>';
      h += "</div>";
    } else {
      // resolvido / descartado: reabrir (a resposta dada aparece acima)
      h += '<button class="rp-btn b-reab" onclick="REPORTES.reabrir(' + r.id + ')">↺ Reabrir</button>';
    }
    h += "</div>";
    h += "</div>";
    return h;
  }

  function renderList() {
    var listEl = document.getElementById("rpList");
    if (!listEl) return;
    if (!_list.length) {
      listEl.innerHTML = '<div class="rp-empty"><div class="ic">📭</div>' +
        "Nenhum reporte " +
        (_filter === "todos" ? "ainda." : "com status “" + (FILTRO_LBL[_filter] || _filter) + "”.") +
        "</div>";
      return;
    }
    listEl.innerHTML = _list.map(cardHTML).join("");
  }

  function tabsHTML() {
    return FILTROS.map(function (f) {
      return '<button class="rp-tab' + (f === _filter ? " active" : "") +
        '" onclick="REPORTES.setFilter(\'' + f + '\')">' + esc(FILTRO_LBL[f]) + "</button>";
    }).join("");
  }

  // window.rReportes — chamado pelo navTo map quando o admin abre a aba
  function render() {
    injectCSS();
    var pg = document.getElementById("pgRp");
    if (!pg) return;
    if (!isAdmin()) {
      pg.innerHTML = '<div class="rp-empty"><div class="ic">🔒</div>Área restrita ao administrador.</div>';
      return;
    }
    pg.innerHTML =
      '<div class="rp-wrap">' +
      '<div class="rp-head">' +
      "<h2>🚩 Reportes dos Dentistas</h2>" +
      '<button class="rp-refresh" onclick="REPORTES.reload()">↻ Atualizar</button>' +
      '<div class="rp-tabs">' + tabsHTML() + "</div>" +
      "</div>" +
      '<div id="rpList"></div>' +
      "</div>";
    loadList();
    refreshBadge();
    initRealtime(); // garante assinatura caso a aba seja a primeira coisa aberta
  }

  // ───────── Ações ─────────
  function setFilter(f) {
    _filter = f;
    // Atualiza tabs sem re-render completo
    var tabs = document.querySelectorAll(".rp-tab");
    tabs.forEach(function (t) { t.classList.remove("active"); });
    var idx = FILTROS.indexOf(f);
    if (idx >= 0 && tabs[idx]) tabs[idx].classList.add("active");
    loadList();
  }

  function patchReporte(id, body) {
    if (!isAdmin()) return;
    // resolvido_at é gerenciado por trigger no Supabase — não enviar daqui.
    supaFetch("/rest/v1/reportes_dentista?id=eq." + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      notify("✓", "Resposta enviada ao dentista.");
      loadList();
      refreshBadge();
    }).catch(function (e) {
      notify("⚠️", "Erro ao atualizar: " + (e && e.message));
    });
  }

  // mostra/esconde o seletor de status quando a resposta é "Outro"
  function onRespChange(id) {
    var sel = document.getElementById("resp-" + id);
    var stSel = document.getElementById("respst-" + id);
    if (!sel || !stSel) return;
    stSel.style.display = (sel.value === "outro") ? "" : "none";
  }

  function responder(id) {
    if (!isAdmin()) return;
    var sel = document.getElementById("resp-" + id);
    var obs = document.getElementById("respobs-" + id);
    var stSel = document.getElementById("respst-" + id);
    if (!sel) return;
    var tipo = sel.value;
    if (!tipo) { notify("⚠️", "Escolha uma resposta."); return; }

    var nota = obs ? obs.value.trim() : "";
    var status;
    if (tipo === "outro") {
      status = stSel ? stSel.value : "em_andamento";
      if (!nota) { notify("⚠️", 'Na resposta "Outro", escreva a observação.'); return; }
    } else {
      status = RESP[tipo] ? RESP[tipo].status : "em_andamento";
    }

    var body = { status: status, resposta_tipo: tipo, resolucao: nota || null };
    if (status === "resolvido" || status === "descartado") {
      body.resolvido_por = (window.CU && window.CU.nome) || "admin";
    } else {
      body.resolvido_por = null;
    }
    patchReporte(id, body);
  }

  function reabrir(id) {
    if (!isAdmin()) return;
    patchReporte(id, { status: "aberto", resposta_tipo: null, resolucao: null, resolvido_por: null });
  }

  function reload() { loadList(); refreshBadge(); }

  // ───────── Ciclo de vida (chamado pelo index.html) ─────────
  function onLogin() {
    if (!isAdmin()) return;
    injectCSS();
    initRealtime();
    refreshBadge();
  }
  function onLogout() {
    teardownRealtime();
  }

  // ───────── Exporta ─────────
  window.rReportes = render;          // referenciado pelo navTo map
  window.REPORTES = {
    onLogin: onLogin,
    onLogout: onLogout,
    render: render,
    reload: reload,
    setFilter: setFilter,
    responder: responder,
    reabrir: reabrir,
    onRespChange: onRespChange,
    refreshBadge: refreshBadge
  };
})();
