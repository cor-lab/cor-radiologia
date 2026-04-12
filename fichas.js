// ============================================================
// FICHAS.JS — Módulo de Fichas para Impressão
// COR - Centro Odontológico de Radiologia
// v1.0 — 12/04/2026
//
// 4 fichas impressas simultaneamente (cada uma em página A4):
//   1. Ficha do Paciente (dados + ortodônticas + história médica)
//   2. Exame Clínico (respiração, fonação, ATM, face)
//   3. Intervenções (trabalhos realizados/a realizar)
//   4. Etiqueta CD (foto + dados compactos)
//
// Uso: imprimirFichas(agId) — chamado pelo botão no app
// Depende de: ags[], fdent(), fex(), fconv(), SUPA_URL, SUPA_KEY
// ============================================================

var FICHAS_VERSION = '1.1';

// Fotos servidas via HTTP pelo servidor_fotos.py (porta 8080)
// URL: http://192.168.0.200:8080/{SEQ/1000}/{SEQ}fs.jpg
var FICHAS_FOTO_BASE = 'http://192.168.0.200:8080';

function _fic_fotoPath(seqAtend) {
    if (!seqAtend) return '';
    var seq = parseInt(seqAtend);
    var pasta = Math.floor(seq / 1000);
    return FICHAS_FOTO_BASE + '/' + pasta + '/' + seq + 'fs.jpg';
}

function _fic_fotoTag(seqAtend) {
    var path = _fic_fotoPath(seqAtend);
    if (!path) return '<div class="hd-ph">Foto<br>Paciente</div>';
    return '<img src="' + path + '" onerror="this.parentNode.innerHTML=\'<div class=hd-ph>Foto<br>indisponível</div>\'" alt="Foto">';
}

