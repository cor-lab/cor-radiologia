// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO BUSCA DE PACIENTES — COR
// Autocompletar inteligente + vinculação por Nome+DataNasc no agendamento
// ═══════════════════════════════════════════════════════════════════════════
//
//   MANIFESTO DE FEATURES — NÃO REMOVER ESTE BLOCO
//
//   Claude (IA): antes de editar, leia a lista. Features abaixo JÁ EXISTEM.
//   Ao reescrever qualquer parte deste módulo, preserve a funcionalidade
//   ou avise explicitamente.
//
//   [✓] Busca no Supabase por nome ou CPF (≥2 chars)
//       Marcadores: "buscarPacientes", "ilike"
//
//   [✓] Dropdown de autocomplete com debounce
//       Marcadores: "renderDropdownPac", "_pacBuscaTimer"
//
//   [✓] VINCULAÇÃO INTELIGENTE (regra crítica de negócio):
//       Paciente = mesmo Nome + mesma Data de Nascimento
//       Se CPF diferir → atualiza o CPF no cadastro existente
//       NÃO cria duplicata de paciente por mudança de CPF
//       Marcadores: "confAgComPaciente", "atualizarCpfPaciente"
//
//   [✓] Criação de paciente novo com CPF normalizado
//       Marcadores: "criarPacienteSupa", "upsert"
//
//   [✓] Seleção (preenche campos do form) e desvinculação
//       Marcadores: "selecionarPaciente", "mostrarPacienteSelecionado",
//                   "desvincularPaciente", "_pacSelecionado"
//
//   [✓] Inicialização automática via MutationObserver
//       Marcadores: "_pacObserver", "initBuscaPaciente", "initBuscaCpf"
//       Vincula aos campos: pNome, pCpf (agendamento), eNm2, eCpf (edição)
//
//   [✓] Sobrescreve confAg() global com confAgComPaciente()
//       Marcadores: "_confAgOriginal", "_pacWrapped"
//       IMPORTANTE: a função original é guardada; não deletar nem
//       reinventar — é o "wrapper" que injeta paciente_id no payload
//
//   [✓] Usa cliente `supa` (RLS authenticated) — NÃO usar fetch direto
//       Marcadores: "supa.from(\"pacientes\")"
//
//   ───────── DEPENDÊNCIAS EXTERNAS ─────────
//
//   - supa (cliente Supabase autenticado) — do index.html
//   - confAg() — função original de confirmar agendamento (é sobrescrita)
//   - toast(), esc() — helpers do index.html
//   - Elementos DOM: pNome, pCpf, eNm2, eCpf (criados dinamicamente)
//
//   ───────── HISTÓRICO ─────────
//
//   v5.1 — 2026-05-26 — Fix sutil de UX: seleção do paciente
//        preservada quando confAg retorna null. Antes: a limpeza
//        de _pacSelecionado e do badge acontecia sempre, mesmo em
//        falha de validação. Cenário ruim: usuário escolhe paciente
//        no dropdown, esquece de selecionar exame, clica Confirmar
//        (toast de erro), corrige e clica de novo — mas a vinculação
//        manual já tinha sido perdida; a busca automática refazia o
//        trabalho e podia até criar duplicata se o paciente não
//        tivesse data_nascimento cadastrada. Agora limpa só dentro
//        do ramo de sucesso (agSalvo && agSalvo.id).
//   v5 — 2026-05-26 — P3 fix: criação de paciente movida pra DEPOIS
//        do confAg confirmar o save. Antes: se a validação do
//        agendamento falhasse (faltou exame/data/dentista), o
//        paciente já tinha sido criado e atualizado — ficava
//        "solto" no banco. Agora: na etapa 1 só faz BUSCA
//        read-only por nome+datanasc → CPF; na etapa 2 chama o
//        confAg; só na etapa 3 (com agSalvo confirmado) aplica
//        propagação (paciente existente) ou criação (paciente
//        novo). Se confAg retornar null, zero mutação em pacientes.
//        Inclui também os fixes anteriores da v4.
//   v4 — 2026-05-26 — Propagação COMPLETA do paciente vinculado.
//        Antes: atualizava só CPF (linhas 459-468) ignorando tel,
//        email, CEP, logradouro, numero, complemento, bairro,
//        municipio, UF, data_nascimento, sexo. Caso real corrigido:
//        MANUELA NAIDON (paciente 96449, ag 99252, seq 214987) —
//        recepcionista digitou CPF e email no agendamento e ficaram
//        apenas em agendamentos.paciente_*, nunca subiram pro
//        cadastro mestre. Agora usa helper global
//        propagarPacienteVinculado() (definido em index.html) com
//        DIFF: só campos não-vazios e diferentes. Regra "vazio no
//        form preserva valor do paciente".
//   v3 — RLS authenticated fix (migração fetch → supa.from)
//   v2 — Vinculação Nome+DataNasc com atualização de CPF divergente
//   v1 — Busca simples por nome/CPF
//
// ═══════════════════════════════════════════════════════════════════════════
// MODULO BUSCA DE PACIENTES - COR v5.1 (preserva seleção em retry)
// Busca inteligente com vinculação por Nome + Data Nascimento
// CPF diferente com mesmo nome+datanasc = mesmo paciente (atualiza CPF)
// Propagação completa do paciente vinculado ao salvar agendamento
// Criação de paciente novo apenas APÓS confirmação do save do agendamento
// Seleção manual preservada quando confAg falha (retry sem perder vínculo)
// Incluir no index.html antes do </body>
// <script src="pacientes_busca.js"></script>
// ============================================================

