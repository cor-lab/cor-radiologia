/* ═══════════════════════════════════════════════════════════════════════
   whatsapp_cor.js — Aba "💬 WhatsApp" do App COR
   VERSÃO: WHATSAPP-WEB v27 (anexar imagem na resposta) — 2026-11-27

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

  var _VERSAO = "whatsapp-web-v27-anexo-20261127";
  var _convs = [];              // todas as conversas carregadas
  var _sel = null;              // numero da conversa aberta
  var _carregando = false;
  var _aba = "pendentes";       // pendentes | resolvidas
  var _busca = "";              // texto do campo de pesquisa (filtra por número/nome)
  var _limparCampo = false;     // após enviar, não restaurar rascunho
  var _BOT_URL = "https://wa.corsm.com.br";
  // v27: imagem anexada à resposta (ainda não enviada). Fica em memória para
  // sobreviver ao re-render do auto-refresh. { numero, dataUrl, nome }
  var _anexo = null;
  var _enviando = false;        // trava contra duplo clique no Enviar
  var _IMG_MAX_BYTES = 5 * 1024 * 1024;   // limite da Cloud API para imagem
  var _IMG_LADO_MAX = 2000;               // lado maior ao reduzir no navegador

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
  // v24 (segurança XSS): escapa TAMBÉM aspas. Dados de conversa (nome do
  // paciente, caption, path de mídia) vêm de fora (WhatsApp) e eram colocados
  // em atributos/onclick — sem escapar aspas, um valor manipulado quebrava o
  // atributo/JS quando a recepção abria a conversa.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // Para argumento de string dentro de onclick="..." (contexto JS): JSON.stringify
  // gera a string com aspas e escapa o interno; esc() cobre o HTML do atributo.
  function jsArg(s) {
    return esc(JSON.stringify(String(s == null ? "" : s)));
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
      var c = _legendaMidia(m.content);
      return "📷 Imagem" + (c ? " " + c : "");
    }
    var t = (m && m.content) ? String(m.content) : "";
    // v26: a prévia não mostra o markdown cru da CORA (**negrito**) nem quebras de linha
    t = t.replace(/\*\*/g, "").replace(/\s+/g, " ");
    return t.length > 42 ? t.substring(0, 42) + "…" : t;
  }
  // v27: legenda de mensagem com imagem. Do paciente vem a legenda ou "[imagem]";
  // da equipe vem "[Nome] legenda" ou "[Nome] [imagem]" (sem legenda).
  function _legendaMidia(content) {
    var t = String(content == null ? "" : content);
    if (t === "[imagem]") return "";
    return t.replace(/\s*\[imagem\]$/, "");
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

  // ── "Criar do resumo" (10/08/2026) — REDE DE SEGURANÇA ──
  // Caso real (Gláucia, 10/08): a CORA escreveu o resumo completo no chat
  // ("Prontinho! Encaminhei o pedido... - Paciente: ... - Exame: ...") mas NÃO
  // chamou escalar_humano — agendamento_dados ficou vazio e o botão "Criar
  // agendamento" não apareceu; o pedido teve que ser inserido à mão no banco.
  // Estas funções detectam esse estado (resumo no chat + sem dados gravados) e
  // oferecem um botão que PARSEIA o resumo e abre o formulário pré-preenchido.
  // O parse é heurístico: campo que não casar vai vazio e a recepção completa
  // no formulário (que ela SEMPRE confere antes de salvar — nada é gravado
  // automaticamente).
  function _resumoCoraTexto(conv) {
    // Procura, da última para a primeira, uma mensagem da CORA com cara de
    // resumo de agendamento (tem "Paciente:" e "Exame:" ou "Data/Horário:").
    var h = conv && Array.isArray(conv.historico) ? conv.historico : [];
    for (var i = h.length - 1; i >= 0; i--) {
      var m = h[i];
      if (!m || m.role !== "assistant" || typeof m.content !== "string") continue;
      var t = m.content.replace(/\*/g, "");   // tira o negrito markdown
      if (/Paciente\s*:/i.test(t) && (/Exame\s*:/i.test(t) || /Data\/?Hor[áa]rio\s*:/i.test(t))) {
        return t;
      }
    }
    return null;
  }

  function _campoResumo(txt, rotulos) {
    // Extrai "Rótulo: valor" (linha iniciada ou não por "- "). Primeiro rótulo
    // que casar vence. Devolve string vazia se não achar.
    for (var i = 0; i < rotulos.length; i++) {
      var re = new RegExp("(?:^|\\n)\\s*-?\\s*" + rotulos[i] + "\\s*:\\s*([^\\n]+)", "i");
      var m = txt.match(re);
      if (m && m[1]) return m[1].trim();
    }
    return "";
  }

  function _dataBRparaISO(s) {
    // "01/11/1963" -> "1963-11-01"; "11/08" -> ISO com ano inferido (ano atual;
    // se a data já passou há mais de 30 dias, assume ano que vem). Se não
    // parsear, devolve "" (recepção preenche no formulário).
    var m = String(s || "").match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (!m) return "";
    var d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
    var ano = m[3] ? parseInt(m[3], 10) : null;
    if (ano !== null && ano < 100) ano += (ano > 30 ? 1900 : 2000);
    if (ano === null) {
      var hoje = new Date();
      ano = hoje.getFullYear();
      var tent = new Date(ano, mo - 1, d);
      if ((hoje - tent) > 30 * 86400000) ano += 1;   // já passou faz tempo: ano que vem
    }
    if (!(d >= 1 && d <= 31 && mo >= 1 && mo <= 12)) return "";
    return ano + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  function _parseResumoCora(conv) {
    var t = _resumoCoraTexto(conv);
    if (!t) return null;
    var dataHor = _campoResumo(t, ["Data\\/?Hor[áa]rio", "Data e hor[áa]rio", "Hor[áa]rio"]);
    var hora = "";
    var mh = dataHor.match(/(\d{1,2})[:h](\d{2})/);
    if (mh) hora = String(parseInt(mh[1], 10)).padStart(2, "0") + ":" + mh[2];
    return {
      paciente_nome: _campoResumo(t, ["Paciente", "Nome"]),
      data_nascimento: _dataBRparaISO(_campoResumo(t, ["Nascimento", "Data de nascimento"])),
      email: _campoResumo(t, ["E-?mail"]),
      exame: _campoResumo(t, ["Exame"]),
      convenio: _campoResumo(t, ["Conv[êe]nio", "Modalidade"]),
      indicacao: _campoResumo(t, ["Dentista", "Indica[çc][ãa]o"]),
      data_horario: dataHor,
      data_exame: _dataBRparaISO(dataHor),
      hora_exame: hora,
      telefone: (conv && conv.numero) || ""
    };
  }

  function _temResumoSemDados(conv) {
    // Só oferece o botão quando NÃO há agendamento_dados gravado mas EXISTE um
    // resumo da CORA no chat — o cenário exato do bug "encaminhei sem gravar".
    if (_agsLista(conv && conv.agendamento_dados).length) return false;
    return !!_resumoCoraTexto(conv);
  }

  async function criarDoResumo(numero) {
    var n = numero || _sel;
    if (!n) return;
    var conv = null;
    for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === n) { conv = _convs[i]; break; }
    var dados = _parseResumoCora(conv);
    if (!dados || (!dados.paciente_nome && !dados.exame)) {
      if (typeof toast === "function") toast("⚠️", "Não encontrei um resumo da CORA nesta conversa");
      return;
    }
    // Mesma trava do botão normal: assume a conversa antes de abrir o formulário.
    var ok = await _assumir(n);
    if (!ok) return;
    if (typeof window.preencherAgDaCora === "function") {
      window.preencherAgDaCora(dados);
      if (typeof toast === "function") toast("📋", "Dados extraídos do resumo — confira TUDO antes de salvar");
    } else {
      if (typeof toast === "function") toast("⚠️", "Função de agendamento indisponível");
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

  // ── v23 — "CORA retoma" (11/08/2026): pede que a CORA VOLTE a falar ──
  // Caso Maixner: o paciente pediu algo enquanto a conversa estava em modo
  // humano; devolvida, a CORA fica MUDA até mensagem nova dele. Este botão
  // chama /cora_retomar: a CORA relê o histórico e manda UMA mensagem que faz
  // a conversa andar. Se a conversa estava assumida por MIM, o backend já
  // devolve pra CORA no mesmo ato; assumida por OUTRO, ele recusa (409).
  async function coraRetomar() {
    if (!_sel) return;
    var instrucao = prompt(
      "Instrução para a CORA (opcional):\n" +
      "Ex.: \"foque na remarcação para a semana que vem\".\n" +
      "Deixe em branco para ela apenas retomar de onde parou.");
    if (instrucao === null) return;   // cancelou
    try {
      var r = await _chamarBot("/cora_retomar", {
        numero: _sel, instrucao: (instrucao || "").trim(), atendente: _quemSou()
      });
      if (r && r.ok) {
        if (typeof toast === "function") toast("🔄", "CORA retomou — mensagem enviada ao paciente");
        await _refresh();
        return;
      }
      if (r && r.status === 409) {
        var det = "";
        try { var d = await r.json(); det = String(d.detail || ""); } catch (e) {}
        if (det.indexOf("fora_da_janela_24h") !== -1) {
          if (typeof toast === "function") toast("⚠️", "Fora da janela de 24h da Meta — o paciente precisa escrever primeiro.");
        } else if (det.indexOf("ja_assumida") !== -1) {
          if (typeof toast === "function") toast("🔒", det.replace("ja_assumida:", "") + " está com esta conversa.");
        } else {
          if (typeof toast === "function") toast("⚠️", "Não foi possível retomar (409).");
        }
        return;
      }
      if (typeof toast === "function") toast("⚠️", "Falha ao retomar (HTTP " + (r ? r.status : "?") + ")");
    } catch (e) {
      console.error("coraRetomar:", e);
      if (typeof toast === "function") toast("⚠️", "Erro ao pedir retomada");
    }
  }

  // ── v25 — ORÇAMENTO DO CONCORRENTE (26/11/2026) ──
  // Dois botões no cabeçalho do chat: "Aprovar orçamento" e "Não cobrir".
  // Abrem um formulário (exame, valor, parcelas) e chamam /cora_orcamento.
  // O SERVIDOR monta o texto (fixo), envia ao paciente, devolve a conversa
  // para a CORA e grava a decisão em orcamentos_concorrencia. A prévia aqui
  // embaixo só espelha esse texto — quem manda é o servidor.
  // O formulário fica em document.body (fora do #pgWa) para o auto-refresh
  // de 4s não apagar o que a recepção está digitando.
  var _orc = null;   // { numero, decisao, enviando }

  function _orcReais(v) {
    try {
      return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) { return "R$ " + Number(v).toFixed(2).replace(".", ","); }
  }
  // "170" | "170,00" | "R$ 1.250,50" | "1.250" -> número; vazio -> null; lixo -> NaN
  function _orcNum(txt) {
    var t = String(txt == null ? "" : txt).replace(/r\$/i, "").replace(/\s/g, "");
    if (!t) return null;
    if (t.indexOf(",") !== -1) t = t.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    return parseFloat(t);
  }
  function _orcVal(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }
  // Lê e valida o formulário. Devolve { erro } ou { dados }.
  function _orcLer() {
    if (!_orc) return { erro: "Formulário fechado." };
    var exame = _orcVal("waOrcExame").replace(/\s+/g, " ");
    if (!exame) return { erro: "Informe o exame." };
    if (exame.length > 80 || exame.indexOf("*") !== -1) return { erro: "Nome do exame inválido (até 80 letras, sem asterisco)." };
    var valor = _orcNum(_orcVal("waOrcValor"));
    if (valor !== null && isNaN(valor)) return { erro: "Valor inválido. Use só números, ex.: 170 ou 170,00." };
    if (_orc.decisao === "aprovar" && valor === null) return { erro: "Informe o valor aprovado." };
    if (valor !== null && (valor < 20 || valor > 5000)) return { erro: "Valor fora da faixa (R$ 20 a R$ 5.000). Confira a digitação." };
    var parcelas = parseInt(_orcVal("waOrcParc") || "1", 10);
    if (!(parcelas >= 1 && parcelas <= 10)) return { erro: "Parcelas: de 1 a 10." };
    var conc = _orcNum(_orcVal("waOrcConc"));
    var nosso = _orcNum(_orcVal("waOrcNosso"));
    if ((conc !== null && isNaN(conc)) || (nosso !== null && isNaN(nosso))) return { erro: "Valor do concorrente ou valor de tabela inválido." };
    return { dados: {
      exame: exame, valor: valor, parcelas: parcelas,
      valor_concorrente: conc, valor_nosso: nosso,
      observacao: _orcVal("waOrcObs").substring(0, 300)
    } };
  }
  // Espelho dos textos fixos do servidor (regras.py). Só para a prévia.
  function _orcTexto(decisao, d) {
    var parc = d.parcelas > 1 ? ", em até " + d.parcelas + "x" : "";
    if (decisao === "aprovar") {
      return "Boa notícia! 😊 A nossa equipe avaliou e consegue fazer o exame *" + d.exame + "* por *" +
             _orcReais(d.valor) + "*" + parc + ". Quer que eu já veja um horário para você?";
    }
    if (d.valor !== null) {
      return "A nossa equipe avaliou com atenção o orçamento que você enviou. 😊 Para o exame *" + d.exame +
             "*, o melhor valor que conseguimos é *" + _orcReais(d.valor) + "*" + parc +
             ". Se quiser, já vejo um horário para você.";
    }
    return "A nossa equipe avaliou com atenção o orçamento que você enviou. 😊 Desta vez não conseguimos " +
           "chegar nesse valor para o exame *" + d.exame + "*; o nosso valor continua o que te passei. " +
           "Se quiser seguir com a gente, já vejo um horário para você.";
  }
  function orcPrevia() {
    var pv = document.getElementById("waOrcPrevia");
    if (!pv || !_orc) return;
    var l = _orcLer();
    if (l.erro) { pv.textContent = l.erro; pv.style.color = "#e6a700"; }
    else { pv.textContent = _orcTexto(_orc.decisao, l.dados); pv.style.color = "#0f6e56"; }
  }
  function orcFechar() {
    var m = document.getElementById("waOrcModal");
    if (m && m.parentNode) m.parentNode.removeChild(m);
    _orc = null;
  }
  function orcAbrir(decisao) {
    if (!_sel) return;
    if (decisao !== "aprovar" && decisao !== "recusar") return;
    orcFechar();
    var conv = null;
    for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === _sel) { conv = _convs[i]; break; }
    if (conv && conv.modo_humano && conv.humano_por && conv.humano_por !== _quemSou()) {
      if (typeof toast === "function") toast("🔒", esc(conv.humano_por) + " está com esta conversa.");
      return;
    }
    _orc = { numero: _sel, decisao: decisao, enviando: false };
    var aprovar = decisao === "aprovar";
    var inp = "width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid #2a3550;" +
              "background:#0f1626;color:#e6e6e6;font-size:.88rem;font-family:inherit";
    var lab = "display:block;font-size:.74rem;color:#9fb0cc;margin:10px 0 4px";
    var h = "";
    h += "<div style='background:#141c2e;border:1px solid #2a3550;border-radius:12px;padding:18px;width:440px;max-width:94vw;max-height:92vh;overflow-y:auto;color:#e6e6e6'>";
    h += "<div style='font-weight:600;font-size:1rem'>" + (aprovar ? "✅ Aprovar orçamento" : "🚫 Não cobrir orçamento") + "</div>";
    h += "<div style='font-size:.76rem;color:#9fb0cc;margin-top:2px'>Paciente " + esc(fmtNumero(_sel)) +
         " — a CORA envia a mensagem abaixo e segue com o agendamento.</div>";
    h += "<label style='" + lab + "'>Exame</label>";
    h += "<input id='waOrcExame' type='text' maxlength='80' placeholder='Ex.: Tomografia 1 Região' autocomplete='off' style='" + inp + "'>";
    h += "<div style='display:flex;gap:10px'>";
    h += "<div style='flex:2'><label style='" + lab + "'>" + (aprovar ? "Valor aprovado (R$)" : "Melhor valor que conseguimos (R$) — opcional") + "</label>";
    h += "<input id='waOrcValor' type='text' inputmode='decimal' placeholder='" + (aprovar ? "170,00" : "em branco = mantém o valor já passado") + "' autocomplete='off' style='" + inp + "'></div>";
    h += "<div style='flex:1'><label style='" + lab + "'>Parcelas</label><select id='waOrcParc' style='" + inp + "'>";
    for (var p = 1; p <= 10; p++) h += "<option value='" + p + "'>" + (p === 1 ? "à vista / 1x" : "até " + p + "x") + "</option>";
    h += "</select></div></div>";
    h += "<div style='display:flex;gap:10px'>";
    h += "<div style='flex:1'><label style='" + lab + "'>Valor do concorrente (R$)</label><input id='waOrcConc' type='text' inputmode='decimal' placeholder='opcional' autocomplete='off' style='" + inp + "'></div>";
    h += "<div style='flex:1'><label style='" + lab + "'>Nosso valor de tabela (R$)</label><input id='waOrcNosso' type='text' inputmode='decimal' placeholder='opcional' autocomplete='off' style='" + inp + "'></div>";
    h += "</div>";
    h += "<label style='" + lab + "'>Observação interna (o paciente não vê)</label>";
    h += "<input id='waOrcObs' type='text' maxlength='300' placeholder='Ex.: clínica X, orçamento por foto' autocomplete='off' style='" + inp + "'>";
    h += "<label style='" + lab + "'>Mensagem que o paciente vai receber</label>";
    h += "<div id='waOrcPrevia' style='background:#d8f5e3;color:#0f6e56;padding:8px 12px;border-radius:12px;font-size:.84rem;white-space:pre-wrap;min-height:38px'></div>";
    h += "<div style='display:flex;justify-content:flex-end;gap:8px;margin-top:16px'>";
    h += "<button class='btn' style='padding:7px 14px;font-size:.84rem' onclick='WHATSAPP.orcFechar()'>Cancelar</button>";
    h += "<button id='waOrcEnviar' class='btn' style='padding:7px 14px;font-size:.84rem;font-weight:600;color:#fff;background:" +
         (aprovar ? "#1f8a4c" : "#8a3b1f") + "' onclick='WHATSAPP.orcEnviar()'>" + (aprovar ? "Aprovar e enviar" : "Enviar resposta") + "</button>";
    h += "</div></div>";
    var m = document.createElement("div");
    m.id = "waOrcModal";
    m.style.cssText = "position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
    m.innerHTML = h;
    document.body.appendChild(m);
    // Exame: aproveita o que a CORA coletou no pedido, se houver (a recepção confere).
    var ags = _agsLista(conv && conv.agendamento_dados);
    var ex = (ags.length === 1 && typeof ags[0].exame === "string") ? ags[0].exame.replace(/\*/g, "").replace(/\s+/g, " ").trim() : "";
    var elEx = document.getElementById("waOrcExame");
    if (elEx) { elEx.value = ex.substring(0, 80); }
    ["waOrcExame", "waOrcValor", "waOrcParc", "waOrcConc", "waOrcNosso"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.addEventListener("input", orcPrevia); el.addEventListener("change", orcPrevia); }
    });
    orcPrevia();
    var foco = document.getElementById(ex ? "waOrcValor" : "waOrcExame");
    if (foco) foco.focus();
  }
  async function orcEnviar() {
    if (!_orc || _orc.enviando) return;
    var l = _orcLer();
    if (l.erro) { if (typeof toast === "function") toast("⚠️", l.erro); return; }
    var d = l.dados, decisao = _orc.decisao, numero = _orc.numero;
    var resumo = (decisao === "aprovar" ? "APROVAR " : "NÃO COBRIR — ") + d.exame +
                 (d.valor !== null ? " por " + _orcReais(d.valor) + (d.parcelas > 1 ? " em até " + d.parcelas + "x" : "") : "") +
                 "\npara " + fmtNumero(numero) + "?\n\nA mensagem vai direto ao paciente.";
    if (!confirm(resumo)) return;
    _orc.enviando = true;
    var bt = document.getElementById("waOrcEnviar");
    if (bt) { bt.disabled = true; bt.textContent = "Enviando…"; }
    function _soltar() {
      if (_orc) _orc.enviando = false;
      var b = document.getElementById("waOrcEnviar");
      if (b) { b.disabled = false; b.textContent = (decisao === "aprovar" ? "Aprovar e enviar" : "Enviar resposta"); }
    }
    try {
      var r = await _chamarBot("/cora_orcamento", {
        numero: numero, decisao: decisao, exame: d.exame, valor: d.valor, parcelas: d.parcelas,
        valor_concorrente: d.valor_concorrente, valor_nosso: d.valor_nosso,
        observacao: d.observacao, atendente: _quemSou()
      });
      if (r && r.ok) {
        var j = {}; try { j = await r.json(); } catch (e) {}
        orcFechar();
        if (typeof toast === "function") {
          toast("✅", (decisao === "aprovar" ? "Orçamento aprovado" : "Resposta enviada") + " — CORA segue com o paciente" +
                (j && j.registrado === false ? " (atenção: a decisão NÃO ficou gravada no relatório)" : ""));
        }
        await _refresh();
        return;
      }
      var det = "";
      if (r && r.status !== 401 && r.status !== 403) {
        try { var dj = await r.json(); det = String(dj.detail || ""); } catch (e) {}
      }
      var msg;
      if (!r) msg = null;   // sessão morta: _chamarBot já avisou
      else if (r.status === 401 || r.status === 403) msg = null;
      else if (r.status === 409 && det.indexOf("fora_da_janela_24h") !== -1) msg = "Fora da janela de 24h da Meta — o paciente precisa escrever primeiro.";
      else if (r.status === 409 && det.indexOf("ja_assumida") !== -1) msg = det.replace("ja_assumida:", "") + " está com esta conversa.";
      else if (r.status === 400) msg = "Dados recusados: " + (det || "confira os campos");
      else if (r.status === 404) msg = "O servidor da CORA ainda não tem esta função (falta o deploy).";
      else if (r.status === 502) msg = "O WhatsApp não aceitou o envio. Nada foi enviado; tente de novo.";
      else msg = "Falha ao enviar (HTTP " + r.status + ")";
      if (msg && typeof toast === "function") toast("⚠️", msg);
      _soltar();
    } catch (e) {
      console.error("orcEnviar:", e);
      if (typeof toast === "function") toast("⚠️", "Erro de rede — confira na conversa se a mensagem saiu antes de tentar de novo.");
      _soltar();
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
    } catch (e) { console.error("devolverCora:", e); }
  }

  // ── v27: anexar imagem na resposta ──
  // A Cloud API só aceita JPG/PNG até 5 MB. Arquivo fora disso (foto grande,
  // WEBP, HEIC que o navegador consiga abrir) é redesenhado em JPG reduzido.
  function _lerDataUrl(arq) {
    return new Promise(function (ok, erro) {
      var fr = new FileReader();
      fr.onload = function () { ok(String(fr.result || "")); };
      fr.onerror = function () { erro(new Error("leitura")); };
      fr.readAsDataURL(arq);
    });
  }
  function _reduzirImagem(dataUrl, lado, qualidade) {
    return new Promise(function (ok, erro) {
      var im = new Image();
      im.onload = function () {
        try {
          var w = im.naturalWidth, a = im.naturalHeight;
          var f = Math.min(1, lado / Math.max(w, a));
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(w * f));
          cv.height = Math.max(1, Math.round(a * f));
          var cx = cv.getContext("2d");
          cx.fillStyle = "#fff";            // PNG transparente não vira fundo preto
          cx.fillRect(0, 0, cv.width, cv.height);
          cx.drawImage(im, 0, 0, cv.width, cv.height);
          ok(cv.toDataURL("image/jpeg", qualidade));
        } catch (e) { erro(e); }
      };
      im.onerror = function () { erro(new Error("imagem")); };
      im.src = dataUrl;
    });
  }
  function _bytesDataUrl(dataUrl) {
    var i = dataUrl.indexOf(",");
    return Math.floor((dataUrl.length - i - 1) * 3 / 4);
  }
  async function _definirAnexo(arq) {
    if (!_sel || !arq) return;
    var numero = _sel;
    if (!arq.type || arq.type.indexOf("image/") !== 0) {
      if (typeof toast === "function") toast("⚠️", "Só é possível anexar imagem");
      return;
    }
    try {
      var dataUrl = await _lerDataUrl(arq);
      var aceito = (arq.type === "image/jpeg" || arq.type === "image/png");
      if (!aceito || arq.size > _IMG_MAX_BYTES) {
        dataUrl = await _reduzirImagem(dataUrl, _IMG_LADO_MAX, 0.85);
        if (_bytesDataUrl(dataUrl) > _IMG_MAX_BYTES) dataUrl = await _reduzirImagem(dataUrl, 1400, 0.75);
      }
      if (_bytesDataUrl(dataUrl) > _IMG_MAX_BYTES) {
        if (typeof toast === "function") toast("⚠️", "Imagem acima de 5 MB mesmo reduzida");
        return;
      }
      if (_sel !== numero) return;   // trocou de conversa enquanto lia o arquivo
      _anexo = { numero: numero, dataUrl: dataUrl, nome: arq.name || "imagem colada" };
      render();
      var ta = document.getElementById("waResp");
      if (ta) ta.focus();
    } catch (e) {
      console.error("anexo:", e);
      if (typeof toast === "function") toast("⚠️", "Não consegui abrir esta imagem. Use JPG ou PNG.");
    }
  }
  function anexarImagem() {
    var inp = document.getElementById("waAnexoInput");
    if (inp) { inp.value = ""; inp.click(); }
  }
  function anexoEscolhido(inp) {
    var arq = inp && inp.files && inp.files[0];
    if (arq) _definirAnexo(arq);
  }
  // Ctrl+V de print/imagem no campo de resposta vira anexo; texto colado segue normal.
  function colarImagem(ev) {
    var itens = ev && ev.clipboardData && ev.clipboardData.items;
    if (!itens) return;
    for (var i = 0; i < itens.length; i++) {
      if (itens[i].kind === "file" && itens[i].type.indexOf("image/") === 0) {
        var arq = itens[i].getAsFile();
        if (arq) { ev.preventDefault(); _definirAnexo(arq); }
        return;
      }
    }
  }
  function removerAnexo() { _anexo = null; render(); }

  async function _enviarImagem(texto) {
    var anx = _anexo;
    var r = await _chamarBot("/enviar_imagem_manual", {
      numero: _sel, imagem_base64: anx.dataUrl, legenda: texto, atendente: _quemSou()
    });
    if (r && r.ok) {
      _anexo = null;
      _limparCampo = true;
      var ta = document.getElementById("waResp");
      if (ta) ta.value = "";
      if (typeof toast === "function") toast("✅", "Imagem enviada ao paciente");
      await _refresh();
      return;
    }
    var det = "";
    if (r) { try { var dj = await r.json(); det = String(dj.detail || ""); } catch (e) {} }
    console.error("enviarImagem:", r && r.status, det);
    var msg;
    if (!r || r.status === 401 || r.status === 403) msg = null;   // sessão morta: _chamarBot já avisou
    else if (r.status === 409) msg = "Fora da janela de 24h da Meta — o paciente precisa escrever primeiro.";
    else if (r.status === 413) msg = "Imagem acima de 5 MB.";
    else if (r.status === 415) msg = "Formato não aceito: use JPG ou PNG.";
    else if (r.status === 404 || r.status === 405) msg = "O servidor da CORA ainda não tem esta função (falta o deploy).";
    else if (r.status === 502) msg = "O WhatsApp não aceitou a imagem. Nada foi enviado; tente de novo.";
    else msg = "Falha ao enviar a imagem (HTTP " + r.status + ")";
    if (msg && typeof toast === "function") toast("⚠️", msg);
  }

  async function enviarResposta() {
    if (!_sel || _enviando) return;
    var ta = document.getElementById("waResp");
    var texto = ta ? ta.value.trim() : "";
    var temAnexo = !!(_anexo && _anexo.numero === _sel);
    if (!texto && !temAnexo) { if (typeof toast === "function") toast("✍️", "Digite uma mensagem"); return; }
    _enviando = true;
    try {
      if (temAnexo) { await _enviarImagem(texto); return; }
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
    } catch (e) {
      console.error("enviarResposta:", e);
      if (typeof toast === "function") toast("⚠️", temAnexo ? "Erro de rede — confira na conversa se a imagem saiu antes de tentar de novo." : "Erro ao enviar");
    } finally { _enviando = false; }
  }

  function abrir(numero) { if (numero !== _sel) _anexo = null; _sel = numero; render(); }
  // v26 (celular): fecha a conversa e volta para a lista
  function voltar() { _sel = null; _anexo = null; render(); }

  // ── v26: layout de celular ──
  // Até 760px (mesmo corte do index.html) mostra UM painel por vez: a lista
  // ocupa a tela toda e, ao tocar numa conversa, o chat abre em tela cheia com
  // "← Voltar". Acima de 760px nada muda (as regras ficam dentro do @media).
  var _MQ_CEL = "(max-width:760px)";
  function _ehCelular() {
    try { return !!(window.matchMedia && window.matchMedia(_MQ_CEL).matches); } catch (e) { return false; }
  }
  function _cssCelular() {
    if (document.getElementById("waCssCel")) return;
    var st = document.createElement("style");
    st.id = "waCssCel";
    st.textContent =
      ".wa-voltar,.wa-so-cel{display:none}" +
      ".wa-cab-id{display:flex;align-items:center;gap:8px;min-width:0}" +
      "@media" + _MQ_CEL + "{" +
        "#pgWa{padding-top:8px!important;padding-bottom:calc(8px + env(safe-area-inset-bottom))!important}" +
        ".wa-root{height:calc(100dvh - 170px)!important}" +
        ".wa-lista{width:100%!important;border-right:0!important}" +
        ".wa-conv{display:none!important}" +
        ".wa-root.wa-aberta .wa-lista{display:none!important}" +
        ".wa-root.wa-aberta .wa-conv{display:flex!important}" +
        ".wa-voltar,.wa-so-cel{display:inline-flex;align-items:center;justify-content:center}" +
        ".wa-rodape-lista{display:none!important}" +
        ".wa-item{padding:12px 14px!important}" +
        ".wa-cab{flex-direction:column;align-items:stretch!important;gap:8px;padding:8px 10px!important}" +
        ".wa-acoes{flex-wrap:nowrap!important;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}" +
        ".wa-acoes .btn{flex:0 0 auto;white-space:nowrap;min-height:38px}" +
        ".wa-msgs{padding:10px!important}" +
        ".wa-bolha{max-width:86%!important}" +
        ".wa-barra{padding:8px 10px!important}" +
        "#waResp,#waBusca{font-size:16px!important}" +   // <16px faz o iPhone dar zoom ao focar
      "}";
    document.head.appendChild(st);
  }
  // No celular a altura do quadro é o que sobra da tela abaixo do cabeçalho do app.
  function _ajustarAltura() {
    var root = document.getElementById("waRoot");
    var pg = document.getElementById("pgWa");
    if (!root || !pg || pg.offsetParent === null) return;
    if (!_ehCelular()) { root.style.setProperty("height", "calc(100vh - 150px)"); return; }
    var pb = 0;
    try { pb = parseFloat(window.getComputedStyle(pg).paddingBottom) || 0; } catch (e) {}
    var topo = root.getBoundingClientRect().top + (window.pageYOffset || 0);
    var alt = Math.max(320, Math.round(window.innerHeight - topo - pb));
    root.style.setProperty("height", alt + "px", "important");
  }
  var _altOuvindo = false;
  function _ouvirAltura() {
    if (_altOuvindo) return;
    _altOuvindo = true;
    window.addEventListener("resize", _ajustarAltura);
    window.addEventListener("orientationchange", function () { setTimeout(_ajustarAltura, 250); });
  }
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
    h += "<div id='waRoot' class='wa-root" + (_sel ? " wa-aberta" : "") + "' style='display:flex;gap:0;border:0.5px solid #2a3550;border-radius:12px;overflow:hidden;height:calc(100vh - 150px)'>";

    // ── COLUNA ESQUERDA: lista de conversas ──
    h += "<div class='wa-lista' style='width:270px;border-right:0.5px solid #2a3550;display:flex;flex-direction:column;flex-shrink:0'>";
    // cabeçalho + abas
    h += "<div style='padding:12px 14px;border-bottom:0.5px solid #2a3550'>";
    h += "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px'>";
    h += "<div style='font-weight:600;font-size:15px'>💬 Conversas</div>";
    // v26: no celular o "Atualizar" vira um ícone aqui (o rodapé da lista some)
    h += "<button class='wa-so-cel' title='Atualizar' aria-label='Atualizar' onclick='WHATSAPP.refresh()' " +
         "style='background:transparent;border:0.5px solid #2a3550;border-radius:8px;color:inherit;cursor:pointer;font-size:1.05rem;width:40px;height:40px'>↻</button>";
    h += "</div>";
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
        var numJs = jsArg(c.numero);   // v24: escapa aspas/apóstrofos corretamente
        h += "<div class='wa-item' onclick='WHATSAPP.abrir(" + numJs + ")' style='padding:10px 14px;border-bottom:0.5px solid #2a3550;cursor:pointer;" +
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
    h += "<div class='wa-rodape-lista' style='padding:8px 12px;border-top:0.5px solid #2a3550'><button class='btn btng' style='width:100%;padding:6px;font-size:.78rem' onclick='WHATSAPP.refresh()'>↻ Atualizar</button></div>";
    h += "</div>";  // fim coluna esquerda

    // ── COLUNA DIREITA: chat ──
    h += "<div class='wa-conv' style='flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden'>";
    if (!_sel) {
      h += "<div style='flex:1;display:flex;align-items:center;justify-content:center;color:var(--gr);font-size:.85rem;padding:40px;text-align:center'>Selecione uma conversa à esquerda para ver e responder.</div>";
    } else {
      var conv = null;
      for (var i = 0; i < _convs.length; i++) if (_convs[i].numero === _sel) { conv = _convs[i]; break; }
      var emHumano = !!(conv && conv.modo_humano);
      var jaResolvida = !!(conv && conv.resolvida);

      // cabeçalho do chat
      h += "<div class='wa-cab' style='padding:10px 16px;border-bottom:0.5px solid #2a3550;display:flex;justify-content:space-between;align-items:center'>";
      h += "<div class='wa-cab-id'>";
      // v26: "← Voltar" (só aparece no celular)
      h += "<button class='wa-voltar' title='Voltar para a lista' aria-label='Voltar para a lista' onclick='WHATSAPP.voltar()' " +
           "style='background:transparent;border:0.5px solid #2a3550;border-radius:8px;color:inherit;cursor:pointer;font-size:1.1rem;width:40px;height:40px;flex-shrink:0'>←</button>";
      h += "<div style='min-width:0'>";
      h += "<div style='font-weight:500;font-size:14px'>" + esc(fmtNumero(_sel)) + "</div>";
      if (emHumano && conv.humano_por) {
        h += "<div style='font-size:11px;color:var(--ac,#4ab848)'>🙋 " + esc(conv.humano_por) + " assumiu — CORA pausada</div>";
      } else {
        h += "<div style='font-size:11px;color:var(--gr)'>🤖 CORA atendendo</div>";
      }
      h += "</div>";
      h += "</div>";  // fim wa-cab-id
      // botões do cabeçalho (no celular: uma linha que rola para o lado)
      h += "<div class='wa-acoes' style='display:flex;gap:6px;flex-wrap:wrap'>";
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
      } else if (_temResumoSemDados(conv)) {
        // (10/08/2026) A CORA escreveu o resumo no chat mas NÃO gravou o pedido
        // (caso Gláucia): oferece extrair do texto. Âmbar = atenção, conferir tudo.
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:linear-gradient(135deg,#e6a700,#c98d00);color:#fff;font-weight:600' title='A CORA escreveu o resumo mas não gravou o pedido — extrai os dados do texto do chat' onclick='WHATSAPP.criarDoResumo()'>📋 Criar do resumo</button>";
      }
      // Se EU assumi (ex.: cliquei em Criar agendamento, que trava a conversa),
      // mostro o botão de devolver aqui no cabeçalho também, para liberar fácil.
      // Se esquecer, o job de fim de expediente (18:30) devolve automaticamente.
      if (emHumano && conv.humano_por && conv.humano_por === _quemSou()) {
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:#243049;color:#e6e6e6' onclick='WHATSAPP.devolverCora()'>↩️ Devolver para a CORA</button>";
      }
      if (!jaResolvida) {
        // v23 — pede que a CORA volte a falar (retomada); some em resolvidas
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:#1d3a5f;color:#cfe3ff' title='A CORA relê a conversa e manda uma mensagem que faz o atendimento andar' onclick='WHATSAPP.coraRetomar()'>🔄 CORA retoma</button>";
        // v25 — resposta da equipe ao orçamento do concorrente (some se OUTRO atendente detém a conversa)
        if (!(emHumano && conv.humano_por && conv.humano_por !== _quemSou())) {
          h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:#1f8a4c;color:#fff;font-weight:600' title='Cobrir o orçamento do concorrente: a CORA informa o valor aprovado e segue com o agendamento' onclick='WHATSAPP.orcAbrir(\"aprovar\")'>✅ Aprovar orçamento</button>";
          h += "<button class='btn' style='padding:5px 12px;font-size:.8rem;background:#5a2e1f;color:#ffd9cc' title='Não cobrir: a CORA avisa com educação e oferece seguir com o nosso valor' onclick='WHATSAPP.orcAbrir(\"recusar\")'>🚫 Não cobrir</button>";
        }
        h += "<button class='btn btng' style='padding:5px 12px;font-size:.8rem' onclick='WHATSAPP.resolver()'>✓ Resolver</button>";
      } else {
        h += "<button class='btn' style='padding:5px 12px;font-size:.8rem' onclick='WHATSAPP.reabrir()'>↩️ Reabrir</button>";
      }
      h += "</div>";
      h += "</div>";

      // mensagens (cores do mockup: paciente claro c/ borda, CORA/recepção verde suave)
      var hist = (conv && Array.isArray(conv.historico)) ? conv.historico : [];
      h += "<div id='waChatScroll' class='wa-msgs' style='flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;background:#000'>";
      if (!hist.length) {
        h += "<div style='color:var(--gr);text-align:center;padding:20px'>Sem mensagens.</div>";
      } else {
        hist.forEach(function (m) {
          var isBot = m.role === "assistant";
          // Mensagem com IMAGEM (paciente enviou foto pela CORA)
          if (m.midia && m.midia.tipo === "image" && m.midia.path) {
            var cap = _legendaMidia(m.content);
            var imgId = "waimg_" + Math.random().toString(36).slice(2, 9);
            // v27: imagem enviada pela equipe (role assistant) fica à direita, em verde
            if (isBot) h += "<div class='wa-bolha' style='align-self:flex-end;max-width:72%;background:#d8f5e3;color:#0f6e56;padding:6px;border-radius:12px'>";
            else h += "<div class='wa-bolha' style='align-self:flex-start;max-width:72%;background:#f0f0f0;color:#222;padding:6px;border-radius:12px;border:0.5px solid #ddd'>";
            h += "<img id='" + imgId + "' alt='" + (isBot ? "imagem enviada" : "imagem do paciente") + "' style='max-width:240px;max-height:280px;border-radius:8px;display:block;cursor:pointer;background:#e5e5e5;min-height:80px' onclick='WHATSAPP.abrirMidia(" + jsArg(m.midia.path) + ")'/>";
            if (cap) h += "<div style='font-size:.8rem;margin-top:4px;padding:0 4px'>" + esc(cap) + "</div>";
            h += "<div style='font-size:.72rem;color:#0a7;margin-top:3px;padding:0 4px;cursor:pointer' onclick='WHATSAPP.abrirMidia(" + jsArg(m.midia.path) + ")'>📎 abrir / baixar</div>";
            h += "</div>";
            // carrega a imagem via URL assinada (bucket privado)
            _carregarMidia(m.midia.path, imgId);
          } else if (isBot) {
            h += "<div class='wa-bolha' style='align-self:flex-end;max-width:72%;background:#d8f5e3;color:#0f6e56;padding:8px 12px;border-radius:12px;font-size:.85rem;white-space:pre-wrap'>" + esc(m.content) + "</div>";
          } else {
            h += "<div class='wa-bolha' style='align-self:flex-start;max-width:72%;background:#f0f0f0;color:#222;padding:8px 12px;border-radius:12px;font-size:.85rem;white-space:pre-wrap;border:0.5px solid #ddd'>" + esc(m.content) + "</div>";
          }
        });
      }
      h += "</div>";

      // barra de resposta (Fase C)
      h += "<div class='wa-barra' style='padding:10px 16px;border-top:0.5px solid #2a3550'>";
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
          // v27 — imagem anexada (prévia) + botão de anexar; o texto vira a legenda
          var anx = (_anexo && _anexo.numero === _sel) ? _anexo : null;
          if (anx) {
            h += "<div style='display:flex;align-items:center;gap:10px;margin-bottom:8px;padding:6px 8px;border-radius:8px;background:#0f1626;border:1px solid #2a3550'>";
            h += "<img src='" + esc(anx.dataUrl) + "' alt='imagem a enviar' style='height:56px;max-width:90px;object-fit:cover;border-radius:6px'/>";
            h += "<span style='flex:1;min-width:0;font-size:.78rem;color:#e6e6e6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>📎 " + esc(anx.nome) + "</span>";
            h += "<button class='btn' style='padding:4px 10px;font-size:.78rem' title='Remover a imagem' onclick='WHATSAPP.removerAnexo()'>✕ Remover</button>";
            h += "</div>";
          }
          h += "<input type='file' id='waAnexoInput' accept='image/*' style='display:none' onchange='WHATSAPP.anexoEscolhido(this)'/>";
          h += "<div style='display:flex;gap:8px;align-items:flex-end'>";
          h += "<button class='btn' style='padding:8px 10px;font-size:.95rem' title='Anexar imagem (ou cole com Ctrl+V)' onclick='WHATSAPP.anexarImagem()'>📎</button>";
          h += "<textarea id='waResp' rows='2' onpaste='WHATSAPP.colarImagem(event)' placeholder='" + (anx ? "Legenda da imagem (opcional)…" : "Digite sua resposta ao paciente…") + "' style='flex:1;padding:8px;border-radius:8px;border:1px solid #2a3550;background:#0f1626;color:#e6e6e6;font-size:.85rem;resize:vertical;font-family:inherit'></textarea>";
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

    _cssCelular();
    el.innerHTML = h;
    _ajustarAltura();
    _ouvirAltura();

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
    voltar: voltar,
    setAba: setAba,
    setBusca: setBusca,
    refresh: _refresh,
    resolver: resolver,
    reabrir: reabrir,
    criarAgendamento: criarAgendamento,
    criarDoResumo: criarDoResumo,
    abrirMidia: abrirMidia,
    assumirConversa: assumirConversa,
    coraRetomar: coraRetomar,
    devolverCora: devolverCora,
    orcAbrir: orcAbrir,
    orcFechar: orcFechar,
    orcEnviar: orcEnviar,
    enviarResposta: enviarResposta,
    anexarImagem: anexarImagem,
    anexoEscolhido: anexoEscolhido,
    colarImagem: colarImagem,
    removerAnexo: removerAnexo,
    versao: _VERSAO
  };
})();

// expõe para o navTo map do index.html
window.rWhatsApp = WHATSAPP.rWhatsApp;