function _fic_fmt(d){if(!d)return'';var p=(d+'').substring(0,10).split('-');return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:d}
function _fic_idade(dn){if(!dn)return'';var p=(dn+'').substring(0,10).split('-');if(p.length!==3)return'';var n=new Date(+p[0],+p[1]-1,+p[2]),h=new Date(),a=h.getFullYear()-n.getFullYear(),m=h.getMonth()-n.getMonth();if(h.getDate()<n.getDate())m--;if(m<0){a--;m+=12}return a+'a '+m+'m'}
function _fic_e(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

function _fic_css(){return'\
@import url("https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap");\
*{margin:0;padding:0;box-sizing:border-box}\
body{font-family:"Open Sans",Arial,sans-serif;color:#1a1a2e;font-size:11px}\
@page{size:A4 portrait;margin:10mm 10mm 10mm 15mm}\
.pg{page-break-after:always;padding:0;position:relative}\
.pg:last-child{page-break-after:auto}\
.hd{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;padding-bottom:10px;border-bottom:3px solid #3aaa35}\
.hd-foto{width:90px;height:110px;border:2px solid #ccc;border-radius:6px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}\
.hd-foto img{width:100%;height:100%;object-fit:cover}\
.hd-ph{color:#aaa;font-size:10px;text-align:center}\
.hd-info{flex:1}\
.hd-nome{font-size:16px;font-weight:700;color:#fff;background:linear-gradient(135deg,#3aaa35,#2d8a2e);padding:5px 14px;border-radius:4px;margin-bottom:6px;letter-spacing:.5px}\
.hd-g{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;line-height:1.6}\
.hd-l{font-weight:700;color:#555}\
.hd-logo{width:90px;flex-shrink:0;text-align:right}\
.hd-logo img{width:80px}\
.st{font-size:12px;font-weight:700;color:#fff;background:linear-gradient(135deg,#3aaa35,#2d8a2e);padding:4px 12px;border-radius:3px;text-align:center;text-transform:uppercase;letter-spacing:1px;margin:8px 0 6px}\
.sst{font-size:11px;font-weight:700;color:#2d8a2e;text-align:center;text-transform:uppercase;letter-spacing:.5px;margin:4px 0;padding:2px 0;border-bottom:1px solid #3aaa35}\
.fr{display:flex;gap:6px;margin:3px 0;align-items:baseline}\
.fl{font-weight:700;font-size:10px;color:#333;white-space:nowrap}\
.fn{flex:1;border-bottom:1px solid #bbb;min-width:40px;min-height:14px}\
.fv{font-size:11px;color:#1a1a2e}\
.fs{width:80px;border-bottom:1px solid #bbb;min-height:14px}\
.cg{display:grid;grid-template-columns:1fr 1fr;gap:2px 20px;margin:4px 0}\
.ci{display:flex;align-items:center;gap:5px;font-size:10.5px;padding:2px 0}\
.cb{width:13px;height:13px;border:1.5px solid #555;border-radius:2px;flex-shrink:0}\
.ln{border-bottom:1px solid #ccc;height:20px}\
.tb{width:100%;border-collapse:collapse;margin:4px 0}\
.tb th{background:#3aaa35;color:#fff;padding:5px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:left;border:1px solid #2d8a2e}\
.tb td{padding:4px 8px;border:1px solid #ddd;height:22px;font-size:10px}\
.tb tr:nth-child(even) td{background:#f8fdf8}\
.er{display:flex;align-items:center;gap:4px;margin:3px 0;flex-wrap:wrap}\
.el{font-weight:700;font-size:10.5px;color:#1a1a2e;min-width:120px}\
.eo{display:flex;align-items:center;gap:3px;font-size:10px}\
.en{border-bottom:1px solid #bbb;min-width:60px;min-height:13px}\
.cdp{display:flex;justify-content:flex-start;align-items:flex-end;min-height:90vh}\
.cde{display:flex;gap:10px;align-items:center;border:2px solid #3aaa35;border-radius:8px;padding:10px;width:400px}\
.cdf{width:80px;height:95px;border-radius:6px;overflow:hidden;border:2px solid #ddd;flex-shrink:0;background:#f0f0f0;display:flex;align-items:center;justify-content:center}\
.cdf img{width:100%;height:100%;object-fit:cover}\
.cdi{flex:1}\
.cdn{font-size:12px;font-weight:700;color:#fff;background:linear-gradient(135deg,#3aaa35,#2d8a2e);padding:3px 8px;border-radius:3px;margin-bottom:5px}\
.cdd{font-size:10px;line-height:1.6}\
.cdd b{color:#555}\
.cdl{width:55px}\
.cdl img{width:100%}\
@media print{.pg{padding:0!important}}\
'}

function _fic_hd(a,dn){
var nb=_fic_fmt(a.paciente_data_nascimento||''),id=_fic_idade(a.paciente_data_nascimento||''),db=_fic_fmt(a.dt);
var seq=a.firebird_seq_atend||'';
return'<div class="hd">'+
'<div class="hd-foto">'+_fic_fotoTag(seq)+'</div>'+
'<div class="hd-info">'+
'<div class="hd-nome">'+_fic_e(a.pac||'SEM NOME').toUpperCase()+'</div>'+
'<div class="hd-g">'+
'<span class="hd-l">Dr.(a):</span><span>'+_fic_e(dn)+'</span>'+
'<span class="hd-l">Telefone:</span><span>'+_fic_e(a.tel||'')+'</span>'+
'<span class="hd-l">Data:</span><span>'+db+'</span>'+
'<span class="hd-l">Nascimento:</span><span>'+nb+'</span>'+
'<span class="hd-l">Idade:</span><span>'+id+'</span>'+
'</div></div>'+
'<div class="hd-logo"><img src="logo.png" alt="COR"></div></div>'}

/* ═══ FICHA 1 — PACIENTE ═══ */
function _fic1(a,dn){
var ed=a.paciente_logradouro||'',ba=a.paciente_bairro||'',ci=a.paciente_municipio||'',ce=a.paciente_cep||'',nu=a.paciente_numero||'';
var h='<div class="pg">'+_fic_hd(a,dn);
h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 16px;margin:8px 0">';
h+='<div>';
h+='<div class="fr"><span class="fl">Pai:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">Profissão do Pai:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">Mãe:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">Profissão da Mãe:</span><span class="fn"></span></div>';
h+='</div><div>';
h+='<div class="fr"><span class="fl">Endereço:</span><span class="fv">'+_fic_e(ed).toUpperCase()+'</span></div>';
h+='<div class="fr"><span class="fl">Bairro:</span><span class="fv">'+_fic_e(ba).toUpperCase()+'</span></div>';
h+='<div class="fr"><span class="fl">Cidade:</span><span class="fv">'+_fic_e(ci).toUpperCase()+'</span></div>';
h+='</div><div>';
h+='<div class="fr"><span class="fl">Nº:</span><span class="fv">'+_fic_e(nu)+'</span></div>';
h+='<div class="fr"><span class="fl">CEP:</span><span class="fv">'+_fic_e(ce)+'</span></div>';
h+='<div class="fr"><span class="fl">UF:</span><span class="fv">RS</span></div>';
h+='</div></div>';
h+='<div class="fr" style="margin:6px 0"><span class="fl">OBS:</span><span class="fn"></span></div>';
h+='<div class="ln"></div><div class="ln"></div>';

h+='<div class="st">Informações Ortodônticas</div>';
h+='<div class="fr"><span class="fl">Tratamento ortodôntico anterior:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">Razões para o tratamento ortodôntico:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">Grau de motivação:</span><span class="fn"></span></div>';

h+='<div class="st">História Médica</div>';
h+='<div class="sst">O paciente apresentou</div>';
var c1=['Asma','Anemia','Alergia','Doenças Sangüíneas','Doença Óssea','Diabetes','Epilepsia','Problemas Endócrinos','Problemas Emocionais','Doenças na Infância'];
var c2=['Doenças Cardíacas','Distúrbios Auditivos','Distúrbios Respiratórios','Traumatismo da Face e/ou Cabeça','Herpes','Hepatite','Febre Reumática','Fraturas Ósseas','',''];
h+='<div class="cg">';
for(var i=0;i<c1.length;i++){
h+='<div class="ci"><div class="cb"></div><span>'+c1[i]+'</span></div>';
h+='<div class="ci"><div class="cb"></div><span>'+(c2[i]||'')+'</span>'+(c2[i]?'':'<span class="fn"></span>')+'</div>';
}
h+='</div>';
h+='<div style="margin-top:6px">';
h+='<div class="fr"><span class="fl">Ingere drogas ou medicamentos:</span><span class="fn"></span><span class="fl" style="margin-left:10px">Anticoncepcional:</span><span class="fn" style="max-width:120px"></span></div>';
h+='<div class="fr"><span class="fl">Anomalias congênitas:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">Estágio desenvolvimento ósseo:</span><span class="fs"></span><span class="fl" style="margin-left:8px">Tipo físico:</span><span class="fs"></span><span class="fl" style="margin-left:8px">Altura:</span><span class="fs" style="width:50px"></span><span class="fl" style="margin-left:8px">Peso:</span><span class="fs" style="width:50px"></span></div>';
h+='<div class="fr"><span class="fl">Cirurgia anterior:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">Saúde atual:</span><span class="fn"></span></div>';
h+='</div>';
for(var l=0;l<6;l++)h+='<div class="ln"></div>';
return h+'</div>'}

/* ═══ FICHA 2 — EXAME CLÍNICO ═══ */
function _fic2(a,dn){
var h='<div class="pg">'+_fic_hd(a,dn);
h+='<div class="st">Exame Clínico</div>';

h+='<div class="er"><span class="el">RESPIRAÇÃO:</span><span class="fl">PREDOMINÂNCIA:</span><span class="eo"><span class="cb"></span> NASAL</span><span class="eo"><span class="cb"></span> BUCAL</span><span class="eo"><span class="cb"></span> MISTA</span></div>';
h+='<div class="er"><span class="el">FONAÇÃO:</span><span class="eo"><span class="cb"></span> NORMAL</span><span class="eo"><span class="cb"></span> ANORMAL</span><span class="en" style="min-width:200px"></span></div>';
h+='<div class="er"><span class="el">MASTIGAÇÃO:</span><span class="eo"><span class="cb"></span> VERTICAL - UNILATERAL</span><span class="en" style="min-width:100px"></span><span class="eo"><span class="cb"></span> HORIZONTAL - BILATERAL</span></div>';
h+='<div class="er"><span class="el">DEGLUTIÇÃO:</span><span class="eo"><span class="cb"></span> NORMAL</span><span class="eo"><span class="cb"></span> ATÍPICA - COM INTERPOSIÇÃO:</span><span class="eo"><span class="cb"></span> LINGUAL</span><span class="eo"><span class="cb"></span> LABIAL</span></div>';

h+='<div class="er"><span class="el">LÍNGUA:</span><span class="fl">POSTURA:</span><span class="eo"><span class="cb"></span> BAIXA</span><span class="eo"><span class="cb"></span> ALTA</span><span style="margin-left:auto"><span class="eo"><span class="cb"></span> BOCHECHAS</span></span></div>';
h+='<div class="er" style="margin-left:120px"><span class="eo"><span class="cb"></span> RETRAÍDA</span><span class="eo"><span class="cb"></span> ADIANTADA</span><span class="eo"><span class="cb"></span> INTERPOSTA</span></div>';

h+='<div class="er"><span class="el">VOLUME:</span><span class="eo"><span class="cb"></span> NORMAL</span><span class="eo"><span class="cb"></span> MACROGLOSSIA</span><span class="eo"><span class="cb"></span> MICROGLOSSIA</span></div>';
h+='<div class="er"><span class="el">FREIO:</span><span class="eo"><span class="cb"></span> NORMAL</span><span class="eo"><span class="cb"></span> ATADO</span></div>';

h+='<div class="er"><span class="el">LÁBIOS:</span><span class="fl">TÔNUS-SUPERIOR:</span><span class="eo"><span class="cb"></span> HIPOTÔNICO</span><span class="eo"><span class="cb"></span> HIPERTÔNICO</span><span class="fl" style="margin-left:8px">INFERIOR:</span><span class="eo"><span class="cb"></span> HIPOTÔNICO</span><span class="eo"><span class="cb"></span> HIPERTÔNICO</span></div>';
h+='<div class="er"><span class="el">MÚSCULO MENTALIS:</span><span class="eo"><span class="cb"></span> HIPERTÔNICO</span><span class="eo"><span class="cb"></span> NORMAL</span><span style="margin-left:auto"><span class="eo"><span class="cb"></span> HIPERTÔNICO</span></span></div>';
h+='<div class="er"><span class="el">FREIOS:</span><span class="eo"><span class="cb"></span> NORMAIS</span><span class="eo"><span class="cb"></span> ATADOS</span></div>';

h+='<div class="er"><span class="el">RELAÇÃO INTERMAXILAR:</span><span class="fl">DENTES:</span><span class="eo"><span class="cb"></span> DISTOCLUSÃO</span><span class="eo"><span class="cb"></span> NORMOCLUSÃO</span><span class="eo"><span class="cb"></span> MESIOCLUSÃO</span></div>';
h+='<div class="er" style="margin-left:180px"><span class="fl">BASAL ÓSSEA:</span><span class="eo"><span class="cb"></span> DISTO-RELAÇÃO</span><span class="eo"><span class="cb"></span> NORMO-RELAÇÃO</span><span class="eo"><span class="cb"></span> MESIO-RELAÇÃO</span></div>';

h+='<div class="er"><span class="el">LINHA MEDIANA DENTÁRIA DESVIADA PARA:</span><span class="eo"><span class="cb"></span> DIREITA</span><span class="en" style="min-width:40px"></span><span style="font-size:10px">mm</span><span class="eo"><span class="cb"></span> ESQUERDA</span><span class="en" style="min-width:40px"></span><span style="font-size:10px">mm</span></div>';
h+='<div class="er"><span class="el">TRESPASSE SAGITAL:</span><span class="en" style="min-width:60px"></span><span style="font-size:10px">mm</span></div>';
h+='<div class="er"><span class="el">TRESPASSE VERTICAL:</span><span class="en" style="min-width:60px"></span><span style="font-size:10px">mm</span></div>';

// ATM
h+='<div class="st">ATM</div>';
h+='<div class="er"><span class="el">DOR:</span><span class="eo"><span class="cb"></span> LADO DIREITO</span><span class="eo"><span class="cb"></span> LADO ESQUERDO</span><span class="eo"><span class="cb"></span> AMBOS</span></div>';
h+='<div class="er"><span class="el">CLIQUES:</span><span class="eo"><span class="cb"></span> LADO DIREITO</span><span class="eo"><span class="cb"></span> LADO ESQUERDO</span><span class="eo"><span class="cb"></span> AMBOS</span></div>';
h+='<div class="er"><span class="el">LATERALIDADE:</span><span class="fl">DIREITA</span><span class="en" style="min-width:60px"></span><span style="font-size:10px">mm</span><span class="fl" style="margin-left:10px">ESQUERDA</span><span class="en" style="min-width:60px"></span><span style="font-size:10px">mm</span></div>';
h+='<div class="er"><span class="el">CURVA DA SPEE:</span><span class="eo"><span class="cb"></span> NORMAL</span><span class="eo"><span class="cb"></span> PLANA</span><span class="eo"><span class="cb"></span> ACENTUADA</span></div>';
h+='<div class="er" style="margin-left:150px"><span class="fl">SE ACENTUADA:</span><span class="eo"><span class="cb"></span> DIREITA</span><span class="en" style="min-width:50px"></span><span style="font-size:10px">mm</span><span class="eo"><span class="cb"></span> ESQUERDA</span><span class="en" style="min-width:50px"></span><span style="font-size:10px">mm</span></div>';

h+='<div class="er"><span class="el">DISGNATAS:</span><span class="fl">TRANSVERSAL:</span><span class="en" style="min-width:200px"></span></div>';
h+='<div class="er" style="margin-left:120px"><span class="fl">VERTICAL:</span><span class="en" style="min-width:200px"></span></div>';
h+='<div class="er" style="margin-left:120px"><span class="fl">SAGITAL:</span><span class="en" style="min-width:200px"></span></div>';

// Face
h+='<div class="st">Desenvolvimento da Face e Posição Espacial</div>';
h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 20px">';
h+='<div class="fr"><span class="fl">SEIOS FRONTAIS:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">ÓRBITAS:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">SEIOS MAXILARES:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">NASO-FARINGE:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">CÉLULAS DA MASTÓIDE:</span><span class="fn"></span></div>';
h+='<div></div>';
h+='<div class="fr"><span class="fl">ÂNGULO GONÍACO:</span><span class="fn"></span></div>';
h+='<div class="fr"><span class="fl">C1 A C2:</span><span class="fn"></span><span style="font-size:10px;margin-left:4px">mm</span></div>';
h+='</div>';
return h+'</div>'}

/* ═══ FICHA 3 — INTERVENÇÕES ═══ */
function _fic3(a,dn,exNm){
var h='<div class="pg">'+_fic_hd(a,dn);
h+='<div class="st">Intervenções</div>';
h+='<table class="tb"><thead><tr><th style="width:80px">Data</th><th>Trabalhos Realizados</th><th>Trabalhos a Realizar</th></tr></thead><tbody>';
h+='<tr><td>'+_fic_fmt(a.dt)+'</td><td>'+_fic_e(exNm)+'</td><td></td></tr>';
for(var i=0;i<35;i++)h+='<tr><td></td><td></td><td></td></tr>';
return h+'</tbody></table></div>'}

/* ═══ FICHA 4 — ETIQUETA CD ═══ */
function _fic4(a,dn){
var id=_fic_idade(a.paciente_data_nascimento||''),nb=_fic_fmt(a.paciente_data_nascimento||''),db=_fic_fmt(a.dt);
var h='<div class="pg"><div class="cdp"><div class="cde">';
h+='<div class="cdl"><img src="logo.png" alt="COR"></div>';
h+='<div class="cdi">';
h+='<div class="cdn">'+_fic_e(a.pac||'SEM NOME').toUpperCase()+'</div>';
h+='<div class="cdd">';
h+='<b>Dr.(a):</b> '+_fic_e(dn)+'<br>';
h+='<b>Idade:</b> '+id+'<br>';
h+='<b>Nasc.:</b> '+nb+'<br>';
h+='<b>Data:</b> '+db+'<br>';
h+='<b>Fone:</b> '+_fic_e(a.tel||'');
h+='</div></div></div></div></div>';
return h}

/* ══════════════════════════════════════════════════════════
   FUNÇÃO PRINCIPAL — imprimirFichas(agId)
   ══════════════════════════════════════════════════════════ */
function imprimirFichas(agId){
var a=ags.find(function(x){return x.id===agId});
if(!a){toast("Erro","Agendamento não encontrado");return}
var d=fdent(a.dId)||{n:'-'}, dn=d.n||'-';
var itens=a.exames||[],nomes=[];
itens.forEach(function(it){
var nm=it._nome||it.nome_exame||'';
if(!nm&&it.exame_id){var ex=fex(it.exame_id);nm=ex?ex.n:''}
if(nm)nomes.push(nm)});
var exNm=nomes.join(', ')||'Atendimento';

var html='<!DOCTYPE html><html><head><meta charset="UTF-8">';
html+='<title>Fichas - '+_fic_e(a.pac)+'</title>';
html+='<style>'+_fic_css()+'</style></head><body>';
html+=_fic1(a,dn);
html+=_fic2(a,dn);
html+=_fic3(a,dn,exNm);
html+=_fic4(a,dn);
html+='</body></html>';

var w=window.open('','_blank','width=900,height=700');
if(!w){toast("Erro","Popup bloqueado. Permita popups para imprimir.");return}
w.document.write(html);w.document.close();
setTimeout(function(){w.print()},600)}
