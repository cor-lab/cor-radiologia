/* ═══════════════════════════════════════════════════════════════════════
   whatsapp_cor.js — Aba "💬 WhatsApp" do App COR
   VERSÃO: WHATSAPP-WEB v18 (busca ampla: nome/mensagem) — 2026-07-10

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

  var _VERSAO = "whatsapp-web-v21-relogin-em-401-403-20260806";
  var _convs = [];              // todas as conversas carregadas
  var _sel = null;              // numero da conversa aberta
  var _carregando = false;
  var _aba = "pendentes";       // pendentes | resolvidas
  var _busca = "";              // texto do campo de pesquisa (filtra por número/nome)
  var _limparCampo = false;     // após enviar, não restaurar rascunho
  var _BOT_URL = "https://wa.corsm.com.br";

  // ── util ──
  // Normaliza conversas.agendamento_dados para uma LISTA de pedidos.
  // A CORA pode gravar um OBJETO (1 paciente, formato antigo) ou uma LISTA
  // (agendamento de família, 2-3 pacientes). Aqui unificamos: sempre devolve
  // um array (vazio se não houver dados). (30/07/2026)
  function _agsLista(ad) {
    if (!ad) return [];
    if (Array.isArray(ad)) {
      return ad.filter(function (x) { return x && typeof x === "object"; });
    }
    if (typeof ad === "object" && ad.paciente_nome) return [ad];
    return [];
  }
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
    if (m && m.midia && m.midia.tipo === "image") {
      var c = (m.content && m.content !== "[imagem]") ? " " + m.content : "";
      return "📷 Imagem" + c;
    }
    var t = (m && m.content) ? String(m.content) : "";
    return t.length > 42 ? t.substring(0, 42) + "…" : t;
  }
  function _quemSou() {
    try {
      if (typeof CU !== "undefined" && CU) return CU.nome || CU.email || CU.login || "recepção";
    } catch (e) {}
    return "recepção";
  }

  // ── Mídia (imagens do paciente, bucket privado wa-midias) ──
  // Gera uma URL assinada temporária e injeta na <img>. Bucket é privado,
  // então precisa de token — só a recepção logada consegue.
  var _WA_MIDIA_BUCKET = "wa-midias";
  var _midiaCache = {};  // path -> signedUrl (evita regerar toda hora)

  async function _urlAssinada(path) {
    if (_midiaCache[path]) return _midiaCache[path];
    try {
      var r = await supaFetch("/storage/v1/object/sign/" + _WA_MIDIA_BUCKET + "/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 3600 })  // 1h
      });
      if (!r || !r.ok) return null;
      var j = await r.json();
      // resposta traz signedURL relativo a /storage/v1
      var signed = j.signedURL || j.signedUrl;
      if (!signed) return null;
      var full = (typeof SUPA_URL !== "undefined" ? SUPA_URL : "") + "/storage/v1" + signed;
      _midiaCache[path] = full;
      return full;
    } catch (e) {
      console.error("url assinada:", e);
      return null;
    }
  }

  async function _carregarMidia(path, imgId) {
    var url = await _urlAssinada(path);
    if (!url) return;
    var el = document.getElementById(imgId);
    if (el) el.src = url;
  }

  async function abrirMidia(path) {
    var url = await _urlAssinada(path);
    if (url) window.open(url, "_blank");
    else if (typeof toast === "function") toast("⚠️", "Não consegui abrir a imagem");
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

  // texto buscável de uma conversa: nome do agendamento + conteúdo das mensagens.
  // usado para a busca por nome/palavra encontrar em qualquer lugar da conversa.
  function _textoBuscavel(c) {
    var partes = [];
    // nome do paciente, se a CORA coletou num agendamento.
    // agendamento_dados pode ser um OBJETO (1 paciente, formato antigo) ou uma
    // LISTA (agendamento de família, 2-3 pacientes). Normaliza para lista.
    var _ags = _agsLista(c.agendamento_dados);
    if (_ags.length && _ags[0].paciente_nome) {
      var _nomes = _ags.map(function(a){ return String(a.paciente_nome || ""); })
                       .filter(function(x){ return x; });
      partes.push(_nomes.join(", "));
    }
    // conteúdo das mensagens (texto que o paciente/CORA trocaram)
    var h = c.historico;
    if (Array.isArray(h)) {
      for (var i = 0; i < h.length; i++) {
        var ct = h[i] && h[i].content;
        if (typeof ct === "string") partes.push(ct);
      }
    }
    return partes.join(" ").toLowerCase();
  }

  // conversas filtradas pela aba atual + pelo texto de busca
  function _filtradas() {
    var base = (_aba === "resolvidas")
      ? _convs.filter(function (c) { return c.resolvida; })
      : _convs.filter(function (c) { return !c.resolvida; });

    var q = (_busca || "").trim().toLowerCase();
    if (!q) return base;

    // normaliza: remove tudo que não é dígito, para casar número digitado
    var qDigitos = q.replace(/\D/g, "");
    return base.filter(function (c) {
      var num = String(c.numero || "");
      var numFmt = String(fmtNumero(c.numero) || "").toLowerCase();
      // casa por número (cru ou formatado)
      var okNum = qDigitos && num.replace(/\D/g, "").indexOf(qDigitos) !== -1;
      var okFmt = numFmt.indexOf(q) !== -1;
      // casa por nome/palavra dentro da conversa (agendamento + mensagens)
      var okTexto = _textoBuscavel(c).indexOf(q) !== -1;
      return okNum || okFmt || okTexto;
    });
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
      // Ao resolver, LIMPA agendamento_dados (30/07/2026). Sem isso, o pedido da
      // paciente anterior ficava preso na conversa: quando a mesma pessoa (ex.: uma
      // secretária que agenda vários pacientes) voltava para agendar OUTRO paciente,
      // o botão "Criar agendamento" abria o formulário com os dados da paciente
      // ANTERIOR, e a recepção tinha que corrigir tudo à mão (caso Jeanne/Teresinha).
      // Resolver = "terminei com esta conversa", então zerar o pedido é o certo.
      await _patchConversa(n, {
        resolvida: true,
        resolvida_em: new Date().toISOString(),
        resolvida_por: _quemSou(),
        escalada: false,
        agendamento_dados: null
      });
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
  async function criarAgendamento(numero, indice) {
    var n = numero || _sel;
    if (!n) return;
    var conv = null;
    for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === n) { conv = _convs[i]; break; }
    // agendamento_dados pode ser objeto (1 paciente) ou lista (família). Normaliza.
    var lista = _agsLista(conv && conv.agendamento_dados);
    if (!lista.length) {
      if (typeof toast === "function") toast("⚠️", "Sem dados de agendamento nesta conversa");
      return;
    }
    // Qual paciente? Se veio índice (botão "Criar agendamento N"), usa ele; senão o 1º.
    var idx = (typeof indice === "number" && indice >= 0 && indice < lista.length) ? indice : 0;
    var dados = lista[idx];
    // TRAVA (17/07/2026): antes de abrir o formulário, ASSUME a conversa. Assim ela
    // fica travada para os outros atendentes (não dá para dois mexerem no mesmo
    // paciente ao mesmo tempo). Se outro já assumiu, _assumir() barra e não abre.
    var ok = await _assumir(n);
    if (!ok) return;   // outra pessoa detém a conversa; toast já foi mostrado
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
      var sess = s && s.data ? s.data.session : null;
      if (!sess) return null;
      // (06/08/2026) getSession() às vezes devolve um access_token JÁ VENCIDO quando a
      // aba ficou suspensa/fechada (o timer de auto-refresh não rodou). Se o token está
      // expirado ou perto disso, força a renovação ANTES de usar — assim não mandamos
      // token velho pro servidor (que responderia 403). Se o refresh falhar (ex.: sessão
      // já morta no Supabase), seguimos com o que tem: o 403 é tratado em _chamarBot.
      var agora = Math.floor(Date.now() / 1000);
      if (sess.expires_at && (sess.expires_at - agora) < 60) {
        try {
          var rs = await supa.auth.refreshSession();
          if (rs && rs.data && rs.data.session) sess = rs.data.session;
        } catch (e) { /* refresh falhou: cai no tratamento de 401/403 abaixo */ }
      }
      return sess.access_token || null;
    } catch (e) { return null; }
  }
  // (06/08/2026) Sessão recusada pelo servidor: o Supabase apagou a sessão
  // (session_not_found) ou o token venceu e não deu pra renovar. O token guardado no
  // navegador ainda "parece" válido, então getSession() não acusa nada e o usuário ficava
  // preso num "HTTP 403" sem explicação. Aqui a gente LIMPA a sessão morta (signOut zera o
  // storage mesmo se o /logout falhar) e avisa pra refazer login — no próximo refresh a
  // pessoa cai na tela de login em vez de repetir o 403 com a sessão morta restaurada.
  var _tratandoSessaoMorta = false;
  async function _sessaoMorta() {
    if (typeof toast === "function") toast("🔒", "Sua sessão expirou. Recarregando para o login…");
    if (_tratandoSessaoMorta) return;   // evita signOut/reload duplicado em chamadas simultâneas
    _tratandoSessaoMorta = true;
    try { if (typeof supa !== "undefined" && supa && supa.auth) await supa.auth.signOut(); } catch (e) {}
    // Recarrega para cair na tela de login. Espera ~1,5s para o toast ser visto; o signOut
    // acima já zerou a sessão morta do storage, então o reload não a restaura.
    try {
      if (typeof location !== "undefined") setTimeout(function () { location.reload(); }, 1500);
    } catch (e) {}
  }
  async function _chamarBot(rota, corpo) {
    var jwt = await _jwt();
    if (!jwt) { await _sessaoMorta(); return null; }
    var r = await fetch(_BOT_URL + rota, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
      body: JSON.stringify(corpo)
    });
    // 401/403 = o servidor recusou a autenticação. Trata como sessão morta (limpa + avisa).
    // NÃO consome o corpo (só lê .status), então os callers seguem lendo r.text()/r.json().
    if (r && (r.status === 401 || r.status === 403)) { await _sessaoMorta(); }
    return r;
  }

  // Adquire a trava da conversa (assume). Retorna true se conseguiu (ou já era minha),
  // false se outra pessoa detém. Trata a resposta 409 do backend (aquisição atômica).
  async function _assumir(numero) {
    var n = numero || _sel;
    if (!n) return false;
    // Checagem rápida no cache local (falha cedo, sem ir ao servidor).
    var conv = null;
    for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === n) { conv = _convs[i]; break; }
    if (conv && conv.modo_humano && conv.humano_por && conv.humano_por !== _quemSou()) {
      if (typeof toast === "function") toast("🔒", esc(conv.humano_por) + " já está atendendo esta conversa");
      return false;
    }
    try {
      var r = await _chamarBot("/modo_humano", { numero: n, ativar: true, atendente: _quemSou() });
      if (r && r.ok) {
        await _refresh();
        return true;
      }
      // 409 = outra pessoa assumiu no meio do caminho (aquisição atômica no backend).
      if (r && r.status === 409) {
        var quem = "";
        try { var d = await r.json(); quem = (d.detail || "").replace("ja_assumida:", ""); } catch (e) {}
        if (typeof toast === "function") toast("🔒", (quem || "Outro atendente") + " assumiu esta conversa primeiro");
        await _refresh();
        return false;
      }
      var t = r ? await r.text() : "";
      console.error("_assumir:", r && r.status, t);
      if (typeof toast === "function") toast("⚠️", "Falha ao assumir (HTTP " + (r ? r.status : "?") + ")");
      return false;
    } catch (e) {
      console.error("_assumir:", e);
      if (typeof toast === "function") toast("⚠️", "Erro ao assumir");
      return false;
    }
  }

  async function assumirConversa() {
    if (!_sel) return;
    var ok = await _assumir(_sel);
    if (ok && typeof toast === "function") toast("🙋", "Você assumiu — CORA pausada");
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
  function setAba(a) { _aba = a; _sel = null; _busca = ""; render(); }

  function setBusca(v) {
    _busca = v || "";
    render();
    // o render redesenha tudo (innerHTML) e o campo perde o foco; restaura o
    // foco e coloca o cursor no fim, para a pessoa seguir digitando sem parar.
    var inp = document.getElementById("waBusca");
    if (inp) {
      inp.focus();
      var n = inp.value.length;
      try { inp.setSelectionRange(n, n); } catch (e) {}
    }
  }

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
    h += "</div>";  // fim abas
    // campo de pesquisa
    h += "<div style='margin-top:10px;position:relative'>";
    h += "<input id='waBusca' type='text' placeholder='🔍 Buscar por número, nome ou mensagem…' value='" + esc(_busca) + "' " +
         "oninput='WHATSAPP.setBusca(this.value)' autocomplete='off' " +
         "style='width:100%;box-sizing:border-box;padding:7px 10px;font-size:.8rem;border:0.5px solid #2a3550;" +
         "border-radius:8px;background:var(--bg2,#0f1626);color:inherit;outline:none'>";
    if (_busca) {
      h += "<button onclick='WHATSAPP.setBusca(\"\")' title='Limpar' " +
           "style='position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;" +
           "border:0;color:var(--gr);cursor:pointer;font-size:.9rem;padding:2px 6px'>✕</button>";
    }
    h += "</div>";
    h += "</div>";  // fim cabeçalho
    h += "<div style='overflow-y:auto;flex:1'>";
    if (!lista.length) {
      var vazio = _busca
        ? "Nenhuma conversa encontrada para \"" + esc(_busca) + "\"."
        : "Nenhuma conversa " + (_aba === "resolvidas" ? "resolvida" : "pendente") + ".";
      h += "<div style='padding:24px 14px;text-align:center;color:var(--gr);font-size:.82rem'>" + vazio + "</div>";
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
      h += "<div style='display:flex;gap:6px;flex-wrap:wrap'>";
      // Se a CORA coletou dados de agendamento, oferece criar o agendamento
      // pré-preenchido (a recepção confere e salva no App COR).
      // Se for FAMÍLIA (2+ pacientes), mostra um botão por paciente:
      // "Criar agendamento 1", "Criar agendamento 2", etc.
      var _agsBtn = _agsLista(conv && conv.agendamento_dados);
      if (_agsBtn.length === 1) {
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;font-weight:600' onclick='WHATSAPP.criarAgendamento()'>📅 Criar agendamento</button>";
      } else if (_agsBtn.length > 1) {
        for (var _ia = 0; _ia < _agsBtn.length; _ia++) {
          var _nomeCurto = String(_agsBtn[_ia].paciente_nome || "").split(" ")[0];
          h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;font-weight:600' onclick='WHATSAPP.criarAgendamento(null," + _ia + ")' title='" + esc(_agsBtn[_ia].paciente_nome || "") + "'>📅 Criar agendamento " + (_ia + 1) + (_nomeCurto ? " (" + esc(_nomeCurto) + ")" : "") + "</button>";
        }
      }
      // Se EU assumi (ex.: cliquei em Criar agendamento, que trava a conversa),
      // mostro o botão de devolver aqui no cabeçalho também, para liberar fácil.
      // Se esquecer, o job de fim de expediente (18:30) devolve automaticamente.
      if (emHumano && conv.humano_por && conv.humano_por === _quemSou()) {
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:#243049;color:#e6e6e6' onclick='WHATSAPP.devolverCora()'>↩️ Devolver para a CORA</button>";
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
          // Mensagem com IMAGEM (paciente enviou foto pela CORA)
          if (m.midia && m.midia.tipo === "image" && m.midia.path) {
            var cap = (m.content && m.content !== "[imagem]") ? m.content : "";
            var imgId = "waimg_" + Math.random().toString(36).slice(2, 9);
            h += "<div style='align-self:flex-start;max-width:72%;background:#f0f0f0;color:#222;padding:6px;border-radius:12px;border:0.5px solid #ddd'>";
            h += "<img id='" + imgId + "' alt='imagem do paciente' style='max-width:240px;max-height:280px;border-radius:8px;display:block;cursor:pointer;background:#e5e5e5;min-height:80px' onclick='WHATSAPP.abrirMidia(\"" + esc(m.midia.path) + "\")'/>";
            if (cap) h += "<div style='font-size:.8rem;margin-top:4px;padding:0 4px'>" + esc(cap) + "</div>";
            h += "<div style='font-size:.72rem;color:#0a7;margin-top:3px;padding:0 4px;cursor:pointer' onclick='WHATSAPP.abrirMidia(\"" + esc(m.midia.path) + "\")'>📎 abrir / baixar</div>";
            h += "</div>";
            // carrega a imagem via URL assinada (bucket privado)
            _carregarMidia(m.midia.path, imgId);
          } else if (isBot) {
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
    var _scrollAntigo = 0;
    if (_scAntigo) {
      _pertoDoFim = (_scAntigo.scrollHeight - _scAntigo.scrollTop - _scAntigo.clientHeight) < 60;
      _scrollAntigo = _scAntigo.scrollTop;  // guarda a posição exata pra restaurar
    }

    el.innerHTML = h;

    var _taNovo = document.getElementById("waResp");
    if (_taNovo && _rascunho) _taNovo.value = _rascunho;
    var _sc = document.getElementById("waChatScroll");
    if (_sc) {
      if (_pertoDoFim) {
        // estava lendo o fim da conversa: cola no fim (mensagem nova aparece)
        _sc.scrollTop = _sc.scrollHeight;
      } else {
        // estava lendo no meio: RESTAURA a posição exata (evita o salto pro topo)
        _sc.scrollTop = _scrollAntigo;
      }
    }

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
    // também não interrompe quem está digitando no campo de busca
    var bu = document.getElementById("waBusca");
    var buscando = bu && document.activeElement === bu;
    await carregar();
    if (digitando || buscando) return;  // não mexe no DOM enquanto digita/busca
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
    setBusca: setBusca,
    refresh: _refresh,
    resolver: resolver,
    reabrir: reabrir,
    criarAgendamento: criarAgendamento,
    abrirMidia: abrirMidia,
    assumirConversa: assumirConversa,
    devolverCora: devolverCora,
    enviarResposta: enviarResposta,
    versao: _VERSAO
  };
})();

// expõe para o navTo map do index.html
window.rWhatsApp = WHATSAPP.rWhatsApp;
