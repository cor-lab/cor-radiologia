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
  var _fila = [];         // escalações pendentes
  var _sel = null;        // numero da conversa aberta
  var _carregando = false;

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

  // ── carregamento (só leitura) ──
  async function carregar() {
    if (_carregando) return;
    _carregando = true;
    try {
      var cRes = await supa.from("conversas")
        .select("numero,historico,atualizado_em")
        .order("atualizado_em", { ascending: false })
        .limit(100);
      _convs = (cRes.data || []);

      var fRes = await supa.from("atendimento_humano")
        .select("id,numero,ultima_msg,criado_em,resolvido")
        .eq("resolvido", false)
        .order("criado_em", { ascending: false })
        .limit(100);
      _fila = (fRes.data || []);
    } catch (e) {
      console.error("WHATSAPP carregar:", e);
      if (typeof toast === "function") toast("⚠️", "Falha ao carregar conversas");
    } finally {
      _carregando = false;
    }
  }

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
    h += "<div style='font-size:1.6rem;font-weight:700;color:" + (_fila.length ? "var(--r)" : "var(--g)") + "'>" + _fila.length + "</div></div>";
    h += "<div class='card' style='flex:1;display:flex;align-items:center;justify-content:center'>";
    h += "<button class='btn btng' onclick='WHATSAPP.refresh()'>↻ Atualizar</button></div>";
    h += "</div>";

    // fila de escalações
    if (_fila.length) {
      h += "<div class='card' style='margin-bottom:14px'>";
      h += "<div class='ctitle'>🔔 Escalações para a recepção</div>";
      h += "<table style='width:100%;font-size:.85rem'><thead><tr>";
      h += "<th style='text-align:left'>Número</th><th style='text-align:left'>Mensagem / Pedido</th><th>Quando</th>";
      h += "</tr></thead><tbody>";
      _fila.forEach(function (f) {
        h += "<tr>";
        h += "<td style='font-family:DM Mono,monospace'>" + esc(fmtNumero(f.numero)) + "</td>";
        h += "<td>" + esc(f.ultima_msg || "") + "</td>";
        h += "<td style='white-space:nowrap;color:var(--gr)'>" + esc(fmtHora(f.criado_em)) + "</td>";
        h += "</tr>";
      });
      h += "</tbody></table></div>";
    }

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
    render();
  }

  return {
    rWhatsApp: rWhatsApp,
    abrir: function (numero) { _sel = numero; render(); },
    refresh: async function () { await carregar(); render(); }
  };
})();

// expõe para o navTo map do index.html
window.rWhatsApp = WHATSAPP.rWhatsApp;
