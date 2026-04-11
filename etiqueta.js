// ============================================================
// MODULO ETIQUETA - COR
// Gera e imprime etiquetas para envelopes de exames
// Tamanho: 10cm x 2,9cm (impressora termica)
// Incluir no index.html antes do </body>
// <script src="etiqueta.js"></script>
// ============================================================

var LOGO_COR_ETQ = "logo.png";

async function imprimirEtiqueta(agId) {
    var a = ags.find(function(x) { return x.id === agId; });
    if (!a) {
        toast("Erro", "Agendamento nao encontrado");
        return;
    }

    var d = fdent(a.dId) || { n: "-" };
    var dentNome = d.n || "-";

    // Calcular idade
    var idade = "-";
    var dataNasc = a.paciente_data_nascimento || a.dataNasc;
    if (dataNasc) {
        try {
            var dn = new Date(dataNasc);
            var hoje = new Date();
            var anos = hoje.getFullYear() - dn.getFullYear();
            var meses = hoje.getMonth() - dn.getMonth();
            if (meses < 0 || (meses === 0 && hoje.getDate() < dn.getDate())) {
                anos--;
                meses += 12;
            }
            if (anos > 0) {
                idade = anos + "a " + meses + "m";
            } else {
                idade = meses + "m";
            }
        } catch(e) {}
    }

    var dataAtend = a.dt || "-";
    var horaAtend = a.hr || "-";

    // Buscar enderecos do dentista
    if (!a.dId) {
        gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, null);
        return;
    }

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
        opcoesHtml += "<button class='btn-endereco' onclick='selecionarEndereco(" + idx + ")' style='" +
            "display:block;width:100%;text-align:left;padding:12px 16px;margin:6px 0;" +
            "background:#1a1a2e;border:1px solid #3a3a5e;border-radius:8px;color:#e0e0e0;" +
            "cursor:pointer;font-size:13px;transition:all 0.2s'>" +
            "<strong style='color:#4ade80'>" + esc(desc) + "</strong><br>" +
            "<span style='color:#ccc'>" + esc(end + compl + bairro) + "</span>" +
            "</button>";
    });

    opcoesHtml += "<button class='btn-endereco' onclick='selecionarEndereco(-1)' style='" +
        "display:block;width:100%;text-align:left;padding:12px 16px;margin:6px 0;" +
        "background:#1a1a2e;border:1px solid #3a3a5e;border-radius:8px;color:#e0e0e0;" +
        "cursor:pointer;font-size:13px;transition:all 0.2s'>" +
        "<strong style='color:#999'>Sem endereco</strong>" +
        "</button>";

    var modal = document.createElement("div");
    modal.id = "mSeletorEndereco";
    modal.className = "mo open";
    modal.innerHTML = "<div class='mb' style='max-width:500px'>" +
        "<div class='mh'>" +
        "<div class='mt'>Selecione o endereco de entrega</div>" +
        "<button class='mx' onclick='fecharSeletorEndereco()'>x</button>" +
        "</div>" +
        "<div style='padding:10px 0'>" +
        "<p style='color:#aaa;font-size:13px;margin:0 0 10px'>Dr(a). " + esc(dentNome) + " possui " + enderecos.length + " enderecos cadastrados:</p>" +
        opcoesHtml +
        "</div></div>";

    document.body.appendChild(modal);

    window._etqDados = {
        a: a, dentNome: dentNome, dataAtend: dataAtend,
        horaAtend: horaAtend, idade: idade, enderecos: enderecos
    };
}

function selecionarEndereco(idx) {
    var dados = window._etqDados;
    if (!dados) return;
    var endereco = idx >= 0 ? dados.enderecos[idx] : null;
    fecharSeletorEndereco();
    gerarEtiquetaHtml(dados.a, dados.dentNome, dados.dataAtend, dados.horaAtend, dados.idade, endereco);
}

function fecharSeletorEndereco() {
    var el = document.getElementById("mSeletorEndereco");
    if (el) el.remove();
    window._etqDados = null;
}

function gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, endereco) {
    var cidade = "";
    var enderecoStr = "";
    var complementoStr = "";

    if (endereco) {
        cidade = endereco.cidade || "Santa Maria";
        enderecoStr = endereco.endereco || "";
        complementoStr = endereco.complemento || "";
    }

    var html = "<!DOCTYPE html><html><head><meta charset='UTF-8'>" +
        "<title>Etiqueta - " + esc(a.pac) + "</title>" +
        "<style>" +
        "@page{size:100mm 29mm;margin:0}" +
        "*{margin:0;padding:0;box-sizing:border-box}" +
        "body{" +
        "  font-family:Arial,Helvetica,sans-serif;" +
        "  width:100mm;height:29mm;" +
        "  overflow:hidden;" +
        "  color:#000;" +
        "}" +
        ".etq{" +
        "  width:100mm;height:29mm;" +
        "  padding:1.2mm 2.5mm 0.8mm 2.5mm;" +
        "  border:0.5pt solid #888;" +
        "}" +
        /* Nome do paciente - grande, bold, com linha embaixo */
        ".nome-pac{" +
        "  font-size:12pt;font-weight:bold;" +
        "  border-bottom:2pt solid #1a3a6e;" +
        "  padding-bottom:0.8mm;" +
        "  margin-bottom:0.5mm;" +
        "  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
        "}" +
        /* Linha do logo + data + hora + idade */
        ".linha-info{" +
        "  display:flex;align-items:center;" +
        "  height:8mm;" +
        "  margin-bottom:0.3mm;" +
        "}" +
        ".linha-info .logo{" +
        "  height:7.5mm;width:auto;" +
        "  margin-right:3mm;" +
        "  object-fit:contain;" +
        "}" +
        ".linha-info .dados{" +
        "  font-size:8.5pt;font-style:italic;font-weight:bold;" +
        "  display:flex;gap:4mm;align-items:baseline;" +
        "}" +
        /* Box do dentista/endereco */
        ".box-dent{" +
        "  border:0.8pt solid #000;" +
        "  padding:0.5mm 2mm;" +
        "  font-size:7.5pt;" +
        "  line-height:1.35;" +
        "}" +
        ".box-dent .dr{font-style:italic;font-size:8.5pt;margin-bottom:0.2mm}" +
        ".box-dent .row{display:flex}" +
        ".box-dent .lbl{font-weight:bold;min-width:22mm;text-transform:uppercase}" +
        ".box-dent .val{}" +
        "@media print{.etq{border:none}}" +
        "</style></head><body>" +
        "<div class='etq'>" +

        /* Nome paciente */
        "<div class='nome-pac'>" + esc(a.pac || "SEM NOME").toUpperCase() + "</div>" +

        /* Logo + Data + Hora + Idade */
        "<div class='linha-info'>" +
        "  <img class='logo' src='" + LOGO_COR_ETQ + "' alt='COR'>" +
        "  <div class='dados'>" +
        "    <span>Data: " + dataAtend + "</span>" +
        "    <span>" + horaAtend + "</span>" +
        "    <span>Idade: " + idade + "</span>" +
        "  </div>" +
        "</div>" +

        /* Box dentista + endereco */
        "<div class='box-dent'>" +
        "  <div class='dr'><i>DR(a):</i>" + esc(dentNome) + "</div>";

    if (cidade) {
        html += "<div class='row'><span class='lbl'>CIDADE</span><span class='val'>" + esc(cidade) + "</span></div>";
    }
    if (enderecoStr) {
        html += "<div class='row'><span class='lbl'>ENDERECO</span><span class='val'>" + esc(enderecoStr) + "</span></div>";
    }
    if (complementoStr) {
        html += "<div class='row'><span class='lbl'>COMPLEMENTO</span><span class='val'>" + esc(complementoStr) + "</span></div>";
    }

    html += "</div>" +
        "</div>" +
        "<script>window.onload=function(){window.print();}<\/script>" +
        "</body></html>";

    var win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
}

console.log("[COR] Modulo etiqueta carregado");
