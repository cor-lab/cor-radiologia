// ============================================================
// FICHAS.JS — Módulo de Fichas para Impressão
// COR - Centro Odontológico de Radiologia
// v2.0 — 12/04/2026
// Ficha 4 refeita conforme layout original (6×7cm — A×L)
// Ficha 3 margens revisadas (28 linhas sem quebra)
// v2.1 — 20/04/2026 — Nome do dentista em negrito
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

var FICHAS_VERSION = '2.1';

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
body{font-family:"Open Sans",Arial,sans-serif;color:#1a1a2e;font-size:11px;margin:0;padding:0}\
@page{size:A4 portrait;margin:0}\
.pg{page-break-after:always;padding:10mm 10mm 10mm 15mm;position:relative}\
.pg:last-child{page-break-after:auto}\
.hd{display:flex;align-items:flex-start;gap:12px;margin:15mm 0 10px 40mm;padding-bottom:10px;border-bottom:3px solid #3aaa35}\
.hd-foto{width:90px;height:110px;border:2px solid #ccc;border-radius:6px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}\
.hd-foto img{width:100%;height:100%;object-fit:cover}\
.hd-ph{color:#aaa;font-size:10px;text-align:center}\
.hd-info{flex:1}\
.hd-nome{font-size:16px;font-weight:700;color:#fff;background:linear-gradient(135deg,#3aaa35,#2d8a2e);padding:5px 14px;border-radius:4px;margin-bottom:6px;letter-spacing:.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}\
.hd-g{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:11px;line-height:1.6}\
.hd-l{font-weight:700;color:#555}\
.hd-d{font-weight:700;color:#1a1a2e;font-size:12px}\
.hd-logo{width:90px;flex-shrink:0;text-align:right}\
.hd-logo img{width:80px}\
.st{font-size:12px;font-weight:700;color:#fff;background:linear-gradient(135deg,#3aaa35,#2d8a2e);padding:4px 12px;border-radius:3px;text-align:center;text-transform:uppercase;letter-spacing:1px;margin:8px 0 6px;-webkit-print-color-adjust:exact;print-color-adjust:exact}\
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
.tb th{background:#3aaa35;color:#fff;padding:5px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:left;border:1px solid #2d8a2e;-webkit-print-color-adjust:exact;print-color-adjust:exact}\
.tb td{padding:4px 8px;border:1px solid #ddd;height:22px;font-size:10px}\
.tb tr:nth-child(even) td{background:#f8fdf8}\
.er{display:flex;align-items:center;gap:4px;margin:3px 0;flex-wrap:wrap}\
.el{font-weight:700;font-size:10.5px;color:#1a1a2e;min-width:120px}\
.eo{display:flex;align-items:center;gap:3px;font-size:10px}\
.en{border-bottom:1px solid #bbb;min-width:60px;min-height:13px}\
.cdp{display:flex;justify-content:flex-start;align-items:flex-start;min-height:auto;padding-top:5mm}\
.cd-crop{border:0.5px dashed #999;width:87mm;height:67mm;display:flex;align-items:center;justify-content:center}\
.cde{display:flex;flex-direction:column;border:0.5px solid #ccc;width:60mm;height:50mm;position:relative;overflow:hidden}\
.cd-header{display:flex;align-items:center;padding:1.5mm;gap:1.5mm;min-height:15mm}\
.cd-header-logo{flex-shrink:0;display:flex;align-items:center}\
.cd-header-logo img{height:12mm;object-fit:contain}\
.cd-header-info{flex:1;text-align:right;font-size:7.5px;line-height:1.7;padding-right:1mm}\
.cd-header-info b{color:#333;font-weight:600}\
.cd-sep{height:2.5px;background:#3aaa35;margin:0;flex-shrink:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}\
.cd-content{display:flex;flex:1;overflow:hidden}\
.cd-foto-box{width:22mm;flex-shrink:0;overflow:hidden;background:#f0f0f0;display:flex;align-items:center;justify-content:center;border-right:1px solid #ddd}\
.cd-foto-box img{width:100%;height:100%;object-fit:cover}\
.cd-dados{flex:1;padding:1.5mm 2.5mm;display:flex;flex-direction:column;justify-content:center}\
.cdn{font-size:10px;font-weight:700;color:#1a1a2e;margin-bottom:3px;letter-spacing:.3px;display:block;word-break:break-word;line-height:1.3}\
.cd-info-grid{display:grid;grid-template-columns:auto 1fr;gap:1px 4px;font-size:8px;line-height:1.6}\
.cd-info-grid b{color:#333;font-weight:600;white-space:nowrap}\
.cd-info-grid span{color:#1a1a2e}\
@media print{body{margin:0!important;padding:0!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.pg{padding:10mm 10mm 10mm 15mm!important}}\
.punch{position:absolute;left:3mm;width:5mm;height:0;border-top:1px solid #aaa}\
.punch1{top:115mm}\
.punch2{top:198mm}\
.visor{margin:8mm 0 8px 18mm;width:115mm;font-size:10.5px;line-height:1.5}\
.visor-nome{font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:3px;letter-spacing:.3px}\
.visor-g{display:grid;grid-template-columns:auto 1fr;gap:1px 6px}\
.visor-l{font-weight:700;color:#555;font-size:10px}\
.visor-sep{border-bottom:2px solid #3aaa35;margin:4px 0}\
.visor-addr{display:grid;grid-template-columns:1fr auto;gap:1px 12px;font-size:10px}\
'}

function _fic_punch(){return'<div class="punch punch1"></div><div class="punch punch2"></div>'}

function _fic_visor(a,dn){
var nb=_fic_fmt(a.paciente_data_nascimento||''),id=_fic_idade(a.paciente_data_nascimento||''),db=_fic_fmt(a.dt);
var ed=a.paciente_logradouro||'',ba=a.paciente_bairro||'',ci=a.paciente_municipio||'',ce=a.paciente_cep||'',nu=a.paciente_numero||'';
var h='<div class="visor">';
h+='<div class="visor-nome">'+_fic_e(a.pac||'SEM NOME').toUpperCase()+'</div>';
h+='<div class="visor-g">';
h+='<span class="visor-l">Telefone:</span><span>'+_fic_e(a.tel||'')+'</span>';
h+='<span class="visor-l">Data:</span><span>'+db+'</span>';
h+='<span class="visor-l">Nascimento:</span><span>'+nb+'</span>';
h+='<span class="visor-l">Idade:</span><span>'+id+'</span>';
h+='</div>';
h+='<div class="visor-sep"></div>';
h+='<div class="visor-addr">';
h+='<div><span class="visor-l">Endereço:</span> '+_fic_e(ed).toUpperCase()+'</div><div><span class="visor-l">Nº:</span> '+_fic_e(nu)+'</div>';
h+='<div><span class="visor-l">Bairro:</span> '+_fic_e(ba).toUpperCase()+'</div><div><span class="visor-l">CEP:</span> '+_fic_e(ce)+'</div>';
h+='<div><span class="visor-l">Cidade:</span> '+_fic_e(ci).toUpperCase()+'</div><div><span class="visor-l">UF:</span> RS</div>';
h+='</div></div>';
return h;
}

function _fic_hd(a,dn){
var nb=_fic_fmt(a.paciente_data_nascimento||''),id=_fic_idade(a.paciente_data_nascimento||''),db=_fic_fmt(a.dt);
var seq=a.firebird_seq_atend||'';
return'<div class="hd">'+
'<div class="hd-foto">'+_fic_fotoTag(seq)+'</div>'+
'<div class="hd-info">'+
'<div class="hd-nome">'+_fic_e(a.pac||'SEM NOME').toUpperCase()+'</div>'+
'<div class="hd-g">'+
'<span class="hd-l">Dr.(a):</span><span class="hd-d">'+_fic_e(dn)+'</span>'+
'<span class="hd-l">Telefone:</span><span>'+_fic_e(a.tel||'')+'</span>'+
'<span class="hd-l">Data:</span><span>'+db+'</span>'+
'<span class="hd-l">Nascimento:</span><span>'+nb+'</span>'+
'<span class="hd-l">Idade:</span><span>'+id+'</span>'+
'</div></div>'+
'<div class="hd-logo"><img src="https://cor-lab.github.io/cor-radiologia/logo.png" alt="COR"></div></div>'}

/* ═══ FICHA 1 — PACIENTE ═══ */
function _fic1(a,dn){
var ed=a.paciente_logradouro||'',ba=a.paciente_bairro||'',ci=a.paciente_municipio||'',ce=a.paciente_cep||'',nu=a.paciente_numero||'';
var h='<div class="pg">'+_fic_punch()+_fic_hd(a,dn);
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
for(var l=0;l<5;l++)h+='<div class="ln"></div>';
return h+'</div>'}

/* ═══ FICHA 2 — EXAME CLÍNICO ═══ */
function _fic2(a,dn){
var h='<div class="pg">'+_fic_punch()+_fic_hd(a,dn);
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

/* ═══ FICHA 3 — INTERVENÇÕES (38 linhas, preenchendo até o rodapé) ═══ */
function _fic3(a,dn,exNm){
var h='<div class="pg">'+_fic_punch()+_fic_hd(a,dn);
h+='<div class="st">Intervenções</div>';
h+='<table class="tb"><thead><tr><th style="width:80px">Data</th><th>Trabalhos Realizados</th><th>Trabalhos a Realizar</th></tr></thead><tbody>';
h+='<tr><td style="height:18px">'+_fic_fmt(a.dt)+'</td><td style="height:18px">'+_fic_e(exNm)+'</td><td style="height:18px"></td></tr>';
for(var i=0;i<37;i++)h+='<tr><td style="height:18px"></td><td style="height:18px"></td><td style="height:18px"></td></tr>';
return h+'</tbody></table></div>'}

/* ═══ FICHA 4 — ETIQUETA CD (7×6cm, layout referência) ═══ */
function _fic4(a,dn){
var id=_fic_idade(a.paciente_data_nascimento||''),nb=_fic_fmt(a.paciente_data_nascimento||''),db=_fic_fmt(a.dt);
var seq=a.firebird_seq_atend||'';
var fotoUrl=seq?(FICHAS_FOTO_BASE+'/'+Math.floor(parseInt(seq)/1000)+'/'+parseInt(seq)+'fs.jpg'):'';
var h='<div class="pg">'+_fic_punch()+'<div class="cdp"><div class="cd-crop">';
h+='<div class="cde">';

// TOPO: Logo COR (esquerda) + Data (direita)
h+='<div class="cd-header">';
h+='<div class="cd-header-logo"><img src="https://cor-lab.github.io/cor-radiologia/logo_site.jpg" alt="COR"></div>';
h+='<div class="cd-header-info"><b>Data:</b> '+db+'<br><b>Fone:</b> '+_fic_e(a.tel||'')+'</div>';
h+='</div>';

// BARRA VERDE
h+='<div class="cd-sep"></div>';

// CORPO: Foto (esquerda) + Nome/Idade/Nasc/Dr (direita)
h+='<div class="cd-content">';
if(fotoUrl){
h+='<div class="cd-foto-box"><img src="'+fotoUrl+'" onerror="this.parentNode.innerHTML=\'<div style=color:#bbb;font-size:8px;text-align:center;padding-top:12mm>Foto<br>indisponível</div>\'" alt="Foto"></div>';
}else{
h+='<div class="cd-foto-box"><div style="color:#bbb;font-size:8px;text-align:center;padding-top:12mm">Foto<br>Paciente</div></div>';
}
h+='<div class="cd-dados">';
h+='<div class="cdn">'+_fic_e(a.pac||'SEM NOME').toUpperCase()+'</div>';
h+='<div class="cd-info-grid">';
h+='<b>Idade:</b><span>'+id+'</span>';
h+='<b>Nasc.:</b><span>'+nb+'</span>';
h+='<b>Dr.(a):</b><span style="font-weight:700;color:#1a1a2e">'+_fic_e(dn)+'</span>';
h+='</div>';
h+='</div>';
h+='</div>';

h+='</div></div></div></div>';
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
html+='<script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script>';
html+='</body></html>';

// Abrir via servidor local HTTP pra evitar bloqueio mixed content das fotos
var encoded=btoa(unescape(encodeURIComponent(html)));
var w=window.open(FICHAS_FOTO_BASE+'/print#'+encoded,'_blank','width=900,height=700');
if(!w){toast("Erro","Popup bloqueado. Permita popups para imprimir.");return}
}

/* ══════════════════════════════════════════════════════════
   PAINEL DE FOTOGRAFIAS — imprimirPainelFotos(agId)
   ══════════════════════════════════════════════════════════ */
function imprimirPainelFotos(agId){
var a=ags.find(function(x){return x.id===agId});
if(!a){toast("Erro","Agendamento não encontrado");return}
var d=fdent(a.dId)||{n:'-'}, dn=d.n||'-';
var seq=a.firebird_seq_atend||'';
if(!seq){toast("Atenção","Sem número de atendimento (seq). Fotos indisponíveis.");return}
var id=_fic_idade(a.paciente_data_nascimento||'');
var base=FICHAS_FOTO_BASE+'/'+Math.floor(parseInt(seq)/1000)+'/'+parseInt(seq);

// Sufixos das fotos
var fotos={
  ffr:base+'ffr.jpg', fs:base+'fs.jpg', fpd:base+'fpd.jpg',
  fif:base+'fif.jpg', fid:base+'fid.jpg', fie:base+'fie.jpg',
  fos:base+'fos.jpg', foi:base+'foi.jpg'
};

var css='\
*{margin:0;padding:0;box-sizing:border-box}\
body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#1a1a2e}\
@page{size:A4 portrait;margin:2mm}\
.pf-page{width:100%;max-width:210mm;margin:0 auto;padding:1mm}\
.pf-header{display:flex;align-items:center;padding:0;gap:2mm}\
.pf-header img{height:8mm;object-fit:contain}\
.pf-header-info{flex:1;text-align:center;font-size:8px;line-height:1.3}\
.pf-header-info b{font-weight:700}\
.pf-header-age{text-align:right;font-size:8px;font-weight:700}\
.pf-sep{height:2px;background:#3aaa35;margin:0.5mm 0;-webkit-print-color-adjust:exact;print-color-adjust:exact}\
.pf-nome{text-align:center;font-size:10px;font-weight:700;margin:0.5mm 0;letter-spacing:.5px}\
.pf-row{display:flex;justify-content:center;gap:1mm;margin-bottom:1mm}\
.pf-row img{border:1px solid #ccc;object-fit:cover;background:#f0f0f0}\
.pf-row-3 img{width:28%;aspect-ratio:3/4}\
.pf-row-1 img{width:42%;aspect-ratio:4/3}\
.pf-row-2 img{width:42%;aspect-ratio:4/3}\
@media print{body{margin:0!important}.pf-page{padding:1mm}}\
';

var err='onerror="this.style.background=\'#f0f0f0\';this.style.minHeight=\'30mm\';this.alt=\'Indisponível\'"';

var html='<!DOCTYPE html><html><head><meta charset="UTF-8">';
html+='<title>Painel Fotos - '+_fic_e(a.pac)+'</title>';
html+='<style>'+css+'</style></head><body><div class="pf-page">';

// Header
html+='<div class="pf-header">';
html+='<img src="https://cor-lab.github.io/cor-radiologia/logo_site.jpg" alt="COR">';
html+='<div class="pf-header-info"><b>Indicação: Dr.(a): '+_fic_e(dn)+'</b></div>';
html+='<div class="pf-header-age">Idade: '+id+'</div>';
html+='</div>';
html+='<div class="pf-sep"></div>';

// Nome do paciente
html+='<div class="pf-nome">'+_fic_e(a.pac||'').toUpperCase()+'</div>';

// Row 1: 3 fotos faciais (frontal repouso, frontal sorrindo, perfil)
html+='<div class="pf-row pf-row-3">';
html+='<img src="'+fotos.ffr+'" '+err+' alt="Frontal">';
html+='<img src="'+fotos.fs+'" '+err+' alt="Sorrindo">';
html+='<img src="'+fotos.fpd+'" '+err+' alt="Perfil">';
html+='</div>';

// Row 2: 1 foto intraoral frontal (centralizada)
html+='<div class="pf-row pf-row-1">';
html+='<img src="'+fotos.fif+'" '+err+' alt="Intraoral Frontal">';
html+='</div>';

// Row 3: 2 fotos intraorais laterais (direita e esquerda)
html+='<div class="pf-row pf-row-2">';
html+='<img src="'+fotos.fid+'" '+err+' alt="Intraoral Direita">';
html+='<img src="'+fotos.fie+'" '+err+' alt="Intraoral Esquerda">';
html+='</div>';

// Row 4: 2 fotos oclusais (superior e inferior)
html+='<div class="pf-row pf-row-2">';
html+='<img src="'+fotos.fos+'" '+err+' alt="Oclusal Superior">';
html+='<img src="'+fotos.foi+'" '+err+' alt="Oclusal Inferior">';
html+='</div>';

html+='</div>';
html+='<script>window.onload=function(){setTimeout(function(){window.print()},800)}<\/script>';
html+='</body></html>';

var encoded=btoa(unescape(encodeURIComponent(html)));
var w=window.open(FICHAS_FOTO_BASE+'/print#'+encoded,'_blank','width=900,height=700');
if(!w){toast("Erro","Popup bloqueado. Permita popups para imprimir.");return}
}
