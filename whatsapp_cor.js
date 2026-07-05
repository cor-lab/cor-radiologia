/* ═══════════════════════════════════════════════════════════════════════
   whatsapp_cor.js — Aba "💬 WhatsApp" do App COR
   VERSÃO: FASE C (v3) — 2026-07-05 — atendimento humano completo

   Fase A: monitor (conversas + fila).
   Fase B: fila acionável (assumir/resolver/reabrir, agrupada por número).
   Fase C: assumir conversa (pausa a CORA), responder o paciente pela CORA,
           devolver para a CORA. Chama o bot (wa.corsm.com.br) com JWT do usuário.

   Padrão espelhado de reportes.js:
     - namespace global WHATSAPP
     - função window.rWhatsApp() chamada pelo navTo map
     - leitura e escrita via supaFetch(...) (JWT auth, RLS libera)
     - Fase C via fetch autenticado ao bot (modo_humano / enviar_manual)

   Tabelas: conversas (numero, historico, atualizado_em, modo_humano),
            atendimento_humano (numero, ultima_msg, criado_em, resolvido, ...).
   ═══════════════════════════════════════════════════════════════════════ */
var WHATSAPP = (function () {
  "use strict";

  var _VERSAO = "fase-c-v4-autorefresh-20260705";  // marcador: confira no console com WHATSAPP.versao
  var _convs = [];        // lista de conversas carregadas
  var _fila = [];         // escalações (conforme filtro)
  var _filaAgrupada = []; // fila agrupada por número (1 por paciente)
  var _sel = null;        // numero da conversa aberta
  var _carregando = false;
  var _filtroFila = "pendente";  // pendente | atendimento | resolvido
  var _cu = null;         // usuário logado (nome para auditoria)

  // ── util ──
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtHora(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      return d.toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return ""; }
  }

  // formata numero wa_id (5555999750603) -> +55 (55) 99975-0603 (best-effort)
  function fmtNumero(n) {
    var d = String(n || "").replace(/\D/g, "");
    if (d.length >= 12 && d.slice(0, 2) === "55") {
      var ddd = d.slice(2, 4);
      var resto = d.slice(4);
      if (resto.length === 9) return "(" + ddd + ") " + resto.slice(0, 5) + "-" + resto.slice(5);
      if (resto.length === 8) return "(" + ddd + ") " + resto.slice(0, 4) + "-" + resto.slice(4);
    }
    return n;
  }

  function ultimaMsg(hist) {
    if (!Array.isArray(hist) || !hist.length) return "";
    var last = hist[hist.length - 1];
    var c = last && last.content ? String(last.content) : "";
    return c.length > 60 ? c.slice(0, 60) + "…" : c;
  }

  // ── carregamento ──
  async function carregar() {
    if (_carregando) return;
    _carregando = true;
    try {
      var cRes = await supaFetch("/rest/v1/conversas?select=numero,historico,atualizado_em,modo_humano,humano_por&order=atualizado_em.desc&limit=100");
      _convs = cRes.ok ? (await cRes.json()) : [];

      var filtro;
      if (_filtroFila === "pendente") {
        filtro = "resolvido=eq.false&em_atendimento=eq.false";
      } else if (_filtroFila === "atendimento") {
        filtro = "resolvido=eq.false&em_atendimento=eq.true";
      } else {
        filtro = "resolvido=eq.true";
      }
      var fRes = await supaFetch("/rest/v1/atendimento_humano?select=id,numero,ultima_msg,criado_em,resolvido,em_atendimento,atendido_por,resolvido_em,resolvido_por&" + filtro + "&order=criado_em.desc&limit=200");
      _fila = fRes.ok ? (await fRes.json()) : [];
      _filaAgrupada = _agrupar(_fila);
    } catch (e) {
      console.error("WHATSAPP carregar:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao carregar conversas");
    } finally {
      _carregando = false;
    }
  }

  // Agrupa a fila por número: 1 entrada por paciente, com a mais recente + ids do grupo.
  function _agrupar(lista) {
    var mapa = {};
    var ordem = [];
    (lista || []).forEach(function (it) {
      var k = it.numero || "?";
      if (!mapa[k]) {
        mapa[k] = {
          numero: it.numero,
          ultima_msg: it.ultima_msg,      // a mais recente (lista já vem desc)
          criado_em: it.criado_em,
          em_atendimento: it.em_atendimento,
          atendido_por: it.atendido_por,
          resolvido: it.resolvido,
          resolvido_por: it.resolvido_por,
          resolvido_em: it.resolvido_em,
          ids: [it.id],
          qtd: 1
        };
        ordem.push(k);
      } else {
        mapa[k].ids.push(it.id);
        mapa[k].qtd += 1;
        // se qualquer uma do grupo está em atendimento, marca o grupo
        if (it.em_atendimento) { mapa[k].em_atendimento = true; mapa[k].atendido_por = mapa[k].atendido_por || it.atendido_por; }
      }
    });
    return ordem.map(function (k) { return mapa[k]; });
  }

  // conta pendentes reais (para o card de resumo), independente do filtro atual
  var _nPendentes = 0;
  var _nAtend = 0;
  var _nResolv = 0;
  async function contarPendentes() {
    async function cont(filtro) {
      try {
        var r = await supaFetch("/rest/v1/atendimento_humano?select=id&" + filtro, {
          method: "GET", headers: { "Prefer": "count=exact" }
        });
        var cr = r.headers.get("content-range");
        if (cr && cr.indexOf("/") >= 0) return parseInt(cr.split("/")[1], 10) || 0;
        var arr = r.ok ? (await r.json()) : [];
        return arr.length;
      } catch (e) { return 0; }
    }
    _nPendentes = await cont("resolvido=eq.false&em_atendimento=eq.false");
    _nAtend = await cont("resolvido=eq.false&em_atendimento=eq.true");
    _nResolv = await cont("resolvido=eq.true");
  }

  // ── ações (Fase B) ──
  function _quemSou() {
    try {
      if (typeof CU !== "undefined" && CU) return CU.nome || CU.email || CU.login || "recepção";
    } catch (e) {}
    return "recepção";
  }

  async function _patchNumero(numero, body, filtroExtra) {
    // aplica a TODAS as escalações daquele número (grupo do paciente)
    var q = "numero=eq." + encodeURIComponent(numero);
    if (filtroExtra) q += "&" + filtroExtra;
    var r = await supaFetch("/rest/v1/atendimento_humano?" + q, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      var txt = "";
      try { txt = await r.text(); } catch (e) {}
      throw new Error("HTTP " + r.status + " " + txt);
    }
  }

  async function assumir(numero) {
    try {
      // assume as pendentes (não resolvidas) daquele número
      await _patchNumero(numero, { em_atendimento: true, atendido_por: _quemSou() }, "resolvido=eq.false");
      if (typeof toast === "function") toast("👋", "Assumido — veja em 'Em atendimento'");
      await _refresh();
    } catch (e) {
      console.error("assumir:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao assumir");
    }
  }

  async function resolver(numero) {
    try {
      // resolve TODAS as não-resolvidas daquele número
      await _patchNumero(numero, { resolvido: true, em_atendimento: false,
                         resolvido_em: new Date().toISOString(), resolvido_por: _quemSou() }, "resolvido=eq.false");
      if (typeof toast === "function") toast("✅", "Resolvido — veja em 'Resolvidas'");
      await _refresh();
    } catch (e) {
      console.error("resolver:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao resolver");
    }
  }

  async function reabrir(numero) {
    try {
      // reabre as resolvidas daquele número
      await _patchNumero(numero, { resolvido: false, em_atendimento: false,
                         resolvido_em: null, resolvido_por: null }, "resolvido=eq.true");
      if (typeof toast === "function") toast("↩️", "Reaberto");
      await _refresh();
    } catch (e) {
      console.error("reabrir:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao reabrir");
    }
  }

  async function _refresh() { await carregar(); await contarPendentes(); render(); }

  // ── Fase C: atendimento humano (chama o bot na VM com o JWT do usuário) ──
  var _BOT_URL = "https://wa.corsm.com.br";

  async function _jwt() {
    // pega o token do usuário logado (mesma sessão do supaFetch)
    try {
      var s = await supa.auth.getSession();
      return s && s.data && s.data.session ? s.data.session.access_token : null;
    } catch (e) { return null; }
  }

  async function _chamarBot(rota, corpo) {
    var jwt = await _jwt();
    if (!jwt) { if (typeof toast === "function") toast("⚠️", "Sessão expirada, refaça login"); return null; }
    var r = await fetch(_BOT_URL + rota, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
      body: JSON.stringify(corpo)
    });
    return r;
  }

  async function assumirConversa() {
    if (!_sel) return;
    try {
      var r = await _chamarBot("/modo_humano", { numero: _sel, ativar: true, atendente: _quemSou() });
      if (r && r.ok) {
        if (typeof toast === "function") toast("🙋", "Você assumiu — CORA pausada");
        await _refresh();
      } else {
        var t = r ? await r.text() : "";
        console.error("assumirConversa:", r && r.status, t);
        if (typeof toast === "function") toast("⚠️", "Falha ao assumir (HTTP " + (r ? r.status : "?") + ")");
      }
    } catch (e) {
      console.error("assumirConversa:", e);
      if (typeof toast === "function") toast("⚠️", "Erro ao assumir");
    }
  }

  async function devolverCora() {
    if (!_sel) return;
    try {
      var r = await _chamarBot("/modo_humano", { numero: _sel, ativar: false });
      if (r && r.ok) {
        if (typeof toast === "function") toast("↩️", "Devolvido para a CORA");
        await _refresh();
      } else {
        if (typeof toast === "function") toast("⚠️", "Falha ao devolver");
      }
    } catch (e) {
      console.error("devolverCora:", e);
    }
  }

  async function enviarResposta() {
    if (!_sel) return;
    var ta = document.getElementById("waResp");
    var texto = ta ? ta.value.trim() : "";
    if (!texto) { if (typeof toast === "function") toast("✍️", "Digite uma mensagem"); return; }
    try {
      var r = await _chamarBot("/enviar_manual", { numero: _sel, texto: texto, atendente: _quemSou() });
      if (r && r.ok) {
        if (ta) ta.value = "";
        if (typeof toast === "function") toast("✅", "Enviado ao paciente");
        await _refresh();
      } else {
        var t = r ? await r.text() : "";
        console.error("enviarResposta:", r && r.status, t);
        if (typeof toast === "function") toast("⚠️", "Falha ao enviar (HTTP " + (r ? r.status : "?") + ")");
      }
    } catch (e) {
      console.error("enviarResposta:", e);
      if (typeof toast === "function") toast("⚠️", "Erro ao enviar");
    }
  }

  function setFiltro(f) { _filtroFila = f; _refresh(); }

  // ── render ──
  function render() {
    var el = document.getElementById("pgWa");
    if (!el) return;

    var h = "";

    // resumo topo
    h += "<div class='sr' style='margin-bottom:14px'>";
    h += "<div class='card' style='flex:1'><div class='ctitle'>💬 Conversas</div>";
    h += "<div style='font-size:1.6rem;font-weight:700'>" + _convs.length + "</div></div>";
    h += "<div class='card' style='flex:1'><div class='ctitle'>🔔 Escalações pendentes</div>";
    h += "<div style='font-size:1.6rem;font-weight:700;color:" + (_nPendentes ? "var(--r)" : "var(--g)") + "'>" + _nPendentes + "</div></div>";
    h += "<div class='card' style='flex:1;display:flex;align-items:center;justify-content:center'>";
    h += "<button class='btn btng' onclick='WHATSAPP.refresh()'>↻ Atualizar</button></div>";
    h += "</div>";

    // fila de escalações com filtros + ações
    h += "<div class='card' style='margin-bottom:14px'>";
    h += "<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px'>";
    h += "<div class='ctitle'>🔔 Escalações para a recepção</div>";
    // seletor de filtro
    var abas = [["pendente","Pendentes",_nPendentes],["atendimento","Em atendimento",_nAtend],["resolvido","Resolvidas",_nResolv]];
    h += "<div style='display:flex;gap:6px'>";
    abas.forEach(function (a) {
      var on = _filtroFila === a[0];
      h += "<button onclick=\"WHATSAPP.setFiltro('" + a[0] + "')\" class='btn' style='padding:4px 10px;font-size:.78rem;" +
           (on ? "background:var(--ac,#4ab848);color:#fff" : "background:transparent;color:var(--gr)") + "'>" + a[1] + " (" + a[2] + ")</button>";
    });
    h += "</div></div>";

    if (!_filaAgrupada.length) {
      h += "<div style='padding:18px;text-align:center;color:var(--gr)'>Nenhum item nesta lista.</div>";
    } else {
      h += "<table style='width:100%;font-size:.85rem;margin-top:8px'><thead><tr>";
      h += "<th style='text-align:left'>Número</th><th style='text-align:left'>Mensagem / Pedido</th><th>Quando</th><th>Ações</th>";
      h += "</tr></thead><tbody>";
      _filaAgrupada.forEach(function (f) {
        var nQ = f.qtd || 1;
        h += "<tr>";
        h += "<td style='font-family:DM Mono,monospace;white-space:nowrap'>" + esc(fmtNumero(f.numero));
        if (nQ > 1) h += "<div style='font-size:.7rem;color:var(--ac,#4ab848)'>" + nQ + " pedidos</div>";
        h += "</td>";
        h += "<td>" + esc(f.ultima_msg || "");
        if (f.em_atendimento && f.atendido_por) {
          h += "<div style='font-size:.72rem;color:var(--ac,#4ab848);margin-top:2px'>👋 em atendimento por " + esc(f.atendido_por) + "</div>";
        }
        if (f.resolvido && f.resolvido_por) {
          h += "<div style='font-size:.72rem;color:var(--gr);margin-top:2px'>✅ resolvido por " + esc(f.resolvido_por) + " em " + esc(fmtHora(f.resolvido_em)) + "</div>";
        }
        h += "</td>";
        h += "<td style='white-space:nowrap;color:var(--gr)'>" + esc(fmtHora(f.criado_em)) + "</td>";
        h += "<td style='white-space:nowrap'>";
        // número entre aspas DUPLAS escapadas (o onclick usa aspas simples;
        // usar aspas simples aqui fecharia o onclick e quebraria o JS).
        var numJs = "&quot;" + String(f.numero).replace(/"/g, "") + "&quot;";
        if (_filtroFila === "pendente") {
          h += "<button class='btn' style='padding:4px 8px;font-size:.75rem;margin-right:4px' onclick='WHATSAPP.assumir(" + numJs + ")'>Assumir</button>";
          h += "<button class='btn btng' style='padding:4px 8px;font-size:.75rem' onclick='WHATSAPP.resolver(" + numJs + ")'>Resolver</button>";
        } else if (_filtroFila === "atendimento") {
          h += "<button class='btn btng' style='padding:4px 8px;font-size:.75rem' onclick='WHATSAPP.resolver(" + numJs + ")'>Resolver</button>";
        } else { // resolvido
          h += "<button class='btn' style='padding:4px 8px;font-size:.75rem' onclick='WHATSAPP.reabrir(" + numJs + ")'>Reabrir</button>";
        }
        h += "</td>";
        h += "</tr>";
      });
      h += "</tbody></table>";
    }
    h += "</div>";

    // layout 2 colunas: lista + conversa aberta
    h += "<div style='display:flex;gap:14px;align-items:flex-start'>";

    // coluna esquerda: lista de conversas
    h += "<div class='card' style='flex:0 0 320px;max-height:70vh;overflow:auto'>";
    h += "<div class='ctitle'>Conversas recentes</div>";
    if (!_convs.length) {
      h += "<div style='padding:18px;text-align:center;color:var(--gr)'>Nenhuma conversa ainda.</div>";
    } else {
      _convs.forEach(function (c) {
        var ativo = c.numero === _sel;
        h += "<div onclick=\"WHATSAPP.abrir('" + esc(c.numero) + "')\" style='padding:10px;border-radius:8px;cursor:pointer;margin-bottom:6px;background:" + (ativo ? "var(--bg2,#eef)" : "transparent") + "'>";
        h += "<div style='display:flex;justify-content:space-between;gap:8px'>";
        h += "<strong style='font-size:.85rem'>" + esc(fmtNumero(c.numero)) + "</strong>";
        h += "<span style='font-size:.7rem;color:var(--gr);white-space:nowrap'>" + esc(fmtHora(c.atualizado_em)) + "</span>";
        h += "</div>";
        h += "<div style='font-size:.78rem;color:var(--gr);margin-top:3px'>" + esc(ultimaMsg(c.historico)) + "</div>";
        h += "</div>";
      });
    }
    h += "</div>";

    // coluna direita: conversa selecionada
    h += "<div class='card' style='flex:1;max-height:70vh;overflow:auto'>";
    if (!_sel) {
      h += "<div style='padding:40px;text-align:center;color:var(--gr)'>Selecione uma conversa à esquerda para ver o histórico.</div>";
    } else {
      var conv = null;
      for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === _sel) { conv = _convs[i]; break; }
      h += "<div class='ctitle'>" + esc(fmtNumero(_sel)) + "</div>";
      var hist = (conv && Array.isArray(conv.historico)) ? conv.historico : [];
      h += "<div id='waChatScroll' style='max-height:340px;overflow-y:auto;padding-right:4px'>";
      if (!hist.length) {
        h += "<div style='padding:20px;color:var(--gr)'>Sem mensagens.</div>";
      } else {
        hist.forEach(function (m) {
          var isBot = m.role === "assistant";
          var lado = isBot ? "flex-end" : "flex-start";
          var bg = isBot ? "linear-gradient(135deg,#4ab848,#7dcf6e)" : "#f0f0f0";
          var cor = isBot ? "#fff" : "#222";
          h += "<div style='display:flex;justify-content:" + lado + ";margin:6px 0'>";
          h += "<div style='max-width:75%;padding:8px 12px;border-radius:12px;background:" + bg + ";color:" + cor + ";font-size:.85rem;white-space:pre-wrap'>";
          h += esc(m.content);
          h += "</div></div>";
        });
      }
      h += "</div>";
      // ── Barra de atendimento (Fase C) ──
      var emHumano = !!(conv && conv.modo_humano);
      h += "<div style='margin-top:12px;border-top:1px solid #2a3550;padding-top:10px'>";
      if (!emHumano) {
        h += "<div style='display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap'>";
        h += "<span style='font-size:.78rem;color:var(--gr)'>🤖 CORA está atendendo esta conversa automaticamente.</span>";
        h += "<button class='btn btng' style='padding:6px 12px;font-size:.8rem' onclick='WHATSAPP.assumirConversa()'>🙋 Assumir conversa</button>";
        h += "</div>";
      } else {
        var quem = (conv && conv.humano_por) ? conv.humano_por : "recepção";
        h += "<div style='display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px'>";
        h += "<span style='font-size:.78rem;color:var(--ac,#4ab848)'>🙋 Você assumiu — CORA pausada (por " + esc(quem) + ")</span>";
        h += "<button class='btn' style='padding:6px 12px;font-size:.8rem' onclick='WHATSAPP.devolverCora()'>↩️ Devolver para a CORA</button>";
        h += "</div>";
        // campo de resposta
        h += "<div style='display:flex;gap:8px;align-items:flex-end'>";
        h += "<textarea id='waResp' rows='2' placeholder='Digite sua resposta ao paciente…' style='flex:1;padding:8px;border-radius:8px;border:1px solid #2a3550;background:#0f1626;color:#e6e6e6;font-size:.85rem;resize:vertical;font-family:inherit'></textarea>";
        h += "<button class='btn btng' style='padding:8px 16px;font-size:.85rem' onclick='WHATSAPP.enviarResposta()'>Enviar ➤</button>";
        h += "</div>";
        h += "<div style='font-size:.72rem;color:var(--gr);margin-top:4px'>A mensagem será enviada ao paciente pelo WhatsApp da CORA.</div>";
      }
      h += "</div>";
    }
    h += "</div>";

    h += "</div>";

    // preserva o que o atendente já digitou antes de re-renderizar
    var _rascunho = "";
    var _taAntigo = document.getElementById("waResp");
    if (_taAntigo) _rascunho = _taAntigo.value;

    // guarda se o chat estava rolado perto do fim (para decidir auto-scroll)
    var _scAntigo = document.getElementById("waChatScroll");
    var _pertoDoFim = true;
    if (_scAntigo) {
      _pertoDoFim = (_scAntigo.scrollHeight - _scAntigo.scrollTop - _scAntigo.clientHeight) < 60;
    }

    el.innerHTML = h;

    // restaura o rascunho no campo (se ainda existe após render)
    var _taNovo = document.getElementById("waResp");
    if (_taNovo && _rascunho) _taNovo.value = _rascunho;

    // rola para a última mensagem só se já estava perto do fim (ou 1ª carga).
    // assim não interrompe quem está lendo mensagens antigas.
    var _sc = document.getElementById("waChatScroll");
    if (_sc && _pertoDoFim) _sc.scrollTop = _sc.scrollHeight;
  }

  // ── auto-refresh (Fase C): atualiza chat e fila sozinho ──
  var _timer = null;
  var _AUTO_MS = 4000;  // a cada 4s

  function _pgVisivel() {
    var el = document.getElementById("pgWa");
    // só atualiza se a aba WhatsApp está de fato na tela
    return el && el.offsetParent !== null && !document.hidden;
  }

  async function _tick() {
    if (_carregando) return;
    if (!_pgVisivel()) return;
    // se o atendente está com o campo focado e digitou algo, não re-renderiza
    // (evita atrapalhar); mas ainda assim busca dados para a próxima vez.
    var ta = document.getElementById("waResp");
    var digitando = ta && document.activeElement === ta && ta.value.trim().length > 0;
    await carregar();
    await contarPendentes();
    if (!digitando) render();
  }

  function _iniciarAuto() {
    if (_timer) return;
    _timer = setInterval(_tick, _AUTO_MS);
  }

  // ── API pública ──
  async function rWhatsApp() {
    var el = document.getElementById("pgWa");
    if (!el) return;
    if (typeof canAcc === "function" && !canAcc("whatsapp")) {
      if (typeof deny === "function") deny(el);
      return;
    }
    el.innerHTML = "<div style='padding:40px;text-align:center;color:var(--gr)'>Carregando conversas…</div>";
    await carregar();
    await contarPendentes();
    render();
    _iniciarAuto();
  }

  return {
    rWhatsApp: rWhatsApp,
    abrir: function (numero) { _sel = numero; render(); },
    refresh: _refresh,
    setFiltro: setFiltro,
    assumir: assumir,
    resolver: resolver,
    reabrir: reabrir,
    assumirConversa: assumirConversa,
    devolverCora: devolverCora,
    enviarResposta: enviarResposta,
    versao: _VERSAO
  };
})();

// expõe para o navTo map do index.html
window.rWhatsApp = WHATSAPP.rWhatsApp;
