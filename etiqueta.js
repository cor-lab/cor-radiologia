// ============================================================
// MODULO ETIQUETA - COR
// Gera e imprime etiquetas para envelopes de exames
// Tamanho: 10cm x 2,9cm (impressora termica)
// <script src="etiqueta.js"></script>
// ============================================================

var LOGO_COR_ETQ = "logo.png";

async function imprimirEtiqueta(agId) {
    var a = ags.find(function(x) { return x.id === agId; });
    if (!a) { toast("Erro", "Agendamento nao encontrado"); return; }

    var d = fdent(a.dId) || { n: "-" };
    var dentNome = d.n || "-";

    var idade = "-";
    var dataNasc = a.paciente_data_nascimento || a.dataNasc;
    if (dataNasc) {
        try {
            var dn = new Date(dataNasc);
            var hoje = new Date();
            var anos = hoje.getFullYear() - dn.getFullYear();
            var meses = hoje.getMonth() - dn.getMonth();
            if (meses < 0 || (meses === 0 && hoje.getDate() < dn.getDate())) { anos--; meses += 12; }
            idade = anos > 0 ? anos + "anos" : meses + "m";
        } catch(e) {}
    }

    var dataAtend = a.dt || "-";
    var horaAtend = a.hr || "-";

    if (!a.dId) { gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, null); return; }

    try {
        var resp = await fetch(
            SUPA_URL + "/rest/v1/dentista_enderecos?dentista_id=eq." + a.dId + "&order=id.asc",
            { headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY } }
        );
        var enderecos = await resp.json();
        if (!enderecos || !enderecos.length) {
            gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, null);
        } else if (enderecos.length === 1) {
            gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, enderecos[0]);
        } else {
            mostrarSeletorEndereco(a, dentNome, dataAtend, horaAtend, idade, enderecos);
        }
    } catch(e) {
        console.error("imprimirEtiqueta:", e);
        gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, null);
    }
}

function mostrarSeletorEndereco(a, dentNome, dataAtend, horaAtend, idade, enderecos) {
    var old = document.getElementById("mSeletorEndereco");
    if (old) old.remove();

    var opcoesHtml = "";
    enderecos.forEach(function(e, idx) {
        var desc = e.descricao || "Endereco " + (idx + 1);
        var end = e.endereco || "";
        var compl = e.complemento ? " - " + e.complemento : "";
        var bairro = e.bairro ? " - " + e.bairro : "";
        opcoesHtml += "<button onclick='selecionarEndereco(" + idx + ")' style='" +
            "display:block;width:100%;text-align:left;padding:12px 16px;margin:6px 0;" +
            "background:#1a1a2e;border:1px solid #3a3a5e;border-radius:8px;color:#e0e0e0;" +
            "cursor:pointer;font-size:13px'>" +
            "<strong style='color:#4ade80'>" + esc(desc) + "</strong><br>" +
            "<span style='color:#ccc'>" + esc(end + compl + bairro) + "</span></button>";
    });
    opcoesHtml += "<button onclick='selecionarEndereco(-1)' style='" +
        "display:block;width:100%;text-align:left;padding:12px 16px;margin:6px 0;" +
        "background:#1a1a2e;border:1px solid #3a3a5e;border-radius:8px;color:#e0e0e0;" +
        "cursor:pointer;font-size:13px'><strong style='color:#999'>Sem endereco</strong></button>";

    var modal = document.createElement("div");
    modal.id = "mSeletorEndereco";
    modal.className = "mo open";
    modal.innerHTML = "<div class='mb' style='max-width:500px'><div class='mh'>" +
        "<div class='mt'>Selecione o endereco de entrega</div>" +
        "<button class='mx' onclick='fecharSeletorEndereco()'>x</button></div>" +
        "<div style='padding:10px 0'>" +
        "<p style='color:#aaa;font-size:13px;margin:0 0 10px'>Dr(a). " + esc(dentNome) + " possui " + enderecos.length + " enderecos cadastrados:</p>" +
        opcoesHtml + "</div></div>";
    document.body.appendChild(modal);
    window._etqDados = { a:a, dentNome:dentNome, dataAtend:dataAtend, horaAtend:horaAtend, idade:idade, enderecos:enderecos };
}

function selecionarEndereco(idx) {
    var d = window._etqDados; if (!d) return;
    var endereco = idx >= 0 ? d.enderecos[idx] : null;
    fecharSeletorEndereco();
    gerarEtiquetaHtml(d.a, d.dentNome, d.dataAtend, d.horaAtend, d.idade, endereco);
}

function fecharSeletorEndereco() {
    var el = document.getElementById("mSeletorEndereco"); if (el) el.remove();
    window._etqDados = null;
}

function gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, endereco) {
    var cidade = "", enderecoStr = "", complementoStr = "";
    if (endereco) {
        cidade = endereco.cidade || "Santa Maria";
        enderecoStr = endereco.endereco || "";
        complementoStr = endereco.complemento || "";
    }

    var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
        "<title>Etiqueta</title>" +
        "<style>" +
        "@page{size:100mm 29mm;margin:0}" +
        "*{margin:0;padding:0;box-sizing:border-box}" +
        "body{font-family:Arial,sans-serif;width:100mm;height:29mm;overflow:hidden;color:#000}" +

        ".etq{width:100mm;height:29mm;padding:0.8mm 2.5mm 0.5mm 2.5mm}" +

        ".nome{font-size:12pt;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "border-bottom:2pt solid #1a3a6e;padding-bottom:0.3mm;margin-bottom:0.3mm}" +

        ".info{display:flex;align-items:center;height:7.5mm;white-space:nowrap}" +
        ".info img{height:7mm;margin-right:2mm}" +
        ".info b{font-size:8pt;font-style:italic}" +
        ".info b+b{margin-left:4mm}" +

        ".dbox{border:0.7pt solid #000;padding:0.2mm 1.5mm;font-size:7pt;line-height:1.25;overflow:hidden}" +
        ".dbox .dr{font-style:italic;font-size:7.5pt}" +
        ".dbox td.l{font-weight:bold;padding-right:2mm;white-space:nowrap}" +

        "@media print{body{-webkit-print-color-adjust:exact}}" +
        "</style></head><body><div class='etq'>" +

        "<div class='nome'>" + esc(a.pac || "SEM NOME").toUpperCase() + "</div>" +

        "<div class='info'>" +
        "<img src='" + LOGO_COR_ETQ + "'>" +
        "<b>Data:&nbsp;" + dataAtend + "</b>" +
        "<b>" + horaAtend + "</b>" +
        "<b>Idade:&nbsp;" + idade + "</b>" +
        "</div>" +

        "<div class='dbox'><table style='width:100%;border-collapse:collapse'>" +
        "<tr><td colspan='2' class='dr'><i>DR(a):</i>" + esc(dentNome) + "</td></tr>";

    if (cidade)
        html += "<tr><td class='l'>CIDADE</td><td>" + esc(cidade) + "</td></tr>";
    if (enderecoStr)
        html += "<tr><td class='l'>ENDERECO</td><td>" + esc(enderecoStr) + "</td></tr>";
    if (complementoStr)
        html += "<tr><td class='l'>COMPLEMENTO</td><td>" + esc(complementoStr) + "</td></tr>";

    html += "</table></div></div>" +
        "<script>window.onload=function(){window.print();}<\/script></body></html>";

    var win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
}

console.log("[COR] Modulo etiqueta carregado");
