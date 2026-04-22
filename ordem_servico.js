// ============================================================
// MODULO ORDEM DE SERVICO (OS) - COR
// v2.7 — grid de dados do paciente com align-items:start e
//        overflow-wrap pra evitar colisão nome×nascimento
// ============================================================

var LOGO_COR_B64 = "logo.png";

function _calcularIdade(dataNasc) {
    if (!dataNasc) return "";
    var partes = dataNasc.substring(0, 10).split("-");
    if (partes.length !== 3) return "";
    var nasc = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]));
    var hoje = new Date();
    var idade = hoje.getFullYear() - nasc.getFullYear();
    var m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade >= 0 ? idade : "";
}

function _formatarDataBR(dataISO) {
    if (!dataISO) return "-";
    var p = dataISO.substring(0, 10).split("-");
    if (p.length !== 3) return dataISO;
    return p[2] + "/" + p[1] + "/" + p[0];
}

function imprimirOS(agId) {
    var a = ags.find(function(x) { return x.id === agId; });
    if (!a) {
        toast("Erro", "Agendamento nao encontrado");
        return;
    }

    var d = fdent(a.dId) || { n: "-" };
    var seqAtend = a.firebird_seq_atend || "PENDENTE";
    var dataAtend = a.dt || "-";
    var horaAtend = a.hr || "-";
    var nomePaciente = a.pac || "-";

    var dataNascISO = a.paciente_data_nascimento || "";
    var dataNascBR = _formatarDataBR(dataNascISO);
    var idade = _calcularIdade(dataNascISO);
    var idadeTexto = idade !== "" ? idade + " anos" : "-";

    var valorCobrado = Number(a.vl || 0);
    var valorBruto = Number(a.valor_bruto || 0);
    var descontoValor = Number(a.desconto_valor || 0);
    var descontoPerc = Number(a.desconto_percentual || 0);

    var formaEntrega = a.forma_entrega || "-";
    var previsaoEntrega = a.previsao_entrega || "";
    if (previsaoEntrega && previsaoEntrega.length >= 10) {
        previsaoEntrega = _formatarDataBR(previsaoEntrega);
    }
    var entregaLabels = {
        "balcao": "Retirada no Balcão",
        "email": "Envio por E-mail",
        "whatsapp": "Envio por WhatsApp",
        "correio": "Envio pelos Correios",
        "entrega_consultorio": "Entrega no Consultório",
        "entrega_dentista": "Entrega no Consultório",
        "digital": "Digital (Portal)",
    };
    var entregaTexto = entregaLabels[formaEntrega] || formaEntrega;
    if (formaEntrega === "-") entregaTexto = "-";

    // ── Montar lista de itens ──
    var itens = a.exames || [];
    if (!itens.length && a.ex) {
        itens = [{ exame_id: a.ex, convenio_id: a.cv || "", preco: valorCobrado, _nome: "" }];
    }
    if (!itens.length) {
        itens = [{ exame_id: null, convenio_id: "", preco: valorCobrado, _nome: "Atendimento" }];
    }

    // ── Classificar itens ──
    var itensInfo = itens.map(function(it) {
        var nomeExame = it._nome || it.nome_exame || "";
        if (!nomeExame && it.exame_id) {
            var ex = fex(it.exame_id);
            nomeExame = ex ? ex.n : (it.exame_id || "Exame");
        }
        if (!nomeExame) nomeExame = "Atendimento";

        var cv = fconv(it.convenio_id || "");
        var foraFat = (typeof itemEhConvenioForaDoFaturamento === "function")
            ? itemEhConvenioForaDoFaturamento(it)
            : !!it.convenio_id;

        return {
            nome: nomeExame,
            convNome: cv ? cv.n : "Particular",
            preco: Number(it.preco || 0),
            foraFat: foraFat
        };
    });

    // ── Somar parte particular vs convênio ──
    var somaParticular = 0, somaConvenio = 0;
    var temParticular = false, temConvenio = false;
    itensInfo.forEach(function(info) {
        if (info.foraFat) { somaConvenio += info.preco; temConvenio = true; }
        else { somaParticular += info.preco; temParticular = true; }
    });

    var ehMisto = temParticular && temConvenio;

    // ── CORRECAO v2.6: Aplicar desconto proporcional na parte PARTICULAR ──
    // Funciona tanto em 100% particular quanto em misto (desconto só na parte particular)
    itensInfo.forEach(function(info) {
        info.precoExibir = info.preco;
        info.precoOriginal = info.preco;
    });

    var temDesconto = descontoValor > 0 && somaParticular > 0;
    var fatorDesc = 1;
    if (temDesconto) {
        fatorDesc = (somaParticular - descontoValor) / somaParticular;
        if (fatorDesc > 0 && fatorDesc < 1) {
            itensInfo.forEach(function(info) {
                if (!info.foraFat) {
                    info.precoExibir = info.preco * fatorDesc;
                }
            });
        } else {
            temDesconto = false; // desconto invalido, ignorar
        }
    }

    // ── Totais finais ──
    var totalParticularBruto = somaParticular;
    var totalParticularComDesc = 0, totalConvenio = 0;
    itensInfo.forEach(function(info) {
        if (info.foraFat) totalConvenio += info.precoExibir;
        else totalParticularComDesc += info.precoExibir;
    });
    var totalGeral = totalParticularComDesc + totalConvenio;

    // ── Gerar HTML tabela de exames ──
    var examesHtml = "";
    itensInfo.forEach(function(info, idx) {
        var corLinha = info.foraFat ? "background:#fff8e8" : "";
        var badgeConv = info.foraFat
            ? "<span style='font-size:10px;background:#BA7517;color:#fff;padding:1px 3px;border-radius:2px;margin-left:3px;vertical-align:middle'>CONV.</span>"
            : "";
        // Se há desconto e item é particular, mostrar preço original riscado + preço com desconto
        var precoCelula = "";
        if (temDesconto && !info.foraFat) {
            precoCelula = "<span style='text-decoration:line-through;color:#999;font-size:12px'>R$ " +
                info.precoOriginal.toFixed(2).replace(".", ",") + "</span><br>" +
                "<span style='color:#1D9E75;font-weight:600'>R$ " +
                info.precoExibir.toFixed(2).replace(".", ",") + "</span>";
        } else {
            precoCelula = "R$ " + info.precoExibir.toFixed(2).replace(".", ",");
        }
        examesHtml += "<tr style='" + corLinha + "'>" +
            "<td style='padding:3px 6px;border-bottom:1px solid #ddd;text-align:center'>" + (idx + 1) + "</td>" +
            "<td style='padding:3px 6px;border-bottom:1px solid #ddd'>" + info.nome + badgeConv + "</td>" +
            "<td style='padding:3px 6px;border-bottom:1px solid #ddd'>" + info.convNome + "</td>" +
            "<td style='padding:3px 6px;border-bottom:1px solid #ddd;text-align:right'>" + precoCelula + "</td>" +
            "</tr>";
    });

    // ── Linhas de totais ──
    var totalHtml = "";
    if (ehMisto) {
        // Subtotal particular (se houver desconto)
        if (temDesconto) {
            totalHtml += "<tr style='background:#f9f9f9'>" +
                "<td colspan='3' style='padding:2px 6px;text-align:right;font-size:12px;color:#666'>Subtotal Particular</td>" +
                "<td style='padding:2px 6px;text-align:right;font-size:12px;color:#666'>R$ " + totalParticularBruto.toFixed(2).replace(".", ",") + "</td>" +
                "</tr>";
            totalHtml += "<tr style='background:#f9f9f9'>" +
                "<td colspan='3' style='padding:2px 6px;text-align:right;font-size:12px;color:#c00'>Desconto" + (descontoPerc > 0 ? " (" + descontoPerc.toFixed(0) + "%)" : "") + "</td>" +
                "<td style='padding:2px 6px;text-align:right;font-size:12px;color:#c00'>-R$ " + descontoValor.toFixed(2).replace(".", ",") + "</td>" +
                "</tr>";
        }
        totalHtml += "<tr style='background:#e8f5e9'>" +
            "<td colspan='3' style='padding:4px 6px;text-align:right;font-weight:bold;color:#1D9E75;font-size:14px'>💵 PAGO NO CAIXA (Particular)</td>" +
            "<td style='padding:4px 6px;text-align:right;font-weight:bold;color:#1D9E75;font-size:14px'>R$ " + totalParticularComDesc.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
        totalHtml += "<tr style='background:#fff8e8'>" +
            "<td colspan='3' style='padding:4px 6px;text-align:right;font-weight:bold;color:#BA7517;font-size:14px'>📋 FATURAR CONVÊNIO</td>" +
            "<td style='padding:4px 6px;text-align:right;font-weight:bold;color:#BA7517;font-size:14px'>R$ " + totalConvenio.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
        totalHtml += "<tr class='total-row'>" +
            "<td colspan='3' style='padding:5px 6px;text-align:right'>TOTAL GERAL</td>" +
            "<td style='padding:5px 6px;text-align:right'>R$ " + totalGeral.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    } else if (temConvenio) {
        // 100% convênio
        totalHtml += "<tr class='total-row' style='background:#fff8e8'>" +
            "<td colspan='3' style='padding:5px 6px;text-align:right;color:#BA7517'>TOTAL (faturar convênio)</td>" +
            "<td style='padding:5px 6px;text-align:right;color:#BA7517'>R$ " + totalConvenio.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    } else {
        // 100% particular
        if (temDesconto) {
            totalHtml += "<tr style='background:#f9f9f9'>" +
                "<td colspan='3' style='padding:2px 6px;text-align:right;font-size:12px;color:#666'>Subtotal</td>" +
                "<td style='padding:2px 6px;text-align:right;font-size:12px;color:#666'>R$ " + totalParticularBruto.toFixed(2).replace(".", ",") + "</td>" +
                "</tr>";
            totalHtml += "<tr style='background:#f9f9f9'>" +
                "<td colspan='3' style='padding:2px 6px;text-align:right;font-size:12px;color:#c00'>Desconto" + (descontoPerc > 0 ? " (" + descontoPerc.toFixed(0) + "%)" : "") + "</td>" +
                "<td style='padding:2px 6px;text-align:right;font-size:12px;color:#c00'>-R$ " + descontoValor.toFixed(2).replace(".", ",") + "</td>" +
                "</tr>";
        }
        totalHtml += "<tr class='total-row'>" +
            "<td colspan='3' style='padding:5px 6px;text-align:right'>TOTAL</td>" +
            "<td style='padding:5px 6px;text-align:right'>R$ " + totalParticularComDesc.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    }

    var barcodeSvg = gerarBarcodeSvg(String(seqAtend));

    // ── Box aviso misto (compacto) ──
    var avisoMistoBox = "";
    if (ehMisto) {
        avisoMistoBox = "<div style='background:#fff8e8;border:1px solid #BA7517;border-radius:4px;padding:5px 8px;margin:6px 0;font-size:12px;color:#854F0B'>" +
            "<b>⚠️ Atendimento Misto:</b> Exames particulares (pagos no caixa) + exames de convênio (faturados pela clínica). " +
            "O paciente paga apenas <b>R$ " + totalParticularComDesc.toFixed(2).replace(".", ",") + "</b> no caixa." +
            "</div>";
    }

    var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
        "<title>OS #" + seqAtend + " - COR</title>" +
        "<style>" +
        "@page{size:A4;margin:8mm 10mm}" +
        "*{box-sizing:border-box}" +
        "html,body{margin:0;padding:0}" +
        "body{font-family:Arial,sans-serif;color:#1a1a2e;font-size:13px;line-height:1.3;padding:0}" +
        ".page{display:flex;flex-direction:column;min-height:calc(297mm - 16mm)}" +
        ".content{flex:0 0 auto}" +
        "table{width:100%;border-collapse:collapse}" +
        "th{background:#2d3a6e;color:#fff;padding:4px 6px;text-align:left;font-size:12px}" +
        ".header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #2d3a6e;padding-bottom:6px;margin-bottom:8px}" +
        ".header img{height:42px}" +
        ".seq-box{text-align:center;background:#f0f4ff;border:2px solid #2d3a6e;border-radius:6px;padding:4px 14px}" +
        ".seq-box .label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.8px}" +
        ".seq-box .numero{font-size:24px;font-weight:bold;color:#2d3a6e;line-height:1.1}" +
        ".info-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:3px 14px;margin-bottom:8px;font-size:13px;align-items:start}" +
        ".info-grid > div{min-width:0}" +
        ".info-grid .label{font-weight:bold;color:#555;font-size:11px;text-transform:uppercase;letter-spacing:.3px}" +
        ".info-grid .valor{font-size:14px;line-height:1.2;word-break:break-word;overflow-wrap:anywhere;hyphens:auto}" +
        ".info-grid .cell-nome{grid-column:span 2}" +
        ".info-grid .cell-full{grid-column:span 2}" +
        ".total-row{background:#f0f4ff;font-weight:bold;font-size:15px}" +
        ".barcode{text-align:center;margin:6px 0}" +
        ".barcode svg{height:32px}" +
        ".entrega-box{margin:6px 0;padding:5px 10px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;display:flex;gap:24px;font-size:13px}" +
        ".entrega-box .label{font-weight:bold;color:#555;font-size:11px;text-transform:uppercase}" +
        ".entrega-box .valor{font-size:13px}" +
        ".setores{margin:8px 0 6px}" +
        ".setores-titulo{font-size:12px;font-weight:bold;color:#2d3a6e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;border-bottom:1.5px solid #2d3a6e;padding-bottom:2px}" +
        ".setores-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}" +
        ".setor-bloco{border:1px solid #ccc;border-radius:4px;padding:4px 6px;background:#fafbfc}" +
        ".setor-nome{font-size:11px;font-weight:bold;color:#2d3a6e;text-transform:uppercase;letter-spacing:.3px;margin-bottom:1px}" +
        ".setor-linha{border-top:1px solid #999;margin-top:20px;padding-top:2px;font-size:10px;color:#888;text-align:center}" +
        ".rodape{margin-top:auto;padding-top:10px;font-size:12px;color:#555;page-break-inside:avoid}" +
        ".rodape-info{display:flex;justify-content:space-between;margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #ddd;font-size:12px;color:#777}" +
        ".rodape-assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:30px}" +
        ".rodape-assinaturas .bloco{text-align:center}" +
        ".rodape-assinaturas .linha-ass{border-top:1px solid #999;padding-top:3px;margin-top:32px;font-size:12px;color:#666}" +
        ".rodape-assinaturas .nome-ass{font-size:11px;color:#999;margin-top:1px}" +
        "@media print{body{padding:0}.page{min-height:calc(297mm - 16mm)}}" +
        "</style></head><body>" +

        "<div class='page'>" +

        "<div class='content'>" +

        // Cabeçalho
        "<div class='header'>" +
        "<img src='" + LOGO_COR_B64 + "' alt='COR'>" +
        "<div class='seq-box'>" +
        "<div class='label'>Ordem de Servico</div>" +
        "<div class='numero'>#" + seqAtend + "</div>" +
        "</div>" +
        "</div>" +

        // Dados paciente
        "<div class='info-grid'>" +
        "<div class='cell-full'><div class='label'>Paciente</div><div class='valor'>" + esc(nomePaciente) + "</div></div>" +
        "<div class='cell-full'><div class='label'>CPF</div><div class='valor'>" + (a.paciente_cpf ? formatarCPF(a.paciente_cpf) : "-") + "</div></div>" +
        "<div class='cell-full'><div class='label'>Telefone</div><div class='valor'>" + (a.tel || "-") + "</div></div>" +
        "<div class='cell-full'><div class='label'>Nascimento</div><div class='valor'>" + dataNascBR + "</div></div>" +
        "<div class='cell-full'><div class='label'>Idade</div><div class='valor'>" + idadeTexto + "</div></div>" +
        "<div class='cell-full'><div class='label'>Sexo</div><div class='valor'>" + (a.paciente_sexo || "-") + "</div></div>" +
        "<div class='cell-full'><div class='label'>Data do Exame</div><div class='valor'>" + dataAtend + "</div></div>" +
        "<div class='cell-full'><div class='label'>Hora</div><div class='valor'>" + horaAtend + "</div></div>" +
        "<div class='cell-full'><div class='label'>Dentista</div><div class='valor'>" + esc(d.n) + "</div></div>" +
        "</div>" +

        // Aviso misto se aplicavel
        avisoMistoBox +

        // Tabela exames
        "<table>" +
        "<thead><tr>" +
        "<th style='width:28px;text-align:center'>#</th>" +
        "<th>Exame</th>" +
        "<th style='width:90px'>Convenio</th>" +
        "<th style='width:90px;text-align:right'>Valor</th>" +
        "</tr></thead>" +
        "<tbody>" + examesHtml + totalHtml + "</tbody></table>" +

        // Forma entrega
        "<div class='entrega-box'>" +
        "<div><div class='label'>Forma de Entrega</div><div class='valor'>" + entregaTexto + "</div></div>" +
        (previsaoEntrega ? "<div><div class='label'>Previsao de Entrega</div><div class='valor'>" + previsaoEntrega + "</div></div>" : "") +
        "</div>" +

        // Código de barras
        "<div class='barcode'>" + barcodeSvg + "<br>" +
        "<span style='font-size:13px;font-family:monospace;letter-spacing:1.5px'>" + seqAtend + "</span></div>" +

        // Setores (4 colunas)
        "<div class='setores'>" +
        "<div class='setores-titulo'>Execução — Assinatura dos Atendentes por Setor</div>" +
        "<div class='setores-grid'>" +
        "<div class='setor-bloco'><div class='setor-nome'>Raios X</div><div class='setor-linha'>Visto</div></div>" +
        "<div class='setor-bloco'><div class='setor-nome'>Tomografia</div><div class='setor-linha'>Visto</div></div>" +
        "<div class='setor-bloco'><div class='setor-nome'>Fotos/Escan.</div><div class='setor-linha'>Visto</div></div>" +
        "<div class='setor-bloco'><div class='setor-nome'>Periapicais</div><div class='setor-linha'>Visto</div></div>" +
        "</div>" +
        "</div>" +

        "</div>" +  // fim .content

        // Rodapé fixo no fundo da página (via margin-top:auto)
        "<div class='rodape'>" +
        "<div class='rodape-info'>" +
        "<span><strong>Paciente:</strong> " + esc(nomePaciente) + "</span>" +
        "<span><strong>Data:</strong> " + dataAtend + "</span>" +
        "<span><strong>OS:</strong> #" + seqAtend + "</span>" +
        "</div>" +
        "<div class='rodape-assinaturas'>" +
        "<div class='bloco'>" +
        "<div class='linha-ass'>Assinatura do Paciente</div>" +
        "<div class='nome-ass'>" + esc(nomePaciente) + "</div>" +
        "</div>" +
        "<div class='bloco'>" +
        "<div class='linha-ass'>Assinatura do Atendente</div>" +
        "<div class='nome-ass'>COR - Centro Odontológico de Radiologia</div>" +
        "</div>" +
        "</div>" +
        "</div>" +

        "</div>" +  // fim .page

        "<script>window.onload=function(){window.print();}<\/script>" +
        "</body></html>";

    var win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
}

function gerarBarcodeSvg(texto) {
    var patterns = {
        "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw",
        "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn",
        "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn",
        "9": "nnwwnnwnn", "*": "nwnnwnwnn"
    };
    var encoded = "*" + texto + "*";
    var barWidth = 1.2, narrowWidth = barWidth, wideWidth = barWidth * 2.5;
    var height = 32, x = 0, bars = "";
    for (var i = 0; i < encoded.length; i++) {
        var ch = encoded[i], pattern = patterns[ch];
        if (!pattern) continue;
        for (var j = 0; j < pattern.length; j++) {
            var isWide = pattern[j] === "w";
            var w = isWide ? wideWidth : narrowWidth;
            if (j % 2 === 0) bars += "<rect x='" + x + "' y='0' width='" + w + "' height='" + height + "' fill='#000'/>";
            x += w;
        }
        x += narrowWidth;
    }
    return "<svg width='" + (x + 8) + "' height='" + (height + 3) + "' xmlns='http://www.w3.org/2000/svg'>" + bars + "</svg>";
}

console.log("[COR] Modulo ordem de servico v2.7 carregado (desconto em mistos + A4 pagina unica)");