var _pacBuscaTimer = null;
var _pacSelecionado = null;

// Buscar pacientes no Supabase por nome ou CPF
async function buscarPacientes(termo) {
    if (!termo || termo.length < 2) return [];

    var filtro = "";
    var termoLimpo = termo.replace(/\D/g, "");

    // Se parece CPF (so numeros, 6+ digitos)
    if (termoLimpo.length >= 6 && /^\d+$/.test(termoLimpo)) {
        filtro = "cpf=ilike.*" + termoLimpo + "*";
    } else {
        filtro = "nome=ilike.*" + encodeURIComponent(termo.toUpperCase()) + "*";
    }

    try {
        var r = await supaFetch(
            "/rest/v1/pacientes?select=*&" + filtro + "&ativo=eq.true&limit=8&order=nome.asc"
        );
        return await r.json();
    } catch (e) {
        console.error("buscarPacientes:", e);
        return [];
    }
}

// Criar paciente novo no Supabase
async function criarPacienteSupa(dados) {
    try {
        var body = {
            nome: (dados.nome || "").toUpperCase().trim(),
            cpf: (dados.cpf || "").replace(/\D/g, "") || null,
            telefone: (dados.telefone || "").replace(/\D/g, "") || null,
            email: dados.email || null,
            data_nascimento: dados.data_nascimento || null,
            sexo: dados.sexo || null,
            cep: dados.cep || null,
            logradouro: dados.logradouro || null,
            numero: dados.numero || null,
            complemento: dados.complemento || null,
            bairro: dados.bairro || null,
            municipio: dados.municipio || null,
            uf: dados.uf || null
        };

        var r = await supaFetch("/rest/v1/pacientes", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            },
            body: JSON.stringify(body)
        });

        var data = await r.json();

        if (Array.isArray(data) && data.length > 0) return data[0];
        if (data && data.id) return data;

        // (15/08/2026) TRAVA DE DUPLICATA no banco: trigger (P0001
        // "PACIENTE_DUPLICADO") ou índice único (23505). Em vez de falhar
        // calado, AVISA a recepção e tenta achar a ficha ativa que já existe
        // (mesmo nome + nascimento) para o agendamento vincular na pessoa
        // certa — auto-correção do caso de corrida entre atendentes.
        var _msg = ((data && data.message) || "") + " " + ((data && data.details) || "");
        var _ehDup = (data && (data.code === "23505" || data.code === "P0001")) ||
                     /PACIENTE_DUPLICADO|uq_paciente_nome_nasc|duplicate key/i.test(_msg);
        if (_ehDup) {
            if (typeof toast === "function")
                toast("⚠️", "Já existe ficha ativa desta pessoa — vinculando à ficha existente.");
            try {
                if (body.nome && body.data_nascimento) {
                    var rf = await supaFetch(
                        "/rest/v1/pacientes?select=*&ativo=eq.true&limit=1" +
                        "&nome=ilike." + encodeURIComponent(body.nome) +
                        "&data_nascimento=eq." + body.data_nascimento);
                    var ex = await rf.json();
                    if (Array.isArray(ex) && ex.length) return ex[0];
                }
            } catch (e2) { console.error("criarPacienteSupa/buscar existente:", e2); }
            return null;
        }

        console.error("criarPacienteSupa:", data);
        return null;
    } catch (e) {
        console.error("criarPacienteSupa:", e);
        return null;
    }
}

