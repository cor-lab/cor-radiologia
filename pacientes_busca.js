// ============================================================
// MODULO BUSCA DE PACIENTES - COR v3 (RLS authenticated fix)
// Busca inteligente com vinculação por Nome + Data Nascimento
// CPF diferente com mesmo nome+datanasc = mesmo paciente (atualiza CPF)
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
            (pac.telefone ? "Tel: " + pac.telefone : "") +
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
async function confAgComPaciente() {
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

    // --- LOGICA DE VINCULAÇÃO ---
    if (!_pacSelecionado && nm) {
        // Tentar encontrar paciente por nome exato
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

        // Se achou candidatos com mesmo nome, verificar data nascimento
        if (candidatos.length > 0 && dataNascForm) {
            var match = candidatos.find(function (c) {
                return c.data_nascimento === dataNascForm;
            });

            if (match) {
                // Mesmo paciente! Nome + data nascimento batem
                _pacSelecionado = match;
                console.log("[COR] Vinculado auto por nome+datanasc:", match.id, match.nome);
            }
        }

        // Se ainda não vinculou, buscar por CPF
        if (!_pacSelecionado && cpfForm && cpfForm.length >= 6) {
            try {
                var rCpf = await supaFetch(
                    "/rest/v1/pacientes?select=*&cpf=eq." + cpfForm + "&ativo=eq.true&limit=5"
                );
                var porCpf = await rCpf.json();
                if (Array.isArray(porCpf) && porCpf.length > 0) {
                    // Verificar se nome + data nasc batem com algum
                    var matchCpf = porCpf.find(function (c) {
                        return c.nome === nm && c.data_nascimento === dataNascForm;
                    });
                    if (matchCpf) {
                        _pacSelecionado = matchCpf;
                        console.log("[COR] Vinculado por CPF+nome+datanasc:", matchCpf.id);
                    }
                    // Se CPF existe mas nome/datanasc diferentes = paciente diferente, cria novo
                }
            } catch (e) {
                console.error("Busca CPF:", e);
            }
        }

        // Se não encontrou ninguém, criar paciente novo
        if (!_pacSelecionado) {
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
        }
    }

    // Sempre salva o CPF do formulário no cadastro do paciente vinculado
    // A regra é: nome + data nasc batem = mesmo paciente, CPF do form é o que vale
    if (_pacSelecionado && cpfForm) {
        var cpfCadastrado = (_pacSelecionado.cpf || "").replace(/\D/g, "");
        if (cpfForm !== cpfCadastrado) {
            console.log("[COR] Atualizando CPF do paciente", _pacSelecionado.id, "de", cpfCadastrado || "(vazio)", "para", cpfForm);
            await atualizarCpfPaciente(_pacSelecionado.id, cpfForm);
            _pacSelecionado.cpf = cpfForm;
        }
    }

    // Chamar funcao original (confAg do index.html)
    if (_confAgOriginal) {
        await _confAgOriginal();
    }

    // Depois de salvar, vincular paciente_id no agendamento
    if (_pacSelecionado && _pacSelecionado.id) {
        var ultimoAg = ags[ags.length - 1];
        if (ultimoAg && ultimoAg.id) {
            try {
                await supaFetch(
                    "/rest/v1/agendamentos?id=eq." + ultimoAg.id,
                    {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ paciente_id: _pacSelecionado.id })
                    }
                );
                ultimoAg.paciente_id = _pacSelecionado.id;
                console.log("[COR] paciente_id vinculado:", _pacSelecionado.id, "-> ag:", ultimoAg.id);
            } catch (e) {
                console.error("Vincular paciente_id:", e);
            }
        }
    }

    // Limpar selecao
    _pacSelecionado = null;
    var badge = document.getElementById("pacSelBadge");
    if (badge) badge.remove();
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

console.log("[COR] Modulo busca de pacientes v2 carregado");
