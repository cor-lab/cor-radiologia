// ============================================================================
// requisicao.js - Sobreimpressão em requisição pré-impressa COR
// ----------------------------------------------------------------------------
// Imprime nome/CRO/endereço do dentista nos campos certos do bloco em papel
// timbrado pré-impresso. Calibração persistida em configuracoes (Supabase).
// Depende de: supa, ags, dents, fdent, esc, toast (já globais no index.html)
// ============================================================================

var REQ_KEY = "requisicao_calib";

// Padrão inicial — sobrescrito pelo que tá salvo no Supabase
var REQ_DEF = {
  x_dent: 18,    y_dent: 109,
  x_cro:  155,   y_cro:  109,
  x_end:  18,    y_end:  129,
  x_tel:  18,    y_tel:  148,
  fonte:  11
};

// Cache em memória (1 leitura por sessão)
var _reqCalib = null;

// ----------------------------------------------------------------------------
// Carregar / salvar calibração
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
// Buscar dados do dentista a partir do agendamento
// ----------------------------------------------------------------------------

async function reqBuscarDadosDent(agId) {
  // 1) Tenta no cache local (ags + dents)
  var ag = ags.find(function(x){ return x.id === agId; });
  if (ag && ag.dId) {
    var d = fdent(ag.dId);
    if (d) {
      // Busca endereço completo no Supabase (cache só tem endereço resumido)
      var endCompleto = await reqBuscarEndCompleto(ag.dId);
      return {
        nome: d.n || "",
        cro:  d.cro || "",
        endereco: endCompleto || d.end || "",
        telefone: d.tel || ""
      };
    }
  }

  // 2) Fallback: busca do Supabase
  var rAg = await supa.from("agendamentos").select("dentista_id").eq("id", agId).single();
  if (rAg.error || !rAg.data || !rAg.data.dentista_id) {
    throw new Error("Agendamento sem dentista indicado.");
  }
  var rD = await supa.from("dentistas")
    .select("nome, cro, telefone")
    .eq("id", rAg.data.dentista_id).single();
  if (rD.error) throw rD.error;
  var endCompleto2 = await reqBuscarEndCompleto(rAg.data.dentista_id);
  return {
    nome: rD.data.nome || "",
    cro:  rD.data.cro || "",
    endereco: endCompleto2 || "",
    telefone: rD.data.telefone || ""
  };
}

async function reqBuscarEndCompleto(dentId) {
  var r = await supa.from("dentista_enderecos")
    .select("endereco, bairro, cidade, cep")
    .eq("dentista_id", dentId)
    .order("id", { ascending: true })
    .limit(5);
  if (r.error || !r.data || !r.data.length) return "";
  // Pega o primeiro (ou tu pode adicionar coluna 'principal' depois)
  var e = r.data[0];
  var partes = [e.endereco, e.bairro, e.cidade].filter(function(x){ return x && x.trim(); });
  return partes.join(" - ");
}

// ----------------------------------------------------------------------------
// Gerar HTML da requisição (mesmo padrão de imprimirRelatorioDia/etc)
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

// ============================================================================
// FUNÇÃO PÚBLICA 1: Imprimir requisição (botão do menu do agendamento)
// ============================================================================

async function imprimirRequisicao(agId) {
  try {
    var calib = await reqCarregarCalib();
    var dados = await reqBuscarDadosDent(agId);

    if (!dados.nome) {
      if (typeof toast === "function") toast("⚠️", "Dentista sem nome cadastrado.");
      return;
    }
    if (!dados.endereco) {
      if (!confirm('Dentista "' + dados.nome + '" não tem endereço cadastrado.\nImprimir mesmo assim?')) return;
    }

    var html = reqGerarHtml(dados, calib);
    reqAbrirImpressao(html);

    if (typeof toast === "function") toast("🖨️", "Requisição enviada à impressora.");
  } catch (e) {
    console.error("[req] erro:", e);
    if (typeof toast === "function") toast("⚠️", "Falha: " + (e.message || e));
    else alert("Falha: " + (e.message || e));
  }
}

// ============================================================================
// FUNÇÃO PÚBLICA 2: Tela de calibração (Configurações → Requisição)
// ============================================================================

async function abrirCalibracaoRequisicao() {
  var c = await reqCarregarCalib();

  // Remove modal anterior se existir
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
      "<div class='av'><strong>Como calibrar:</strong> clica em <em>🖨️ Imprimir teste</em> em folha branca, sobrepõe na requisição contra a luz, ajusta os mm pra direita/esquerda (X) ou baixo/cima (Y), reimprime até alinhar. Daí salva.</div>" +
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
  var dados = {
    nome: "Dr. TESTE DE CALIBRAÇÃO",
    cro:  "CRO-RS 99999",
    endereco: "Rua de Teste, 999 - Bairro Teste - Santa Maria",
    telefone: "(55) 99999-9999"
  };
  reqAbrirImpressao(reqGerarHtml(dados, calib));
}
