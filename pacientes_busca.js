// ============================================================
// MODULO BUSCA DE PACIENTES - COR
// Adiciona busca inteligente ao campo de paciente
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

    // Se parece CPF (so numeros, 11 digitos)
    if (termoLimpo.length >= 6 && /^\d+$/.test(termoLimpo)) {
        filtro = "cpf=ilike.*" + termoLimpo + "*";
    } else {
        filtro = "nome=ilike.*" + encodeURIComponent(termo.toUpperCase()) + "*";
    }

    try {
        var r = await fetch(
            SUPA_URL + "/rest/v1/pacientes?select=*&" + filtro + "&ativo=eq.true&limit=8&order=nome.asc",
            {
                headers: {
                    "apikey": SUPA_KEY,
                    "Authorization": "Bearer " + SUPA_KEY
                }
            }
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

        var r = await fetch(SUPA_URL + "/rest/v1/pacientes", {
            method: "POST",
            headers: {
                "apikey": SUPA_KEY,
                "Authorization": "Bearer " + SUPA_KEY,
                "Content-Type": "application/json",
                "Prefer": "return=representation"
            },
            body: JSON.stringify(body)
        });

        var data = await r.json();

        if (Array.isArray(data) && data.length > 0) {
            return data[0];
        }
        if (data && data.id) {
            return data;
        }

        console.error("criarPacienteSupa:", data);
        return null;
    } catch (e) {
        console.error("criarPacienteSupa:", e);
        return null;
    }
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

        item.innerHTML =
            "<div>" +
            "<div style='font-weight:600;font-size:.88rem'>" + esc(pac.nome) + "</div>" +
            "<div style='font-size:.74rem;color:var(--gr)'>" +
            (cpfDisplay ? "CPF: " + cpfDisplay + " | " : "") +
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

// Selecionar um paciente do dropdown
function selecionarPaciente(pac, inputId) {
    _pacSelecionado = pac;

    // Determinar prefixo (p = novo agendamento, e = editar)
    var prefix = inputId === "pNome" ? "p" : "e";

    // Preencher campos
    var campos = {
        "Nome": pac.nome || "",
        "Tel": pac.telefone ? pac.telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3") : "",
        "Email": pac.email || "",
        "Cpf": pac.cpf ? formatarCPF(pac.cpf) : "",
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
        if (el && campos[campo]) {
            el.value = campos[campo];
        }
    });

    // Fechar dropdown
    var dd = document.getElementById("pacDropdown");
    if (dd) dd.remove();

    // Mostrar indicador de paciente selecionado
    mostrarPacienteSelecionado(pac, inputId);

    toast("OK", "Paciente selecionado: " + pac.nome);
}

// Mostrar badge de paciente selecionado
function mostrarPacienteSelecionado(pac, inputId) {
    var existente = document.getElementById("pacSelBadge");
    if (existente) existente.remove();

    var input = document.getElementById(inputId);
    if (!input) return;

    var badge = document.createElement("div");
    badge.id = "pacSelBadge";
    badge.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;" +
        "background:rgba(74,184,72,.1);border:1px solid rgba(74,184,72,.25);" +
        "border-radius:8px;margin-top:6px;font-size:.8rem;";
    badge.innerHTML =
        "<span style='color:var(--g);font-weight:700'>Paciente vinculado</span>" +
        "<span style='color:var(--wh)'>" + esc(pac.nome) + "</span>" +
        (pac.cpf ? "<span style='color:var(--gr)'>(CPF: " + formatarCPF(pac.cpf) + ")</span>" : "") +
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
    if (!e.target.closest("#pacDropdown") && e.target.id !== "pNome" && e.target.id !== "eNm2") {
        var dd = document.getElementById("pacDropdown");
        if (dd) dd.remove();
    }
});