// Atualizar CPF de paciente existente no Supabase
async function atualizarCpfPaciente(pacienteId, novoCpf) {
    try {
        var cpfLimpo = (novoCpf || "").replace(/\D/g, "");
        if (!cpfLimpo || !pacienteId) return false;

        var r = await supaFetch(
            "/rest/v1/pacientes?id=eq." + pacienteId,
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                },
                body: JSON.stringify({ cpf: cpfLimpo })
            }
        );

        var data = await r.json();
        console.log("[COR] CPF atualizado no paciente " + pacienteId + ":", cpfLimpo);
        return true;
    } catch (e) {
        console.error("atualizarCpfPaciente:", e);
        return false;
    }
}

// Formatar data ISO para DD/MM/AAAA
function formatarDataBR(dataISO) {
    if (!dataISO) return "";
    var partes = dataISO.split("-");
    if (partes.length === 3) return partes[2] + "/" + partes[1] + "/" + partes[0];
    return dataISO;
}

// Renderizar dropdown de resultados
function renderDropdownPac(resultados, inputId) {
    var existente = document.getElementById("pacDropdown");
    if (existente) existente.remove();

    if (!resultados.length) return;

    var input = document.getElementById(inputId);
    if (!input) return;

    var dd = document.createElement("div");
    dd.id = "pacDropdown";
    dd.style.cssText = "position:absolute;left:0;right:0;top:100%;z-index:999;" +
        "background:rgba(18,36,78,.98);border:1px solid rgba(74,184,72,.3);" +
        "border-radius:0 0 10px 10px;max-height:220px;overflow-y:auto;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.4);";

    resultados.forEach(function (pac) {
        var item = document.createElement("div");
        item.style.cssText = "padding:10px 14px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.05);" +
            "display:flex;justify-content:space-between;align-items:center;transition:background .12s;";
        item.onmouseenter = function () { item.style.background = "rgba(74,184,72,.1)"; };
        item.onmouseleave = function () { item.style.background = "none"; };

        var cpfDisplay = pac.cpf ? formatarCPF(pac.cpf) : "";
        var nascDisplay = pac.data_nascimento ? formatarDataBR(pac.data_nascimento) : "";

        item.innerHTML =
            "<div>" +
            "<div style='font-weight:600;font-size:.88rem'>" + esc(pac.nome) + "</div>" +
            "<div style='font-size:.74rem;color:var(--gr)'>" +
            (cpfDisplay ? "CPF: " + cpfDisplay + " | " : "") +
            (nascDisplay ? "Nasc: " + nascDisplay + " | " : "") +
            (pac.telefone ? "Tel: " + esc(pac.telefone) : "") +
            "</div></div>" +
            "<div style='font-size:.7rem;color:var(--g);font-weight:700'>Selecionar</div>";

        item.onclick = function () {
            selecionarPaciente(pac, inputId);
        };

        dd.appendChild(item);
    });

    // Posicionar relativo ao campo
    var wrapper = input.parentElement;
    wrapper.style.position = "relative";
    wrapper.appendChild(dd);
}

// Selecionar um paciente do dropdown — preenche TODOS os campos incluindo CPF
function selecionarPaciente(pac, inputId) {
    _pacSelecionado = pac;

    // Determinar prefixo (p = novo agendamento, e = editar)
    var prefix = (inputId === "pNome" || inputId === "pCpf") ? "p" : "e";

    // Nome do campo no editar é eNm2, não eNome
    var nomeFieldId = prefix === "e" ? "eNm2" : prefix + "Nome";
    var telFieldId = prefix === "e" ? "eTel2" : prefix + "Tel";

    // Preencher nome
    var elNome = document.getElementById(nomeFieldId);
    if (elNome) elNome.value = pac.nome || "";

    // Preencher telefone
    var elTel = document.getElementById(telFieldId);
    if (elTel && pac.telefone) {
        elTel.value = pac.telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
    }

    // Preencher demais campos
    var campos = {
        "Email": pac.email || "",
        "Cpf": pac.cpf ? formatarCPF(pac.cpf) : "",
        "DataNasc": pac.data_nascimento || "",
        "Cep": pac.cep || "",
        "Logradouro": pac.logradouro || "",
        "Numero": pac.numero || "",
        "Complemento": pac.complemento || "",
        "Bairro": pac.bairro || "",
        "Municipio": pac.municipio || "",
        "Uf": pac.uf || ""
    };

    Object.keys(campos).forEach(function (campo) {
        var el = document.getElementById(prefix + campo);
        if (el) {
            // Sempre atribui — limpa o campo se valor for vazio (evita dados fantasmas do paciente anterior)
            el.value = campos[campo];
        }
    });

    // Limpar sexo se novo paciente não tem
    var selSexo = document.getElementById(prefix + "Sexo");
    if (selSexo) selSexo.value = pac.sexo || "";

    // Limpar telefone se novo paciente não tem
    if (elTel && !pac.telefone) elTel.value = "";

    // Fechar dropdown
    var dd = document.getElementById("pacDropdown");
    if (dd) dd.remove();

    // Mostrar indicador de paciente selecionado
    mostrarPacienteSelecionado(pac, nomeFieldId);

    toast("OK", "Paciente selecionado: " + pac.nome);
}

