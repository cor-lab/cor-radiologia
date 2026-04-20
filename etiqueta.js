// ============================================================
// MODULO ETIQUETA - COR
// Gera e imprime etiquetas para envelopes, protocolo e CD
// Tamanho: 10cm x 2,9cm (impressora termica)
// <script src="etiqueta.js"></script>
// v4: protocolo reordenado (Paciente > Dentista > Cidade > Endereco > Complemento)
// v5: usa cliente `supa` em vez de fetch direto (corrige RLS authenticated)
// ============================================================

var LOGO_COR_ETQ = "logo.png";

// ============================================================
// ENTRADA PRINCIPAL — tipo: "envelope" (default), "protocolo", "cd"
// ============================================================
async function imprimirEtiqueta(agId, tipo) {
    tipo = tipo || "envelope";
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

    // CD e Protocolo nao precisam de endereco
    if (tipo === "cd") {
        gerarEtiquetaCD(a, dentNome, dataAtend, horaAtend);
        return;
    }

    if (!a.dId) {
        if (tipo === "protocolo") {
            gerarEtiquetaProtocolo(a, dentNome, null);
        } else {
            gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, null);
        }
        return;
    }

    try {
        // v5: usa cliente supa (JWT authenticated) em vez de fetch manual
        var r = await supa.from("dentista_enderecos")
            .select("*")
            .eq("dentista_id", a.dId)
            .order("id", { ascending: true });
        if (r.error) console.error("imprimirEtiqueta/enderecos:", r.error);
        var enderecos = r.data || [];

        if (!enderecos.length) {
            if (tipo === "protocolo") {
                gerarEtiquetaProtocolo(a, dentNome, null);
            } else {
                gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, null);
            }
        } else if (enderecos.length === 1) {
            if (tipo === "protocolo") {
                gerarEtiquetaProtocolo(a, dentNome, enderecos[0]);
            } else {
                gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, enderecos[0]);
            }
        } else {
            mostrarSeletorEndereco(a, dentNome, dataAtend, horaAtend, idade, enderecos, tipo);
        }
    } catch(e) {
        console.error("imprimirEtiqueta:", e);
        if (tipo === "protocolo") {
            gerarEtiquetaProtocolo(a, dentNome, null);
        } else {
            gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, null);
        }
    }
}

// ============================================================
// SELETOR DE ENDERECO (envelope + protocolo)
// ============================================================
function mostrarSeletorEndereco(a, dentNome, dataAtend, horaAtend, idade, enderecos, tipo) {
    tipo = tipo || "envelope";
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
    window._etqDados = { a:a, dentNome:dentNome, dataAtend:dataAtend, horaAtend:horaAtend, idade:idade, enderecos:enderecos, tipo:tipo };
}

function selecionarEndereco(idx) {
    var d = window._etqDados; if (!d) return;
    var endereco = idx >= 0 ? d.enderecos[idx] : null;
    var tipo = d.tipo || "envelope";
    fecharSeletorEndereco();
    if (tipo === "protocolo") {
        gerarEtiquetaProtocolo(d.a, d.dentNome, endereco);
    } else {
        gerarEtiquetaHtml(d.a, d.dentNome, d.dataAtend, d.horaAtend, d.idade, endereco);
    }
}

function fecharSeletorEndereco() {
    var el = document.getElementById("mSeletorEndereco"); if (el) el.remove();
    window._etqDados = null;
}

