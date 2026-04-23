// ═══════════════════════════════════════════════════════════════════════════
// IMPRIMIR RELATÓRIO DIÁRIO — COR
// Consolidado de atendimentos realizados numa data + resumos e totais
// ═══════════════════════════════════════════════════════════════════════════
//
//   MANIFESTO DE FEATURES — NÃO REMOVER ESTE BLOCO
//
//   Claude (IA): antes de editar, leia a lista. Features abaixo JÁ EXISTEM.
//   Ao reescrever imprimirRelatorioDia(), preserve a funcionalidade ou
//   avise explicitamente.
//
//   [✓] Filtro por data (atDate || agBase || hoje)
//       Filtra ags locais OU busca no Supabase se cache vazio
//       Marcadores: "atDate", "agBase", "status_clinico=eq.realizado"
//
//   [✓] Fallback ao Supabase quando cache local está vazio
//       Usa fetch direto (SUPA_URL + SUPA_KEY) + /rest/v1/agendamentos
//       Inclui JOIN com agendamento_exames via IN(ids)
//       Marcadores: "todosItens", "rItens"
//
//   [✓] Tabela principal — uma linha por atendimento
//       Colunas: #, SEQ, Hora, Paciente, Exame(s), Dentista, Convênio,
//                Bruto, Desc, Faturado, Forma pgto
//
//   [✓] FONTE ÚNICA DE VERDADE — calcValoresAg (do index.html)
//       NÃO reimplementar cálculo de desconto aqui.
//       Marcadores: "calcValoresAg", "_vals"
//       Fallback apenas se a função não estiver carregada
//
//   [✓] Resumo por convênio — qtd, bruto, desc, faturado
//       Marcadores: "porConvenio", "resumoConv"
//
//   [✓] Top 10 dentistas — ordenado por faturamento descendente
//       Marcadores: "porDentista", "dentArr", "slice(0,10)"
//
//   [✓] Totais finais (bruto/desc/faturado)
//       Marcadores: "totalBruto", "totalDesc", "totalFat", ".total-row"
//
//   [✓] Auto-impressão ao abrir (window.onload = window.print)
//
//   ───────── DEPENDÊNCIAS EXTERNAS ─────────
//
//   - ags[], fdent(), fex(), fconv() — do index.html (App COR)
//   - calcValoresAg(a) — CRÍTICO: fonte única de verdade pra cálculo
//   - pad(), esc(), iso2br() — helpers do index.html
//   - SUPA_URL, SUPA_KEY — constantes globais
//
// ═══════════════════════════════════════════════════════════════════════════