// Mostrar badge de paciente selecionado
function mostrarPacienteSelecionado(pac, inputId) {
    var existente = document.getElementById("pacSelBadge");
    if (existente) existente.remove();

    var input = document.getElementById(inputId);
    if (!input) return;

    var nascDisplay = pac.data_nascimento ? formatarDataBR(pac.data_nascimento) : "";

    var badge = document.createElement("div");
    badge.id = "pacSelBadge";
    badge.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;" +
        "background:rgba(74,184,72,.1);border:1px solid rgba(74,184,72,.25);" +
        "border-radius:8px;margin-top:6px;font-size:.8rem;flex-wrap:wrap;";
    badge.innerHTML =
        "<span style='color:var(--g);font-weight:700'>Paciente vinculado</span>" +
        "<span style='color:var(--wh)'>" + esc(pac.nome) + "</span>" +
        (pac.cpf ? "<span style='color:var(--gr)'>(CPF: " + formatarCPF(pac.cpf) + ")</span>" : "") +
        (nascDisplay ? "<span style='color:var(--gr)'>(Nasc: " + nascDisplay + ")</span>" : "") +
        "<span style='cursor:pointer;color:var(--rd);font-weight:700;margin-left:auto' " +
        "onclick='desvincularPaciente(\"" + inputId + "\")'>X</span>";

    input.parentElement.appendChild(badge);
}

// Desvincular paciente
function desvincularPaciente(inputId) {
    _pacSelecionado = null;
    var badge = document.getElementById("pacSelBadge");
    if (badge) badge.remove();
}

// Fechar dropdown ao clicar fora
document.addEventListener("click", function (e) {
    if (!e.target.closest("#pacDropdown") && e.target.id !== "pNome" && e.target.id !== "eNm2" && e.target.id !== "pCpf" && e.target.id !== "eCpf") {
        var dd = document.getElementById("pacDropdown");
        if (dd) dd.remove();
    }
});

// Inicializar busca no campo de paciente (por nome)
function initBuscaPaciente(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    if (input.dataset.buscaInit) return;
    input.dataset.buscaInit = "1";

    input.addEventListener("input", function () {
        var termo = input.value.trim();
        if (_pacBuscaTimer) clearTimeout(_pacBuscaTimer);

        if (termo.length < 2) {
            var dd = document.getElementById("pacDropdown");
            if (dd) dd.remove();
            return;
        }

        _pacBuscaTimer = setTimeout(async function () {
            var resultados = await buscarPacientes(termo);
            renderDropdownPac(resultados, inputId);
        }, 300);
    });
}

// Inicializar busca no campo CPF
function initBuscaCpf(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    if (input.dataset.buscaCpfInit) return;
    input.dataset.buscaCpfInit = "1";

    input.addEventListener("input", function () {
        var termo = input.value.replace(/\D/g, "").trim();
        if (_pacBuscaTimer) clearTimeout(_pacBuscaTimer);

        if (termo.length < 6) {
            var dd = document.getElementById("pacDropdown");
            if (dd) dd.remove();
            return;
        }

        _pacBuscaTimer = setTimeout(async function () {
            var resultados = await buscarPacientes(termo);
            renderDropdownPac(resultados, inputId);
        }, 300);
    });
}

// ============================================================
// VINCULAÇÃO INTELIGENTE NO confAg()
// Regra: Nome + Data Nasc iguais = mesmo paciente
// CPF diferente? Atualiza CPF no cadastro do paciente
// ============================================================