// ============================================================
// ETIQUETA ENVELOPE (fontes aumentadas + tudo negrito)
// ============================================================
function gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, endereco) {
    var cidade = "", enderecoStr = "", complementoStr = "";
    if (endereco) {
        cidade = endereco.cidade || "Santa Maria";
        enderecoStr = endereco.endereco || "";
        complementoStr = endereco.complemento || "";
    }

    var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
        "<title>Etiqueta Envelope</title>" +
        "<style>" +
        "@page{size:100mm 29mm;margin:0}" +
        "*{margin:0;padding:0;box-sizing:border-box}" +
        "body{font-family:Arial,sans-serif;width:100mm;height:29mm;overflow:hidden;color:#000;font-weight:bold}" +

        ".etq{width:100mm;height:29mm;padding:0.8mm 2.5mm 0.5mm 2.5mm}" +

        ".nome{font-size:14pt;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "border-bottom:2pt solid #1a3a6e;padding-bottom:0.3mm;margin-bottom:0.4mm;letter-spacing:.2pt}" +

        ".info{display:flex;align-items:center;height:7.5mm;white-space:nowrap}" +
        ".info img{height:7mm;margin-right:2mm}" +
        ".info b{font-size:9.5pt;font-weight:bold;font-style:italic}" +
        ".info b+b{margin-left:3.5mm}" +

        ".dbox{border:0.7pt solid #000;padding:0.3mm 1.5mm;font-size:8.5pt;line-height:1.2;overflow:hidden;font-weight:bold}" +
        ".dbox .dr{font-style:italic;font-size:9pt;font-weight:bold}" +
        ".dbox td{font-weight:bold}" +
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
        "<tr><td colspan='2' class='dr'><i>DR(a):</i> " + esc(dentNome) + "</td></tr>";

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

// ============================================================
// ETIQUETA PROTOCOLO (v4 - REORDENADO)
// Ordem: 1.PACIENTE  2.DENTISTA  3.CIDADE  4.ENDERECO  5.COMPLEMENTO
// ============================================================
function gerarEtiquetaProtocolo(a, dentNome, endereco) {
    var cidade = "", enderecoStr = "", complementoStr = "";
    if (endereco) {
        cidade = endereco.cidade || "Santa Maria";
        enderecoStr = endereco.endereco || "";
        complementoStr = endereco.complemento || "";
    }

    var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
        "<title>Etiqueta Protocolo</title>" +
        "<style>" +
        "@page{size:100mm 29mm;margin:0}" +
        "*{margin:0;padding:0;box-sizing:border-box}" +
        "body{font-family:Arial,sans-serif;width:100mm;height:29mm;overflow:hidden;color:#000;font-weight:bold}" +

        ".etq{width:100mm;height:29mm;padding:1mm 3mm 1mm 3mm;border:0.5pt solid #ccc}" +

        ".paciente{font-size:13pt;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "border-bottom:1.5pt solid #1a3a6e;padding-bottom:0.3mm;margin-bottom:0.6mm;letter-spacing:.2pt}" +

        ".dentista{font-size:10.5pt;font-weight:bold;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "margin-bottom:0.6mm}" +

        ".dados{font-size:9pt;line-height:1.25;font-weight:bold}" +
        ".dados .lbl{font-weight:bold;margin-right:2mm}" +
        ".dados div{font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +

        "@media print{body{-webkit-print-color-adjust:exact}.etq{border:none}}" +
        "</style></head><body><div class='etq'>" +

        // 1. PACIENTE (topo, destaque)
        "<div class='paciente'>" + esc(a.pac || "SEM NOME").toUpperCase() + "</div>" +

        // 2. DENTISTA
        "<div class='dentista'>DR(a): " + esc(dentNome).toUpperCase() + "</div>" +

        // 3-5. CIDADE / ENDERECO / COMPLEMENTO
        "<div class='dados'>";

    if (cidade)
        html += "<div><span class='lbl'>CIDADE</span>" + esc(cidade) + "</div>";
    if (enderecoStr)
        html += "<div><span class='lbl'>ENDERECO</span>" + esc(enderecoStr) + "</div>";
    if (complementoStr)
        html += "<div><span class='lbl'>COMPLEMENTO</span>" + esc(complementoStr) + "</div>";

    html += "</div>" +
        "</div>" +
        "<script>window.onload=function(){window.print();}<\/script></body></html>";

    var win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
}

// ============================================================
// ETIQUETA CD (fontes aumentadas + tudo negrito)
// ============================================================
function gerarEtiquetaCD(a, dentNome, dataAtend, horaAtend) {
    var dataHora = dataAtend + " " + horaAtend;

    var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
        "<title>Etiqueta CD</title>" +
        "<style>" +
        "@page{size:100mm 29mm;margin:0}" +
        "*{margin:0;padding:0;box-sizing:border-box}" +
        "body{font-family:Arial,sans-serif;width:100mm;height:29mm;overflow:hidden;color:#000;font-weight:bold}" +

        ".etq{width:100mm;height:29mm;padding:1.5mm 2.5mm 1mm 2.5mm;border:0.5pt solid #ccc}" +

        ".topo{display:flex;align-items:flex-start}" +
        ".topo img{height:10mm;margin-right:2.5mm;flex-shrink:0}" +
        ".topo-txt{overflow:hidden;flex:1}" +
        ".topo-txt .nome{font-size:14pt;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.2pt}" +
        ".topo-txt .sub{font-size:9pt;font-weight:bold;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:0.5mm}" +
        ".topo-txt .sub2{font-size:9pt;font-weight:bold;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:0.3mm}" +

        "@media print{body{-webkit-print-color-adjust:exact}.etq{border:none}}" +
        "</style></head><body><div class='etq'>" +

        "<div class='topo'>" +
        "<img src='" + LOGO_COR_ETQ + "'>" +
        "<div class='topo-txt'>" +
        "<div class='nome'>" + esc(a.pac || "SEM NOME").toUpperCase() + "</div>" +
        "<div class='sub'>Data: " + esc(dataHora) + "</div>" +
        "<div class='sub2'>DR(a): " + esc(dentNome) + "</div>" +
        "</div></div>" +

        "</div>" +
        "<script>window.onload=function(){window.print();}<\/script></body></html>";

    var win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
}

console.log("[COR] Modulo etiqueta v5 carregado (RLS authenticated fix)");
