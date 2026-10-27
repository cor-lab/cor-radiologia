/* ═══════════════════════════════════════════════════════════════════════
   nfse_pj.js — APP COR v8.6 (2026-10-27)
   ─────────────────────────────────────────────────────────────────────
   1) PAGADOR ≠ PACIENTE (modal "Emitir NFS-e" do index.html)
      • pacientes.nf_pagador_terceiro = true → a nota não sai automática ao
        realizar; o modal abre exigindo o pagador.
      • O pagador (CPF ou CNPJ) fica em agendamentos.nf_tomador e vira o
        tomador da nota (emitir-nfse-focus v55). CNPJ pode ter ISS retido.
      Funções usadas pelo index.html: nfPagPreparar, nfPagToggle, nfPagColeta,
      nfPagDocBlur, nfPagCepBlur. Flag em window._nfPagFlagTerceiro.

   2) ABA "🏢 Notas PJ" (window.rNotasPJ → #pgNpj; PERMS.notaspj admin/agenda)
      • Cadastro de empresas tomadoras (nfse_tomadores_pj) — cada uma com
        "ISS retido" (Unimed sim, SYNS não) e descrição padrão.
      • Emissão avulsa: empresa + valor + descrição + competência
        → emitir-nfse-focus {tipo:"pj"} (sempre Padrão Nacional).
      • Lista das notas PJ com acompanhamento/retomada e link do PDF.

   Estilo do projeto: var/function, supa, supaFetch, toast(emoji,msg), esc.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Utilitários ──────────────────────────────────────────────────────────
function _npjDig(v){ return String(v || "").replace(/\D+/g, ""); }

if (typeof window.validarCNPJ !== "function") {
  window.validarCNPJ = function(c){
    c = _npjDig(c);
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    function dv(n){
      var pesos = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      var s = 0, i;
      for (i = 0; i < n; i++) s += parseInt(c.charAt(i), 10) * pesos[i];
      var r = s % 11;
      return r < 2 ? 0 : 11 - r;
    }
    return dv(12) === parseInt(c.charAt(12), 10) && dv(13) === parseInt(c.charAt(13), 10);
  };
}

function formatarCNPJ(c){
  c = _npjDig(c);
  if (c.length !== 14) return c;
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}
function _npjDoc(d){
  d = _npjDig(d);
  if (d.length === 14) return formatarCNPJ(d);
  if (d.length === 11 && typeof formatarCPF === "function") return formatarCPF(d);
  return d;
}
function _npjMoeda(v){ return "R$ " + Number(v || 0).toFixed(2).replace(".", ","); }
function _npjNum(v){
  // aceita "1.234,56" / "1234,56" / "1234.56"
  var s = String(v || "").trim();
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  var n = Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
function _npjEl(id){ return document.getElementById(id); }
function _npjVal(id){ var e = _npjEl(id); return e ? String(e.value || "").trim() : ""; }
function _npjSet(id, v){ var e = _npjEl(id); if (e) e.value = (v == null ? "" : v); }
function _npjEsc(s){ return (typeof esc === "function") ? esc(s) : String(s || "").replace(/[&<>"']/g, function(ch){ return "&#" + ch.charCodeAt(0) + ";"; }); }
function _npjHojeBRT(){
  var d = new Date(Date.now() - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function _npjAliqIss(){ return 0.04; } // ISS do COR no Simples (NFSEN_PALIQ=4.00 na Edge)

async function _npjViaCep(cep){
  cep = _npjDig(cep);
  if (cep.length !== 8) return null;
  try {
    var r = await fetch("https://viacep.com.br/ws/" + cep + "/json/");
    if (!r.ok) return null;
    var d = await r.json();
    return d && !d.erro ? d : null;
  } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════
// 1) PAGADOR ≠ PACIENTE (modal Emitir NFS-e)
// ═══════════════════════════════════════════════════════════════════════
window._nfPagFlagTerceiro = false;

var NFPAG_CAMPOS = ["nfPagDoc","nfPagNome","nfPagEmail","nfPagCep","nfPagLog","nfPagNum","nfPagBairro","nfPagCompl","nfPagUf"];

function nfPagToggle(){
  var on = !!(_npjEl("nfPagOutro") || {}).checked;
  var b = _npjEl("nfPagBloco");
  if (b) b.style.display = on ? "" : "none";
  nfPagAtualizarIss();
}

function nfPagAtualizarIss(){
  var box = _npjEl("nfPagIssBox");
  if (box) box.style.display = _npjDig(_npjVal("nfPagDoc")).length === 14 ? "" : "none";
}

// Chamado por abrirModalEmitirNota(ag): limpa o bloco, depois carrega do banco
// a marcação do paciente e o pagador já salvo no atendimento.
async function nfPagPreparar(ag){
  window._nfPagFlagTerceiro = false;
  NFPAG_CAMPOS.forEach(function(id){ _npjSet(id, ""); });
  var iss = _npjEl("nfPagIssRet"); if (iss) iss.checked = false;
  var chk = _npjEl("nfPagOutro"); if (chk) chk.checked = false;
  var av = _npjEl("nfPagAviso"); if (av) av.style.display = "none";
  nfPagToggle();
  if (!ag || !ag.id) return;
  try {
    var rAg = await supa.from("agendamentos").select("nf_tomador, paciente_id").eq("id", ag.id).maybeSingle();
    var t = rAg.data && rAg.data.nf_tomador;
    var pacId = (rAg.data && rAg.data.paciente_id) || ag.paciente_id;
    var flag = false;
    if (pacId) {
      var rP = await supa.from("pacientes").select("nf_pagador_terceiro").eq("id", pacId).maybeSingle();
      flag = !!(rP.data && rP.data.nf_pagador_terceiro);
    }
    // O modal pode ter sido fechado/trocado enquanto carregava
    if (typeof AG_EMISSAO_ATUAL === "undefined" || !AG_EMISSAO_ATUAL || AG_EMISSAO_ATUAL.id !== ag.id) return;
    window._nfPagFlagTerceiro = flag;
    if (av) av.style.display = flag ? "" : "none";
    if (t && typeof t === "object" && _npjDig(t.cnpj || t.cpf)) {
      _npjSet("nfPagDoc", _npjDig(t.cnpj || t.cpf));
      _npjSet("nfPagNome", t.nome); _npjSet("nfPagEmail", t.email);
      _npjSet("nfPagCep", t.cep); _npjSet("nfPagLog", t.logradouro); _npjSet("nfPagNum", t.numero);
      _npjSet("nfPagBairro", t.bairro); _npjSet("nfPagCompl", t.complemento); _npjSet("nfPagUf", t.uf);
      if (iss) iss.checked = t.iss_retido === true;
      if (chk) chk.checked = true;
    } else if (flag && chk) {
      chk.checked = true;
    }
    nfPagToggle();
  } catch (e) {
    console.error("nfPagPreparar:", e);
  }
}

// Retorna null (sem pagador), {erro} ou o objeto nf_tomador pronto p/ gravar.
function nfPagColeta(){
  var chk = _npjEl("nfPagOutro");
  if (!chk || !chk.checked) return null;
  var doc = _npjDig(_npjVal("nfPagDoc"));
  var nome = _npjVal("nfPagNome");
  if (doc.length !== 11 && doc.length !== 14) return { erro: "Informe o CPF (11 dígitos) ou CNPJ (14 dígitos) do pagador." };
  if (doc.length === 11 && !(typeof validarCPF === "function" && validarCPF(doc))) return { erro: "CPF do pagador inválido." };
  if (doc.length === 14 && !validarCNPJ(doc)) return { erro: "CNPJ do pagador inválido." };
  if (nome.length < 3) return { erro: "Informe o nome / razão social do pagador." };
  var cep = _npjDig(_npjVal("nfPagCep"));
  if (cep && cep.length !== 8) return { erro: "CEP do pagador deve ter 8 dígitos (ou deixe em branco)." };
  var o = {
    nome: nome.toUpperCase(),
    email: _npjVal("nfPagEmail").toLowerCase(),
    cep: cep,
    logradouro: _npjVal("nfPagLog"),
    numero: _npjVal("nfPagNum"),
    bairro: _npjVal("nfPagBairro"),
    complemento: _npjVal("nfPagCompl"),
    uf: _npjVal("nfPagUf").toUpperCase()
  };
  if (doc.length === 14) { o.cnpj = doc; o.iss_retido = !!(_npjEl("nfPagIssRet") || {}).checked; }
  else o.cpf = doc;
  return o;
}

// CNPJ digitado: se a empresa já está no cadastro de Notas PJ, preenche tudo.
async function nfPagDocBlur(){
  nfPagAtualizarIss();
  var doc = _npjDig(_npjVal("nfPagDoc"));
  if (doc.length !== 14) return;
  try {
    var r = await supa.from("nfse_tomadores_pj").select("*").eq("cnpj", doc).maybeSingle();
    var e = r.data;
    if (!e) return;
    if (!_npjVal("nfPagNome")) _npjSet("nfPagNome", e.razao_social);
    if (!_npjVal("nfPagEmail")) _npjSet("nfPagEmail", e.email);
    if (!_npjVal("nfPagCep")) {
      _npjSet("nfPagCep", e.cep); _npjSet("nfPagLog", e.logradouro); _npjSet("nfPagNum", e.numero);
      _npjSet("nfPagBairro", e.bairro); _npjSet("nfPagCompl", e.complemento); _npjSet("nfPagUf", e.uf);
    }
    var iss = _npjEl("nfPagIssRet"); if (iss) iss.checked = !!e.iss_retido;
    toast("🏢", "Empresa encontrada no cadastro: " + e.razao_social);
  } catch (err) { console.warn("nfPagDocBlur:", err); }
}

async function nfPagCepBlur(){
  if (_npjVal("nfPagLog")) return;
  var d = await _npjViaCep(_npjVal("nfPagCep"));
  if (!d) return;
  _npjSet("nfPagLog", d.logradouro); _npjSet("nfPagBairro", d.bairro); _npjSet("nfPagUf", d.uf);
}

// ═══════════════════════════════════════════════════════════════════════
// 2) ABA NOTAS PJ
// ═══════════════════════════════════════════════════════════════════════
var _npjEmpresas = [];
var _npjNotas = [];
var _npjEditId = null;      // null = nova empresa; 0 = formulário fechado
var _npjEmitindo = false;
var _npjPollings = {};

var _NPJ_IN = "width:100%;box-sizing:border-box;padding:7px 9px;border-radius:7px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#fff;font-size:.85rem";
function _npjInput(id, rot, val, extra){
  return "<div><label style='color:var(--gr);font-size:.72rem;display:block;margin-bottom:2px'>" + rot + "</label>" +
    "<input id='" + id + "' value='" + _npjEsc(val == null ? "" : String(val)) + "' style='" + _NPJ_IN + "' " + (extra || "") + "></div>";
}

window.rNotasPJ = async function(){
  var pg = _npjEl("pgNpj");
  if (!pg) return;
  if (typeof canAcc === "function" && !canAcc("notaspj")) { if (typeof deny === "function") deny(pg); return; }
  pg.innerHTML = "<div class='card'><div style='padding:10px;color:var(--gr)'>Carregando…</div></div>";
  await _npjCarregar();
  _npjRender();
};

async function _npjCarregar(){
  try {
    var r1 = await supa.from("nfse_tomadores_pj").select("*").order("razao_social", { ascending: true });
    if (r1.error) throw new Error(r1.error.message);
    _npjEmpresas = r1.data || [];
    var r2 = await supa.from("nfse_emitidas")
      .select("id,reference,tomador_pj_id,paciente_nome,cpf_cnpj_tomador,valor_servico,valor_liquido,iss_retido,valor_iss_retido,competencia,descricao,status_fiscal,numero_nfse,url_pdf,pdf_url,mensagem_erro,created_at")
      .not("tomador_pj_id", "is", null)
      .order("created_at", { ascending: false }).limit(60);
    if (r2.error) throw new Error(r2.error.message);
    _npjNotas = r2.data || [];
  } catch (e) {
    console.error("_npjCarregar:", e);
    toast("⚠️", "Falha ao carregar Notas PJ: " + (e.message || e));
  }
}

function _npjEmpresa(id){
  for (var i = 0; i < _npjEmpresas.length; i++) if (_npjEmpresas[i].id === Number(id)) return _npjEmpresas[i];
  return null;
}

function _npjRender(){
  var pg = _npjEl("pgNpj");
  if (!pg) return;
  var ativas = _npjEmpresas.filter(function(e){ return e.ativo; });
  var h = "";
  h += "<div style='margin-bottom:16px'><h2 style='font-family:Playfair Display,serif;font-size:1.22rem'>🏢 Notas fiscais para empresas (CNPJ)</h2>";
  h += "<p style='color:var(--gr);font-size:.82rem;margin-top:3px'>Notas mensais de convênio (Unimed, SYNS…) e qualquer outra nota avulsa para CNPJ. Pacientes que pedem nota na empresa: use “outro pagador” na emissão do atendimento.</p></div>";

  // ── Emitir ──
  h += "<div class='card'><div class='ctitle'>Emitir nota</div>";
  if (!ativas.length) {
    h += "<div style='font-size:.85rem;color:var(--gr)'>Cadastre uma empresa abaixo para começar.</div>";
  } else {
    h += "<div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 14px'>";
    h += "<div><label style='color:var(--gr);font-size:.72rem;display:block;margin-bottom:2px'>Empresa</label><select id='npjEmp' onchange='npjEmpChange()' style='" + _NPJ_IN + "'>";
    h += "<option value=''>— selecione —</option>";
    ativas.forEach(function(e){
      h += "<option value='" + e.id + "'>" + _npjEsc(e.nome_fantasia || e.razao_social) + " — " + formatarCNPJ(e.cnpj) + "</option>";
    });
    h += "</select></div>";
    h += _npjInput("npjValor", "Valor bruto da nota (R$)", "", "inputmode='decimal' placeholder='0,00' oninput='npjResumo()'");
    h += "<div><label style='color:var(--gr);font-size:.72rem;display:block;margin-bottom:2px'>Competência (data do serviço)</label><input id='npjComp' type='date' value='" + _npjHojeBRT() + "' max='" + _npjHojeBRT() + "' style='" + _NPJ_IN + "'></div>";
    h += "</div>";
    h += "<div style='margin-top:8px'><label style='color:var(--gr);font-size:.72rem;display:block;margin-bottom:2px'>Descrição do serviço (vai na nota)</label>";
    h += "<textarea id='npjDesc' rows='3' maxlength='2000' style='" + _NPJ_IN + ";resize:vertical'></textarea></div>";
    h += "<div id='npjResumo' style='margin-top:10px;font-size:.85rem'></div>";
    h += "<div style='margin-top:12px'><button id='npjBtnEmitir' class='btn btng' style='padding:8px 18px' onclick='npjEmitir()'>🧾 Emitir nota</button></div>";
  }
  h += "</div>";

  // ── Notas emitidas ──
  h += "<div class='card'><div style='display:flex;justify-content:space-between;align-items:center'><div class='ctitle' style='margin:0'>Notas para empresas</div>";
  h += "<button class='btn btno' style='padding:5px 12px;font-size:.78rem' onclick='rNotasPJ()'>↻ Atualizar</button></div>";
  if (!_npjNotas.length) {
    h += "<div style='font-size:.82rem;color:var(--gr);margin-top:8px'>Nenhuma nota emitida ainda.</div>";
  } else {
    h += "<div class='tw' style='margin-top:8px'><table><thead><tr><th>Data</th><th>Empresa</th><th>Competência</th><th>Valor</th><th>ISS retido</th><th>Líquido</th><th>Status</th><th>Nº</th><th></th></tr></thead><tbody>";
    _npjNotas.forEach(function(n){
      var st = n.status_fiscal || "";
      var cor = st === "emitida" ? "var(--tl)" : (st === "rejeitada" ? "var(--or)" : (st === "emitindo" ? "#e6a700" : "var(--gr)"));
      var pdf = n.url_pdf || n.pdf_url;
      h += "<tr>";
      h += "<td>" + (n.created_at ? (typeof iso2br === "function" ? iso2br(String(n.created_at).substring(0,10)) : String(n.created_at).substring(0,10)) : "—") + "</td>";
      h += "<td>" + _npjEsc(n.paciente_nome) + "<div style='font-size:.7rem;color:var(--gr)'>" + _npjDoc(n.cpf_cnpj_tomador) + "</div></td>";
      h += "<td>" + (n.competencia ? (typeof iso2br === "function" ? iso2br(n.competencia) : n.competencia) : "—") + "</td>";
      h += "<td>" + _npjMoeda(n.valor_servico) + "</td>";
      h += "<td>" + (n.iss_retido ? _npjMoeda(n.valor_iss_retido) : "—") + "</td>";
      h += "<td>" + _npjMoeda(n.valor_liquido) + "</td>";
      h += "<td style='color:" + cor + ";font-weight:600'>" + _npjEsc(st) + "</td>";
      h += "<td>" + _npjEsc(n.numero_nfse || "—") + "</td>";
      h += "<td style='white-space:nowrap'>";
      if (pdf) h += "<a class='btn btno' style='padding:4px 10px;font-size:.75rem;text-decoration:none' href='" + _npjEsc(pdf) + "' target='_blank' rel='noopener'>PDF</a> ";
      if (st === "emitindo") h += "<button class='btn btno' style='padding:4px 10px;font-size:.75rem' onclick=\"npjVerificar('" + n.id + "')\">Verificar/Retomar</button>";
      if (st === "rejeitada") h += "<button class='btn btno' style='padding:4px 10px;font-size:.75rem' onclick=\"npjVerErro('" + n.id + "')\">Ver erro</button>";
      h += "</td></tr>";
    });
    h += "</tbody></table></div>";
  }
  h += "</div>";

  // ── Empresas ──
  h += "<div class='card'><div style='display:flex;justify-content:space-between;align-items:center'><div class='ctitle' style='margin:0'>Empresas tomadoras</div>";
  h += "<button class='btn btng' style='padding:5px 12px;font-size:.78rem' onclick='npjEditar(null)'>+ Nova empresa</button></div>";
  h += "<div id='npjForm'></div>";
  if (!_npjEmpresas.length) {
    h += "<div style='font-size:.82rem;color:var(--gr);margin-top:8px'>Nenhuma empresa cadastrada.</div>";
  } else {
    h += "<div class='tw' style='margin-top:8px'><table><thead><tr><th>Empresa</th><th>CNPJ</th><th>ISS</th><th>Cidade</th><th>Situação</th><th></th></tr></thead><tbody>";
    _npjEmpresas.forEach(function(e){
      h += "<tr" + (e.ativo ? "" : " style='opacity:.55'") + ">";
      h += "<td><strong>" + _npjEsc(e.nome_fantasia || e.razao_social) + "</strong>" + (e.nome_fantasia ? "<div style='font-size:.7rem;color:var(--gr)'>" + _npjEsc(e.razao_social) + "</div>" : "") + "</td>";
      h += "<td>" + formatarCNPJ(e.cnpj) + "</td>";
      h += "<td>" + (e.iss_retido ? "<span style='color:#e6a700'>Retido pela empresa</span>" : "Sem retenção") + "</td>";
      h += "<td>" + _npjEsc([e.municipio, e.uf].filter(Boolean).join("/")) + "</td>";
      h += "<td>" + (e.ativo ? "Ativa" : "Inativa") + "</td>";
      h += "<td><button class='btn btno' style='padding:4px 10px;font-size:.75rem' onclick='npjEditar(" + e.id + ")'>✏️ Editar</button></td>";
      h += "</tr>";
    });
    h += "</tbody></table></div>";
  }
  h += "</div>";
  pg.innerHTML = h;
  npjResumo();
}

function npjEmpChange(){
  var e = _npjEmpresa(_npjVal("npjEmp"));
  var d = _npjEl("npjDesc");
  if (e && d && !String(d.value || "").trim() && e.descricao_padrao) d.value = e.descricao_padrao;
  npjResumo();
}

function npjResumo(){
  var box = _npjEl("npjResumo");
  if (!box) return;
  var e = _npjEmpresa(_npjVal("npjEmp"));
  var v = _npjNum(_npjVal("npjValor"));
  if (!e) { box.innerHTML = ""; return; }
  var h = "<span style='color:var(--gr)'>Tomador:</span> " + _npjEsc(e.razao_social) + " · " + formatarCNPJ(e.cnpj);
  if (!e.cep || !e.logradouro) h += "<div style='color:var(--or);margin-top:4px'>⚠️ Empresa sem CEP/logradouro no cadastro — complete antes de emitir.</div>";
  if (isFinite(v) && v > 0) {
    var iss = Math.round(v * _npjAliqIss() * 100) / 100;
    if (e.iss_retido) {
      h += "<div style='margin-top:4px'>Valor " + _npjMoeda(v) + " − ISS retido 4% " + _npjMoeda(iss) + " = <b>líquido a receber " + _npjMoeda(v - iss) + "</b></div>";
    } else {
      h += "<div style='margin-top:4px'>Valor " + _npjMoeda(v) + " · ISS 4% (" + _npjMoeda(iss) + ") <b>não retido</b> — recolhido pela COR no Simples.</div>";
    }
  }
  box.innerHTML = h;
}

async function npjEmitir(){
  if (_npjEmitindo) return;
  var e = _npjEmpresa(_npjVal("npjEmp"));
  var v = _npjNum(_npjVal("npjValor"));
  var desc = _npjVal("npjDesc").replace(/\s+/g, " ");
  var comp = _npjVal("npjComp");
  if (!e) { toast("⚠️", "Selecione a empresa."); return; }
  if (!e.cep || !e.logradouro) { toast("⚠️", "Complete CEP e logradouro da empresa antes de emitir."); return; }
  if (!isFinite(v) || v <= 0) { toast("⚠️", "Informe um valor válido."); return; }
  if (desc.length < 10) { toast("⚠️", "Descreva o serviço (mínimo 10 caracteres)."); return; }
  if (comp && comp > _npjHojeBRT()) { toast("⚠️", "A competência não pode ser futura."); return; }
  var iss = Math.round(v * _npjAliqIss() * 100) / 100;
  var msg = "Emitir NFS-e (Padrão Nacional) para:\n\n" + e.razao_social + "\nCNPJ " + formatarCNPJ(e.cnpj) +
    "\n\nValor: " + _npjMoeda(v) +
    (e.iss_retido ? "\nISS RETIDO pela empresa (4%): " + _npjMoeda(iss) + "\nLíquido a receber: " + _npjMoeda(v - iss) : "\nISS não retido") +
    "\nCompetência: " + (comp || _npjHojeBRT()) +
    "\n\nDescrição: " + desc + "\n\nConfirma? (a nota tem validade fiscal)";
  if (!confirm(msg)) return;

  var amb = (typeof ambienteNfseEmissao === "function") ? ambienteNfseEmissao() : "nacional_producao";
  if (amb.indexOf("nacional_") !== 0) { toast("⚠️", "Nota para empresa só pelo Padrão Nacional."); return; }

  _npjEmitindo = true;
  var btn = _npjEl("npjBtnEmitir");
  if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
  try {
    var resp = await supaFetch(API_BASE + "/emitir-nfse-focus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "pj", tomador_pj_id: e.id, valor: v, descricao: desc, competencia: comp || null, ambiente: amb })
    });
    var data = await resp.json().catch(function(){ return {}; });
    if (data && data.pendente) {
      toast("Aguardando", "Focus instável — a nota foi reservada e está sendo acompanhada.");
      if (data.reference) _npjPolling(data.nfse_id, data.reference);
    } else if (!resp.ok) {
      toast("Erro", (data && (data.error || data.message)) || ("Falha ao emitir (HTTP " + resp.status + ")."));
      console.error("npjEmitir:", data);
    } else {
      toast("🧾", "Nota enviada para processamento. Acompanhando…");
      _npjSet("npjValor", ""); _npjSet("npjDesc", "");
      if (data.reference) _npjPolling(data.nfse_id, data.reference);
    }
  } catch (err) {
    console.error("npjEmitir:", err);
    toast("Erro", "Falha ao emitir: " + (err.message || err));
  } finally {
    _npjEmitindo = false;
    await _npjCarregar();
    _npjRender();
  }
}

function _npjPolling(nfseId, reference){
  if (!reference) return;
  if (_npjPollings[reference]) clearInterval(_npjPollings[reference]);
  var tent = 0, ocupado = false;
  var id = setInterval(async function(){
    if (ocupado) return;
    ocupado = true; tent++;
    try {
      var r = await supaFetch(API_BASE + "/consultar-nfse-focus", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: reference })
      });
      var d = await r.json().catch(function(){ return {}; });
      var st = d.status_mapeado;
      if (r.ok && (st === "emitida" || st === "rejeitada" || st === "cancelada")) {
        clearInterval(id); delete _npjPollings[reference];
        if (st === "emitida") toast("✅", "NFS-e da empresa autorizada" + (d.focus && d.focus.numero ? " — nº " + d.focus.numero : "") + ".");
        else if (st === "rejeitada") toast("⚠️", "A prefeitura rejeitou a nota. Veja o erro na lista.");
        await _npjCarregar(); _npjRender();
      } else if (tent >= 20 || (!r.ok && r.status !== 503)) {
        clearInterval(id); delete _npjPollings[reference];
        toast("⏳", "Ainda sem resposta definitiva. Use “Verificar/Retomar” na lista.");
        await _npjCarregar(); _npjRender();
      }
    } catch (e) { console.warn("_npjPolling:", e); }
    ocupado = false;
  }, 6000);
  _npjPollings[reference] = id;
}

async function npjVerificar(nfseId){
  var n = null;
  for (var i = 0; i < _npjNotas.length; i++) if (_npjNotas[i].id === nfseId) n = _npjNotas[i];
  if (!n || !n.reference) { toast("⚠️", "Nota sem referência."); return; }
  try {
    toast("⏳", "Consultando a nota na Focus…");
    var r = await supaFetch(API_BASE + "/consultar-nfse-focus", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: n.reference })
    });
    var d = await r.json().catch(function(){ return {}; });
    if (!r.ok) { toast("Erro", d.error || ("Falha ao consultar (HTTP " + r.status + ").")); return; }
    if (d.status_mapeado !== "emitindo") { await _npjCarregar(); _npjRender(); toast("ℹ️", "Status: " + d.status_mapeado); return; }
    if (!d.nao_encontrada) { toast("Aguardando", "A nota ainda está em processamento."); _npjPolling(n.id, n.reference); return; }
    if (!d.pode_retomar) { toast("Aguardando", "Tente retomar em " + (d.retry_after_seconds || 60) + " segundo(s)."); return; }
    if (!confirm("A Focus não recebeu esta nota. Reenviar com o MESMO conteúdo e referência?")) return;
    var er = await supaFetch(API_BASE + "/emitir-nfse-focus", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "pj", retomar: true, nfse_id: n.id })
    });
    var ed = await er.json().catch(function(){ return {}; });
    if (!er.ok && !ed.pendente) { toast("Erro", ed.error || ("Falha ao retomar (HTTP " + er.status + ").")); return; }
    toast("🧾", "Nota reenviada. Acompanhando…");
    _npjPolling(n.id, n.reference);
  } catch (e) {
    toast("Erro", "Falha: " + (e.message || e));
  }
}

function npjVerErro(nfseId){
  for (var i = 0; i < _npjNotas.length; i++) {
    if (_npjNotas[i].id === nfseId) {
      var m = String(_npjNotas[i].mensagem_erro || "Sem detalhes.");
      try { var j = JSON.parse(m); if (j && j.erros) m = j.erros.map(function(x){ return (x.codigo || "") + " " + (x.mensagem || ""); }).join("\n"); } catch (e) {}
      alert("Erro da prefeitura/Focus:\n\n" + m.slice(0, 1500));
      return;
    }
  }
}

// ── Cadastro de empresas ────────────────────────────────────────────────
function npjEditar(id){
  var box = _npjEl("npjForm");
  if (!box) return;
  var e = id ? _npjEmpresa(id) : null;
  _npjEditId = e ? e.id : null;
  e = e || { ativo: true, iss_retido: false, municipio: "Santa Maria", uf: "RS" };
  var h = "<div style='margin-top:10px;padding:12px;border:1px solid rgba(255,255,255,.14);border-radius:8px'>";
  h += "<div style='font-weight:600;margin-bottom:8px'>" + (_npjEditId ? "Editar empresa" : "Nova empresa") + "</div>";
  h += "<div style='display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 14px'>";
  h += _npjInput("npjFCnpj", "CNPJ", e.cnpj || "", _npjEditId ? "disabled" : "placeholder='só números'");
  h += _npjInput("npjFRazao", "Razão social", e.razao_social);
  h += _npjInput("npjFFant", "Nome fantasia (opcional)", e.nome_fantasia);
  h += _npjInput("npjFIm", "Inscrição municipal (opcional)", e.inscricao_municipal);
  h += _npjInput("npjFEmail", "E-mail p/ envio da nota", e.email, "type='email'");
  h += _npjInput("npjFTel", "Telefone", e.telefone);
  h += _npjInput("npjFCep", "CEP", e.cep, "onblur='npjCepBlur()'");
  h += _npjInput("npjFLog", "Logradouro", e.logradouro);
  h += _npjInput("npjFNum", "Número", e.numero);
  h += _npjInput("npjFCompl", "Complemento", e.complemento);
  h += _npjInput("npjFBairro", "Bairro", e.bairro);
  h += _npjInput("npjFMun", "Cidade", e.municipio);
  h += _npjInput("npjFUf", "UF", e.uf, "maxlength='2'");
  h += "</div>";
  h += "<label style='display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.85rem;cursor:pointer'><input id='npjFIss' type='checkbox' style='width:auto'" + (e.iss_retido ? " checked" : "") + "> A empresa <b>retém o ISS</b> (ex.: Unimed)</label>";
  h += "<label style='display:flex;align-items:center;gap:8px;margin-top:6px;font-size:.85rem;cursor:pointer'><input id='npjFAtivo' type='checkbox' style='width:auto'" + (e.ativo ? " checked" : "") + "> Ativa</label>";
  h += "<div style='margin-top:8px'><label style='color:var(--gr);font-size:.72rem;display:block;margin-bottom:2px'>Descrição padrão da nota (opcional)</label>";
  h += "<textarea id='npjFDesc' rows='2' maxlength='2000' style='" + _NPJ_IN + ";resize:vertical'>" + _npjEsc(e.descricao_padrao || "") + "</textarea></div>";
  h += "<div style='display:flex;gap:8px;margin-top:12px'><button class='btn btng' style='padding:7px 16px' onclick='npjSalvar()'>Salvar</button>";
  h += "<button class='btn btno' style='padding:7px 16px' onclick=\"document.getElementById('npjForm').innerHTML=''\">Cancelar</button></div>";
  h += "</div>";
  box.innerHTML = h;
}

async function npjCepBlur(){
  if (_npjVal("npjFLog")) return;
  var d = await _npjViaCep(_npjVal("npjFCep"));
  if (!d) { toast("⚠️", "CEP não encontrado."); return; }
  _npjSet("npjFLog", d.logradouro); _npjSet("npjFBairro", d.bairro);
  _npjSet("npjFMun", d.localidade); _npjSet("npjFUf", d.uf);
}

async function npjSalvar(){
  var cnpj = _npjDig(_npjVal("npjFCnpj"));
  var dados = {
    razao_social: _npjVal("npjFRazao").toUpperCase(),
    nome_fantasia: _npjVal("npjFFant") || null,
    inscricao_municipal: _npjDig(_npjVal("npjFIm")) || null,
    email: _npjVal("npjFEmail").toLowerCase() || null,
    telefone: _npjDig(_npjVal("npjFTel")) || null,
    cep: _npjDig(_npjVal("npjFCep")) || null,
    logradouro: _npjVal("npjFLog") || null,
    numero: _npjVal("npjFNum") || null,
    complemento: _npjVal("npjFCompl") || null,
    bairro: _npjVal("npjFBairro") || null,
    municipio: _npjVal("npjFMun") || null,
    uf: _npjVal("npjFUf").toUpperCase() || null,
    iss_retido: !!(_npjEl("npjFIss") || {}).checked,
    ativo: !!(_npjEl("npjFAtivo") || {}).checked,
    descricao_padrao: _npjVal("npjFDesc") || null
  };
  if (!_npjEditId && !validarCNPJ(cnpj)) { toast("⚠️", "CNPJ inválido."); return; }
  if (dados.razao_social.length < 3) { toast("⚠️", "Informe a razão social."); return; }
  if (!dados.cep || dados.cep.length !== 8 || !dados.logradouro) { toast("⚠️", "CEP (8 dígitos) e logradouro são obrigatórios para a nota."); return; }
  try {
    var r;
    if (_npjEditId) {
      r = await supa.from("nfse_tomadores_pj").update(dados).eq("id", _npjEditId).select("id");
    } else {
      dados.cnpj = cnpj;
      r = await supa.from("nfse_tomadores_pj").insert(dados).select("id");
    }
    if (r.error) {
      if (/duplicate|23505/i.test(r.error.message || "")) throw new Error("Esse CNPJ já está cadastrado.");
      throw new Error(r.error.message);
    }
    if (!r.data || !r.data.length) throw new Error("Sem permissão para salvar (perfil admin/agenda).");
    toast("✅", "Empresa salva.");
    await _npjCarregar();
    _npjRender();
  } catch (e) {
    toast("⚠️", "Falha ao salvar: " + (e.message || e));
  }
}

// ── v8.7 — checkbox no formulário do ATENDIMENTO (eNfTerc) ────────────────
// Lê/grava pacientes.nf_pagador_terceiro direto, sem depender do "Salvar".
async function nfPagFlagEditCarregar(pacId){
  var cb = _npjEl("eNfTerc");
  if (!cb) return;
  if (!pacId) {
    cb.disabled = true;
    var bx = _npjEl("eNfTercBox"); if (bx) bx.title = "Atendimento sem ficha de paciente vinculada";
    return;
  }
  try {
    var r = await supa.from("pacientes").select("nf_pagador_terceiro").eq("id", pacId).maybeSingle();
    cb = _npjEl("eNfTerc");
    if (!cb) return;
    cb.checked = !!(r.data && r.data.nf_pagador_terceiro);
    cb.disabled = false;
  } catch (e) { console.warn("nfPagFlagEditCarregar:", e); }
}

async function nfPagFlagEditSalvar(pacId, cb){
  if (!pacId || !cb) return;
  var novo = !!cb.checked;
  cb.disabled = true;
  try {
    var r = await supa.from("pacientes").update({ nf_pagador_terceiro: novo }).eq("id", pacId).select("id");
    if (r.error || !r.data || !r.data.length) throw new Error((r.error && r.error.message) || "sem permissão");
    toast("🧾", novo ? "Marcado: paciente não é o pagador — a nota vai pedir quem paga." : "Desmarcado: nota volta a sair no nome do paciente.");
  } catch (e) {
    cb.checked = !novo;
    toast("⚠️", "Não foi possível salvar: " + (e.message || e));
  } finally {
    cb.disabled = false;
  }
}