async function imprimirRelatorioDia() {
  var selDate = atDate || agBase || new Date();
  var ds = selDate.getFullYear() + "-" + pad(selDate.getMonth()+1) + "-" + pad(selDate.getDate());
  var dsBR = ds.substring(8,10) + "/" + ds.substring(5,7) + "/" + ds.substring(0,4);

  var dayAgs = ags.filter(function(a){
    var adt = a.dt;
    if(!adt) return false;
    var pts = adt.split("/");
    if(pts.length !== 3) return false;
    var iso = pts[2] + "-" + pts[1] + "-" + pts[0];
    return iso === ds && (a.status_clinico || a.st) === "realizado";
  });

  // Se não encontrou localmente, buscar do Supabase
  if(!dayAgs.length){
    try{
      var r = await fetch(SUPA_URL+"/rest/v1/agendamentos?select=*&data_exame=eq."+ds+"&status_clinico=eq.realizado&order=hora_exame.asc",
        {headers:{"apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY}});
      var dados = await r.json();
      if(dados && dados.length){
        var ids = dados.map(function(a){return a.id});
        var rItens = await fetch(SUPA_URL+"/rest/v1/agendamento_exames?select=*&agendamento_id=in.("+ids.join(",")+")",
          {headers:{"apikey":SUPA_KEY,"Authorization":"Bearer "+SUPA_KEY}});
        var todosItens = await rItens.json() || [];
        dayAgs = dados.map(function(a){
          var itens = todosItens.filter(function(it){return it.agendamento_id===a.id});
          return {
            id:a.id, pac:a.paciente_nome||"", pId:a.paciente_id,
            tel:a.paciente_telefone||"", cpf:a.paciente_cpf||"",
            ex:a.exame_id, exames:itens,
            dt:iso2br(a.data_exame), hr:(a.hora_exame||"08:00").substring(0,5),
            dId:a.dentista_id, cv:a.convenio_id||"",
            vl:parseFloat(a.valor||0),
            valor_bruto:parseFloat(a.valor_bruto||a.valor||0),
            valor_faturado:parseFloat(a.valor_faturado||a.valor||0),
            desconto_percentual:Number(a.desconto_percentual||0),
            desconto_valor:Number(a.desconto_valor||0),
            forma_pagamento_prevista:a.forma_pagamento_prevista||"avista",
            forma_pagamento_final:a.forma_pagamento_final||"",
            cb:a.cashback_pts||0,
            st:a.status||"agendado",status:a.status||"agendado",
            status_clinico:a.status_clinico||a.status||"agendado",
            status_fiscal:a.status_fiscal||"nao_emitida",
            nfse_id:a.nfse_id||null,numero_nfse:a.numero_nfse||null,
            firebird_seq_atend:a.firebird_seq_atend||null,
            obs:a.observacoes||""
          };
        });
      }
    }catch(e){console.error("Relatorio fetch:",e)}
  }

  dayAgs.sort(function(a,b){ return (a.hr||"").localeCompare(b.hr||""); });

  var totalBruto = 0, totalDesc = 0, totalFat = 0;
  var porConvenio = {};
  var porDentista = {};

  var linhas = "";
  dayAgs.forEach(function(a, idx){
    var d = fdent(a.dId);
    var dentNome = d ? d.n : "-";
    var itens = a.exames || [];
    var nomes = itens.map(function(it){
      var ex = fex(it.exame_id);
      return ex ? ex.n : (it.nome_exame || it.exame_id || "?");
    }).join(", ");
    if(!nomes) nomes = "-";

    var cvNome = "Particular";
    if(itens.length && itens[0].convenio_id){
      var cv = fconv(itens[0].convenio_id);
      cvNome = cv ? cv.n : itens[0].convenio_id;
    } else if(a.cv){
      var cv2 = fconv(a.cv);
      cvNome = cv2 ? cv2.n : a.cv;
    }

    // ═══ FONTE ÚNICA DE VERDADE: calcValoresAg (definida no index.html) ═══
    var _vals = (typeof calcValoresAg === 'function') ? calcValoresAg(a) : null;
    var vb, vd, vf;
    if(_vals){
      vb = _vals.bruto; vd = _vals.desconto; vf = _vals.faturado;
    } else {
      // Fallback (caso o script carregue antes do index)
      vb = Number(a.valor_bruto || a.vl || 0);
      vd = Number(a.desconto_valor || 0);
      vf = Number(a.valor_faturado || a.vl || 0);
      if(vb === 0 && itens.length){
        var soma = 0;
        itens.forEach(function(it){ soma += Number(it.preco || 0); });
        if(soma > 0){ vb = soma; vf = soma; }
      }
    }

    totalBruto += vb;
    totalDesc += vd;
    totalFat += vf;

    if(!porConvenio[cvNome]) porConvenio[cvNome] = {qtd:0, bruto:0, desc:0, fat:0};
    porConvenio[cvNome].qtd++;
    porConvenio[cvNome].bruto += vb;
    porConvenio[cvNome].desc += vd;
    porConvenio[cvNome].fat += vf;

    if(!porDentista[dentNome]) porDentista[dentNome] = {qtd:0, bruto:0, fat:0};
    porDentista[dentNome].qtd++;
    porDentista[dentNome].bruto += vb;
    porDentista[dentNome].fat += vf;

    var formaPg = a.forma_pagamento_final || a.forma_pagamento_prevista || "-";
    var seq = a.firebird_seq_atend || "-";

    linhas += "<tr>" +
      "<td style='text-align:center'>" + (idx+1) + "</td>" +
      "<td style='text-align:center;font-size:11px'>" + seq + "</td>" +
      "<td style='text-align:center'>" + (a.hr || "-") + "</td>" +
      "<td>" + esc(a.pac || "-") + "</td>" +
      "<td style='font-size:11px'>" + esc(nomes) + "</td>" +
      "<td style='font-size:11px'>" + esc(dentNome) + "</td>" +
      "<td style='font-size:11px'>" + esc(cvNome) + "</td>" +
      "<td style='text-align:right'>R$ " + vb.toFixed(2).replace(".",",") + "</td>" +
      "<td style='text-align:right;color:#c00'>" + (vd > 0 ? "R$ " + vd.toFixed(2).replace(".",",") : "-") + "</td>" +
      "<td style='text-align:right;font-weight:bold'>R$ " + vf.toFixed(2).replace(".",",") + "</td>" +
      "<td style='text-align:center;font-size:11px'>" + formaPg + "</td>" +
      "</tr>";
  });

  // Resumo por convênio
  var resumoConv = "";
  Object.keys(porConvenio).sort().forEach(function(cv){
    var c = porConvenio[cv];
    resumoConv += "<tr>" +
      "<td>" + esc(cv) + "</td>" +
      "<td style='text-align:center'>" + c.qtd + "</td>" +
      "<td style='text-align:right'>R$ " + c.bruto.toFixed(2).replace(".",",") + "</td>" +
      "<td style='text-align:right;color:#c00'>" + (c.desc > 0 ? "R$ " + c.desc.toFixed(2).replace(".",",") : "-") + "</td>" +
      "<td style='text-align:right;font-weight:bold'>R$ " + c.fat.toFixed(2).replace(".",",") + "</td>" +
      "</tr>";
  });

  // Resumo por dentista (top 10)
  var dentArr = [];
  Object.keys(porDentista).forEach(function(dn){ dentArr.push({n:dn, d:porDentista[dn]}); });
  dentArr.sort(function(a,b){ return b.d.fat - a.d.fat; });
  var resumoDent = "";
  dentArr.slice(0,10).forEach(function(dd){
    resumoDent += "<tr>" +
      "<td>" + esc(dd.n) + "</td>" +
      "<td style='text-align:center'>" + dd.d.qtd + "</td>" +
      "<td style='text-align:right'>R$ " + dd.d.bruto.toFixed(2).replace(".",",") + "</td>" +
      "<td style='text-align:right;font-weight:bold'>R$ " + dd.d.fat.toFixed(2).replace(".",",") + "</td>" +
      "</tr>";
  });

  var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
    "<title>Relatório Diário - COR - " + dsBR + "</title>" +
    "<style>" +
    "body{font-family:Arial,sans-serif;margin:15px;color:#1a1a2e;font-size:12px}" +
    "table{width:100%;border-collapse:collapse;margin-bottom:20px}" +
    "th{background:#2d3a6e;color:#fff;padding:5px 6px;text-align:left;font-size:11px;white-space:nowrap}" +
    "td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}" +
    "tr:nth-child(even){background:#f8f9fa}" +
    ".header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #2d3a6e;padding-bottom:10px;margin-bottom:15px}" +
    ".header img{height:50px}" +
    ".titulo{font-size:18px;font-weight:bold;color:#2d3a6e}" +
    ".subtitulo{font-size:13px;color:#666}" +
    ".total-row{background:#e8ecf4!important;font-weight:bold;font-size:13px}" +
    ".resumo-titulo{font-size:14px;font-weight:bold;color:#2d3a6e;margin:20px 0 8px;border-bottom:2px solid #2d3a6e;padding-bottom:4px}" +
    ".resumos{display:grid;grid-template-columns:1fr 1fr;gap:20px}" +
    "@media print{body{margin:10px;font-size:11px}th{font-size:10px}td{padding:3px 4px}}" +
    "</style></head><body>" +

    "<div class='header'>" +
    "<div><div class='titulo'>Relatório Diário de Atendimentos</div>" +
    "<div class='subtitulo'>COR - Centro Odontológico de Radiologia</div></div>" +
    "<div style='text-align:right'><div style='font-size:20px;font-weight:bold;color:#2d3a6e'>" + dsBR + "</div>" +
    "<div style='font-size:12px;color:#666'>" + dayAgs.length + " atendimento(s) realizado(s)</div></div>" +
    "</div>" +

    "<table>" +
    "<thead><tr>" +
    "<th>#</th><th>Seq</th><th>Hora</th><th>Paciente</th><th>Exame(s)</th><th>Dentista</th><th>Convênio</th>" +
    "<th style='text-align:right'>Bruto</th><th style='text-align:right'>Desc.</th>" +
    "<th style='text-align:right'>Faturado</th><th>Pgto</th>" +
    "</tr></thead><tbody>" +
    linhas +
    "<tr class='total-row'>" +
    "<td colspan='7' style='text-align:right'>TOTAIS</td>" +
    "<td style='text-align:right'>R$ " + totalBruto.toFixed(2).replace(".",",") + "</td>" +
    "<td style='text-align:right;color:#c00'>R$ " + totalDesc.toFixed(2).replace(".",",") + "</td>" +
    "<td style='text-align:right'>R$ " + totalFat.toFixed(2).replace(".",",") + "</td>" +
    "<td></td></tr>" +
    "</tbody></table>" +

    "<div class='resumos'>" +
    "<div>" +
    "<div class='resumo-titulo'>Resumo por Convênio</div>" +
    "<table><thead><tr><th>Convênio</th><th>Qtd</th><th style='text-align:right'>Bruto</th><th style='text-align:right'>Desc.</th><th style='text-align:right'>Faturado</th></tr></thead><tbody>" +
    resumoConv +
    "</tbody></table>" +
    "</div>" +

    "<div>" +
    "<div class='resumo-titulo'>Top Dentistas (por faturamento)</div>" +
    "<table><thead><tr><th>Dentista</th><th>Qtd</th><th style='text-align:right'>Bruto</th><th style='text-align:right'>Faturado</th></tr></thead><tbody>" +
    resumoDent +
    "</tbody></table>" +
    "</div>" +
    "</div>" +

    "<div style='margin-top:20px;font-size:10px;color:#999;text-align:center'>Relatório gerado em " + new Date().toLocaleString("pt-BR") + " — COR Sistema</div>" +

    "<script>window.onload=function(){window.print();}<\/script>" +
    "</body></html>";

  var win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
}