// ============================================================
// MODULO ORDEM DE SERVICO (OS) - COR
// Gera e imprime OS a partir do agendamento
// Incluir no index.html antes do </body>
// <script src="ordem_servico.js"></script>
// ============================================================

var LOGO_COR_B64 = "logo.png";

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

    // Montar lista de exames
    var examesHtml = "";
    var totalValor = 0;
    var itens = a.exames || [];
    if (!itens.length && a.ex) {
        itens = [{ exame_id: a.ex, convenio_id: a.cv || "", preco: a.vl || a.valor_bruto || a.valor_faturado || 0 }];
    }
    // Se ainda sem itens, mostrar valor total como linha unica
    var valorTotal = Number(a.vl || a.valor_bruto || a.valor_faturado || 0);
    if (!itens.length && valorTotal > 0) {
        itens = [{ exame_id: null, convenio_id: "", preco: valorTotal, _nome: "Atendimento" }];
    }
    if (!itens.length) {
        itens = [{ exame_id: null, convenio_id: "", preco: 0, _nome: "Atendimento" }];
    }

    itens.forEach(function(it, idx) {
        var nomeExame = it._nome || it.nome_exame || "";
        if (!nomeExame && it.exame_id) {
            var ex = fex(it.exame_id);
            nomeExame = ex ? ex.n : (it.exame_id || "Exame");
        }
        if (!nomeExame) nomeExame = "Atendimento";
        var cv = fconv(it.convenio_id || "");
        var preco = Number(it.preco || 0);
        totalValor += preco;

        examesHtml += "<tr>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd;text-align:center'>" + (idx + 1) + "</td>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd'>" + nomeExame + "</td>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd'>" + (cv ? cv.n : "Particular") + "</td>" +
            "<td style='padding:6px 10px;border-bottom:1px solid #ddd;text-align:right'>R$ " + preco.toFixed(2).replace(".", ",") + "</td>" +
            "</tr>";
    });

    // Codigo de barras SVG (Code 128 simplificado - numeros)
    var barcodeSvg = gerarBarcodeSvg(String(seqAtend));

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
        ".info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-bottom:15px;font-size:13px}" +
        ".info-grid .label{font-weight:bold;color:#555;font-size:11px;text-transform:uppercase}" +
        ".info-grid .valor{font-size:14px}" +
        ".total-row{background:#f0f4ff;font-weight:bold;font-size:15px}" +
        ".barcode{text-align:center;margin:15px 0}" +
        ".footer{margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:40px;font-size:12px;color:#666}" +
        ".footer .linha{border-top:1px solid #999;padding-top:5px;text-align:center;margin-top:40px}" +
        "@media print{body{padding:15px}}" +
        "</style></head><body>" +

        "<div class='header'>" +
        "<img src='" + LOGO_COR_B64 + "' alt='COR'>" +
        "<div class='seq-box'>" +
        "<div class='label'>Ordem de Servico</div>" +
        "<div class='numero'>#" + seqAtend + "</div>" +
        "</div>" +
        "</div>" +

        "<div class='info-grid'>" +
        "<div><div class='label'>Paciente</div><div class='valor'>" + esc(a.pac) + "</div></div>" +
        "<div><div class='label'>CPF</div><div class='valor'>" + (a.paciente_cpf ? formatarCPF(a.paciente_cpf) : "-") + "</div></div>" +
        "<div><div class='label'>Data</div><div class='valor'>" + dataAtend + "</div></div>" +
        "<div><div class='label'>Hora</div><div class='valor'>" + horaAtend + "</div></div>" +
        "<div><div class='label'>Dentista</div><div class='valor'>" + esc(d.n) + "</div></div>" +
        "<div><div class='label'>Telefone</div><div class='valor'>" + (a.tel || "-") + "</div></div>" +
        "</div>" +

        "<table>" +
        "<thead><tr>" +
        "<th style='width:40px;text-align:center'>#</th>" +
        "<th>Exame</th>" +
        "<th>Convenio</th>" +
        "<th style='width:100px;text-align:right'>Valor</th>" +
        "</tr></thead>" +
        "<tbody>" + examesHtml +
        "<tr class='total-row'>" +
        "<td colspan='3' style='padding:8px 10px;text-align:right'>TOTAL</td>" +
        "<td style='padding:8px 10px;text-align:right'>R$ " + totalValor.toFixed(2).replace(".", ",") + "</td>" +
        "</tr></tbody></table>" +

        "<div class='barcode'>" + barcodeSvg + "<br>" +
        "<span style='font-size:14px;font-family:monospace;letter-spacing:2px'>" + seqAtend + "</span></div>" +

        "<div class='footer'>" +
        "<div><div class='linha'>Assinatura do Paciente</div></div>" +
        "<div><div class='linha'>Assinatura do Atendente</div></div>" +
        "</div>" +

        "<script>window.onload=function(){window.print();}<\/script>" +
        "</body></html>";

    // Abrir janela de impressao
    var win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
}

// Gerar codigo de barras simples em SVG (Code 39 para numeros)
function gerarBarcodeSvg(texto) {
    // Code 39 patterns para digitos
    var patterns = {
        "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw",
        "3": "wnwwnnnnn", "4": "nnnwwnnnw", "5": "wnnwwnnnn",
        "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn",
        "9": "nnwwnnwnn", "*": "nwnnwnwnn"
    };

    var encoded = "*" + texto + "*";
    var barWidth = 1.5;
    var narrowWidth = barWidth;
    var wideWidth = barWidth * 2.5;
    var height = 50;
    var x = 0;
    var bars = "";

    for (var i = 0; i < encoded.length; i++) {
        var ch = encoded[i];
        var pattern = patterns[ch];
        if (!pattern) continue;

        for (var j = 0; j < pattern.length; j++) {
            var isWide = pattern[j] === "w";
            var w = isWide ? wideWidth : narrowWidth;
            var isBar = (j % 2 === 0);

            if (isBar) {
                bars += "<rect x='" + x + "' y='0' width='" + w + "' height='" + height + "' fill='#000'/>";
            }
            x += w;
        }
        x += narrowWidth; // gap entre caracteres
    }

    return "<svg width='" + (x + 10) + "' height='" + (height + 5) + "' xmlns='http://www.w3.org/2000/svg'>" +
        bars + "</svg>";
}

console.log("[COR] Modulo ordem de servico carregado");
