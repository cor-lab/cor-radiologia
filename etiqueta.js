// ═══════════════════════════════════════════════════════════════════════════
// MODULO ETIQUETA — COR
// Gera e imprime etiquetas para envelopes, protocolo e CD
// Tamanho fixo: 10cm × 2,9cm (impressora térmica)
// Uso: <script src="etiqueta.js"></script>
// ═══════════════════════════════════════════════════════════════════════════
//
//   MANIFESTO DE FEATURES — NÃO REMOVER ESTE BLOCO
//
//   Claude (IA): antes de editar, leia a lista. Features abaixo JÁ EXISTEM.
//   Ao reescrever imprimirEtiqueta() ou os 3 geradores, preserve a
//   funcionalidade ou avise explicitamente.
//
//   [✓] Entrada única: imprimirEtiqueta(agId, tipo)
//       Tipos: "envelope" (default), "protocolo", "cd"
//       Marcadores: "imprimirEtiqueta", "tipo ==="
//
//   [✓] Entrada PARA LEGADO: imprimirEtiquetaHist(histItem, tipo, paciente_id)
//       Aceita registro de historico_atendimentos (sem agId no Supabase).
//       Busca DOB em pacientes se paciente_id informado. Mapeia dentista_id
//       por nome usando array global `dents`. Monta objeto `a` compativel e
//       reusa os 3 geradores (gerarEtiquetaCD/Protocolo/Html).
//       Marcadores: "imprimirEtiquetaHist", "histItem"
//
//   [✓] OMISSAO DE CAMPOS AUSENTES nos 3 geradores (v6)
//       Quando um campo chega vazio ("", null, undefined, "-"), o gerador
//       OMITE a linha/pedaco em vez de mostrar "-" feio. Helper: _v(x).
//       Marcadores: "function _v(", "v6:"
//       - Envelope: omite Data/Hora/Idade individualmente + linha DR(a)
//       - Protocolo: omite linha DR(a)
//       - CD: omite Data/Hora/DR(a)
//       Fluxo de agendamento novo nao e afetado (sempre preenche tudo).
//
//   [✓] 3 geradores de etiqueta:
//       - gerarEtiquetaHtml     → Envelope (paciente + logo + data/hora/idade + dr + end)
//       - gerarEtiquetaProtocolo → Protocolo (ordem: paciente > dr > cidade > end > compl)
//       - gerarEtiquetaCD        → CD (logo + paciente + data/hora + dr)
//
//   [✓] Seletor de endereço (mostrarSeletorEndereco)
//       Dentista com múltiplos endereços → abre modal pra escolher
//       Marcadores: "mSeletorEndereco", "selecionarEndereco", "_etqDados"
//
//   [✓] Integração com dentista_enderecos (tabela Supabase)
//       Usa cliente supa (RLS authenticated) — NÃO usar fetch direto
//       Marcadores: "supa.from(\"dentista_enderecos\")"
//
//   [✓] CSS inline @page 100mm×29mm — calibrado pra impressora térmica
//       NÃO alterar tamanhos sem validar na impressora física
//
//   ───────── DEPENDÊNCIAS EXTERNAS ─────────
//
//   - ags[], fdent(), esc(), toast() — do index.html (App COR)
//   - supa (cliente Supabase autenticado)
//   - LOGO_COR_ETQ = "logo.png"
//
//   ───────── HISTÓRICO ─────────
//
//   v6 — adiciona imprimirEtiquetaHist() para pacientes do legado
//        (seleção via tela de histórico do paciente no App COR)
//   v5 — usa cliente supa em vez de fetch direto (corrige RLS authenticated)
//   v4 — protocolo reordenado: Paciente > Dentista > Cidade > End > Complemento
//
// ═══════════════════════════════════════════════════════════════════════════

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
// v6: omite campos ausentes (hora/idade/dentista) em vez de mostrar "-"
//     - nao afeta fluxo de agendamento novo (sempre preenche tudo)
//     - melhora etiquetas do historico legado (pode ter campos nulos)
// ============================================================
function gerarEtiquetaHtml(a, dentNome, dataAtend, horaAtend, idade, endereco) {
    // v6: helper - trata "-", "", null, undefined como ausente
    function _v(x) { return x && String(x).trim() !== "" && String(x).trim() !== "-"; }

    var cidade = "", enderecoStr = "", complementoStr = "";
    if (endereco) {
        cidade = endereco.cidade || "Santa Maria";
        enderecoStr = endereco.endereco || "";
        complementoStr = endereco.complemento || "";
    }

    // Linha de info: logo + so os pedacos que tiverem valor real
    var infoInner = "<img src='" + LOGO_COR_ETQ + "'>";
    if (_v(dataAtend)) infoInner += "<b>Data:&nbsp;" + esc(dataAtend) + "</b>";
    if (_v(horaAtend)) infoInner += "<b>" + esc(horaAtend) + "</b>";
    if (_v(idade))     infoInner += "<b>Idade:&nbsp;" + esc(idade) + "</b>";

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

        "<div class='info'>" + infoInner + "</div>" +

        "<div class='dbox'><table style='width:100%;border-collapse:collapse'>";

    // Linha DR(a): so se tiver nome de dentista real
    if (_v(dentNome)) {
        html += "<tr><td colspan='2' class='dr'><i>DR(a):</i> " + esc(dentNome) + "</td></tr>";
    }

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
// v6: omite linha DR(a) se dentNome ausente (paciente legado)
// ============================================================
function gerarEtiquetaProtocolo(a, dentNome, endereco) {
    function _v(x) { return x && String(x).trim() !== "" && String(x).trim() !== "-"; }

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
        "<div class='paciente'>" + esc(a.pac || "SEM NOME").toUpperCase() + "</div>";

    // 2. DENTISTA - omite linha inteira se nao tiver nome (v6)
    if (_v(dentNome)) {
        html += "<div class='dentista'>DR(a): " + esc(dentNome).toUpperCase() + "</div>";
    }

    // 3-5. CIDADE / ENDERECO / COMPLEMENTO
    html += "<div class='dados'>";

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
// v6: omite hora se ausente (so mostra data); omite DR(a) se vazio
// ============================================================
function gerarEtiquetaCD(a, dentNome, dataAtend, horaAtend) {
    function _v(x) { return x && String(x).trim() !== "" && String(x).trim() !== "-"; }

    // Monta string data/hora com os pedacos que existem
    var dataHora = "";
    if (_v(dataAtend)) dataHora = String(dataAtend);
    if (_v(horaAtend)) dataHora = dataHora ? (dataHora + " " + horaAtend) : String(horaAtend);

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
        "<div class='nome'>" + esc(a.pac || "SEM NOME").toUpperCase() + "</div>";

    // Linha de data/hora: so se tiver pelo menos um
    if (dataHora) {
        html += "<div class='sub'>Data: " + esc(dataHora) + "</div>";
    }
    // Linha DR(a): so se tiver nome
    if (_v(dentNome)) {
        html += "<div class='sub2'>DR(a): " + esc(dentNome) + "</div>";
    }

    html += "</div></div>" +
        "</div>" +
        "<script>window.onload=function(){window.print();}<\/script></body></html>";

    var win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
}

// ============================================================
// ETIQUETA PARA HISTORICO/LEGADO (v6)
// ============================================================
// Wrapper que aceita registro de historico_atendimentos em vez de agId.
// Pacientes do legado nao tem agendamento no Supabase (so fb_seq_atend),
// entao montamos um objeto `a` compativel com o formato esperado pelos
// geradores e reaproveitamos 100% do fluxo existente (CD, protocolo, envelope,
// seletor de endereco).
//
// Parametros:
//   histItem    - registro de historico_atendimentos: {paciente_nome, data_atendimento,
//                 dentista_nome, fb_seq_atend, ...}
//   tipo        - "envelope" (default) | "protocolo" | "cd"
//   paciente_id - opcional. Se informado, busca DOB em pacientes (pra calcular idade).
//                 Normalmente eh o histPaciente.id da tela de historico do App COR.
// ============================================================
async function imprimirEtiquetaHist(histItem, tipo, paciente_id) {
    tipo = tipo || "envelope";
    if (!histItem) { toast && toast("Erro", "Dados do atendimento ausentes"); return; }

    // 1. Busca DOB do paciente (se tiver paciente_id) pra calcular idade
    var dob = null;
    var pid = paciente_id || histItem.paciente_id;
    if (pid) {
        try {
            var rp = await supa.from("pacientes")
                .select("data_nascimento")
                .eq("id", pid)
                .maybeSingle();
            if (rp && rp.data) dob = rp.data.data_nascimento;
        } catch(e) { console.warn("imprimirEtiquetaHist/pacientes:", e); }
    }

    // 2. Tenta achar dentista_id por nome no array global `dents`
    //    (se nao achar, dId fica null -> fluxo sem endereco)
    //    v6: se dentista_nome ausente, dentNome fica "" (gerador omite a linha)
    var dentId = null;
    var dentNome = histItem.dentista_nome || "";
    if (histItem.dentista_nome && typeof dents !== "undefined" && Array.isArray(dents)) {
        var nomeUpper = histItem.dentista_nome.toUpperCase().trim();
        // Tira prefixos comuns de titulo (match mais tolerante)
        ["DRA. ", "DRA ", "DR. ", "DR "].forEach(function(p){
            if (nomeUpper.indexOf(p) === 0) nomeUpper = nomeUpper.slice(p.length).trim();
        });
        for (var i = 0; i < dents.length; i++) {
            var dNome = (dents[i].n || dents[i].nome || "").toUpperCase().trim();
            ["DRA. ", "DRA ", "DR. ", "DR "].forEach(function(p){
                if (dNome.indexOf(p) === 0) dNome = dNome.slice(p.length).trim();
            });
            if (dNome === nomeUpper) {
                dentId = dents[i].id;
                break;
            }
        }
    }

    // 3. Formata data do atendimento pra BR (dd/mm/yyyy)
    //    v6: usa "" em vez de "-" se ausente (gerador omite)
    var dataBr = "";
    if (histItem.data_atendimento) {
        var ds = String(histItem.data_atendimento);
        var parts = ds.split("T")[0].split("-");
        if (parts.length === 3) dataBr = parts[2] + "/" + parts[1] + "/" + parts[0];
    }

    // 3b. Hora do atendimento (v6: vem do backfill, campo hora_atendimento)
    //     Se nao tiver, fica vazio e o gerador omite
    var horaStr = "";
    if (histItem.hora_atendimento) {
        var hs = String(histItem.hora_atendimento);
        horaStr = hs.substring(0, 5);  // HH:MM (ignora segundos)
    }

    // 4. Calcula idade (se tem DOB). "" se nao tiver (gerador omite).
    var idade = "";
    if (dob) {
        try {
            var dn = new Date(dob);
            var hoje = new Date();
            var anos = hoje.getFullYear() - dn.getFullYear();
            var meses = hoje.getMonth() - dn.getMonth();
            if (meses < 0 || (meses === 0 && hoje.getDate() < dn.getDate())) { anos--; meses += 12; }
            idade = anos > 0 ? anos + "anos" : meses + "m";
        } catch(e) {}
    }

    // 5. Monta objeto `a` compativel com os geradores
    var a = {
        id: "hist_" + (histItem.fb_seq_atend || "x"),
        pac: histItem.paciente_nome || "SEM NOME",
        paciente_data_nascimento: dob,
        dataNasc: dob,
        dt: dataBr,
        hr: horaStr,
        dId: dentId
    };

    // 6. Fluxo identico ao imprimirEtiqueta original a partir daqui
    //    (CD nao precisa endereco; demais: busca enderecos do dentista)
    if (tipo === "cd") {
        gerarEtiquetaCD(a, dentNome, a.dt, a.hr);
        return;
    }

    if (!dentId) {
        if (tipo === "protocolo") {
            gerarEtiquetaProtocolo(a, dentNome, null);
        } else {
            gerarEtiquetaHtml(a, dentNome, a.dt, a.hr, idade, null);
        }
        return;
    }

    try {
        var r = await supa.from("dentista_enderecos")
            .select("*")
            .eq("dentista_id", dentId)
            .order("id", { ascending: true });
        if (r.error) console.error("imprimirEtiquetaHist/enderecos:", r.error);
        var enderecos = r.data || [];

        if (!enderecos.length) {
            if (tipo === "protocolo") {
                gerarEtiquetaProtocolo(a, dentNome, null);
            } else {
                gerarEtiquetaHtml(a, dentNome, a.dt, a.hr, idade, null);
            }
        } else if (enderecos.length === 1) {
            if (tipo === "protocolo") {
                gerarEtiquetaProtocolo(a, dentNome, enderecos[0]);
            } else {
                gerarEtiquetaHtml(a, dentNome, a.dt, a.hr, idade, enderecos[0]);
            }
        } else {
            mostrarSeletorEndereco(a, dentNome, a.dt, a.hr, idade, enderecos, tipo);
        }
    } catch(e) {
        console.error("imprimirEtiquetaHist:", e);
        if (tipo === "protocolo") {
            gerarEtiquetaProtocolo(a, dentNome, null);
        } else {
            gerarEtiquetaHtml(a, dentNome, a.dt, a.hr, idade, null);
        }
    }
}

console.log("[COR] Modulo etiqueta v6 carregado (legado via historico_atendimentos)");
