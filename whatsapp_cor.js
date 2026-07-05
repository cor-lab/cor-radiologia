/* ═══════════════════════════════════════════════════════════════════════
   whatsapp_cor.js — Aba "💬 WhatsApp" do App COR
   FASE A (monitor): SOMENTE LEITURA. Mostra as conversas do bot com os
   pacientes e a fila de escalações (atendimento_humano). NÃO envia mensagens
   nem assume conversas (isso é Fase C, futura).

   Padrão espelhado de reportes.js:
     - namespace global WHATSAPP
     - função window.rWhatsApp() chamada pelo navTo map
     - leitura via supa.from(...) (client = supa)
     - estilo: classes card/ctitle/btn/badge do App COR

   Tabelas lidas:
     - conversas          (numero, historico[jsonb], atualizado_em)
     - atendimento_humano (numero, ultima_msg, criado_em, resolvido)
   ═══════════════════════════════════════════════════════════════════════ */
var WHATSAPP = (function () {
  "use strict";

  var _convs = [];        // lista de conversas carregadas
  var _fila = [];         // escalações (conforme filtro)
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
      var cRes = await supa.from("conversas")
        .select("numero,historico,atualizado_em")
        .order("atualizado_em", { ascending: false })
        .limit(100);
      _convs = (cRes.data || []);

      var q = supa.from("atendimento_humano")
        .select("id,numero,ultima_msg,criado_em,resolvido,em_atendimento,atendido_por,resolvido_em,resolvido_por")
        .order("criado_em", { ascending: false })
        .limit(200);

      if (_filtroFila === "pendente") {
        q = q.eq("resolvido", false).eq("em_atendimento", false);
      } else if (_filtroFila === "atendimento") {
        q = q.eq("resolvido", false).eq("em_atendimento", true);
      } else { // resolvido
        q = q.eq("resolvido", true);
      }

      var fRes = await q;
      _fila = (fRes.data || []);
    } catch (e) {
      console.error("WHATSAPP carregar:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao carregar conversas");
    } finally {
      _carregando = false;
    }
  }

  // conta pendentes reais (para o card de resumo), independente do filtro atual
  var _nPendentes = 0;
  async function contarPendentes() {
    try {
      var r = await supa.from("atendimento_humano")
        .select("id", { count: "exact", head: true })
        .eq("resolvido", false).eq("em_atendimento", false);
      _nPendentes = (r.count != null) ? r.count : _fila.length;
    } catch (e) { _nPendentes = _fila.length; }
  }

  // ── ações (Fase B) ──
  function _quemSou() {
    // tenta pegar o usuário logado do App COR (variável global CU)
    try {
      if (typeof CU !== "undefined" && CU) return CU.nome || CU.email || CU.login || "recepção";
    } catch (e) {}
    return "recepção";
  }

  async function assumir(id) {
    try {
      await supa.from("atendimento_humano")
        .update({ em_atendimento: true, atendido_por: _quemSou() })
        .eq("id", id);
      if (typeof toast === "function") toast("👋", "Item assumido");
      await refresh();
    } catch (e) {
      console.error(e);
      if (typeof toast === "function") toast("⚠️", "Falha ao assumir");
    }
  }

  async function resolver(id) {
    try {
      await supa.from("atendimento_humano")
        .update({ resolvido: true, em_atendimento: false,
                  resolvido_em: new Date().toISOString(), resolvido_por: _quemSou() })
        .eq("id", id);
      if (typeof toast === "function") toast("✅", "Marcado como resolvido");
      await refresh();
    } catch (e) {
      console.error(e);
      if (typeof toast === "function") toast("⚠️", "Falha ao resolver");
    }
  }

  async function reabrir(id) {
    try {
      await supa.from("atendimento_humano")
        .update({ resolvido: false, em_atendimento: false,
                  resolvido_em: null, resolvido_por: null })
        .eq("id", id);
      if (typeof toast === "function") toast("↩️", "Reaberto");
      await refresh();
    } catch (e) {
      console.error(e);
      if (typeof toast === "function") toast("⚠️", "Falha ao reabrir");
    }
  }

  function setFiltro(f) { _filtroFila = f; refresh(); }

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
    var abas = [["pendente","Pendentes"],["atendimento","Em atendimento"],["resolvido","Resolvidas"]];
    h += "<div style='display:flex;gap:6px'>";
    abas.forEach(function (a) {
      var on = _filtroFila === a[0];
      h += "<button onclick=\"WHATSAPP.setFiltro('" + a[0] + "')\" class='btn' style='padding:4px 10px;font-size:.78rem;" +
           (on ? "background:var(--ac,#4ab848);color:#fff" : "background:transparent;color:var(--gr)") + "'>" + a[1] + "</button>";
    });
    h += "</div></div>";

    if (!_fila.length) {
      h += "<div style='padding:18px;text-align:center;color:var(--gr)'>Nenhum item nesta lista.</div>";
    } else {
      h += "<table style='width:100%;font-size:.85rem;margin-top:8px'><thead><tr>";
      h += "<th style='text-align:left'>Número</th><th style='text-align:left'>Mensagem / Pedido</th><th>Quando</th><th>Ações</th>";
      h += "</tr></thead><tbody>";
      _fila.forEach(function (f) {
        h += "<tr>";
        h += "<td style='font-family:DM Mono,monospace;white-space:nowrap'>" + esc(fmtNumero(f.numero)) + "</td>";
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
        if (_filtroFila === "pendente") {
          h += "<button class='btn' style='padding:4px 8px;font-size:.75rem;margin-right:4px' onclick='WHATSAPP.assumir(" + f.id + ")'>Assumir</button>";
          h += "<button class='btn btng' style='padding:4px 8px;font-size:.75rem' onclick='WHATSAPP.resolver(" + f.id + ")'>Resolver</button>";
        } else if (_filtroFila === "atendimento") {
          h += "<button class='btn btng' style='padding:4px 8px;font-size:.75rem' onclick='WHATSAPP.resolver(" + f.id + ")'>Resolver</button>";
        } else { // resolvido
          h += "<button class='btn' style='padding:4px 8px;font-size:.75rem' onclick='WHATSAPP.reabrir(" + f.id + ")'>Reabrir</button>";
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
      h += "<div style='margin-top:12px;padding:10px;background:#fff8e1;border-radius:8px;font-size:.78rem;color:#8a6d00'>";
      h += "ℹ️ Modo monitor (somente leitura). Para responder ao paciente, use o WhatsApp da recepção. Em breve será possível assumir a conversa por aqui.";
      h += "</div>";
    }
    h += "</div>";

    h += "</div>";

    el.innerHTML = h;
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
  }

  return {
    rWhatsApp: rWhatsApp,
    abrir: function (numero) { _sel = numero; render(); },
    refresh: async function () { await carregar(); await contarPendentes(); render(); },
    setFiltro: setFiltro,
    assumir: assumir,
    resolver: resolver,
    reabrir: reabrir
  };
})();

// expõe para o navTo map do index.html
window.rWhatsApp = WHATSAPP.rWhatsApp;
