// ============================================================================
// requisicao.js v2 - Sobreimpressão em requisição pré-impressa COR
// ----------------------------------------------------------------------------
// - Imprime nome/CRO/endereço/telefone do dentista nos campos certos.
// - Calibração persistida em configuracoes (chave 'requisicao_calib').
// - Múltiplos endereços: abre seletor; principal pré-selecionado.
// - Permite redefinir o principal direto no seletor (fica salvo).
// Depende de globais: supa, ags, dents, fdent, esc, toast.
// ============================================================================

var REQ_KEY = "requisicao_calib";

var REQ_DEF = {
  x_dent: 18,    y_dent: 109,
  x_cro:  155,   y_cro:  109,
  x_end:  18,    y_end:  129,
  x_tel:  18,    y_tel:  148,
  fonte:  11
};

var _reqCalib = null;

// ----------------------------------------------------------------------------
// Calibração (configuracoes / Supabase)
// ----------------------------------------------------------------------------

async function reqCarregarCalib(forcar) {
  if (_reqCalib && !forcar) return _reqCalib;
  try {
    var r = await supa.from("configuracoes").select("valor").eq("chave", REQ_KEY).maybeSingle();
    _reqCalib = Object.assign({}, REQ_DEF, (r.data && r.data.valor) || {});
  } catch (e) {
    console.warn("[req] erro ao ler calib, usando padrão:", e);
    _reqCalib = Object.assign({}, REQ_DEF);
  }
  return _reqCalib;
}

async function reqSalvarCalib(novo) {
  var valor = Object.assign({}, REQ_DEF, _reqCalib || {}, novo);
  var r = await supa.from("configuracoes").upsert({
    chave: REQ_KEY,
    valor: valor,
    updated_at: new Date().toISOString()
  }, { onConflict: "chave" });
  if (r.error) {
    console.error("[req] erro ao salvar calib:", r.error);
    if (typeof toast === "function") toast("⚠️", "Erro ao salvar calibração.");
    throw r.error;
  }
  _reqCalib = valor;
  return valor;
}

// ----------------------------------------------------------------------------
// Buscar dentista + endereços
// ----------------------------------------------------------------------------

async function reqBuscarDentista(agId) {
  var ag = ags.find(function(x){ return x.id === agId; });
  var dentId = ag && ag.dId;

  if (!dentId) {
    var rAg = await supa.from("agendamentos").select("dentista_id").eq("id", agId).single();
    if (rAg.error || !rAg.data || !rAg.data.dentista_id) {
      throw new Error("Agendamento sem dentista indicado.");
    }
    dentId = rAg.data.dentista_id;
  }

  // Cache local (dents) tem nome/cro/telefone
  var dCache = fdent(dentId);

  // Busca completa (caso cache não tenha)
  var rD = !dCache
    ? await supa.from("dentistas").select("nome, cro, telefone").eq("id", dentId).single()
    : null;

  // Sempre busca todos os endereços
  var rE = await supa.from("dentista_enderecos")
    .select("id, descricao, endereco, complemento, bairro, cidade, cep, principal")
    .eq("dentista_id", dentId)
    .order("principal", { ascending: false })
    .order("id", { ascending: true });

  return {
    dentId: dentId,
    nome: dCache ? dCache.n : (rD.data && rD.data.nome) || "",
    cro:  dCache ? dCache.cro : (rD.data && rD.data.cro) || "",
    telefone: dCache ? dCache.tel : (rD.data && rD.data.telefone) || "",
    enderecos: rE.data || []
  };
}

function reqFormatarEnd(e) {
  var l1 = [e.endereco, e.complemento].filter(Boolean).join(", ");
  var l2 = [e.bairro, e.cidade].filter(Boolean).join(" - ");
  return [l1, l2].filter(Boolean).join(" - ");
}

// ----------------------------------------------------------------------------
// HTML da requisição
// ----------------------------------------------------------------------------

function reqGerarHtml(dados, c) {
  return "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>" +
    "<title>Requisição</title>" +
    "<style>" +
    "@page{size:A4;margin:0}" +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    "body{font-family:Arial,sans-serif}" +
    ".folha{position:relative;width:210mm;height:297mm}" +
    ".campo{position:absolute;font-size:" + c.fonte + "pt;color:#000;white-space:nowrap;overflow:hidden}" +
    "@media print{.folha{box-shadow:none}}" +
    "</style></head><body>" +
    "<div class='folha'>" +
      "<div class='campo' style='left:" + c.x_dent + "mm;top:" + c.y_dent + "mm'>" + esc(dados.nome) + "</div>" +
      "<div class='campo' style='left:" + c.x_cro  + "mm;top:" + c.y_cro  + "mm'>" + esc(dados.cro) + "</div>" +
      "<div class='campo' style='left:" + c.x_end  + "mm;top:" + c.y_end  + "mm'>" + esc(dados.endereco) + "</div>" +
      (dados.telefone
        ? "<div class='campo' style='left:" + c.x_tel + "mm;top:" + c.y_tel + "mm'>" + esc(dados.telefone) + "</div>"
        : "") +
    "</div>" +
    "<script>window.onload=function(){window.print();}<\/script>" +
    "</body></html>";
}

