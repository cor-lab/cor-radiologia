// ============================================================
// MODULO ORDEM DE SERVICO (OS) - COR
// v2.5 — correção agendamentos mistos (Particular + Convênio)
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

    // ── Classificar cada item: faturavel (particular) vs fora faturamento (convênio) ──
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

    // ── Somar parte particular (faturável) vs parte convênio (não faturável) ──
    var somaParticular = 0, somaConvenio = 0;
    var temParticular = false, temConvenio = false;
    itensInfo.forEach(function(info) {
        if (info.foraFat) { somaConvenio += info.preco; temConvenio = true; }
        else { somaParticular += info.preco; temParticular = true; }
    });

    var ehMisto = temParticular && temConvenio;

    // ── Determinar preço a EXIBIR em cada item ──
    // Lógica: preço sempre = preço real do item. Desconto só se aplica na parte particular.
    // Se agendamento 100% particular E há desconto, aplicar desconto proporcional nos particulares.
    itensInfo.forEach(function(info) {
        info.precoExibir = info.preco;
    });

    // Se há desconto e é 100% particular, aplicar proporcionalmente
    if (!ehMisto && !temConvenio && descontoValor > 0 && somaParticular > 0) {
        var fatorDesc = (somaParticular - descontoValor) / somaParticular;
        if (fatorDesc > 0) {
            itensInfo.forEach(function(info) {
                info.precoExibir = info.preco * fatorDesc;
            });
        }
    }

    // ── Totais finais ──
    var totalParticular = 0, totalConvenio = 0;
    itensInfo.forEach(function(info) {
        if (info.foraFat) totalConvenio += info.precoExibir;
        else totalParticular += info.precoExibir;
    });
    var totalGeral = totalParticular + totalConvenio;

    // ── Gerar HTML da tabela ──
    var examesHtml = "";
    itensInfo.forEach(function(info, idx) {
        var corLinha = info.foraFat ? "background:#fff8e8" : "";
        var badgeConv = info.foraFat
            ? "<span style='font-size:9px;background:#BA7517;color:#fff;padding:1px 4px;border-radius:3px;margin-left:4px'>CONV.</span>"
            : "";
        examesHtml += "<tr style='" + corLinha + "'>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd;text-align:center'>" + (idx + 1) + "</td>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd'>" + info.nome + badgeConv + "</td>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd'>" + info.convNome + "</td>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd;text-align:right'>R$ " + info.precoExibir.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    });

    // ── Linha(s) de totais ──
    var totalHtml = "";
    if (ehMisto) {
        // Agendamento misto: mostrar totais separados
        totalHtml += "<tr style='background:#e8f5e9'>" +
            "<td colspan='3' style='padding:6px 10px;text-align:right;font-weight:bold;color:#1D9E75'>💵 PAGO NO CAIXA (Particular)</td>" +
            "<td style='padding:6px 10px;text-align:right;font-weight:bold;color:#1D9E75'>R$ " + totalParticular.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
        totalHtml += "<tr style='background:#fff8e8'>" +
            "<td colspan='3' style='padding:6px 10px;text-align:right;font-weight:bold;color:#BA7517'>📋 FATURAR CONVÊNIO</td>" +
            "<td style='padding:6px 10px;text-align:right;font-weight:bold;color:#BA7517'>R$ " + totalConvenio.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
        totalHtml += "<tr class='total-row'>" +
            "<td colspan='3' style='padding:8px 10px;text-align:right'>TOTAL GERAL</td>" +
            "<td style='padding:8px 10px;text-align:right'>R$ " + totalGeral.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    } else if (temConvenio) {
        // 100% convênio
        totalHtml += "<tr class='total-row' style='background:#fff8e8'>" +
            "<td colspan='3' style='padding:8px 10px;text-align:right;color:#BA7517'>TOTAL (faturar convênio)</td>" +
            "<td style='padding:8px 10px;text-align:right;color:#BA7517'>R$ " + totalConvenio.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    } else {
        // 100% particular
        totalHtml += "<tr class='total-row'>" +
            "<td colspan='3' style='padding:8px 10px;text-align:right'>TOTAL</td>" +
            "<td style='padding:8px 10px;text-align:right'>R$ " + totalParticular.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    }

    var barcodeSvg = gerarBarcodeSvg(String(seqAtend));

    // ── Box de aviso se misto ──
    var avisoMistoBox = "";
    if (ehMisto) {
        avisoMistoBox = "<div style='background:#fff8e8;border:2px solid #BA7517;border-radius:6px;padding:10px 14px;margin:10px 0;font-size:12px;color:#854F0B'>" +
            "<b>⚠️ Atendimento Misto:</b> Este atendimento tem exames particulares (pagos no caixa) e exames de convênio (faturados separadamente pela clínica). " +
            "O paciente paga apenas <b>R$ " + totalParticular.toFixed(2).replace(".", ",") + "</b> no caixa." +
            "</div>";
    }

    var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
        "<title>OS #" + seqAtend + " - COR</title>" +
        "<style>" +
        "body{font-family:Arial,sans-serif;margin:0;padding:20px;color:#1a1a2e}" +
        "table{width:100%;border-collapse:collapse}" +
        "th{background:#2d3a6e;color:#fff;padding:8px 10px;text-align:left;font-size:12px}" +
        ".header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #2d3a6e;padding-bottom:15px;margin-bottom:15px}" +
        ".header img{height:60px}" +
        ".seq-box{text-align:center;background:#f0f4ff;border:2px solid #2d3a6e;border-radius:8px;padding:10px 20px}" +
        ".seq-box .label{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:1px}" +
        ".seq-box .numero{font-size:28px;font-weight:bold;color:#2d3a6e}" +
        ".info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 20px;margin-bottom:15px;font-size:13px}" +
        ".info-grid .label{font-weight:bold;color:#555;font-size:11px;text-transform:uppercase}" +
        ".info-grid .valor{font-size:14px}" +
        ".total-row{background:#f0f4ff;font-weight:bold;font-size:15px}" +
        ".barcode{text-align:center;margin:12px 0}" +
        ".entrega-box{margin:12px 0;padding:10px 15px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;display:flex;gap:30px;font-size:13px}" +
        ".entrega-box .label{font-weight:bold;color:#555;font-size:11px;text-transform:uppercase}" +
        ".entrega-box .valor{font-size:14px;margin-top:2px}" +
        ".setores{margin:18px 0 10px;page-break-inside:avoid}" +
        ".setores-titulo{font-size:12px;font-weight:bold;color:#2d3a6e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:2px solid #2d3a6e;padding-bottom:4px}" +
        ".setores-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 30px}" +
        ".setor-bloco{border:1px solid #ddd;border-radius:6px;padding:10px 12px;background:#fafbfc}" +
        ".setor-nome{font-size:11px;font-weight:bold;color:#2d3a6e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}" +
        ".setor-linha{border-top:1px solid #999;margin-top:28px;padding-top:4px;font-size:10px;color:#888;text-align:center}" +
        ".rodape{margin-top:100px;font-size:12px;color:#555;page-break-inside:avoid}" +
        ".rodape-info{display:flex;justify-content:space-between;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #ddd;font-size:11px;color:#777}" +
        ".rodape-assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:60px}" +
        ".rodape-assinaturas .bloco{text-align:center}" +
        ".rodape-assinaturas .linha-ass{border-top:1px solid #999;padding-top:5px;margin-top:60px;font-size:12px;color:#666}" +
        ".rodape-assinaturas .nome-ass{font-size:11px;color:#999;margin-top:2px}" +
        "@media print{body{padding:15px}}" +
        "</style></head><body>" +

        // ── Cabeçalho ──
        "<div class='header'>" +
        "<img src='" + LOGO_COR_B64 + "' alt='COR'>" +
        "<div class='seq-box'>" +
        "<div class='label'>Ordem de Servico</div>" +
        "<div class='numero'>#" + seqAtend + "</div>" +
        "</div>" +
        "</div>" +

        // ── Dados do paciente ──
        "<div class='info-grid'>" +
        "<div><div class='label'>Paciente</div><div class='valor'>" + esc(nomePaciente) + "</div></div>" +
        "<div><div class='label'>CPF</div><div class='valor'>" + (a.paciente_cpf ? formatarCPF(a.paciente_cpf) : "-") + "</div></div>" +
        "<div><div class='label'>Telefone</div><div class='valor'>" + (a.tel || "-") + "</div></div>" +
        "<div><div class='label'>Data Nascimento</div><div class='valor'>" + dataNascBR + "</div></div>" +
        "<div><div class='label'>Idade</div><div class='valor'>" + idadeTexto + "</div></div>" +
        "<div><div class='label'>Sexo</div><div class='valor'>" + (a.paciente_sexo || "-") + "</div></div>" +
        "<div><div class='label'>Data do Exame</div><div class='valor'>" + dataAtend + "</div></div>" +
        "<div><div class='label'>Hora</div><div class='valor'>" + horaAtend + "</div></div>" +
        "<div><div class='label'>Dentista</div><div class='valor'>" + esc(d.n) + "</div></div>" +
        "</div>" +

        // ── Aviso misto se aplicavel ──
        avisoMistoBox +

        // ── Tabela de exames ──
        "<table>" +
        "<thead><tr>" +
        "<th style='width:40px;text-align:center'>#</th>" +
        "<th>Exame</th>" +
        "<th>Convenio</th>" +
        "<th style='width:100px;text-align:right'>Valor</th>" +
        "</tr></thead>" +
        "<tbody>" + examesHtml + totalHtml + "</tbody></table>" +

        // ── Forma de entrega ──
        "<div class='entrega-box'>" +
        "<div><div class='label'>Forma de Entrega</div><div class='valor'>" + entregaTexto + "</div></div>" +
        (previsaoEntrega ? "<div><div class='label'>Previsao de Entrega</div><div class='valor'>" + previsaoEntrega + "</div></div>" : "") +
        "</div>" +

        // ── Código de barras ──
        "<div class='barcode'>" + barcodeSvg + "<br>" +
        "<span style='font-size:14px;font-family:monospace;letter-spacing:2px'>" + seqAtend + "</span></div>" +

        // ── Assinaturas dos setores técnicos ──
        "<div class='setores'>" +
        "<div class='setores-titulo'>Execução — Assinatura dos Atendentes por Setor</div>" +
        "<div class='setores-grid'>" +
        "<div class='setor-bloco'><div class='setor-nome'>Raios X</div><div class='setor-linha'>Assinatura / Visto</div></div>" +
        "<div class='setor-bloco'><div class='setor-nome'>Tomografia</div><div class='setor-linha'>Assinatura / Visto</div></div>" +
        "<div class='setor-bloco'><div class='setor-nome'>Fotos e Escaneamento</div><div class='setor-linha'>Assinatura / Visto</div></div>" +
        "<div class='setor-bloco'><div class='setor-nome'>Periapicais</div><div class='setor-linha'>Assinatura / Visto</div></div>" +
        "</div>" +
        "</div>" +

        // ── Rodapé: assinaturas paciente/atendente ──
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
        "<div class='nome-ass'>COR - Centro Odontol\u00f3gico de Radiologia</div>" +
        "</div>" +
        "</div>" +
        "</div>" +

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
    var barWidth = 1.5, narrowWidth = barWidth, wideWidth = barWidth * 2.5;
    var height = 50, x = 0, bars = "";
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
    return "<svg width='" + (x + 10) + "' height='" + (height + 5) + "' xmlns='http://www.w3.org/2000/svg'>" + bars + "</svg>";
}

console.log("[COR] Modulo ordem de servico v2.5 carregado (mistos corrigidos)");
