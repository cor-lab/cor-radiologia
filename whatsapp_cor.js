/* ═══════════════════════════════════════════════════════════════════════
   whatsapp_cor.js — Aba "💬 WhatsApp" do App COR
   VERSÃO: WHATSAPP-WEB v14 (bloqueio de atendente + agendamento) — 2026-07-08

   Modelo estilo WhatsApp Web:
     - Lista de conversas à esquerda com 2 abas: Pendentes / Resolvidas
     - Chat da conversa selecionada à direita + campo de resposta
     - Selo "quem assumiu" (na lista e no topo do chat)
     - Toda conversa nova entra em Pendentes; ao Resolver vai p/ Resolvidas;
       mensagem nova do paciente volta p/ Pendentes (o bot marca resolvida=false)

   Fase C (atendimento humano): assumir conversa (pausa a CORA), responder o
   paciente pela CORA, devolver. Chama o bot (wa.corsm.com.br) com JWT do usuário.

   Base de dados: tabela `conversas`
     numero, historico[jsonb], atualizado_em,
     modo_humano, humano_desde, humano_por,
     resolvida, resolvida_em, resolvida_por
   ═══════════════════════════════════════════════════════════════════════ */
var WHATSAPP = (function () {
  "use strict";

  var _VERSAO = "whatsapp-web-v14-bloqueio-atendente-20260708";
  var _convs = [];              // todas as conversas carregadas
  var _sel = null;              // numero da conversa aberta
  var _carregando = false;
  var _aba = "pendentes";       // pendentes | resolvidas
  var _limparCampo = false;     // após enviar, não restaurar rascunho
  var _BOT_URL = "https://wa.corsm.com.br";

  // ── util ──
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function fmtHora(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      var hoje = new Date();
      var mesmoDia = d.toDateString() === hoje.toDateString();
      if (mesmoDia) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    } catch (e) { return ""; }
  }
  function fmtNumero(n) {
    var s = String(n || "").replace(/\D/g, "");
    // 55 55 99975 0603 -> (55) 99975-0603 (heurística simples)
    if (s.length >= 12) {
      var ddd = s.substring(2, 4);
      var resto = s.substring(4);
      if (resto.length === 9) return "(" + ddd + ") " + resto.substring(0, 5) + "-" + resto.substring(5);
      if (resto.length === 8) return "(" + ddd + ") " + resto.substring(0, 4) + "-" + resto.substring(4);
    }
    return n;
  }
  function ultimaMsg(hist) {
    if (!Array.isArray(hist) || !hist.length) return "";
    var m = hist[hist.length - 1];
    var t = (m && m.content) ? String(m.content) : "";
    return t.length > 42 ? t.substring(0, 42) + "…" : t;
  }
  function _quemSou() {
    try {
      if (typeof CU !== "undefined" && CU) return CU.nome || CU.email || CU.login || "recepção";
    } catch (e) {}
    return "recepção";
  }

  // ── carregamento ──
  async function carregar() {
    if (_carregando) return;
    _carregando = true;
    try {
      var r = await supaFetch("/rest/v1/conversas?select=numero,historico,atualizado_em,modo_humano,humano_por,resolvida,resolvida_por,resolvida_em,escalada,agendamento_dados&order=atualizado_em.desc&limit=200");
      _convs = r.ok ? (await r.json()) : [];
    } catch (e) {
      console.error("WHATSAPP carregar:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao carregar conversas");
    } finally {
      _carregando = false;
    }
  }

  // conversas filtradas pela aba atual
  function _filtradas() {
    if (_aba === "resolvidas") return _convs.filter(function (c) { return c.resolvida; });
    return _convs.filter(function (c) { return !c.resolvida; });
  }
  function _contar(resolvida) {
    var n = 0;
    for (var i = 0; i < _convs.length; i++) if (!!_convs[i].resolvida === resolvida) n++;
    return n;
  }

  // ── ações ──
  async function _patchConversa(numero, body) {
    var r = await supaFetch("/rest/v1/conversas?numero=eq." + encodeURIComponent(numero), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      var t = ""; try { t = await r.text(); } catch (e) {}
      throw new Error("HTTP " + r.status + " " + t);
    }
  }

  async function resolver(numero) {
    var n = numero || _sel;
    if (!n) return;
    try {
      await _patchConversa(n, { resolvida: true, resolvida_em: new Date().toISOString(), resolvida_por: _quemSou(), escalada: false });
      if (n === _sel) _sel = null;   // fecha o chat: a conversa saiu de "Pendentes"
      if (typeof toast === "function") toast("✅", "Resolvida — veja em 'Resolvidas'");
      await _refresh();
    } catch (e) {
      console.error("resolver:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao resolver");
    }
  }

  // Abre o formulário "Novo Agendamento" no App COR já pré-preenchido com o
  // que a CORA coletou. A recepção confere, completa (exame/dentista) e salva.
  function criarAgendamento(numero) {
    var n = numero || _sel;
    if (!n) return;
    var conv = null;
    for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === n) { conv = _convs[i]; break; }
    var dados = conv && conv.agendamento_dados;
    if (!dados) {
      if (typeof toast === "function") toast("⚠️", "Sem dados de agendamento nesta conversa");
      return;
    }
    if (typeof window.preencherAgDaCora === "function") {
      window.preencherAgDaCora(dados);
    } else {
      if (typeof toast === "function") toast("⚠️", "Função de agendamento indisponível");
    }
  }

  async function reabrir(numero) {
    var n = numero || _sel;
    if (!n) return;
    try {
      await _patchConversa(n, { resolvida: false, resolvida_em: null, resolvida_por: null });
      if (n === _sel) _sel = null;   // fecha o chat: a conversa saiu de "Resolvidas"
      if (typeof toast === "function") toast("↩️", "Reaberta — veja em 'Pendentes'");
      await _refresh();
    } catch (e) {
      console.error("reabrir:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao reabrir");
    }
  }

  // ── Fase C: atendimento humano via bot ──
  async function _jwt() {
    try {
      var s = await supa.auth.getSession();
      return s && s.data && s.data.session ? s.data.session.access_token : null;
    } catch (e) { return null; }
  }
  async function _chamarBot(rota, corpo) {
    var jwt = await _jwt();
    if (!jwt) { if (typeof toast === "function") toast("⚠️", "Sessão expirada, refaça login"); return null; }
    return fetch(_BOT_URL + rota, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
      body: JSON.stringify(corpo)
    });
  }

  async function assumirConversa() {
    if (!_sel) return;
    // Se outro atendente já assumiu, não deixa "roubar" (evita dois ao mesmo tempo).
    var conv = null;
    for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === _sel) { conv = _convs[i]; break; }
    if (conv && conv.modo_humano && conv.humano_por && conv.humano_por !== _quemSou()) {
      if (typeof toast === "function") toast("🔒", esc(conv.humano_por) + " já está atendendo esta conversa");
      return;
    }
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
    } catch (e) { console.error("assumirConversa:", e); if (typeof toast === "function") toast("⚠️", "Erro ao assumir"); }
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
    } catch (e) { console.error("devolverCora:", e); }
  }

  async function enviarResposta() {
    if (!_sel) return;
    var ta = document.getElementById("waResp");
    var texto = ta ? ta.value.trim() : "";
    if (!texto) { if (typeof toast === "function") toast("✍️", "Digite uma mensagem"); return; }
    try {
      var r = await _chamarBot("/enviar_manual", { numero: _sel, texto: texto, atendente: _quemSou() });
      if (r && r.ok) {
        _limparCampo = true;
        if (ta) ta.value = "";
        if (typeof toast === "function") toast("✅", "Enviado ao paciente");
        await _refresh();
      } else {
        var t = r ? await r.text() : "";
        console.error("enviarResposta:", r && r.status, t);
        if (typeof toast === "function") toast("⚠️", "Falha ao enviar (HTTP " + (r ? r.status : "?") + ")");
      }
    } catch (e) { console.error("enviarResposta:", e); if (typeof toast === "function") toast("⚠️", "Erro ao enviar"); }
  }

  function abrir(numero) { _sel = numero; render(); }
  function setAba(a) { _aba = a; _sel = null; render(); }

  async function _refresh() { await carregar(); render(); }

  // ── render ──
  function render() {
    var el = document.getElementById("pgWa");
    if (!el) return;

    var nPend = _contar(false);
    var nResolv = _contar(true);
    var lista = _filtradas();

    var h = "";

    // Layout WhatsApp Web: 2 colunas
    h += "<div style='display:flex;gap:0;border:0.5px solid #2a3550;border-radius:12px;overflow:hidden;height:calc(100vh - 150px)'>";

    // ── COLUNA ESQUERDA: lista de conversas ──
    h += "<div style='width:270px;border-right:0.5px solid #2a3550;display:flex;flex-direction:column;flex-shrink:0'>";
    // cabeçalho + abas
    h += "<div style='padding:12px 14px;border-bottom:0.5px solid #2a3550'>";
    h += "<div style='font-weight:600;font-size:15px;margin-bottom:10px'>💬 Conversas</div>";
    h += "<div style='display:flex;gap:6px'>";
    h += "<button onclick=\"WHATSAPP.setAba('pendentes')\" class='btn' style='padding:5px 12px;font-size:.78rem;" +
         (_aba === "pendentes" ? "background:var(--ac,#4ab848);color:#fff" : "background:transparent;color:var(--gr)") + "'>Pendentes (" + nPend + ")</button>";
    h += "<button onclick=\"WHATSAPP.setAba('resolvidas')\" class='btn' style='padding:5px 12px;font-size:.78rem;" +
         (_aba === "resolvidas" ? "background:var(--ac,#4ab848);color:#fff" : "background:transparent;color:var(--gr)") + "'>Resolvidas (" + nResolv + ")</button>";
    h += "</div></div>";
    // itens
    h += "<div style='overflow-y:auto;flex:1'>";
    if (!lista.length) {
      h += "<div style='padding:24px 14px;text-align:center;color:var(--gr);font-size:.82rem'>Nenhuma conversa " + (_aba === "resolvidas" ? "resolvida" : "pendente") + ".</div>";
    } else {
      lista.forEach(function (c) {
        var ativo = c.numero === _sel;
        var numJs = "&quot;" + String(c.numero).replace(/"/g, "") + "&quot;";
        h += "<div onclick='WHATSAPP.abrir(" + numJs + ")' style='padding:10px 14px;border-bottom:0.5px solid #2a3550;cursor:pointer;" +
             (ativo ? "background:rgba(74,184,72,.12)" : "") + "'>";
        h += "<div style='display:flex;justify-content:space-between;align-items:center'>";
        h += "<span style='font-weight:500;font-size:13px'>" + esc(fmtNumero(c.numero)) + "</span>";
        h += "<span style='font-size:11px;color:var(--gr)'>" + esc(fmtHora(c.atualizado_em)) + "</span>";
        h += "</div>";
        h += "<div style='font-size:12px;color:var(--gr);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + esc(ultimaMsg(c.historico)) + "</div>";
        // selo de quem assumiu / escalação / resolvida
        if (c.modo_humano && c.humano_por) {
          h += "<div style='font-size:11px;color:var(--ac,#4ab848);margin-top:3px'>🙋 " + esc(c.humano_por) + "</div>";
        } else if (c.escalada && !c.resolvida) {
          // a CORA escalou para a recepção -> destaque com aceno
          h += "<div style='font-size:11px;color:#e6a700;margin-top:3px;font-weight:600'>🙋 CORA pediu atendente</div>";
        } else if (c.resolvida && c.resolvida_por) {
          h += "<div style='font-size:11px;color:var(--gr);margin-top:3px'>✅ " + esc(c.resolvida_por) + "</div>";
        }
        h += "</div>";
      });
    }
    h += "</div>";  // fim itens
    h += "<div style='padding:8px 12px;border-top:0.5px solid #2a3550'><button class='btn btng' style='width:100%;padding:6px;font-size:.78rem' onclick='WHATSAPP.refresh()'>↻ Atualizar</button></div>";
    h += "</div>";  // fim coluna esquerda

    // ── COLUNA DIREITA: chat ──
    h += "<div style='flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden'>";
    if (!_sel) {
      h += "<div style='flex:1;display:flex;align-items:center;justify-content:center;color:var(--gr);font-size:.85rem;padding:40px;text-align:center'>Selecione uma conversa à esquerda para ver e responder.</div>";
    } else {
      var conv = null;
      for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === _sel) { conv = _convs[i]; break; }
      var emHumano = !!(conv && conv.modo_humano);
      var jaResolvida = !!(conv && conv.resolvida);

      // cabeçalho do chat
      h += "<div style='padding:10px 16px;border-bottom:0.5px solid #2a3550;display:flex;justify-content:space-between;align-items:center'>";
      h += "<div>";
      h += "<div style='font-weight:500;font-size:14px'>" + esc(fmtNumero(_sel)) + "</div>";
      if (emHumano && conv.humano_por) {
        h += "<div style='font-size:11px;color:var(--ac,#4ab848)'>🙋 " + esc(conv.humano_por) + " assumiu — CORA pausada</div>";
      } else {
        h += "<div style='font-size:11px;color:var(--gr)'>🤖 CORA atendendo</div>";
      }
      h += "</div>";
      // botões do cabeçalho
      h += "<div style='display:flex;gap:6px'>";
      // Se a CORA coletou dados de agendamento, oferece criar o agendamento
      // pré-preenchido (a recepção confere e salva no App COR).
      if (conv && conv.agendamento_dados) {
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;font-weight:600' onclick='WHATSAPP.criarAgendamento()'>📅 Criar agendamento</button>";
      }
      if (!jaResolvida) {
        h += "<button class='btn btng' style='padding:5px 12px;font-size:.8rem' onclick='WHATSAPP.resolver()'>✓ Resolver</button>";
      } else {
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem' onclick='WHATSAPP.reabrir()'>↩️ Reabrir</button>";
      }
      h += "</div>";
      h += "</div>";

      // mensagens (cores do mockup: paciente claro c/ borda, CORA/recepção verde suave)
      var hist = (conv && Array.isArray(conv.historico)) ? conv.historico : [];
      h += "<div id='waChatScroll' style='flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#000'>";
      if (!hist.length) {
        h += "<div style='color:var(--gr);text-align:center;padding:20px'>Sem mensagens.</div>";
      } else {
        hist.forEach(function (m) {
          var isBot = m.role === "assistant";
          if (isBot) {
            h += "<div style='align-self:flex-end;max-width:72%;background:#d8f5e3;color:#0f6e56;padding:8px 12px;border-radius:12px;font-size:.85rem;white-space:pre-wrap'>" + esc(m.content) + "</div>";
          } else {
            h += "<div style='align-self:flex-start;max-width:72%;background:#f0f0f0;color:#222;padding:8px 12px;border-radius:12px;font-size:.85rem;white-space:pre-wrap;border:0.5px solid #ddd'>" + esc(m.content) + "</div>";
          }
        });
      }
      h += "</div>";

      // barra de resposta (Fase C)
      h += "<div style='padding:10px 16px;border-top:0.5px solid #2a3550'>";
      if (!emHumano) {
        h += "<div style='display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap'>";
        h += "<span style='font-size:.78rem;color:var(--gr)'>🤖 CORA está atendendo. Assuma para responder você mesmo.</span>";
        h += "<button class='btn btng' style='padding:6px 12px;font-size:.8rem' onclick='WHATSAPP.assumirConversa()'>🙋 Assumir conversa</button>";
        h += "</div>";
      } else {
        // Alguém assumiu. Descobre se fui EU ou OUTRA pessoa.
        var quemAssumiu = (conv && conv.humano_por) ? String(conv.humano_por) : "";
        var euMesmo = quemAssumiu && (quemAssumiu === _quemSou());
        if (euMesmo) {
          // Fui eu: posso responder e devolver.
          h += "<div style='display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px'>";
          h += "<span style='font-size:.78rem;color:var(--ac,#4ab848)'>🙋 Você assumiu — CORA pausada</span>";
          h += "<button class='btn' style='padding:5px 10px;font-size:.78rem' onclick='WHATSAPP.devolverCora()'>↩️ Devolver para a CORA</button>";
          h += "</div>";
          h += "<div style='display:flex;gap:8px;align-items:flex-end'>";
          h += "<textarea id='waResp' rows='2' placeholder='Digite sua resposta ao paciente…' style='flex:1;padding:8px;border-radius:8px;border:1px solid #2a3550;background:#0f1626;color:#e6e6e6;font-size:.85rem;resize:vertical;font-family:inherit'></textarea>";
          h += "<button class='btn btng' style='padding:8px 16px;font-size:.85rem' onclick='WHATSAPP.enviarResposta()'>Enviar ➤</button>";
          h += "</div>";
        } else {
          // OUTRA pessoa assumiu: bloqueia (não deixa dois atendentes ao mesmo
          // tempo). Mostra quem está atendendo, sem campo de resposta.
          h += "<div style='display:flex;align-items:center;gap:8px;flex-wrap:wrap'>";
          h += "<span style='font-size:.8rem;color:#e6a700;font-weight:600'>🔒 " + esc(quemAssumiu || "Outro atendente") + " está atendendo esta conversa</span>";
          h += "</div>";
          h += "<div style='font-size:.72rem;color:var(--gr);margin-top:4px'>Para responder, peça que " + esc(quemAssumiu || "o atendente") + " devolva a conversa à CORA.</div>";
        }
      }
      h += "</div>";
    }
    h += "</div>";  // fim coluna direita

    h += "</div>";  // fim layout

    // ── preservar rascunho + scroll ──
    var _rascunho = "";
    if (!_limparCampo) {
      var _taAntigo = document.getElementById("waResp");
      if (_taAntigo) _rascunho = _taAntigo.value;
    }
    _limparCampo = false;

    var _scAntigo = document.getElementById("waChatScroll");
    var _pertoDoFim = true;
    if (_scAntigo) _pertoDoFim = (_scAntigo.scrollHeight - _scAntigo.scrollTop - _scAntigo.clientHeight) < 60;

    el.innerHTML = h;

    var _taNovo = document.getElementById("waResp");
    if (_taNovo && _rascunho) _taNovo.value = _rascunho;
    var _sc = document.getElementById("waChatScroll");
    if (_sc && _pertoDoFim) _sc.scrollTop = _sc.scrollHeight;

    // mantém a assinatura em dia (evita re-render desnecessário no próximo tick)
    try { _ultimaAssinatura = _assinatura(); } catch (e) {}
  }

  // ── auto-refresh ──
  var _timer = null;
  var _AUTO_MS = 4000;
  function _pgVisivel() {
    var el = document.getElementById("pgWa");
    return el && el.offsetParent !== null && !document.hidden;
  }
  // Assinatura leve dos dados: muda só quando há conteúdo novo relevante.
  // Usada para o auto-refresh NÃO recriar o DOM (e não fazer o chat "pular")
  // quando nada mudou de fato.
  function _assinatura() {
    var partes = [];
    for (var i = 0; i < _convs.length; i++) {
      var c = _convs[i];
      var h = c.historico;
      var nmsg = Array.isArray(h) ? h.length : 0;
      partes.push([c.numero, c.atualizado_em, nmsg, c.modo_humano ? 1 : 0,
                   c.humano_por || "", c.resolvida ? 1 : 0, c.escalada ? 1 : 0,
                   c.agendamento_dados ? 1 : 0].join(":"));
    }
    return partes.join("|") + "#aba=" + _aba + "#sel=" + (_sel || "");
  }
  var _ultimaAssinatura = "";

  async function _tick() {
    if (_carregando) return;
    if (!_pgVisivel()) return;
    var ta = document.getElementById("waResp");
    var digitando = ta && document.activeElement === ta && ta.value.trim().length > 0;
    await carregar();
    if (digitando) return;              // não mexe no DOM enquanto digita
    var assinatura = _assinatura();
    if (assinatura === _ultimaAssinatura) return;  // nada mudou -> não re-renderiza (não pula)
    _ultimaAssinatura = assinatura;
    render();
  }
  function _iniciarAuto() { if (!_timer) _timer = setInterval(_tick, _AUTO_MS); }

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
    render();
    _iniciarAuto();
  }

  return {
    rWhatsApp: rWhatsApp,
    abrir: abrir,
    setAba: setAba,
    refresh: _refresh,
    resolver: resolver,
    reabrir: reabrir,
    criarAgendamento: criarAgendamento,
    assumirConversa: assumirConversa,
    devolverCora: devolverCora,
    enviarResposta: enviarResposta,
    versao: _VERSAO
  };
})();

// expõe para o navTo map do index.html
window.rWhatsApp = WHATSAPP.rWhatsApp;