function reqAbrirImpressao(html) {
  var win = window.open("", "_blank");
  if (!win) {
    if (typeof toast === "function") toast("⚠️", "Bloqueio de pop-up. Permite janelas pra imprimir.");
    return;
  }
  win.document.write(html);
  win.document.close();
}

// ----------------------------------------------------------------------------
// Marcar endereço como principal (atomico: desmarca outros, marca o escolhido)
// ----------------------------------------------------------------------------

async function reqMarcarPrincipal(dentId, endId) {
  // Desmarca todos os outros
  var r1 = await supa.from("dentista_enderecos")
    .update({ principal: false })
    .eq("dentista_id", dentId)
    .neq("id", endId);
  if (r1.error) {
    console.error("[req] desmarcar:", r1.error);
    throw r1.error;
  }
  // Marca o escolhido
  var r2 = await supa.from("dentista_enderecos")
    .update({ principal: true })
    .eq("id", endId);
  if (r2.error) {
    console.error("[req] marcar:", r2.error);
    throw r2.error;
  }
}

// ============================================================================
// PÚBLICO 1: Imprimir requisição
// ============================================================================

async function imprimirRequisicao(agId) {
  try {
    var calib = await reqCarregarCalib();
    var d = await reqBuscarDentista(agId);

    if (!d.nome) {
      if (typeof toast === "function") toast("⚠️", "Dentista sem nome cadastrado.");
      return;
    }

    // Sem endereços
    if (!d.enderecos.length) {
      if (!confirm('Dentista "' + d.nome + '" não tem endereço cadastrado.\nImprimir mesmo assim?')) return;
      reqImprimirComEndereco(d, "", calib);
      return;
    }

    // 1 endereço só → direto
    if (d.enderecos.length === 1) {
      reqImprimirComEndereco(d, reqFormatarEnd(d.enderecos[0]), calib);
      return;
    }

    // 2+ endereços → seletor
    abrirSeletorEndereco(d, calib);

  } catch (e) {
    console.error("[req] erro:", e);
    if (typeof toast === "function") toast("⚠️", "Falha: " + (e.message || e));
    else alert("Falha: " + (e.message || e));
  }
}

function reqImprimirComEndereco(d, enderecoStr, calib) {
  var html = reqGerarHtml({
    nome: d.nome,
    cro: d.cro,
    endereco: enderecoStr,
    telefone: d.telefone
  }, calib);
  reqAbrirImpressao(html);
  if (typeof toast === "function") toast("🖨️", "Requisição enviada.");
}

// ----------------------------------------------------------------------------
// Modal seletor de endereço
// ----------------------------------------------------------------------------