// Guardar referencia da funcao original
var _confAgOriginal = typeof confAg === "function" ? confAg : null;

// Sobrescrever confAg para incluir paciente_id e logica de vinculação
// v5 (2026-05-26 P3 fix): reordena o fluxo para evitar paciente "solto":
// 1. lê dados do form
// 2. BUSCA (read-only) por nome+datanasc → CPF; NÃO cria nada ainda
// 3. chama _confAgOriginal(isAtendimento) e captura agSalvo
// 4. SÓ SE agSalvo:
//    a) se _pacSelecionado já existe (vinculação prévia ou auto), propaga
//       campos não-vazios pro cadastro mestre (helper propagarPacienteVinculado)
//    b) se _pacSelecionado NÃO existe, cria paciente novo agora com os
//       dados do form
//    c) PATCH paciente_id no ag
// 5. se !agSalvo: nada acontece em pacientes (zero efeito colateral)
async function confAgComPaciente(isAtendimento) {
    var prefix = "p";
    var nm = (document.getElementById(prefix + "Nome")?.value || "").trim().toUpperCase();
    var cpfForm = (document.getElementById(prefix + "Cpf")?.value || "").replace(/\D/g, "");
    var dataNascForm = (document.getElementById(prefix + "DataNasc")?.value || "").trim();
    var tel = (document.getElementById(prefix + "Tel")?.value || "").replace(/\D/g, "");
    var email = (document.getElementById(prefix + "Email")?.value || "").trim();
    var sexo = (document.getElementById(prefix + "Sexo")?.value || "").trim();
    var cep = (document.getElementById(prefix + "Cep")?.value || "").trim();
    var logradouro = (document.getElementById(prefix + "Logradouro")?.value || "").trim();
    var numero = (document.getElementById(prefix + "Numero")?.value || "").trim();
    var complemento = (document.getElementById(prefix + "Complemento")?.value || "").trim();
    var bairro = (document.getElementById(prefix + "Bairro")?.value || "").trim();
    var municipio = (document.getElementById(prefix + "Municipio")?.value || "").trim();
    var uf = (document.getElementById(prefix + "Uf")?.value || "").trim().toUpperCase();

    // ─── ETAPA 1: BUSCA READ-ONLY (sem mutar nada) ────────────────────────
    // Tenta achar paciente existente por nome+datanasc, depois por CPF+nome+datanasc.
    // NÃO cria paciente novo aqui — adiado pra depois do confAg confirmar o save.
    if (!_pacSelecionado && nm) {
        var candidatos = [];
        try {
            var rNome = await supaFetch(
                "/rest/v1/pacientes?select=*&nome=ilike." + encodeURIComponent(nm) + "&ativo=eq.true&limit=10"
            );
            candidatos = await rNome.json();
            if (!Array.isArray(candidatos)) candidatos = [];
        } catch (e) {
            candidatos = [];
        }

        if (candidatos.length > 0 && dataNascForm) {
            var match = candidatos.find(function (c) {
                return c.data_nascimento === dataNascForm;
            });
            if (match) {
                _pacSelecionado = match;
                console.log("[COR] Vinculado auto por nome+datanasc:", match.id, match.nome);
            }
        }

        if (!_pacSelecionado && cpfForm && cpfForm.length >= 6) {
            try {
                var rCpf = await supaFetch(
                    "/rest/v1/pacientes?select=*&cpf=eq." + cpfForm + "&ativo=eq.true&limit=5"
                );
                var porCpf = await rCpf.json();
                if (Array.isArray(porCpf) && porCpf.length > 0) {
                    var matchCpf = porCpf.find(function (c) {
                        return c.nome === nm && c.data_nascimento === dataNascForm;
                    });
                    if (matchCpf) {
                        _pacSelecionado = matchCpf;
                        console.log("[COR] Vinculado por CPF+nome+datanasc:", matchCpf.id);
                    }
                }
            } catch (e) {
                console.error("Busca CPF:", e);
            }
        }
        // NB: criação de paciente novo foi MOVIDA pra etapa 3.b abaixo
    }

    // ─── ETAPA 2: SALVAR AGENDAMENTO ──────────────────────────────────────
    // confAg retorna o ag salvo em sucesso, ou null em falha de validação ou save.
    var agSalvo = null;
    if (_confAgOriginal) {
        agSalvo = await _confAgOriginal(isAtendimento);
    }

    // ─── ETAPA 3: MUTAÇÕES (só se save confirmou) ─────────────────────────
    if (agSalvo && agSalvo.id) {
        // 3.a) Paciente existente: propaga dados não-vazios do form
        if (_pacSelecionado && _pacSelecionado.id) {
            if (typeof propagarPacienteVinculado === "function") {
                try {
                    await propagarPacienteVinculado(_pacSelecionado.id, {
                        cpf:              cpfForm,
                        telefone:         tel,
                        email:            email,
                        data_nascimento:  dataNascForm,
                        sexo:             sexo,
                        cep:              cep,
                        logradouro:       logradouro,
                        numero:           numero,
                        complemento:      complemento,
                        bairro:           bairro,
                        municipio:        municipio,
                        uf:               uf
                    });
                    if (cpfForm) _pacSelecionado.cpf = cpfForm;
                } catch (e) {
                    console.error("[COR] propagar paciente vinculado:", e);
                }
            }
        } else if (nm) {
            // 3.b) Sem paciente vinculado e nome preenchido: cria novo agora
            //      (após ag salvo, evitando paciente solto se validação falhasse)
            try {
                var novoPac = await criarPacienteSupa({
                    nome: nm, cpf: cpfForm, telefone: tel, email: email,
                    data_nascimento: dataNascForm, sexo: sexo,
                    cep: cep, logradouro: logradouro, numero: numero,
                    complemento: complemento, bairro: bairro,
                    municipio: municipio, uf: uf
                });
                if (novoPac) {
                    _pacSelecionado = novoPac;
                    console.log("[COR] Paciente NOVO criado:", novoPac.id, novoPac.nome);
                }
            } catch (e) {
                console.error("[COR] criar paciente novo (pós-save):", e);
            }
        }

        // 3.c) PATCH paciente_id no ag salvo
        if (_pacSelecionado && _pacSelecionado.id) {
            try {
                await supaFetch(
                    "/rest/v1/agendamentos?id=eq." + agSalvo.id,
                    {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paciente_id: _pacSelecionado.id })
                    }
                );
                agSalvo.paciente_id = _pacSelecionado.id;
                console.log("[COR] paciente_id vinculado:", _pacSelecionado.id, "-> ag:", agSalvo.id);
            } catch (e) {
                console.error("Vincular paciente_id:", e);
            }
        }

        // v5.1 fix (2026-05-26): limpar seleção SÓ em caso de sucesso.
        // Antes: limpava sempre, e numa retry após falha de validação
        // o usuário perdia a vinculação manual feita no dropdown.
        _pacSelecionado = null;
        var badge = document.getElementById("pacSelBadge");
        if (badge) badge.remove();
    } else {
        // Save falhou (toast já mostrado pelo confAg original).
        // Não cria paciente, não propaga, não faz PATCH — zero efeito colateral.
        // E PRESERVA _pacSelecionado + badge: numa retry após o usuário
        // corrigir os campos faltantes, a vinculação manual continua válida.
        console.log("[COR] confAg retornou null — nenhuma mutação em pacientes; seleção preservada pra retry.");
    }
}

