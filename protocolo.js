/* ═══════════════════════════════════════════════════════════════════════════
 *  App COR · Módulo Protocolo de Retirada de Exames
 *  Aba externa — NÃO edita o index.html além de 1 linha <script>.
 * ───────────────────────────────────────────────────────────────────────────
 *  Como instalar (index.html):
 *    Adicione, logo ANTES do </body>, depois dos scripts do app:
 *        <script defer src="protocolo.js"></script>
 *
 *  Depende de (já existem no index.html):
 *    - supa      → cliente supabase.createClient (global)
 *    - CU        → usuário logado { id, nome, role, ... }
 *    - navTo()   → troca de aba
 *    - PERMS     → mapa de permissões por role
 *    - #nav      → barra de botões de aba
 *    - .page     → containers de página
 *
 *  Backend: rode protocolo.sql no Supabase antes de usar.
 *  Permissão: aparece só para os perfis em ROLES_COM_ACESSO abaixo.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // Perfis que enxergam a aba Protocolo (recepção/balcão + admin).
  var ROLES_COM_ACESSO = ["admin", "agenda"];

  var only  = function (s) { return String(s || "").replace(/\D/g, ""); };
  var last8 = function (s) { return only(s).slice(-8); };
  var esc   = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var fmtData = function (iso) {
    if (!iso) return "";
    var p = String(iso).slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso;
  };

  var GRUPOS = [];   // resultado atual: [{paciente, exames:[...]}]
  var _buscaSeq = 0; // sequência de busca: descarta respostas fora de ordem

  /* ── 1. CSS escopado ────────────────────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById("proto-css")) return;
    var st = document.createElement("style");
    st.id = "proto-css";
    st.textContent = [
      "#pgProto{--pc:#0e7490;--pcd:#155e75;--psoft:#ecfeff;--ok:#15803d;--muted:#64748b;--line:#e2e8f0;color:#0f172a}",
      "#pgProto .pcard{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.06);margin-bottom:18px;overflow:hidden}",
      "#pgProto .pch{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:700;margin:0;padding:15px 18px 0}",
      "#pgProto .pcb{padding:16px 18px}",
      "#pgProto .pgrid{display:grid;grid-template-columns:1.6fr 1fr;gap:18px;align-items:start}",
      "@media(max-width:900px){#pgProto .pgrid{grid-template-columns:1fr}}",
      "#pgProto .srow{display:flex;gap:10px}",
      "#pgProto .pin{flex:1;font-size:28px;font-weight:700;letter-spacing:2px;padding:13px 15px;border:2px solid var(--line);border-radius:12px;outline:none}",
      "#pgProto .pin:focus{border-color:var(--pc)}",
      "#pgProto .pin::placeholder{color:#cbd5e1;font-weight:600;letter-spacing:1px}",
      "#pgProto .pbtn{border:0;border-radius:12px;font-weight:700;cursor:pointer;font-size:15px;padding:0 20px;display:inline-flex;align-items:center;gap:7px}",
      "#pgProto .pbtn.pri{background:var(--pc);color:#fff}#pgProto .pbtn.pri:hover{background:var(--pcd)}",
      "#pgProto .pbtn.ok{background:var(--ok);color:#fff}",
      "#pgProto .pbtn:disabled{opacity:.45;cursor:not-allowed}",
      "#pgProto .kp{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;max-width:270px}",
      "#pgProto .kp button{font-size:21px;font-weight:700;padding:13px 0;border-radius:12px;border:1px solid var(--line);background:#fff;cursor:pointer}",
      "#pgProto .kp button:hover{background:#f1f5f9}",
      "#pgProto .hint{font-size:12px;color:var(--muted);margin-top:10px}",
      "#pgProto .empty{color:var(--muted);text-align:center;padding:22px 4px;font-size:14px}",
      "#pgProto .pat{border:1px solid var(--line);border-radius:14px;margin-top:14px;overflow:hidden}",
      "#pgProto .path{display:flex;align-items:center;gap:10px;padding:11px 14px;background:#f8fafc;border-bottom:1px solid var(--line)}",
      "#pgProto .pav{width:34px;height:34px;border-radius:50%;background:var(--psoft);color:var(--pcd);display:grid;place-items:center;font-weight:800;font-size:14px}",
      "#pgProto .pnm{font-weight:700;color:#0f172a;font-size:15px}#pgProto .pmt{font-size:12px;color:var(--muted)}",
      "#pgProto .ex{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid #f1f5f9}",
      "#pgProto .ex label{display:flex;align-items:center;gap:12px;cursor:pointer;flex:1}",
      "#pgProto .ex input{width:22px;height:22px;accent-color:var(--pc);cursor:pointer}",
      "#pgProto .exn{font-weight:600;color:#0f172a}#pgProto .exm{font-size:12px;color:var(--muted);margin-top:1px}",
      "#pgProto .pill{font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;background:#f0fdf4;color:var(--ok)}",
      "#pgProto .cbar{margin-top:16px;padding:14px;border:1px dashed var(--pc);border-radius:14px;background:var(--psoft);display:none}",
      "#pgProto .cbar.show{display:block}",
      "#pgProto .crow{display:flex;gap:10px;align-items:center;flex-wrap:wrap}",
      "#pgProto .clab{font-size:12px;font-weight:700;color:var(--pcd)}",
      "#pgProto .ptxt,#pgProto .psel{padding:11px 12px;border:1px solid var(--line);border-radius:10px;font-size:15px;outline:none}",
      "#pgProto .ptxt{min-width:220px}#pgProto .ptxt:focus{border-color:var(--pc)}",
      "#pgProto .cnt{font-weight:800;color:var(--pcd)}",
      "#pgProto .li{border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-top:10px;background:linear-gradient(180deg,#fff,#fafcff)}",
      "#pgProto .li .t{display:flex;justify-content:space-between;gap:8px;align-items:baseline}",
      "#pgProto .li .w{font-weight:700;font-size:14px}#pgProto .li .wh{font-size:12px;color:var(--muted);white-space:nowrap}",
      "#pgProto .li .e{font-size:13px;margin-top:4px}#pgProto .li .b{font-size:12px;color:var(--muted);margin-top:3px}",
      "#pgProto .lie{color:var(--muted);text-align:center;padding:16px 0;font-size:13px}",
      "#pgProto .phtoggle{cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding-bottom:15px;user-select:none}",
      "#pgProto .phtoggle:hover{color:var(--pcd)}",
      "#pgProto .chev{color:var(--muted);transition:transform .18s;font-size:11px}",
      "#pgProto .chev.open{transform:rotate(90deg)}",
      "#pgProto .phbody{display:none}#pgProto .phbody.open{display:block}",
      "#pgProto .srow2{display:flex;gap:8px;margin-bottom:8px}",
      "#pgProto .phq{flex:1;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px;outline:none;color:#0f172a}",
      "#pgProto .phq:focus{border-color:var(--pc)}"
    ].join("");
    document.head.appendChild(st);
  }

  /* ── 2. Injeta botão de aba + página no DOM ─────────────────────────────── */
  function mount() {
    var nav = document.getElementById("nav");
    if (nav && !nav.querySelector('button[data-p="protocolo"]')) {
      var b = document.createElement("button");
      b.dataset.p = "protocolo";
      b.innerHTML = "📦 Protocolo";
      // v3.73+ do index: o botão "Histórico" saiu do menu (aba unificada no
      // Atendimento). Ancora em "Pacientes" (nova aba), senão "Atendimento",
      // senão no fim — assim o Protocolo mantém a posição de sempre.
      var ref = nav.querySelector('button[data-p="pacientes"]') ||
                nav.querySelector('button[data-p="historico"]') ||
                nav.querySelector('button[data-p="atendimento"]');
      if (ref && ref.nextSibling) nav.insertBefore(b, ref.nextSibling);
      else nav.appendChild(b);
    }

    var first = document.getElementById("page-dashboard");
    var container = first ? first.parentNode : document.body;
    if (!document.getElementById("page-protocolo")) {
      var pg = document.createElement("div");
      pg.className = "page";
      pg.id = "page-protocolo";
      pg.innerHTML = '<div class="pi pg-scroll" id="pgProto"></div>';
      container.appendChild(pg);
    }

    // permissão: adiciona 'protocolo' aos roles escolhidos
    if (typeof PERMS === "object" && PERMS) {
      ROLES_COM_ACESSO.forEach(function (r) {
        if (PERMS[r]) PERMS[r].protocolo = 1;
      });
    }
    applyBtnVisibility();
  }

  // mostra/esconde o botão conforme o usuário logado
  function applyBtnVisibility() {
    var btn = document.querySelector('#nav button[data-p="protocolo"]');
    if (!btn) return;
    var vis = (typeof CU !== "undefined" && CU && ROLES_COM_ACESSO.indexOf(CU.role) >= 0);
    btn.style.display = vis ? "" : "none";
  }

  /* ── 3. Intercepta navTo pra renderizar nossa aba ───────────────────────── */
  function hookNav() {
    if (typeof window.navTo !== "function" || window.navTo.__protoWrapped) return;
    var orig = window.navTo;
    var wrapped = function (page) {
      orig(page);                       // já faz o show/hide genérico da .page
      if (page === "protocolo") render();
    };
    wrapped.__protoWrapped = true;
    window.navTo = wrapped;
  }

  /* ── 4. Render principal da aba ─────────────────────────────────────────── */
  function render() {
    injectCSS();
    var el = document.getElementById("pgProto");
    if (!el) return;
    el.innerHTML =
      '<div class="pgrid">' +
        '<div>' +
          '<div class="pcard">' +
            '<div class="pch">1 · Buscar pelo celular do paciente</div>' +
            '<div class="pcb">' +
              '<div class="srow">' +
                '<input id="protoPhone" class="pin" inputmode="numeric" placeholder="Digite o celular" autocomplete="off">' +
                '<button class="pbtn pri" id="protoBuscar">🔍 Buscar</button>' +
              '</div>' +
              '<div class="kp" id="protoKp"></div>' +
              '<div class="hint">Traz <b>todos os pacientes</b> com esse número (a família). Casa pelos <b>últimos 8 dígitos</b> — funciona com ou sem DDD.</div>' +
            '</div>' +
          '</div>' +
          '<div class="pcard">' +
            '<div class="pch">2 · Marcar exames que estão sendo retirados</div>' +
            '<div class="pcb">' +
              '<div id="protoResults"><div class="empty">Digite um celular e clique em Buscar.</div></div>' +
              '<div class="cbar" id="protoCbar">' +
                '<div class="crow" style="margin-bottom:10px"><span class="cnt" id="protoCount">0</span><span style="font-weight:600">exame(s) selecionado(s)</span></div>' +
                '<div class="crow">' +
                  '<span class="clab">Retirado por:</span>' +
                  '<input id="protoQuem" class="ptxt" placeholder="Nome de quem está retirando">' +
                  '<select id="protoVinc" class="psel">' +
                    '<option>Próprio paciente</option><option>Familiar</option><option>Responsável</option><option>Terceiro autorizado</option>' +
                  '</select>' +
                  '<button class="pbtn ok" id="protoReg">✓ Registrar retirada</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pcard" id="protoHistCard">' +
          '<div class="pch phtoggle" id="protoHistToggle"><span>🔎 Consultar protocolos</span><span class="chev" id="protoHistChev">▸</span></div>' +
          '<div class="pcb phbody" id="protoHistBody">' +
            '<div class="srow2">' +
              '<input id="protoHistQ" class="phq" placeholder="Nome ou telefone" autocomplete="off">' +
              '<button class="pbtn pri" id="protoHistBtn" style="padding:0 16px">Buscar</button>' +
            '</div>' +
            '<div id="protoHistResults"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // teclado numérico
    var kp = document.getElementById("protoKp");
    var keys = ["1","2","3","4","5","6","7","8","9","C","0","⌫"];
    keys.forEach(function (k) {
      var bt = document.createElement("button");
      bt.textContent = k;
      bt.onclick = function () {
        var i = document.getElementById("protoPhone");
        if (k === "C") i.value = "";
        else if (k === "⌫") i.value = i.value.slice(0, -1);
        else i.value += k;
        i.focus();
      };
      kp.appendChild(bt);
    });

    document.getElementById("protoBuscar").onclick = buscar;
    document.getElementById("protoPhone").addEventListener("keydown", function (e) {
      if (e.key === "Enter") buscar();
    });
    document.getElementById("protoReg").onclick = registrar;

    document.getElementById("protoHistToggle").onclick = toggleHist;
    document.getElementById("protoHistBtn").onclick = function () {
      consultaHist(document.getElementById("protoHistQ").value);
    };
    document.getElementById("protoHistQ").addEventListener("keydown", function (e) {
      if (e.key === "Enter") consultaHist(document.getElementById("protoHistQ").value);
    });
  }

  /* ── 5. Buscar no Supabase ──────────────────────────────────────────────── */
  async function buscar() {
    var box = document.getElementById("protoResults");
    document.getElementById("protoCbar").classList.remove("show");
    var tel = last8(document.getElementById("protoPhone").value);
    if (tel.length < 8) {
      box.innerHTML = '<div class="empty">Digite o número completo (pelo menos 8 dígitos).</div>';
      return;
    }
    // Anti-corrida: cada busca ganha um número; só a mais recente pode renderizar.
    // Evita que uma resposta antiga (rede lenta) sobrescreva uma busca nova.
    var meuSeq = ++_buscaSeq;
    var btn = document.getElementById("protoBuscar");
    if (btn) btn.disabled = true;
    box.innerHTML = '<div class="empty">Buscando...</div>';
    try {
      var res = await supa.rpc("protocolo_buscar_por_telefone", {
        p_telefone: document.getElementById("protoPhone").value
      });
      if (meuSeq !== _buscaSeq) return;   // já veio uma busca mais nova — descarta esta
      if (res.error) {
        box.innerHTML = '<div class="empty">Erro ao buscar: ' + esc(res.error.message) + "</div>";
        return;
      }
      // agrupa por paciente
      var map = {};
      GRUPOS = [];
      (res.data || []).forEach(function (row) {
        var k = row.paciente_id + "|" + row.paciente_nome;
        if (!map[k]) { map[k] = { paciente: row, exames: [] }; GRUPOS.push(map[k]); }
        map[k].exames.push(row);
      });
      if (GRUPOS.length === 0) {
        box.innerHTML = '<div class="empty">Nenhum exame pronto pra retirada com esse celular.<br>' +
          '<span style="font-size:12px">Confira o número ou localize por outro meio.</span></div>';
        return;
      }
      renderResultados();
    } catch (e) {
      if (meuSeq !== _buscaSeq) return;
      box.innerHTML = '<div class="empty">Erro ao buscar: ' + esc(e && e.message || "desconhecido") + "</div>";
    } finally {
      if (meuSeq === _buscaSeq && btn) btn.disabled = false;
    }
  }

  function iniciais(nome) {
    var p = String(nome || "").trim().split(/\s+/);
    return ((p[0] || "")[0] || "") + ((p[p.length - 1] || "")[0] || "");
  }

  function renderResultados() {
    var html = "";
    GRUPOS.forEach(function (g, gi) {
      var p = g.paciente;
      html += '<div class="pat"><div class="path">' +
        '<div class="pav">' + esc(iniciais(p.paciente_nome).toUpperCase()) + "</div><div>" +
        '<div class="pnm">' + esc(p.paciente_nome) + "</div>" +
        '<div class="pmt">Paciente #' + esc(p.paciente_id) +
          (p.paciente_cpf ? " · CPF " + esc(p.paciente_cpf) : "") +
          (p.paciente_nasc ? " · nasc. " + fmtData(p.paciente_nasc) : "") + "</div></div></div>";
      g.exames.forEach(function (ex, ei) {
        html += '<div class="ex"><label>' +
          '<input type="checkbox" data-g="' + gi + '" data-e="' + ei + '">' +
          '<span><span class="exn">' + (ex.exame_icone ? esc(ex.exame_icone) + " " : "") + esc(ex.exame_nome) + "</span>" +
          '<span class="exm">Exame #' + esc(ex.agendamento_id) + " · " + fmtData(ex.data_exame) + "</span></span>" +
          '</label><span class="pill">Pronto</span></div>';
      });
      html += "</div>";
    });
    var box = document.getElementById("protoResults");
    box.innerHTML = html;
    box.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
      cb.addEventListener("change", updateCount);
    });
    document.getElementById("protoCbar").classList.add("show");
    updateCount();
  }

  function selecionados() {
    return [].slice.call(document.querySelectorAll("#protoResults input:checked")).map(function (cb) {
      return GRUPOS[+cb.dataset.g].exames[+cb.dataset.e];
    });
  }
  function updateCount() {
    document.getElementById("protoCount").textContent = selecionados().length;
  }

  /* ── 6. Registrar retirada ──────────────────────────────────────────────── */
  async function registrar() {
    var sel = selecionados();
    if (sel.length === 0) { toast("Marque pelo menos um exame.", true); return; }
    var quem = document.getElementById("protoQuem").value.trim();
    if (!quem) { toast("Informe quem está retirando.", true); document.getElementById("protoQuem").focus(); return; }
    var vinc = document.getElementById("protoVinc").value;
    var btn = document.getElementById("protoReg");
    btn.disabled = true;

    var res = await supa.rpc("protocolo_registrar_retirada", {
      p_agendamento_ids: sel.map(function (e) { return e.agendamento_id; }),
      p_retirado_por: quem,
      p_vinculo: vinc,
      p_telefone_busca: document.getElementById("protoPhone").value,
      p_usuario_id: (typeof CU !== "undefined" && CU) ? CU.id : null
    });
    btn.disabled = false;

    if (res.error) { toast("Erro ao registrar: " + res.error.message, true); return; }
    toast("Retirada registrada (" + sel.length + " exame" + (sel.length > 1 ? "s" : "") + ").");
    document.getElementById("protoQuem").value = "";
    await buscar();       // recarrega — os retirados somem da lista
    refreshHistIfOpen();
  }

  /* ── 7. Consulta de protocolos (painel recolhível) ──────────────────────── */
  function toggleHist() {
    var body = document.getElementById("protoHistBody");
    var chev = document.getElementById("protoHistChev");
    if (!body) return;
    var aberto = body.classList.toggle("open");
    if (chev) chev.classList.toggle("open", aberto);
    if (aberto && !body._carregou) {
      body._carregou = true;
      consultaHist("");   // primeira abertura mostra as retiradas de hoje
    }
  }

  async function consultaHist(q) {
    var box = document.getElementById("protoHistResults");
    if (!box) return;
    box.innerHTML = '<div class="lie">Buscando...</div>';
    var termo = (q || "").trim();
    var res = termo
      ? await supa.rpc("protocolo_consultar", { p_busca: termo })
      : await supa.rpc("protocolo_do_dia");
    if (res.error) { box.innerHTML = '<div class="lie">Erro: ' + esc(res.error.message) + "</div>"; return; }
    renderLog(res.data || [], box, termo);
  }

  function renderLog(rows, box, termo) {
    if (!rows.length) {
      box.innerHTML = '<div class="lie">' +
        (termo ? "Nada encontrado para “" + esc(termo) + "”." : "Nenhuma retirada registrada hoje.") +
        "</div>";
      return;
    }
    if (!termo) {
      box.innerHTML = '<div class="lie" style="padding:2px 0 10px">Retiradas de hoje (' + rows.length + "):</div>";
    } else {
      box.innerHTML = '<div class="lie" style="padding:2px 0 10px">' + rows.length + " resultado(s):</div>";
    }
    box.innerHTML += rows.map(function (r) {
      var dt = new Date(r.retirado_em);
      var hora = dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      var dia = dt.toLocaleDateString("pt-BR");
      return '<div class="li"><div class="t"><span class="w">' + esc(r.paciente_nome || "") +
        '</span><span class="wh">' + dia + " " + hora + "</span></div>" +
        '<div class="e">📄 ' + esc(r.exame_nome || "") + ' <span style="color:#64748b">· #' + esc(r.agendamento_id) + "</span></div>" +
        '<div class="b">Retirado por <b>' + esc(r.retirado_por || "") + "</b>" +
        (r.vinculo ? " · " + esc(r.vinculo) : "") +
        (r.usuario_nome ? " · conf. " + esc(r.usuario_nome) : "") + "</div></div>";
    }).join("");
  }

  // recarrega a consulta se o painel estiver aberto (após registrar)
  function refreshHistIfOpen() {
    var body = document.getElementById("protoHistBody");
    if (body && body.classList.contains("open")) {
      var q = document.getElementById("protoHistQ");
      consultaHist(q ? q.value : "");
    }
  }

  /* ── 8. Toast ───────────────────────────────────────────────────────────── */
  function toast(msg, err) {
    var t = document.getElementById("protoToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "protoToast";
      t.style.cssText = "position:fixed;left:50%;bottom:26px;transform:translateX(-50%) translateY(30px);color:#fff;padding:14px 22px;border-radius:12px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transition:.25s;z-index:9999";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = err ? "#b91c1c" : "#15803d";
    t.style.opacity = "1";
    t.style.transform = "translateX(-50%) translateY(0)";
    clearTimeout(t._t);
    t._t = setTimeout(function () {
      t.style.opacity = "0";
      t.style.transform = "translateX(-50%) translateY(30px)";
    }, 2600);
  }

  /* ── 9. Boot ────────────────────────────────────────────────────────────── */
  function boot() {
    if (typeof PERMS === "undefined" || typeof window.navTo !== "function") {
      return setTimeout(boot, 300);   // espera o app carregar
    }
    injectCSS();
    mount();
    hookNav();
    // reavalia visibilidade do botão quando o usuário loga/desloga
    document.addEventListener("click", function () { setTimeout(applyBtnVisibility, 400); }, true);
    setInterval(applyBtnVisibility, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