function abrirSeletorEndereco(d, calib) {
  var ant = document.getElementById("modal-sel-end");
  if (ant) ant.remove();

  // Endereço pré-selecionado: principal, ou primeiro
  var preId = (d.enderecos.find(function(e){ return e.principal; }) || d.enderecos[0]).id;

  var m = document.createElement("div");
  m.id = "modal-sel-end";

  var cards = d.enderecos.map(function(e){
    var label = e.descricao || ("Endereço #" + e.id);
    var endLinha = reqFormatarEnd(e);
    var isPrincipal = !!e.principal;
    return "<div class='card-end" + (e.id === preId ? " sel" : "") + "' data-id='" + e.id + "' onclick='reqSelEndereco(" + e.id + ")'>" +
      "<div class='lbl'>" +
        "<input type='radio' name='end-radio' " + (e.id === preId ? "checked" : "") + ">" +
        "<strong>" + esc(label) + "</strong>" +
        (isPrincipal ? "<span class='star' title='Endereço principal'>⭐</span>" : "") +
      "</div>" +
      "<div class='end'>" + esc(endLinha) + "</div>" +
      (e.cep ? "<div class='cep'>CEP: " + esc(e.cep) + "</div>" : "") +
    "</div>";
  }).join("");

  m.innerHTML =
    "<style>" +
    "#modal-sel-end{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px}" +
    "#modal-sel-end .box{background:var(--bg,#1a1d24);color:var(--wh,#fff);padding:18px;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;border:1px solid rgba(255,255,255,.08)}" +
    "#modal-sel-end h3{font-size:1rem;margin-bottom:4px}" +
    "#modal-sel-end .sub{font-size:.78rem;color:var(--gr,#9aa);margin-bottom:14px}" +
    "#modal-sel-end .card-end{background:rgba(255,255,255,.03);border:1.5px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:all .12s}" +
    "#modal-sel-end .card-end:hover{border-color:#4ade80;background:rgba(74,222,128,.05)}" +
    "#modal-sel-end .card-end.sel{border-color:#4ade80;background:rgba(74,222,128,.08)}" +
    "#modal-sel-end .lbl{display:flex;align-items:center;gap:8px;margin-bottom:4px}" +
    "#modal-sel-end .lbl strong{font-size:.88rem}" +
    "#modal-sel-end .star{font-size:.85rem}" +
    "#modal-sel-end .end{font-size:.78rem;color:var(--gr,#aab);line-height:1.4}" +
    "#modal-sel-end .cep{font-size:.72rem;color:var(--gr,#9aa);margin-top:2px;font-family:DM Mono,monospace}" +
    "#modal-sel-end .ac{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap}" +
    "#modal-sel-end .ac .esq{display:flex;gap:6px;flex-wrap:wrap}" +
    "#modal-sel-end .ac .dir{display:flex;gap:6px;flex-wrap:wrap}" +
    "</style>" +
    "<div class='box'>" +
      "<h3>📍 Escolher endereço</h3>" +
      "<div class='sub'>" + esc(d.nome) + " tem " + d.enderecos.length + " endereços. Selecione qual usar:</div>" +
      "<div id='lista-ends'>" + cards + "</div>" +
      "<div class='ac'>" +
        "<div class='esq'>" +
          "<button class='btn btnt bsm' onclick='reqDefinirComoPrincipal()'>⭐ Tornar principal</button>" +
        "</div>" +
        "<div class='dir'>" +
          "<button class='btn bsm' onclick='document.getElementById(\"modal-sel-end\").remove()'>Cancelar</button>" +
          "<button class='btn btng bsm' onclick='reqConfirmarImpressao()'>🖨️ Imprimir</button>" +
        "</div>" +
      "</div>" +
    "</div>";

  document.body.appendChild(m);

  // Estado do modal (acessado pelas funções globais abaixo)
  window._reqModalState = { dentista: d, calib: calib, selecionadoId: preId };
}

function reqSelEndereco(id) {
  var st = window._reqModalState;
  if (!st) return;
  st.selecionadoId = id;
  // Atualiza visual
  document.querySelectorAll("#modal-sel-end .card-end").forEach(function(c){
    var on = parseInt(c.getAttribute("data-id")) === id;
    c.classList.toggle("sel", on);
    var radio = c.querySelector("input[type=radio]");
    if (radio) radio.checked = on;
  });
}

function reqConfirmarImpressao() {
  var st = window._reqModalState;
  if (!st) return;
  var end = st.dentista.enderecos.find(function(e){ return e.id === st.selecionadoId; });
  if (!end) return;
  document.getElementById("modal-sel-end").remove();
  reqImprimirComEndereco(st.dentista, reqFormatarEnd(end), st.calib);
}

async function reqDefinirComoPrincipal() {
  var st = window._reqModalState;
  if (!st) return;
  var end = st.dentista.enderecos.find(function(e){ return e.id === st.selecionadoId; });
  if (!end) return;
  if (end.principal) {
    if (typeof toast === "function") toast("⭐", "Já é o principal.");
    return;
  }
  try {
    await reqMarcarPrincipal(st.dentista.dentId, end.id);
    // Atualiza estado em memória
    st.dentista.enderecos.forEach(function(e){ e.principal = (e.id === end.id); });
    if (typeof toast === "function") toast("⭐", "Marcado como principal.");
    // Reabre o modal pra refletir a estrelinha
    abrirSeletorEndereco(st.dentista, st.calib);
  } catch (e) {
    if (typeof toast === "function") toast("⚠️", "Erro: " + e.message);
  }
}

// ============================================================================
// PÚBLICO 2: Tela de calibração
// ============================================================================

