/* ═══════════════════════════════════════════════════════════════════════
   relacionamento_cor.js — appCOR · Módulo RELACIONAMENTO · Etapa 1
   v20261112d — WhatsApp Web na ficha: 5 variações de texto e contador diário
                (referência de 5/dia; avisa ao passar, não bloqueia)

   Aba exclusiva de ADMINISTRADORES: evolução dos encaminhamentos (volume de
   ATENDIMENTOS REALIZADOS), lista de oportunidades, ficha individual do
   solicitante e exclusões do foco comercial.

   • Módulo externo (padrão chat_cor.js / reportes.js): injeta sozinho o botão
     no menu ⚙ Administração, a página #page-relacionamento e PERMS.admin.
   • NÃO lê o array local de agendamentos (2.000 mais recentes). Todos os
     números vêm das funções rel_* no Supabase, que recusam quem não é admin.
   • Erro/timeout NUNCA vira zero: a tela mostra o erro e nenhum número.
   • Não envia mensagens sozinho: o botão WhatsApp só ABRE o WhatsApp Web com o
     texto preenchido; quem envia é a pessoa. Registro de contatos = Etapa 2.
   • Desligar: configuracoes.rel_ativo = false (esconde a aba).
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var PAG = "relacionamento";
  var POR_PAGINA = 50;
  var COR_ATUAL = "#4ab848";   /* série do período atual  (--g)  */
  var COR_ANT = "#9db0ca";     /* mesmo período do ano anterior   */
  var COR_PERDA = "#fb923c";   /* barras de perda          (--or) */

  var S = {
    ativo: true,
    escopo: "comercial",
    sub: "geral",
    carregando: false,
    erro: null,
    painel: null,
    lista: null,
    exclusoes: null,
    filtro: { classe: "atencao", busca: "", base10: true, tel: "" },
    ordem: { col: "perda", dir: -1 },
    pag: 0,
    fichaId: null,
    ficha: null,
    fichaErro: null,
    fichaMeses: 24,
    scrollLista: 0
  };

  var CLASSES = {
    queda_acentuada:     { rot: "Queda acentuada",              css: "br"  },
    sem_encaminhamentos: { rot: "Sem encaminhamentos em 12m",   css: "br"  },
    retomou_mes:         { rot: "Zerado em 12m · voltou no mês", css: "bo"  },
    reduziu:             { rot: "Reduziu",                      css: "bo"  },
    estavel:             { rot: "Estável",                      css: "bgr" },
    cresceu:             { rot: "Cresceu",                      css: "bg"  },
    novo:                { rot: "Novo observado",               css: "bt"  },
    recuperado:          { rot: "Voltou a encaminhar",          css: "bp"  }
  };
  var ATENCAO = { queda_acentuada: 1, sem_encaminhamentos: 1, retomou_mes: 1, reduziu: 1 };

  /* ── utilitários ─────────────────────────────────────────────────── */
  function h(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function num(n) { return Number(n || 0).toLocaleString("pt-BR"); }
  function sinal(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + num(Math.abs(n)); }
  function pct(atual, base) {
    if (!base) return "n/a";
    var p = (atual - base) * 100 / base;
    var t = Math.abs(p).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return (p > 0 ? "+" : p < 0 ? "−" : "") + t + "%";
  }
  var MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  function mesRot(iso) {           /* "2026-10-01" -> "out/26" */
    var p = String(iso || "").split("-");
    if (p.length < 2) return "";
    return MESES[parseInt(p[1], 10) - 1] + "/" + p[0].slice(2);
  }
  function dataBR(iso) {           /* "2026-10-31" -> "31/10/2026" */
    var p = String(iso || "").slice(0, 10).split("-");
    if (p.length < 3) return "—";
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function dataHoraBR(ts) {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return String(ts); }
  }
  function diaAnterior(iso) {      /* fim exclusivo -> último dia incluído */
    var p = String(iso).split("-");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) - 86400000);
    return d.toISOString().slice(0, 10);
  }
  function diasEntre(isoA, isoB) {
    var a = String(isoA).split("-"), b = String(isoB).split("-");
    return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 86400000);
  }
  function avisar(ico, msg) { if (typeof toast === "function") toast(ico, msg); }
  function souAdmin() { return typeof CU !== "undefined" && CU && CU.role === "admin"; }
  function raiz() { return document.getElementById("pgRel"); }

  /* ── estilos ─────────────────────────────────────────────────────── */
  function instalarCss() {
    if (document.getElementById("relCss")) return;
    var st = document.createElement("style");
    st.id = "relCss";
    st.textContent = [
      ".rel-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-bottom:14px}",
      ".rel-top h2{font-family:'Playfair Display',serif;font-size:1.25rem;margin-right:auto}",
      ".rel-seg{display:inline-flex;border:1px solid rgba(255,255,255,.12);border-radius:9px;overflow:hidden}",
      ".rel-seg button{background:transparent;border:0;color:var(--gr);padding:7px 13px;font:600 .8rem 'DM Sans',sans-serif;cursor:pointer}",
      ".rel-seg button.on{background:rgba(74,184,72,.16);color:var(--wh)}",
      ".rel-saude{font-size:.76rem;color:var(--gr)}",
      ".rel-aviso{background:rgba(251,146,60,.1);border:1px solid rgba(251,146,60,.3);color:#fdba74;border-radius:10px;padding:10px 14px;font-size:.82rem;margin-bottom:14px}",
      ".rel-erro{background:rgba(224,82,82,.1);border:1px solid rgba(224,82,82,.3);color:#fca5a5;border-radius:10px;padding:16px;font-size:.86rem}",
      ".rel-tabs{display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:16px;flex-wrap:wrap}",
      ".rel-tabs button{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--gr);padding:9px 14px;font:600 .84rem 'DM Sans',sans-serif;cursor:pointer}",
      ".rel-tabs button.on{color:var(--wh);border-bottom-color:var(--g)}",
      ".rel-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}",
      ".rel-kpi{background:rgba(18,36,78,.75);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;min-width:0}",
      ".rel-kpi.clic{cursor:pointer}.rel-kpi.clic:hover{border-color:rgba(74,184,72,.4)}",
      ".rel-kpi .l{font-size:.72rem;color:var(--gr);font-weight:700;text-transform:uppercase;letter-spacing:.04em}",
      ".rel-kpi .v{font-family:'Playfair Display',serif;font-size:1.75rem;font-weight:700;line-height:1.15;margin:4px 0 2px}",
      ".rel-kpi .s{font-size:.76rem;color:#9db0ca;line-height:1.35}",
      ".rel-g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}",
      ".rel-card{background:rgba(18,36,78,.7);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;min-width:0}",
      ".rel-card h3{font-size:.92rem;font-weight:700;margin-bottom:2px}",
      ".rel-card .sub{font-size:.74rem;color:var(--gr);margin-bottom:10px;line-height:1.35}",
      ".rel-leg{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.74rem;color:#c5d1e3;margin-bottom:6px}",
      ".rel-leg i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}",
      ".rel-chart{position:relative;width:100%}",
      ".rel-chart svg{display:block;width:100%;overflow:visible}",
      ".rel-det{margin-top:8px;font-size:.76rem;color:var(--gr)}",
      ".rel-det summary{cursor:pointer}",
      ".rel-det table td,.rel-det table th{padding:4px 8px;font-size:.76rem}",
      ".rel-hb{display:grid;grid-template-columns:minmax(90px,38%) 1fr auto;align-items:center;gap:8px;padding:4px 0;cursor:pointer;border-radius:6px}",
      ".rel-hb:hover{background:rgba(255,255,255,.04)}",
      ".rel-hb .n{font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".rel-hb .t{height:12px;background:rgba(255,255,255,.05);border-radius:0 4px 4px 0}",
      ".rel-hb .b{height:12px;border-radius:0 4px 4px 0;background:" + COR_PERDA + "}",
      ".rel-hb .x{font-size:.76rem;color:#c5d1e3;white-space:nowrap;font-variant-numeric:tabular-nums}",
      ".rel-filtros{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center;margin-bottom:12px}",
      ".rel-filtros input[type=text],.rel-filtros select{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;color:var(--wh);font:.82rem 'DM Sans',sans-serif;outline:none}",
      ".rel-filtros select{width:auto;max-width:100%}",
      ".rel-filtros select option{background:#12244e}",
      ".rel-sit{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;border-radius:6px}",
      ".rel-sit:hover{background:rgba(255,255,255,.04)}.rel-sit:last-of-type{border-bottom:0}",
      ".rel-sit b{font-variant-numeric:tabular-nums;font-size:.9rem}",
      ".rel-filtros label{font-size:.8rem;color:#c5d1e3;display:inline-flex;align-items:center;gap:5px;cursor:pointer}",
      ".rel-tbl th{cursor:pointer;user-select:none}",
      ".rel-tbl th.nos{cursor:default}",
      ".rel-tbl td{font-size:.82rem;padding:9px 10px}.rel-tbl th{padding:8px 10px}",
      ".rel-tbl td.r,.rel-tbl th.r{text-align:right;font-variant-numeric:tabular-nums}",
      ".rel-tbl tr.lin{cursor:pointer}",
      ".rel-nome{font-weight:600;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".rel-mini{font-size:.7rem;color:var(--gr)}",
      ".rel-tag{font-size:.66rem;font-weight:700;padding:2px 7px;border-radius:10px;display:inline-block;white-space:nowrap;margin:1px 2px 1px 0;background:rgba(255,255,255,.08);color:#c5d1e3}",
      ".rel-pag{display:flex;align-items:center;gap:10px;justify-content:flex-end;margin-top:10px;font-size:.8rem;color:var(--gr)}",
      ".rel-fh{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-start;margin-bottom:14px}",
      ".rel-fh .tit{font-family:'Playfair Display',serif;font-size:1.3rem;line-height:1.2;word-break:break-word}",
      ".rel-fh .meta{font-size:.8rem;color:#c5d1e3;margin-top:4px;line-height:1.5}",
      ".rel-vazio{padding:28px;text-align:center;color:var(--gr);font-size:.86rem}",
      "#relTip{position:fixed;z-index:9000;pointer-events:none;background:#0b1730;border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:7px 10px;font-size:.76rem;color:var(--wh);box-shadow:0 6px 20px rgba(0,0,0,.4);display:none;max-width:260px;line-height:1.45}",
      "#relTip b{font-weight:700}#relTip i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}",
      "@media(max-width:900px){.rel-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.rel-g2{grid-template-columns:1fr}}",
      "@media(max-width:520px){.rel-kpis{grid-template-columns:1fr}.rel-nome{max-width:150px}}"
    ].join("\n");
    document.head.appendChild(st);
  }

  /* ── tooltip compartilhado ───────────────────────────────────────── */
  function tip() {
    var t = document.getElementById("relTip");
    if (!t) { t = document.createElement("div"); t.id = "relTip"; document.body.appendChild(t); }
    return t;
  }
  function tipMostrar(ev, html) {
    var t = tip();
    t.innerHTML = html;
    t.style.display = "block";
    var w = t.offsetWidth, hh = t.offsetHeight;
    var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + hh > window.innerHeight - 8) y = ev.clientY - hh - 14;
    t.style.left = Math.max(4, x) + "px";
    t.style.top = Math.max(4, y) + "px";
  }
  function tipEsconder() { var t = document.getElementById("relTip"); if (t) t.style.display = "none"; }

  /* ── gráficos (SVG, sem biblioteca externa) ──────────────────────── */
  function teto(v) {              /* topo do eixo = 4 passos "redondos" e inteiros */
    if (v <= 0) return 4;
    var passo = v / 4;
    var p = Math.pow(10, Math.floor(Math.log(passo) / Math.LN10));
    var f = passo / p;
    var n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    passo = Math.max(1, Math.ceil(n * p - 1e-9));
    return passo * 4;
  }
  function grade(W, H, m, ymax) {
    var s = "", i, y, v;
    for (i = 0; i <= 4; i++) {
      v = ymax * i / 4;
      y = m.t + (H - m.t - m.b) * (1 - i / 4);
      s += "<line x1='" + m.l + "' x2='" + (W - m.r) + "' y1='" + y + "' y2='" + y +
           "' stroke='rgba(255,255,255," + (i === 0 ? ".22" : ".07") + ")' stroke-width='1'/>";
      s += "<text x='" + (m.l - 6) + "' y='" + (y + 3.5) + "' text-anchor='end' font-size='10.5' fill='#8fa3bf'>" +
           num(Math.round(v)) + "</text>";
    }
    return s;
  }

  /* Duas séries de 12 meses (atual x mesmo mês do ano anterior) + mês parcial separado */
  function grafLinhas(el, cfg) {
    var W = Math.max(280, el.clientWidth || 600), H = 220;
    var m = { l: 44, r: 14, t: 12, b: 26 };
    var n = cfg.rotulos.length + (cfg.parcial ? 1 : 0);
    var maxv = 0, i, j;
    for (i = 0; i < cfg.series.length; i++)
      for (j = 0; j < cfg.series[i].vals.length; j++) maxv = Math.max(maxv, cfg.series[i].vals[j]);
    if (cfg.parcial) maxv = Math.max(maxv, cfg.parcial.val, cfg.parcial.ant);
    var ymax = teto(maxv);
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    function X(k) { return m.l + (n === 1 ? pw / 2 : pw * k / (n - 1)); }
    function Y(v) { return m.t + ph * (1 - v / ymax); }
    var s = "<svg viewBox='0 0 " + W + " " + H + "' height='" + H + "' role='img' aria-label='" + h(cfg.titulo) + "'>";
    s += grade(W, H, m, ymax);
    var passo = W < 460 ? 3 : (W < 640 ? 2 : 1);
    for (i = 0; i < cfg.rotulos.length; i++) {
      if (i % passo !== 0) continue;
      if (cfg.parcial && X(i) > X(n - 1) - 118) continue;   /* não colide com o rótulo do mês parcial */
      s += "<text x='" + X(i) + "' y='" + (H - 8) + "' text-anchor='middle' font-size='10.5' fill='#8fa3bf'>" + h(cfg.rotulos[i]) + "</text>";
    }
    for (i = cfg.series.length - 1; i >= 0; i--) {
      var se = cfg.series[i], d = "";
      for (j = 0; j < se.vals.length; j++) d += (j ? "L" : "M") + X(j).toFixed(1) + " " + Y(se.vals[j]).toFixed(1);
      s += "<path d='" + d + "' fill='none' stroke='" + se.cor + "' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'" +
           (se.trac ? " stroke-dasharray='5 4'" : "") + "/>";
      if (!se.trac) for (j = 0; j < se.vals.length; j++)
        s += "<circle cx='" + X(j).toFixed(1) + "' cy='" + Y(se.vals[j]).toFixed(1) + "' r='3' fill='" + se.cor + "' stroke='#12244e' stroke-width='1.5'/>";
    }
    if (cfg.parcial) {
      var k = cfg.rotulos.length, ult = cfg.series[0].vals[k - 1];
      s += "<line x1='" + X(k - 1) + "' y1='" + Y(ult) + "' x2='" + X(k) + "' y2='" + Y(cfg.parcial.val) +
           "' stroke='" + cfg.series[0].cor + "' stroke-width='1.5' stroke-dasharray='2 4' opacity='.7'/>";
      s += "<circle cx='" + X(k) + "' cy='" + Y(cfg.parcial.val) + "' r='4' fill='#12244e' stroke='" + cfg.series[0].cor + "' stroke-width='2'/>";
      s += "<text x='" + X(k) + "' y='" + (H - 8) + "' text-anchor='end' font-size='10.5' fill='#fdba74'>" + h(cfg.parcial.rot) + " (parcial)</text>";
    }
    s += "<line id='" + cfg.id + "X' x1='0' x2='0' y1='" + m.t + "' y2='" + (H - m.b) + "' stroke='rgba(255,255,255,.35)' stroke-width='1' style='display:none'/>";
    s += "<rect x='" + m.l + "' y='" + m.t + "' width='" + pw + "' height='" + ph + "' fill='transparent' data-hit='1'/>";
    s += "</svg>";
    el.innerHTML = s;
    var hit = el.querySelector("[data-hit]"), cross = el.querySelector("#" + cfg.id + "X");
    hit.addEventListener("mousemove", function (ev) {
      var r = hit.getBoundingClientRect();
      var k2 = Math.round((ev.clientX - r.left) / r.width * (n - 1));
      k2 = Math.max(0, Math.min(n - 1, k2));
      cross.setAttribute("x1", X(k2)); cross.setAttribute("x2", X(k2)); cross.style.display = "";
      var t;
      if (cfg.parcial && k2 === cfg.rotulos.length) {
        t = "<b>" + h(cfg.parcial.rot) + " — mês em andamento (parcial)</b><br>" +
            "<i style='background:" + cfg.series[0].cor + "'></i>Até agora: <b>" + num(cfg.parcial.val) + "</b><br>" +
            "<span style='color:#9db0ca'>Mês inteiro do ano anterior: " + num(cfg.parcial.ant) + " — não comparável</span>";
      } else {
        var a = cfg.series[0].vals[k2], b = cfg.series[1].vals[k2];
        t = "<b>" + h(cfg.rotulos[k2]) + "</b><br>" +
            "<i style='background:" + cfg.series[0].cor + "'></i>" + h(cfg.series[0].nome) + ": <b>" + num(a) + "</b><br>" +
            "<i style='background:" + cfg.series[1].cor + "'></i>" + h(cfg.rotAnt[k2]) + ": <b>" + num(b) + "</b><br>" +
            "Diferença: " + sinal(a - b) + " (" + pct(a, b) + ")";
      }
      tipMostrar(ev, t);
    });
    hit.addEventListener("mouseleave", function () { cross.style.display = "none"; tipEsconder(); });
  }

  /* Barras mensais da ficha individual; mês parcial tracejado */
  function grafBarras(el, pontos) {
    var W = Math.max(280, el.clientWidth || 600), H = 230;
    var m = { l: 36, r: 8, t: 12, b: 28 };
    var n = pontos.length, maxv = 0, i;
    for (i = 0; i < n; i++) maxv = Math.max(maxv, pontos[i].n);
    var ymax = teto(maxv);
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var slot = pw / n, bw = Math.max(2, Math.min(22, slot - 2));
    var s = "<svg viewBox='0 0 " + W + " " + H + "' height='" + H + "' role='img' aria-label='Atendimentos realizados por mês'>";
    s += grade(W, H, m, ymax);
    var cadaRot = n > 40 ? 12 : (W < 520 ? 6 : 3);
    for (i = 0; i < n; i++) {
      var p = pontos[i], x = m.l + slot * i + (slot - bw) / 2;
      var bh = ph * p.n / ymax, y = m.t + ph - bh;
      var mm = parseInt(String(p.mes).split("-")[1], 10);
      if (p.n > 0) {
        var r = Math.min(3, bw / 2, bh);
        var d = "M" + x.toFixed(1) + " " + (m.t + ph) + "V" + (y + r).toFixed(1) +
                "Q" + x.toFixed(1) + " " + y.toFixed(1) + " " + (x + r).toFixed(1) + " " + y.toFixed(1) +
                "H" + (x + bw - r).toFixed(1) +
                "Q" + (x + bw).toFixed(1) + " " + y.toFixed(1) + " " + (x + bw).toFixed(1) + " " + (y + r).toFixed(1) +
                "V" + (m.t + ph) + "Z";
        s += p.parcial
          ? "<path d='" + d + "' fill='rgba(74,184,72,.18)' stroke='" + COR_ATUAL + "' stroke-width='1.2' stroke-dasharray='3 3'/>"
          : "<path d='" + d + "' fill='" + COR_ATUAL + "'/>";
      } else {
        s += "<circle cx='" + (x + bw / 2).toFixed(1) + "' cy='" + (m.t + ph - 3) + "' r='1.3' fill='#5d7290'/>";
      }
      var rotular = n > 40 ? (mm === 1) : ((n - 1 - i) % cadaRot === 0);
      if (rotular)
        s += "<text x='" + (x + bw / 2).toFixed(1) + "' y='" + (H - 9) + "' text-anchor='middle' font-size='10.5' fill='" +
             (p.parcial ? "#fdba74" : "#8fa3bf") + "'>" + (n > 40 ? String(p.mes).slice(0, 4) : mesRot(p.mes)) + "</text>";
      s += "<rect x='" + (m.l + slot * i).toFixed(1) + "' y='" + m.t + "' width='" + slot.toFixed(1) + "' height='" + ph +
           "' fill='transparent' data-i='" + i + "'/>";
    }
    s += "</svg>";
    el.innerHTML = s;
    el.querySelector("svg").addEventListener("mousemove", function (ev) {
      var tg = ev.target;
      if (!tg || !tg.getAttribute || tg.getAttribute("data-i") === null) { tipEsconder(); return; }
      var q = pontos[+tg.getAttribute("data-i")];
      tipMostrar(ev, "<b>" + mesRot(q.mes) + (q.parcial ? " — parcial" : "") + "</b><br>" +
        num(q.n) + (q.n === 1 ? " atendimento realizado" : " atendimentos realizados"));
    });
    el.querySelector("svg").addEventListener("mouseleave", tipEsconder);
  }

  /* ── carga de dados ──────────────────────────────────────────────── */
  function rpc(nome, args) {
    return supa.rpc(nome, args || {}).then(function (r) {
      if (r.error) throw new Error(r.error.message || String(r.error));
      if (r.data === null || typeof r.data === "undefined") throw new Error("resposta vazia de " + nome);
      return r.data;
    });
  }
  function carregar() {
    S.carregando = true; S.erro = null;
    render();
    return Promise.all([
      rpc("rel_painel", { p_escopo: S.escopo }),
      rpc("rel_solicitantes", { p_escopo: S.escopo }),
      rpc("rel_exclusoes_listar")
    ]).then(function (v) {
      S.painel = v[0]; S.lista = v[1]; S.exclusoes = v[2];
      S.carregando = false;
      render();
    }).catch(function (e) {
      /* falha NUNCA vira zero: limpa tudo e mostra o erro */
      S.painel = null; S.lista = null; S.exclusoes = null;
      S.carregando = false;
      S.erro = (e && e.message) || "erro desconhecido";
      render();
    });
  }
  function abrirFicha(id) {
    var pg = document.getElementById("page-" + PAG);
    var sc = raiz();
    S.scrollLista = sc ? sc.scrollTop : 0;
    S.fichaId = id; S.ficha = null; S.fichaErro = null;
    render();
    rpc("rel_dentista_ficha", { p_id: id }).then(function (d) {
      if (S.fichaId !== id) return;
      S.ficha = d; render();
    }).catch(function (e) {
      if (S.fichaId !== id) return;
      S.fichaErro = (e && e.message) || "erro desconhecido"; render();
    });
    if (pg && sc) sc.scrollTop = 0;
  }
  function fecharFicha() {
    S.fichaId = null; S.ficha = null; S.fichaErro = null;
    render();
    var sc = raiz();
    if (sc) sc.scrollTop = S.scrollLista || 0;
  }

  /* ── render: moldura ─────────────────────────────────────────────── */
  function render() {
    var el = raiz();
    if (!el) return;
    tipEsconder();
    if (!souAdmin()) {
      el.innerHTML = "<div class='adeny'><div class='adi'>🔒</div><h3>Acesso Restrito</h3><p>Área exclusiva de administradores.</p></div>";
      return;
    }
    if (!S.ativo) {
      el.innerHTML = "<div class='rel-vazio'>Módulo Relacionamento desativado (configuração <code>rel_ativo</code>).</div>";
      return;
    }
    if (S.fichaId) { renderFicha(el); return; }

    var P = S.painel, s = "";
    s += "<div class='rel-top'><h2>Relacionamento com dentistas</h2>";
    s += "<div class='rel-seg' role='group' aria-label='Escopo'>" +
         "<button data-rel='escopo' data-v='comercial' class='" + (S.escopo === "comercial" ? "on" : "") + "' title='Exclui os cadastros marcados como fora do foco'>Foco comercial</button>" +
         "<button data-rel='escopo' data-v='clinica' class='" + (S.escopo === "clinica" ? "on" : "") + "' title='Todos os cadastros, inclusive os fora do foco'>Clínica completa</button></div>";
    s += "<button class='btn btno bsm' data-rel='recarregar'>↻ Atualizar</button></div>";

    if (S.carregando && !P) { el.innerHTML = s + "<div class='rel-vazio'>Carregando dados do servidor…</div>"; return; }
    if (S.erro) {
      el.innerHTML = s + "<div class='rel-erro'><b>Não foi possível carregar os dados.</b><br>" + h(S.erro) +
        "<br><br>Nenhum número é exibido para não gerar uma falsa queda. " +
        "<button class='btn btno bsm' data-rel='recarregar' style='margin-left:6px'>Tentar de novo</button></div>";
      return;
    }
    if (!P) { el.innerHTML = s; return; }

    var atraso = diasEntre(P.saude.ultimo_realizado || P.hoje, P.hoje);
    s += "<div class='rel-saude' style='margin:-6px 0 12px'>Unidade: <b>atendimentos realizados</b> (não são pacientes únicos nem exames) · " +
         "Escopo: <b>" + (S.escopo === "comercial" ? "foco comercial (" + num(P.exclusoes_ativas) + " cadastros fora)" : "clínica completa") + "</b> · " +
         "Último realizado: " + dataBR(P.saude.ultimo_realizado) + " · Última gravação: " + dataHoraBR(P.saude.ultima_atualizacao) +
         " · Consultado: " + dataHoraBR(P.gerado_em) + (S.carregando ? " · atualizando…" : "") + "</div>";
    if (!P.saude.ultimo_realizado || atraso > 4)
      s += "<div class='rel-aviso'>⚠️ O último atendimento realizado na base é de " + dataBR(P.saude.ultimo_realizado) +
           " (" + atraso + " dias). Os dados podem estar atrasados ou incompletos — não trate quedas recentes como reais antes de conferir.</div>";

    var nExc = 0, i;
    for (i = 0; i < (S.exclusoes || []).length; i++) if (S.exclusoes[i].ativo) nExc++;
    s += "<div class='rel-tabs'>" +
         "<button data-rel='sub' data-v='geral' class='" + (S.sub === "geral" ? "on" : "") + "'>Visão geral</button>" +
         "<button data-rel='sub' data-v='lista' class='" + (S.sub === "lista" ? "on" : "") + "'>Oportunidades</button>" +
         "<button data-rel='sub' data-v='exclusoes' class='" + (S.sub === "exclusoes" ? "on" : "") + "'>Fora do foco (" + nExc + ")</button></div>";
    s += "<div id='relCorpo'></div>";
    el.innerHTML = s;

    if (S.sub === "geral") renderGeral();
    else if (S.sub === "lista") renderLista();
    else renderExclusoes();
  }

  /* ── visão geral ─────────────────────────────────────────────────── */
  function contar(classe) {
    var n = 0, i;
    for (i = 0; i < S.lista.length; i++) if (S.lista[i].classe === classe) n++;
    return n;
  }
  function renderGeral() {
    var P = S.painel, T = P.totais, L = P.limiares, c = document.getElementById("relCorpo");
    var perAtu = dataBR(P.atual_ini) + " a " + dataBR(diaAnterior(P.atual_fim));
    var perAnt = dataBR(P.anterior_ini) + " a " + dataBR(diaAnterior(P.anterior_fim));
    var nQueda = contar("queda_acentuada"), nZero = contar("sem_encaminhamentos"), nVolt = contar("retomou_mes");
    var s = "<div class='rel-kpis'>";
    s += "<div class='rel-kpi'><div class='l'>Atendimentos realizados · 12 meses</div><div class='v'>" + num(T.atual12) + "</div>" +
         "<div class='s'>" + perAtu + "<br>12 meses anteriores: " + num(T.anterior12) + " · " + sinal(T.atual12 - T.anterior12) + " (" + pct(T.atual12, T.anterior12) + ")</div></div>";
    s += "<div class='rel-kpi'><div class='l'>Solicitantes distintos · 12 meses</div><div class='v'>" + num(T.solic_atual12) + "</div>" +
         "<div class='s'>Contagem por cadastro (não por CRO/pessoa)<br>12 meses anteriores: " + num(T.solic_anterior12) +
         (T.sem_dentista_atual12 ? " · " + num(T.sem_dentista_atual12) + " atend. sem solicitante" : "") + "</div></div>";
    s += "<div class='rel-kpi clic' data-rel='irclasse' data-v='queda_acentuada'><div class='l'>Cadastros com queda acentuada</div><div class='v'>" + num(nQueda) + "</div>" +
         "<div class='s'>Regra: perda de pelo menos " + L.queda_pct + "% e " + L.queda_min + " atendimentos, 12 meses × 12 anteriores</div></div>";
    s += "<div class='rel-kpi clic' data-rel='irclasse' data-v='sem_encaminhamentos'><div class='l'>Sem encaminhamentos em 12 meses</div><div class='v'>" + num(nZero) + "</div>" +
         "<div class='s'>Encaminhavam no período anterior e zeraram no atual" +
         (nVolt ? "<br>Outros " + num(nVolt) + " zeraram, mas voltaram no mês em andamento" : "") + "</div></div>";
    s += "</div>";

    s += "<div class='rel-g2'>";
    s += "<div class='rel-card'><h3>Atendimentos realizados por mês</h3><div class='sub'>12 meses completos comparados ao mesmo mês do ano anterior. " +
         "O mês em andamento aparece separado e não entra na comparação.</div>" +
         "<div class='rel-leg'><span><i style='background:" + COR_ATUAL + "'></i>" + perAtu + "</span><span><i style='background:" + COR_ANT + "'></i>Mesmo mês, ano anterior</span></div>" +
         "<div class='rel-chart' id='relG1'></div>" + tabelaSerie("realizados") + "</div>";
    s += "<div class='rel-card'><h3>Solicitantes distintos por mês</h3><div class='sub'>Cadastros com pelo menos um atendimento realizado no mês. " +
         "A soma dos meses não é o total do ano (o mesmo cadastro aparece em vários meses).</div>" +
         "<div class='rel-leg'><span><i style='background:" + COR_ATUAL + "'></i>" + perAtu + "</span><span><i style='background:" + COR_ANT + "'></i>Mesmo mês, ano anterior</span></div>" +
         "<div class='rel-chart' id='relG2'></div>" + tabelaSerie("solicitantes") + "</div>";
    s += "</div>";

    s += "<div class='rel-g2'>";
    s += "<div class='rel-card'><h3>Maiores perdas de volume</h3><div class='sub'>Diferença em atendimentos realizados, " + perAtu + " contra " + perAnt + ". Clique para abrir a ficha.</div>" + rankPerdas() + "</div>";
    s += "<div class='rel-card'><h3>Situação dos cadastros</h3><div class='sub'>" + num(S.lista.length) + " cadastros com atendimento realizado nos últimos 24 meses ou no mês em andamento. Clique para filtrar.</div>" + resumoClasses() + "</div>";
    s += "</div>";
    c.innerHTML = s;

    var serie = P.serie, n = serie.length;
    /* serie: 36 meses completos + mês parcial (último). Atual = [n-13, n-2]; anterior = 12 antes. */
    var atu = serie.slice(n - 13, n - 1), ant = serie.slice(n - 25, n - 13), par = serie[n - 1], parAnt = serie[n - 13];
    function monta(campo, id, titulo) {
      grafLinhas(document.getElementById(id), {
        id: id, titulo: titulo,
        rotulos: atu.map(function (x) { return mesRot(x.mes); }),
        rotAnt: ant.map(function (x) { return mesRot(x.mes); }),
        series: [
          { nome: "Período atual", cor: COR_ATUAL, vals: atu.map(function (x) { return x[campo]; }) },
          { nome: "Ano anterior", cor: COR_ANT, trac: true, vals: ant.map(function (x) { return x[campo]; }) }
        ],
        parcial: par && par.parcial ? { rot: mesRot(par.mes), val: par[campo], ant: parAnt ? parAnt[campo] : 0 } : null
      });
    }
    monta("realizados", "relG1", "Atendimentos realizados por mês");
    monta("solicitantes", "relG2", "Solicitantes distintos por mês");
  }
  function tabelaSerie(campo) {
    var serie = S.painel.serie, n = serie.length, i, s;
    s = "<details class='rel-det'><summary>Ver em tabela</summary><div class='tw'><table><tr><th>Mês</th><th class='r' style='text-align:right'>Atual</th><th>Mês (ano anterior)</th><th style='text-align:right'>Anterior</th><th style='text-align:right'>Diferença</th></tr>";
    for (i = n - 13; i < n - 1; i++) {
      var a = serie[i], b = serie[i - 12];
      s += "<tr><td>" + mesRot(a.mes) + "</td><td style='text-align:right'>" + num(a[campo]) + "</td><td>" + mesRot(b.mes) +
           "</td><td style='text-align:right'>" + num(b[campo]) + "</td><td style='text-align:right'>" + sinal(a[campo] - b[campo]) + "</td></tr>";
    }
    var p = serie[n - 1];
    s += "<tr><td>" + mesRot(p.mes) + " (parcial)</td><td style='text-align:right'>" + num(p[campo]) + "</td><td colspan='3' style='color:var(--gr)'>mês em andamento — sem comparação</td></tr>";
    return s + "</table></div></details>";
  }
  function rankPerdas() {
    var arr = S.lista.filter(function (x) { return x.ant12 - x.atu12 > 0; })
      .sort(function (a, b) { return (b.ant12 - b.atu12) - (a.ant12 - a.atu12); }).slice(0, 10);
    if (!arr.length) return "<div class='rel-vazio'>Nenhum cadastro com perda de volume neste escopo.</div>";
    var max = arr[0].ant12 - arr[0].atu12, s = "", i;
    for (i = 0; i < arr.length; i++) {
      var x = arr[i], perda = x.ant12 - x.atu12;
      s += "<div class='rel-hb' data-rel='ficha' data-id='" + x.id + "' title='" + h(x.nome) + ": " + num(x.ant12) + " → " + num(x.atu12) + "'>" +
           "<div class='n'>" + h(x.nome) + "</div>" +
           "<div class='t'><div class='b' style='width:" + Math.max(2, perda * 100 / max).toFixed(1) + "%'></div></div>" +
           "<div class='x'>−" + num(perda) + " <span style='color:var(--gr)'>(" + num(x.ant12) + "→" + num(x.atu12) + ")</span></div></div>";
    }
    return s;
  }
  function resumoClasses() {
    var ordem = ["queda_acentuada", "sem_encaminhamentos", "retomou_mes", "reduziu", "estavel", "cresceu", "recuperado", "novo"];
    var s = "", i;
    for (i = 0; i < ordem.length; i++) {
      var k = ordem[i], n = contar(k);
      s += "<div class='rel-sit' data-rel='irclasse' data-v='" + k + "'><span class='badge " + CLASSES[k].css + "'>" + CLASSES[k].rot + "</span><b>" + num(n) + "</b></div>";
    }
    return s + "<div class='rel-mini' style='margin-top:8px'>“Voltou a encaminhar” = sem envios nos 12 meses anteriores, com histórico mais antigo. Não indica causa.</div>";
  }

  /* ── oportunidades (tabela) ──────────────────────────────────────── */
  function filtrada() {
    var f = S.filtro, b = f.busca.trim().toUpperCase();
    var arr = S.lista.filter(function (x) {
      if (f.classe === "atencao") { if (!ATENCAO[x.classe]) return false; }
      else if (f.classe && x.classe !== f.classe) return false;
      if (f.base10 && x.base_pequena && ATENCAO[x.classe]) return false;
      if (f.tel === "com" && !x.tem_tel) return false;
      if (f.tel === "sem" && x.tem_tel) return false;
      if (f.tel === "comp" && !x.tel_compart) return false;
      if (b && String(x.nome || "").toUpperCase().indexOf(b) < 0 && String(x.id) !== b) return false;
      return true;
    });
    var col = S.ordem.col, dir = S.ordem.dir;
    function val(x) {
      if (col === "perda") return x.ant12 - x.atu12;
      if (col === "var") return x.ant12 ? (x.atu12 - x.ant12) / x.ant12 : (x.atu12 ? 9e9 : 0);
      if (col === "nome") return String(x.nome || "");
      if (col === "ultimo") return String(x.ultimo || "");
      return x[col] || 0;
    }
    arr.sort(function (a, b2) {
      var va = val(a), vb = val(b2);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return String(a.nome).localeCompare(String(b2.nome));
    });
    return arr;
  }
  function renderLista() {
    var c = document.getElementById("relCorpo"), f = S.filtro, k;
    var s = "<div class='rel-filtros'>" +
      "<input type='text' id='relBusca' placeholder='Buscar por nome ou ID' value='" + h(f.busca) + "' style='min-width:210px'>" +
      "<select id='relClasse'><option value='atencao'" + (f.classe === "atencao" ? " selected" : "") + ">Reduções (todas)</option>";
    for (k in CLASSES) s += "<option value='" + k + "'" + (f.classe === k ? " selected" : "") + ">" + CLASSES[k].rot + "</option>";
    s += "<option value=''" + (f.classe === "" ? " selected" : "") + ">Todas as situações</option></select>" +
      "<select id='relTel'><option value=''>Telefone: todos</option><option value='com'" + (f.tel === "com" ? " selected" : "") + ">Com telefone</option>" +
      "<option value='sem'" + (f.tel === "sem" ? " selected" : "") + ">Sem telefone</option><option value='comp'" + (f.tel === "comp" ? " selected" : "") + ">Telefone compartilhado</option></select>" +
      "<label title='Esconde reduções de quem tinha menos de " + S.painel.limiares.base_pequena + " atendimentos no período anterior'><input type='checkbox' id='relBase'" + (f.base10 ? " checked" : "") + "> Ocultar base pequena (&lt; " + S.painel.limiares.base_pequena + ")</label>" +
      "</div><div id='relTbl'></div>";
    c.innerHTML = s;
    desenharTabela();
  }
  function desenharTabela() {
    var w = document.getElementById("relTbl");
    if (!w) return;
    var arr = filtrada(), tot = arr.length, pags = Math.max(1, Math.ceil(tot / POR_PAGINA));
    if (S.pag >= pags) S.pag = pags - 1;
    var ini = S.pag * POR_PAGINA, pg = arr.slice(ini, ini + POR_PAGINA), i;
    function th(col, rot, cls) {
      var seta = S.ordem.col === col ? (S.ordem.dir < 0 ? " ▼" : " ▲") : "";
      return "<th class='" + (cls || "") + "' data-rel='ordem' data-v='" + col + "'>" + rot + seta + "</th>";
    }
    if (!tot) {
      w.innerHTML = "<div class='rel-vazio'>Nenhum cadastro corresponde aos filtros atuais.</div>";
      return;
    }
    var P = S.painel;
    var s = "<div class='rel-mini' style='margin-bottom:6px'>" + num(tot) + " cadastros · Anterior: " + dataBR(P.anterior_ini) + " a " + dataBR(diaAnterior(P.anterior_fim)) +
            " · Atual: " + dataBR(P.atual_ini) + " a " + dataBR(diaAnterior(P.atual_fim)) + " · 3 meses: últimos 3 meses completos × mesmos meses do ano anterior</div>";
    s += "<div class='tw'><table class='rel-tbl'><tr>" + th("nome", "Solicitante") + th("ant12", "Anterior", "r") + th("atu12", "Atual", "r") +
         th("perda", "Perda", "r") + th("var", "Variação", "r") + th("atu3", "3 meses", "r") + th("parcial", "Mês atual", "r") +
         th("ultimo", "Último envio") + "<th class='nos'>Situação</th><th class='nos'>Cadastro</th></tr>";
    for (i = 0; i < pg.length; i++) {
      var x = pg[i], perda = x.ant12 - x.atu12, cl = CLASSES[x.classe] || { rot: x.classe, css: "bgr" };
      var tags = "";
      if (!x.tem_tel) tags += "<span class='rel-tag'>sem telefone</span>";
      if (x.tel_compart) tags += "<span class='rel-tag' style='color:#fdba74'>tel. compartilhado</span>";
      if (x.base_pequena && ATENCAO[x.classe]) tags += "<span class='rel-tag'>base pequena</span>";
      if (x.ativo === false) tags += "<span class='rel-tag'>cadastro inativo</span>";
      if (x.excluido) tags += "<span class='rel-tag' style='color:#c4b5fd'>fora do foco</span>";
      s += "<tr class='lin' data-rel='ficha' data-id='" + x.id + "'>" +
           "<td><div class='rel-nome' title='" + h(x.nome) + "'>" + h(x.nome) + "</div><div class='rel-mini'>#" + x.id + (x.cro ? " · CRO " + h(x.cro) : "") + "</div></td>" +
           "<td class='r'>" + num(x.ant12) + "</td><td class='r'>" + num(x.atu12) + "</td>" +
           "<td class='r'>" + (perda > 0 ? "−" + num(perda) : perda < 0 ? "+" + num(-perda) : "0") + "</td>" +
           "<td class='r'>" + pct(x.atu12, x.ant12) + "</td>" +
           "<td class='r' title='Últimos 3 meses completos × mesmos meses do ano anterior'>" + num(x.ant3) + " → " + num(x.atu3) + "</td>" +
           "<td class='r'>" + (x.parcial ? num(x.parcial) : "—") + "</td>" +
           "<td>" + dataBR(x.ultimo) + "</td>" +
           "<td><span class='badge " + cl.css + "'>" + cl.rot + "</span></td><td>" + (tags || "<span class='rel-mini'>—</span>") + "</td></tr>";
    }
    s += "</table></div>";
    if (pags > 1)
      s += "<div class='rel-pag'><button class='btn btno bsm' data-rel='pag' data-v='-1'" + (S.pag === 0 ? " disabled" : "") + ">← Anterior</button>" +
           "Página " + (S.pag + 1) + " de " + pags +
           "<button class='btn btno bsm' data-rel='pag' data-v='1'" + (S.pag >= pags - 1 ? " disabled" : "") + ">Próxima →</button></div>";
    w.innerHTML = s;
  }

  /* ── exclusões do foco ───────────────────────────────────────────── */
  function renderExclusoes() {
    var c = document.getElementById("relCorpo"), arr = S.exclusoes || [], i;
    var s = "<div class='rel-card'><h3>Cadastros fora do foco comercial</h3><div class='sub'>Não aparecem nas filas e contadores do foco comercial. " +
            "O cadastro e os atendimentos continuam intactos e contam em “Clínica completa”. Para incluir um novo, abra a ficha do solicitante.</div>";
    if (!arr.length) { c.innerHTML = s + "<div class='rel-vazio'>Nenhuma exclusão registrada.</div></div>"; return; }
    s += "<div class='tw'><table class='rel-tbl'><tr><th class='nos'>Cadastro</th><th class='nos'>Situação</th><th class='nos'>Justificativa</th><th class='nos'>Registrado por</th><th class='nos'>Revisar em</th><th class='nos'></th></tr>";
    for (i = 0; i < arr.length; i++) {
      var x = arr[i];
      s += "<tr><td><div class='rel-nome' title='" + h(x.nome) + "'>" + h(x.nome) + "</div><div class='rel-mini'>#" + x.id + "</div></td>" +
           "<td>" + (x.ativo ? "<span class='badge bp'>Fora do foco</span>" : "<span class='badge bgr'>Reincluído</span>") + "</td>" +
           "<td style='max-width:320px'>" + h(x.motivo) + (x.ativo ? "" : "<div class='rel-mini'>Reinclusão: " + h(x.removido_motivo || "") + "</div>") + "</td>" +
           "<td>" + h(x.criado_por_nome || "—") + "<div class='rel-mini'>" + dataHoraBR(x.criado_em) + "</div>" +
           (x.ativo ? "" : "<div class='rel-mini'>Reincluído por " + h(x.removido_por_nome || "—") + " em " + dataHoraBR(x.removido_em) + "</div>") + "</td>" +
           "<td>" + (x.revisar_em ? dataBR(x.revisar_em) : "—") + "</td>" +
           "<td style='white-space:nowrap'><button class='btn btno bsm' data-rel='ficha' data-id='" + x.id + "'>Ficha</button> " +
           (x.ativo ? "<button class='btn btnp bsm' data-rel='reincluir' data-id='" + x.id + "' data-nome='" + h(x.nome) + "'>Reincluir</button>" : "") + "</td></tr>";
    }
    c.innerHTML = s + "</table></div></div>";
  }
  function dlgExcluir(id, nome) {
    openM("Excluir do foco comercial",
      "<p style='color:var(--gr);font-size:.86rem;margin-bottom:12px'><b style='color:var(--wh)'>" + h(nome) + "</b> (#" + id + ") deixará de aparecer nas filas e contadores do foco comercial. " +
      "O cadastro e os atendimentos não são alterados.</p>" +
      "<div class='field' style='margin-bottom:10px'><label>Justificativa (obrigatória)</label><textarea id='relExMot' maxlength='500'></textarea></div>" +
      "<div class='field'><label>Revisar em (opcional)</label><input type='date' id='relExRev'></div>",
      [{ lbl: "Cancelar", cls: "btno", fn: closeM },
       { lbl: "Excluir do foco", cls: "btnp", fn: function () {
          var mot = (document.getElementById("relExMot").value || "").trim();
          var rev = document.getElementById("relExRev").value || null;
          if (mot.length < 3) { avisar("⚠️", "Informe a justificativa"); return; }
          rpc("rel_excluir_dentista", { p_id: id, p_motivo: mot, p_revisar_em: rev }).then(function () {
            closeM(); avisar("✅", "Cadastro excluído do foco comercial"); aposMudanca(id);
          }).catch(function (e) { avisar("❌", "Não foi possível salvar: " + e.message); });
       } }]);
  }
  function dlgReincluir(id, nome) {
    openM("Reincluir no foco comercial",
      "<p style='color:var(--gr);font-size:.86rem;margin-bottom:12px'><b style='color:var(--wh)'>" + h(nome) + "</b> (#" + id + ") voltará às filas e contadores do foco comercial.</p>" +
      "<div class='field'><label>Justificativa (obrigatória)</label><textarea id='relExMot' maxlength='500'></textarea></div>",
      [{ lbl: "Cancelar", cls: "btno", fn: closeM },
       { lbl: "Reincluir", cls: "btng", fn: function () {
          var mot = (document.getElementById("relExMot").value || "").trim();
          if (mot.length < 3) { avisar("⚠️", "Informe a justificativa"); return; }
          rpc("rel_reincluir_dentista", { p_id: id, p_motivo: mot }).then(function () {
            closeM(); avisar("✅", "Cadastro reincluído no foco comercial"); aposMudanca(id);
          }).catch(function (e) { avisar("❌", "Não foi possível salvar: " + e.message); });
       } }]);
  }
  function aposMudanca(id) {
    var reabrir = S.fichaId === id;
    carregar().then(function () { if (reabrir) abrirFicha(id); });
  }

  /* ── WhatsApp Web (abre com o texto pronto; o envio é manual) ────── */
  function telWhats(tel) {         /* só aceita DDD+número ou 55+DDD+número; não completa por chute */
    var t = String(tel || "").replace(/\D/g, "");
    if (t.length === 10 || t.length === 11) t = "55" + t;
    if ((t.length !== 12 && t.length !== 13) || t.slice(0, 2) !== "55") return "";
    return t;
  }
  function primeiroNome(nome) {
    var p = String(nome || "").trim().split(/\s+/)[0] || "";
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
  }
  /* 5 variações do texto de abertura: evitam mandar o mesmo bloco para todos */
  function variacoes(C) {
    var dr = "Dr(a). " + primeiroNome(C.nome);
    var eu = primeiroNome(typeof CU !== "undefined" && CU ? CU.nome : "") || "a equipe";
    var hr = 12;
    try { hr = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }), 10); } catch (e) {}
    var sauda = hr < 12 ? "Bom dia" : (hr < 18 ? "Boa tarde" : "Boa noite");
    return [
      "Olá, " + dr + "! Aqui é " + eu + ", da COR - Centro Odontológico de Radiologia. Estamos ouvindo nossos parceiros para entender como podemos melhorar sua rotina de exames. Podemos conversar por aqui?",
      "Oi, " + dr + ", tudo bem? Sou " + eu + ", da COR Radiologia. Queremos saber como tem sido a sua experiência com os nossos exames e o que podemos melhorar. Tem um minutinho para conversar por aqui?",
      sauda + ", " + dr + "! " + eu + ", da COR - Centro Odontológico de Radiologia. Estamos conversando com os dentistas parceiros para ajustar o nosso atendimento. Posso lhe fazer uma pergunta rápida por aqui?",
      dr + ", aqui é " + eu + ", da COR. Gostaríamos de ouvir a sua opinião sobre nossos exames, prazos e atendimento, para melhorar o que for preciso. Podemos falar por este número?",
      "Olá, " + dr + "! " + eu + ", da COR Radiologia, falando. Estamos revendo a nossa rotina com os parceiros e a sua opinião é importante para nós. Seria possível conversarmos rapidamente por aqui?"
    ];
  }
  function dlgWhats() {
    var F = S.ficha;
    if (!F) return;
    var C = F.cadastro, t = telWhats(C.telefone);
    if (!t) { avisar("⚠️", "Telefone do cadastro inválido para WhatsApp"); return; }
    /* o contador vem do servidor; se não vier, não abre (a abordagem ficaria sem registro) */
    rpc("rel_abordagens_hoje", { p_dentista_id: C.id }).then(function (st) {
      if (!S.ficha || S.ficha.cadastro.id !== C.id) return;
      montarDlgWhats(F, C, t, st);
    }).catch(function (e) {
      avisar("❌", "Não foi possível consultar o limite diário: " + e.message);
    });
  }
  function montarDlgWhats(F, C, t, st) {
    var textos = variacoes(C);
    var idx = st.hoje % textos.length;          /* cada abordagem do dia começa em um texto diferente */
    var acima = st.hoje >= st.limite;
    var avisos = "";
    if (st.ultima && st.ultima.em)
      avisos += "<div class='rel-aviso'>⚠️ Este cadastro já teve uma abordagem aberta em " + dataHoraBR(st.ultima.em) +
        (st.ultima.por ? " por " + h(st.ultima.por) : "") + ". Evite repetir sem que ele tenha respondido.</div>";
    if (F.tel_compartilhado_com && F.tel_compartilhado_com.length)
      avisos += "<div class='rel-aviso'>⚠️ Este telefone também está em outro(s) cadastro(s): " +
        F.tel_compartilhado_com.map(function (o) { return h(o.nome); }).join(", ") + ". Confirme com quem vai falar.</div>";
    if (F.exclusao && F.exclusao.ativo)
      avisos += "<div class='rel-aviso'>Este cadastro está fora do foco comercial.</div>";

    var corpo = avisos +
      "<p style='color:var(--gr);font-size:.82rem;margin-bottom:10px'>Para <b style='color:var(--wh)'>" + h(C.nome) + "</b> · +" + t.slice(0, 2) + " " + t.slice(2, 4) + " " + t.slice(4) +
      "<br>Abordagens abertas hoje pelo app: <b id='relWaCont' style='color:" + (acima ? "#fdba74" : "var(--wh)") + "'>" + st.hoje + " de " + st.limite + "</b></p>" +
      "<div class='field'><label>Mensagem <span id='relWaVar' style='text-transform:none;font-weight:500'>· texto " + (idx + 1) + " de " + textos.length + "</span></label>" +
      "<textarea id='relWaMsg' style='min-height:150px' maxlength='1000'>" + h(textos[idx]) + "</textarea></div>" +
      "<div style='margin-top:8px'><button type='button' class='btn btno bsm' id='relWaTroca'>🔁 Usar outro texto</button></div>";
    if (acima)
      corpo += "<div class='rel-aviso' style='margin-top:12px'>⚠️ Já foram abertas " + st.hoje + " abordagens hoje (referência: " + st.limite +
        " por dia). Mais mensagens no mesmo dia aumentam o risco de bloqueio do número.</div>";
    corpo += "<p style='color:#fdba74;font-size:.76rem;margin-top:10px'>Ao continuar, o WhatsApp Web abre com a mensagem preenchida — <b>o envio é feito por você lá</b>. " +
      "Confirme que ele está no número da clínica (55 99166-8228). Telefone de cadastro não garante que o número é do dentista nem que ele aceita ser contatado.</p>";

    var enviando = false;
    openM("Mensagem pelo WhatsApp Web", corpo,
      [{ lbl: "Cancelar", cls: "btno", fn: closeM },
       { lbl: "Abrir WhatsApp Web", cls: "btng", fn: function () {
          if (enviando) return;                  /* clique duplo não registra duas vezes */
          var msg = (document.getElementById("relWaMsg").value || "").trim();
          if (msg.length < 10) { avisar("⚠️", "Escreva a mensagem"); return; }
          /* a aba é aberta já no clique (senão o navegador bloqueia); recebe o endereço depois de registrar */
          var w = window.open("", "cor_whatsapp_web");
          if (!w) { avisar("⚠️", "O navegador bloqueou a nova aba. Libere pop-ups para o App COR."); return; }
          function desistir() {
            try { if (w.location && w.location.href === "about:blank") w.close(); } catch (e) { /* aba do WhatsApp já aberta: deixa como está */ }
          }
          enviando = true;
          rpc("rel_abordagem_registrar", { p_dentista_id: C.id, p_telefone: t, p_texto: msg, p_variacao: idx + 1 })
            .then(function (r) {
              enviando = false;
              if (r && r.ok) {
                w.location.href = "https://web.whatsapp.com/send?phone=" + t + "&text=" + encodeURIComponent(msg);
                closeM();
                avisar("💬", "WhatsApp Web aberto — confira e envie por lá (" + r.hoje + " de " + r.limite + " hoje)");
                return;
              }
              desistir();
              avisar("❌", "Resposta inesperada do servidor");
            })
            .catch(function (e) { enviando = false; desistir(); avisar("❌", "Não foi possível registrar: " + e.message); });
       } }]);
    var bt = document.getElementById("relWaTroca");
    if (bt) bt.onclick = function () {
      idx = (idx + 1) % textos.length;
      document.getElementById("relWaMsg").value = textos[idx];
      document.getElementById("relWaVar").textContent = "· texto " + (idx + 1) + " de " + textos.length;
    };
  }

  /* ── ficha individual ────────────────────────────────────────────── */
  function soma(arr, a, b) { var t = 0, i; for (i = a; i < b; i++) t += arr[i].n; return t; }
  function renderFicha(el) {
    var s = "<div style='margin-bottom:12px'><button class='btn btno bsm' data-rel='voltar'>← Voltar para a lista</button></div>";
    if (S.fichaErro) {
      el.innerHTML = s + "<div class='rel-erro'><b>Não foi possível carregar a ficha.</b><br>" + h(S.fichaErro) +
        "<br><br><button class='btn btno bsm' data-rel='ficha' data-id='" + S.fichaId + "'>Tentar de novo</button></div>";
      return;
    }
    if (!S.ficha) { el.innerHTML = s + "<div class='rel-vazio'>Carregando ficha…</div>"; return; }
    var F = S.ficha, C = F.cadastro, H = F.historico || {}, X = F.exclusao, serie = F.serie, n = serie.length;
    /* serie: 60 meses completos + parcial (último) */
    var fim = n - 1;
    var atu12 = soma(serie, fim - 12, fim), ant12 = soma(serie, fim - 24, fim - 12);
    var atu3 = soma(serie, fim - 3, fim), ant3 = soma(serie, fim - 15, fim - 12);
    var par = serie[fim];
    var foraFoco = !!(X && X.ativo);

    s += "<div class='rel-fh'><div style='min-width:0;flex:1 1 320px'><div class='tit'>" + h(C.nome) + "</div><div class='meta'>Cadastro #" + C.id +
         (C.cro ? " · CRO " + h(C.cro) : " · sem CRO no cadastro") + (C.especialidade ? " · " + h(C.especialidade) : "") + (C.cidade ? " · " + h(C.cidade) : "") +
         "<br>Telefone: " + (C.telefone ? h(C.telefone) + " <span class='rel-mini'>(cadastro; não confirma WhatsApp nem autorização de contato)</span>" : "<span style='color:#fdba74'>não cadastrado</span>") +
         (C.email ? "<br>E-mail: " + h(C.email) : "") + "</div></div>" +
         "<div style='display:flex;flex-wrap:wrap;gap:8px'>" +
         (telWhats(C.telefone) ? "<button class='btn btng bsm' data-rel='whats'>💬 WhatsApp Web</button>" : "") + (foraFoco
            ? "<button class='btn btng bsm' data-rel='reincluir' data-id='" + C.id + "' data-nome='" + h(C.nome) + "'>Reincluir no foco</button>"
            : "<button class='btn btnp bsm' data-rel='excluir' data-id='" + C.id + "' data-nome='" + h(C.nome) + "'>Excluir do foco comercial</button>") + "</div></div>";

    if (foraFoco)
      s += "<div class='rel-aviso' style='background:rgba(167,139,250,.1);border-color:rgba(167,139,250,.3);color:#c4b5fd'>Fora do foco comercial desde " + dataHoraBR(X.criado_em) +
           " (" + h(X.criado_por_nome || "—") + "). Justificativa: " + h(X.motivo) + (X.revisar_em ? " · Revisar em " + dataBR(X.revisar_em) : "") + "</div>";
    if (C.ativo === false) s += "<div class='rel-aviso'>Cadastro marcado como inativo. Isso não é o mesmo que deixar de encaminhar.</div>";
    if (F.tel_compartilhado_com && F.tel_compartilhado_com.length)
      s += "<div class='rel-aviso'>⚠️ Telefone compartilhado com " + F.tel_compartilhado_com.map(function (o) { return h(o.nome) + " (#" + o.id + ")"; }).join(", ") +
           ". Confirme com quem está falando antes de associar qualquer contato.</div>";
    if (/DUPLICADO unificado/.test(String(C.observacoes || "")))
      s += "<div class='rel-aviso'>Este cadastro foi unificado em outro; o histórico pode ter sido movido.</div>";

    var m0 = serie[fim - 12].mes, m1 = serie[fim - 1].mes, a0 = serie[fim - 24].mes, a1 = serie[fim - 13].mes;
    s += "<div class='rel-kpis'>" +
         "<div class='rel-kpi'><div class='l'>12 meses completos</div><div class='v'>" + num(atu12) + "</div><div class='s'>" + mesRot(m0) + " a " + mesRot(m1) +
         "<br>Anteriores (" + mesRot(a0) + " a " + mesRot(a1) + "): " + num(ant12) + " · " + sinal(atu12 - ant12) + " (" + pct(atu12, ant12) + ")</div></div>" +
         "<div class='rel-kpi'><div class='l'>Últimos 3 meses completos</div><div class='v'>" + num(atu3) + "</div><div class='s'>" + mesRot(serie[fim - 3].mes) + " a " + mesRot(m1) +
         "<br>Mesmos meses do ano anterior: " + num(ant3) + " · " + sinal(atu3 - ant3) + " (" + pct(atu3, ant3) + ")</div></div>" +
         "<div class='rel-kpi'><div class='l'>Mês em andamento</div><div class='v'>" + num(par.n) + "</div><div class='s'>" + mesRot(par.mes) + " — parcial, não comparável com meses completos</div></div>" +
         "<div class='rel-kpi'><div class='l'>Histórico na base</div><div class='v'>" + num(H.total) + "</div><div class='s'>Primeiro: " + dataBR(H.primeiro) + "<br>Último: " + dataBR(H.ultimo) + "</div></div>" +
         "</div>";

    s += "<div class='rel-card'><div style='display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px'><h3 style='margin-right:auto'>Atendimentos realizados por mês</h3>" +
         "<div class='rel-seg'><button data-rel='meses' data-v='24' class='" + (S.fichaMeses === 24 ? "on" : "") + "'>24 meses</button>" +
         "<button data-rel='meses' data-v='60' class='" + (S.fichaMeses === 60 ? "on" : "") + "'>5 anos</button></div></div>" +
         "<div class='sub'>Meses sem atendimento aparecem como zero (ponto na linha de base). A última barra, tracejada, é o mês em andamento.</div>" +
         "<div class='rel-chart' id='relGF'></div></div>";
    s += "<div class='rel-mini' style='margin-top:12px'>Contatos, tarefas, ocorrências e mensagens entram na Etapa 2. Consultado em " + dataHoraBR(F.gerado_em) + ".</div>";
    el.innerHTML = s;
    grafBarras(document.getElementById("relGF"), serie.slice(n - (S.fichaMeses + 1)));
  }

  /* ── eventos ─────────────────────────────────────────────────────── */
  function aoClicar(ev) {
    var t = ev.target.closest ? ev.target.closest("[data-rel]") : null;
    if (!t || t.disabled) return;
    var a = t.getAttribute("data-rel"), v = t.getAttribute("data-v"), id = parseInt(t.getAttribute("data-id"), 10);
    if (a === "escopo") { if (S.escopo !== v) { S.escopo = v; S.pag = 0; carregar(); } }
    else if (a === "recarregar") carregar();
    else if (a === "sub") { S.sub = v; render(); }
    else if (a === "irclasse") { S.filtro.classe = v; S.filtro.base10 = false; S.pag = 0; S.sub = "lista"; render(); }
    else if (a === "ordem") {
      if (S.ordem.col === v) S.ordem.dir = -S.ordem.dir; else { S.ordem.col = v; S.ordem.dir = (v === "nome") ? 1 : -1; }
      S.pag = 0; desenharTabela();
    }
    else if (a === "pag") { S.pag += parseInt(v, 10); desenharTabela(); raiz().scrollTop = 0; }
    else if (a === "ficha") { ev.stopPropagation(); abrirFicha(id); }
    else if (a === "voltar") fecharFicha();
    else if (a === "meses") { S.fichaMeses = parseInt(v, 10); render(); }
    else if (a === "whats") { ev.stopPropagation(); dlgWhats(); }
    else if (a === "excluir") { ev.stopPropagation(); dlgExcluir(id, t.getAttribute("data-nome")); }
    else if (a === "reincluir") { ev.stopPropagation(); dlgReincluir(id, t.getAttribute("data-nome")); }
  }
  function aoMudar(ev) {
    var t = ev.target;
    if (!t || !t.id) return;
    if (t.id === "relBusca") { S.filtro.busca = t.value; S.pag = 0; desenharTabela(); }
    else if (t.id === "relClasse") { S.filtro.classe = t.value; S.pag = 0; desenharTabela(); }
    else if (t.id === "relTel") { S.filtro.tel = t.value; S.pag = 0; desenharTabela(); }
    else if (t.id === "relBase") { S.filtro.base10 = !!t.checked; S.pag = 0; desenharTabela(); }
  }

  /* ── instalação (nav, página, permissões, feature flag) ──────────── */
  function botaoNav() { return document.querySelector("#navAdminMenu button[data-p='" + PAG + "']"); }
  function aplicarVisibilidade() {
    var b = botaoNav();
    if (b) b.style.display = (souAdmin() && S.ativo) ? "" : "none";
  }
  function checarFlag() {
    if (!souAdmin() || typeof supa === "undefined") { aplicarVisibilidade(); return; }
    supa.from("configuracoes").select("valor").eq("chave", "rel_ativo").maybeSingle().then(function (r) {
      /* só desliga com valor explicitamente false; erro de leitura não esconde nem libera nada
         (quem protege os dados são as funções rel_* no servidor) */
      S.ativo = !(r && r.data && (r.data.valor === false || r.data.valor === "false"));
      aplicarVisibilidade();
    }, function () { aplicarVisibilidade(); });
  }
  function entrar() {
    if (!souAdmin() || !S.ativo) { render(); return; }
    if (!S.painel && !S.carregando) carregar(); else render();
  }
  function instalar() {
    if (typeof PERMS === "undefined" || typeof navTo !== "function") {
      console.warn("[relacionamento] appCOR não encontrado; módulo não instalado");
      return;
    }
    instalarCss();
    PERMS.admin[PAG] = 1;   /* demais perfis ficam sem a chave = sem acesso */

    var menu = document.getElementById("navAdminMenu");
    if (menu && !botaoNav()) {
      var b = document.createElement("button");
      b.setAttribute("data-p", PAG);
      b.textContent = "📈 Relacionamento";
      b.style.display = "none";
      menu.insertBefore(b, menu.firstChild);
    }
    if (!document.getElementById("page-" + PAG)) {
      var pg = document.createElement("div");
      pg.className = "page"; pg.id = "page-" + PAG;
      pg.innerHTML = "<div class='pi pg-scroll' id='pgRel'></div>";
      var ref = document.getElementById("page-reversoes") || document.querySelector(".page");
      if (ref && ref.parentNode) ref.parentNode.insertBefore(pg, ref.nextSibling); else document.body.appendChild(pg);
      pg.addEventListener("click", aoClicar);
      pg.addEventListener("input", aoMudar);
      pg.addEventListener("change", aoMudar);
    }

    var navOrig = window.navTo;
    window.navTo = function (page) {
      if (page === PAG && !souAdmin()) return;     /* URL/console: não-admin não entra */
      var r = navOrig.apply(this, arguments);
      if (page === PAG) entrar(); else tipEsconder();
      return r;
    };
    if (typeof window.applyNav === "function") {
      var applyOrig = window.applyNav;
      window.applyNav = function () {
        var r = applyOrig.apply(this, arguments);
        aplicarVisibilidade();
        checarFlag();
        return r;
      };
    }
    if (typeof CU !== "undefined" && CU) { aplicarVisibilidade(); checarFlag(); }

    var redim;
    window.addEventListener("resize", function () {
      clearTimeout(redim);
      redim = setTimeout(function () {
        var pg2 = document.getElementById("page-" + PAG);
        if (pg2 && pg2.classList.contains("active") && (S.sub === "geral" || S.fichaId)) render();
      }, 200);
    });
    window.rRelacionamento = entrar;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", instalar);
  else instalar();
})();