// Inicializar busca no campo de paciente
function initBuscaPaciente(inputId) {
    var input = document.getElementById(inputId);
    if (!input) return;

    // Evitar duplicar o listener
    if (input.dataset.buscaInit) return;
    input.dataset.buscaInit = "1";

    input.addEventListener("input", function () {
        var termo = input.value.trim();

        // Limpar timer anterior
        if (_pacBuscaTimer) clearTimeout(_pacBuscaTimer);

        // Fechar dropdown se campo vazio
        if (termo.length < 2) {
            var dd = document.getElementById("pacDropdown");
            if (dd) dd.remove();
            return;
        }

        // Debounce de 300ms
        _pacBuscaTimer = setTimeout(async function () {
            var resultados = await buscarPacientes(termo);
            renderDropdownPac(resultados, inputId);
        }, 300);
    });
}

// ============================================================
// INTEGRACAO COM confAg() - salvar paciente_id no agendamento
// ============================================================

// Guardar referencia da funcao original
var _confAgOriginal = typeof confAg === "function" ? confAg : null;

// Sobrescrever confAg para incluir paciente_id
async function confAgComPaciente() {
    // Se nao tem paciente selecionado, criar um novo
    if (!_pacSelecionado) {
        var nm = (document.getElementById("pNome")?.value || "").trim();
        var cpf = (document.getElementById("pCpf")?.value || "").replace(/\D/g, "");
        var tel = (document.getElementById("pTel")?.value || "").replace(/\D/g, "");
        var email = (document.getElementById("pEmail")?.value || "").trim();
        var cep = (document.getElementById("pCep")?.value || "").trim();
        var logradouro = (document.getElementById("pLogradouro")?.value || "").trim();
        var numero = (document.getElementById("pNumero")?.value || "").trim();
        var complemento = (document.getElementById("pComplemento")?.value || "").trim();
        var bairro = (document.getElementById("pBairro")?.value || "").trim();
        var municipio = (document.getElementById("pMunicipio")?.value || "").trim();
        var uf = (document.getElementById("pUf")?.value || "").trim();

        if (nm) {
            var novoPac = await criarPacienteSupa({
                nome: nm, cpf: cpf, telefone: tel, email: email,
                cep: cep, logradouro: logradouro, numero: numero,
                complemento: complemento, bairro: bairro,
                municipio: municipio, uf: uf
            });
            if (novoPac) {
                _pacSelecionado = novoPac;
                console.log("Paciente criado:", novoPac.id, novoPac.nome);
            }
        }
    }

    // Chamar funcao original
    if (_confAgOriginal) {
        await _confAgOriginal();
    }

    // Depois de salvar, atualizar o paciente_id no agendamento
    if (_pacSelecionado && _pacSelecionado.id) {
        var ultimoAg = ags[ags.length - 1];
        if (ultimoAg && ultimoAg.id) {
            await fetch(
                SUPA_URL + "/rest/v1/agendamentos?id=eq." + ultimoAg.id,
                {
                    method: "PATCH",
                    headers: {
                        "apikey": SUPA_KEY,
                        "Authorization": "Bearer " + SUPA_KEY,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ paciente_id: _pacSelecionado.id })
                }
            );
            console.log("paciente_id vinculado:", _pacSelecionado.id, "-> agendamento:", ultimoAg.id);
        }
    }

    // Limpar selecao
    _pacSelecionado = null;
    var badge = document.getElementById("pacSelBadge");
    if (badge) badge.remove();
}

// ============================================================
// OBSERVADOR - inicializa busca quando o campo aparece
// ============================================================

var _pacObserver = new MutationObserver(function () {
    var pNome = document.getElementById("pNome");
    if (pNome && !pNome.dataset.buscaInit) {
        initBuscaPaciente("pNome");
    }
    var eNm2 = document.getElementById("eNm2");
    if (eNm2 && !eNm2.dataset.buscaInit) {
        initBuscaPaciente("eNm2");
    }
});

_pacObserver.observe(document.body, { childList: true, subtree: true });

console.log("[COR] Modulo busca de pacientes carregado");