async function abrirCalibracaoRequisicao() {
  var c = await reqCarregarCalib();
  var ant = document.getElementById("modal-calib-req");
  if (ant) ant.remove();

  var m = document.createElement("div");
  m.id = "modal-calib-req";
  m.innerHTML =
    "<style>" +
    "#modal-calib-req{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px}" +
    "#modal-calib-req .box{background:var(--bg,#1a1d24);color:var(--wh,#fff);padding:20px;border-radius:10px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto;border:1px solid rgba(255,255,255,.08)}" +
    "#modal-calib-req h3{margin-bottom:10px;font-size:1rem}" +
    "#modal-calib-req .av{background:rgba(240,180,0,.08);border-left:3px solid #f0b500;padding:8px 10px;font-size:.8rem;color:#f0c040;margin-bottom:14px;border-radius:4px;line-height:1.5}" +
    "#modal-calib-req .gd{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}" +
    "#modal-calib-req label{font-size:.72rem;color:var(--gr,#9aa);display:flex;flex-direction:column;gap:3px;text-transform:uppercase;font-weight:600}" +
    "#modal-calib-req input[type=number]{padding:6px 8px;font-size:.85rem;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--wh,#fff);border-radius:5px}" +
    "#modal-calib-req .ac{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}" +
    "@media(max-width:600px){#modal-calib-req .gd{grid-template-columns:repeat(2,1fr)}}" +
    "</style>" +
    "<div class='box'>" +
      "<h3>📐 Calibração da Requisição</h3>" +
      "<div class='av'><strong>Como calibrar:</strong> clica em <em>🖨️ Imprimir teste</em> em folha branca, sobrepõe na requisição contra a luz, ajusta os mm pra direita/esquerda (X) ou baixo/cima (Y), reimprime até alinhar. Depois <em>💾 Salvar</em>.</div>" +
      "<div class='gd'>" +
        cInput("x_dent", "Dentista X (mm)", c.x_dent) +
        cInput("y_dent", "Dentista Y (mm)", c.y_dent) +
        cInput("x_cro",  "CRO X (mm)",      c.x_cro)  +
        cInput("y_cro",  "CRO Y (mm)",      c.y_cro)  +
        cInput("x_end",  "Endereço X (mm)", c.x_end)  +
        cInput("y_end",  "Endereço Y (mm)", c.y_end)  +
        cInput("x_tel",  "Telefone X (mm)", c.x_tel)  +
        cInput("y_tel",  "Telefone Y (mm)", c.y_tel)  +
        cInput("fonte",  "Fonte (pt)",      c.fonte)  +
      "</div>" +
      "<div class='ac'>" +
        "<button class='btn btnt bsm' onclick='reqImprimirTeste()'>🖨️ Imprimir teste</button>" +
        "<button class='btn bsm' onclick='document.getElementById(\"modal-calib-req\").remove()'>Cancelar</button>" +
        "<button class='btn btng bsm' onclick='reqSalvarCalibFromModal()'>💾 Salvar</button>" +
      "</div>" +
    "</div>";

  document.body.appendChild(m);

  function cInput(id, lbl, val) {
    return "<label>" + lbl +
      "<input type='number' id='ck-" + id + "' value='" + val + "' step='0.5'></label>";
  }
}

async function reqSalvarCalibFromModal() {
  var v = function(id){ return parseFloat(document.getElementById("ck-" + id).value); };
  try {
    await reqSalvarCalib({
      x_dent: v("x_dent"), y_dent: v("y_dent"),
      x_cro:  v("x_cro"),  y_cro:  v("y_cro"),
      x_end:  v("x_end"),  y_end:  v("y_end"),
      x_tel:  v("x_tel"),  y_tel:  v("y_tel"),
      fonte:  v("fonte")
    });
    var m = document.getElementById("modal-calib-req");
    if (m) m.remove();
    if (typeof toast === "function") toast("💾", "Calibração salva!");
  } catch (e) {
    alert("Erro ao salvar: " + e.message);
  }
}

function reqImprimirTeste() {
  var v = function(id){ return parseFloat(document.getElementById("ck-" + id).value); };
  var calib = {
    x_dent: v("x_dent"), y_dent: v("y_dent"),
    x_cro:  v("x_cro"),  y_cro:  v("y_cro"),
    x_end:  v("x_end"),  y_end:  v("y_end"),
    x_tel:  v("x_tel"),  y_tel:  v("y_tel"),
    fonte:  v("fonte")
  };
  reqAbrirImpressao(reqGerarHtml({
    nome: "Dr. TESTE DE CALIBRAÇÃO",
    cro:  "CRO-RS 99999",
    endereco: "Rua de Teste, 999 - Bairro Teste - Santa Maria",
    telefone: "(55) 99999-9999"
  }, calib));
}