// ============================================================
// OBSERVADOR - inicializa busca quando os campos aparecem
// ============================================================

var _pacObserver = new MutationObserver(function () {
    var pNome = document.getElementById("pNome");
    if (pNome && !pNome.dataset.buscaInit) {
        initBuscaPaciente("pNome");
    }
    var pCpf = document.getElementById("pCpf");
    if (pCpf && !pCpf.dataset.buscaCpfInit) {
        initBuscaCpf("pCpf");
    }
    var eNm2 = document.getElementById("eNm2");
    if (eNm2 && !eNm2.dataset.buscaInit) {
        initBuscaPaciente("eNm2");
    }
    var eCpf = document.getElementById("eCpf");
    if (eCpf && !eCpf.dataset.buscaCpfInit) {
        initBuscaCpf("eCpf");
    }
});

_pacObserver.observe(document.body, { childList: true, subtree: true });

// ============================================================
// SOBRESCREVER confAg para usar a versão com vinculação
// O botão no HTML chama confAg() — redirecionamos para confAgComPaciente()
// ============================================================
if (typeof confAg === "function" && !confAg._pacWrapped) {
    _confAgOriginal = confAg;
    confAg = confAgComPaciente;
    confAg._pacWrapped = true;
    console.log("[COR] confAg sobrescrito com vinculação de paciente");
}

console.log("[COR] Modulo busca de pacientes v5.1 carregado");
