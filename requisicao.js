// ============================================================================
// requisicao.js v3.5 - Sobreimpressão em requisição pré-impressa COR
// ----------------------------------------------------------------------------
// - Imprime nome/CRO/endereço/telefone do dentista nos campos certos.
// - LOGO do dentista impressa em area calibrada (v3.3).
// - Calibração persistida em configuracoes (chave 'requisicao_calib').
// - Múltiplos endereços: abre seletor; principal pré-selecionado.
// - Permite redefinir o principal direto no seletor (fica salvo).
// - v3.1: pode ser disparada pelo cadastro do dentista (sem agendamento)
//         e aceita quantidade de folhas.
// - v3.2: pop-up bloqueado evitado (aba aberta no gesto do clique) +
//         pagina em branco extra eliminada (last-of-type).
// - v3.3: logo do dentista impressa em area calibravel (4 mm + checkbox).
// - v3.4: tamanho do papel corrigido pra 150x250mm (era A4, errado).
// - v3.5: calibracao sempre fresca a cada impressao (evita cache stale
//         entre PCs) + diagnostico no console + toast em fallback silencioso.
// Depende de globais: supa, ags, dents, fdent, esc, toast, SUPA_URL.
// ----------------------------------------------------------------------------
// CHANGELOG v3 (2026-05-28) — code review do Vine:
//   #1 reqBuscarDentista: trata rE.error (e rD.error) — antes uma falha de
//      rede/RLS na busca de enderecos era silenciada e imprimia "sem endereco".
//   #2 reqLerNum: leitura segura dos campos de calibracao com fallback pro
//      valor atual/padrao — antes parseFloat de campo vazio salvava NaN e a
//      impressao saia com left:NaNmm. Usado em salvar e imprimir teste.
//   #3 reqGerarHtml: o print() agora aguarda as imagens decodificarem antes
//      de disparar (img.decode/complete + timeout 3s). Prepara o terreno pra
//      a logomarca do dentista (Etapa 3); com folha so-texto dispara na hora.
//
// CHANGELOG v3.1 (2026-05-28):
//   * reqGerarHtml(dados, c, qtd): aceita qtd (1-50, clamp). Gera N folhas
//     identicas com page-break-after entre elas — uma chamada window.print()
//     imprime tudo. Retrocompat: chamadas sem qtd seguem com 1 folha.
//   * Nova publico imprimirRequisicaoPorDentista(dentId, qtd): variante de
//     imprimirRequisicao(agId, qtd) que NAO depende de agendamento. Recebe
//     dentId direto. Usado pelo modal de edicao do dentista no App COR
//     (botao "Imprimir Requisicao" na secao da logo, v3.10.8).
//   * Nova helper reqBuscarDentistaPorId(dentId): irmao de reqBuscarDentista
//     mas sem o passo de resolver dentista a partir do agendamento.
//   * qtd propagada por toda a cadeia: imprimirRequisicao, reqImprimirCom-
//     Endereco, abrirSeletorEndereco (salva no window._reqModalState),
//     reqConfirmarImpressao, reqDefinirComoPrincipal (re-render mantem qtd).
//
// CHANGELOG v3.2 (2026-05-28) — code review do Vine sobre v3.1:
//   #2 POP-UP BLOQUEADO: imprimirRequisicaoPorDentista fazia awaits antes
//      do window.open, podendo perder o gesto do clique e ser bloqueada.
//      FIX: chamador abre a janela IMEDIATAMENTE no handler do clique
//      (nova helper reqAbrirJanelaComLoading exibe spinner enquanto carrega)
//      e passa adiante via parametro winPreAberta. reqAbrirImpressao aceita
//      janela pre-aberta e escreve o HTML nela. winPreAberta propagada
//      em toda a cadeia (imprimirRequisicaoPorDentista → reqImprimirCom-
//      Endereco → reqAbrirImpressao) e tambem em abrirSeletorEndereco/
//      reqConfirmarImpressao via _reqModalState.winPreAberta. Em todos os
//      caminhos que NAO terminam imprimindo (erro, cancelamento, sem
//      dentista) a janela e fechada. Novo reqCancelarSeletor() substitui
//      o onclick inline antigo de Cancelar pra fechar a janela tambem.
//   #3 PAGINA EM BRANCO EXTRA: .folha:last-child nao funcionava porque o
//      <script> apos as folhas era o ultimo filho. Trocado pra
//      .folha:last-of-type que ignora outros tipos de elemento.
//
// CHANGELOG v3.3 (2026-05-28) — Etapa 3 do plano de logomarca do dentista:
//   * REQ_DEF ganhou 5 campos novos: logo_x, logo_y, logo_w (largura),
//     logo_h (altura max), logo_mostrar (boolean). Como reqCarregarCalib
//     ja faz Object.assign(REQ_DEF, salvo), instalacoes antigas (sem esses
//     campos no Supabase) ganham os defaults automaticamente.
//   * Novo helper reqLogoUrl(logoPath, cacheBust) constroi URL publica do
//     bucket dentista-logos. Trata data URIs e URLs absolutas (retorna
//     como veio) — usado pelo teste de calibracao com placeholder SVG.
//   * reqBuscarDentista e reqBuscarDentistaPorId agora retornam `logo`
//     (path no bucket). SELECT inclui logo_path. Reusa dCache.logo se cache
//     ja tem (App COR v3.10.7+ popula no map de dents).
//   * reqImprimirComEndereco propaga d.logo pra reqGerarHtml.
//   * reqGerarHtml(dados, c, qtd): se dados.logo + c.logo_mostrar, injeta
//     <img class='logo' src=...> posicionado em mm. style:
//       position:absolute; left/top em mm; width=logo_w em mm; max-height=
//       logo_h em mm; object-fit:contain. Mantem proporcao + nao extrapola.
//   * Tela de calibracao (abrirCalibracaoRequisicao) ganhou secao "🖼️ Logo
//     do dentista" com 4 campos numericos (X, Y, W, H em mm) + checkbox
//     "Mostrar logo do dentista" (logo_mostrar). reqSalvarCalibFromModal
//     e reqImprimirTeste passaram a ler/salvar esses campos.
//   * reqImprimirTeste usa um PLACEHOLDER SVG inline (data URI) como logo —
//     assim a posicao/tamanho podem ser calibrados antes de qualquer
//     dentista ter logo cadastrada. O SVG mostra um retangulo tracejado
//     com a palavra "LOGO" centralizada na area definida.
//
// CHANGELOG v3.4 (2026-05-28):
//   * Tamanho do papel corrigido: era A4 (210x297mm), passou pra 150x250mm
//     (papel pre-impresso real da requisicao COR). @page{size:150mm 250mm}
//     + .folha{width:150mm;height:250mm}. Tudo em mm, entao a calibracao
//     salva continua valida — Vine ja tinha calibrado pra esse papel real.
//     Se a impressora estiver com bandeja A4 configurada, o navegador
//     escala automaticamente; em impressora com bandeja custom 150x250
//     sai 1:1 perfeito.
//
// CHANGELOG v3.5 (2026-05-28):
//   * BUG: calibracao "nao propagava" entre PCs. Causa: _reqCalib (cache
//     em memoria) era populado na primeira chamada e nunca recarregado.
//     Apos voce calibrar num PC, outros PCs com a sessao ja aberta
//     continuavam usando a calibracao antiga em memoria.
//   * FIX: nova reqCarregarCalibFresco() forca refetch do banco.
//     imprimirRequisicao e imprimirRequisicaoPorDentista agora chamam ela
//     em vez de reqCarregarCalib (que mantem cache). Custa 1 query extra
//     por impressao, mas garante consistencia entre PCs.
//   * BONUS: reqCarregarCalib agora loga no console o que veio do banco
//     (pra diagnosticar). E o try/catch silencioso virou toast visivel
//     em caso de erro — antes, qualquer falha caia silenciosa pra REQ_DEF.
// ============================================================================

var REQ_KEY = "requisicao_calib";

var REQ_DEF = {
  x_dent: 18,    y_dent: 109,
  x_cro:  155,   y_cro:  109,
  x_end:  18,    y_end:  129,
  x_tel:  18,    y_tel:  148,
  fonte:  11,
  // ⚡ v3.3 (28/05/2026) — Etapa 3 da logo. Posicao GLOBAL (mesma pra todos
  // os dentistas, ja que a folha pre-impressa e a mesma). Calibravel pela
  // tela de calibracao da requisicao. Defaults conservadores no canto
  // superior esquerdo — a recepcao deve calibrar de acordo com o template
  // pre-impresso real.
  logo_x: 15,    logo_y: 15,
  logo_w: 35,    logo_h: 20,
  logo_mostrar: true
};

// ⚡ NOVO v3.3 (28/05/2026) — Constroi URL publica da logo a partir do path
// guardado em dentistas.logo_path. Bucket dentista-logos e public, entao
// nao precisa de signed URL. Cache-bust por timestamp (pra preview se
// atualizar quando a logo for trocada).
// Se receber uma URL absoluta (http*, data:) retorna como veio — uso pelo
// teste de calibracao com placeholder data URI.
function reqLogoUrl(logoPath, cacheBust) {
  if (!logoPath) return "";
  // Ja e URL absoluta ou data URI? Retorna como veio.
  if (/^(https?:|data:)/i.test(logoPath)) return logoPath;
  // Tenta usar SUPA_URL global do app. Em ambiente isolado (sem global),
  // cai pra URL hardcoded do projeto COR.
  var base = (typeof SUPA_URL === "string" && SUPA_URL)
    ? SUPA_URL
    : "https://flpvzvtbhuyjjdqyrsza.supabase.co";
  var url = base + "/storage/v1/object/public/dentista-logos/" + encodeURIComponent(logoPath);
  if (cacheBust) url += "?t=" + Date.now();
  return url;
}

var _reqCalib = null;

// ----------------------------------------------------------------------------
// Calibração (configuracoes / Supabase)
// ----------------------------------------------------------------------------

async function reqCarregarCalib(forcar) {
  if (_reqCalib && !forcar) return _reqCalib;
  // ⚡ v3.5 (28/05/2026) — log do que veio do banco pra diagnosticar
  // casos onde a calibracao "nao propaga" entre PCs. Antes, qualquer
  // erro na query era silenciado por try/catch → app usava REQ_DEF sem
  // avisar ninguem (calibracao "antiga"/default mesmo apos teu save).
  // Agora log explicito e toast em caso de fallback.
  try {
    var r = await supa.from("configuracoes").select("valor").eq("chave", REQ_KEY).maybeSingle();
    if (r.error) {
      console.error("[req] reqCarregarCalib: erro do banco:", r.error);
      if (typeof toast === "function") toast("⚠️", "Erro ao ler calibração (usando padrão). Veja console.");
      _reqCalib = Object.assign({}, REQ_DEF);
    } else if (!r.data || !r.data.valor) {
      console.warn("[req] reqCarregarCalib: nenhuma calibracao no banco, usando padrao REQ_DEF.");
      _reqCalib = Object.assign({}, REQ_DEF);
    } else {
      console.log("[req] reqCarregarCalib: calibracao carregada do banco:", r.data.valor);
      _reqCalib = Object.assign({}, REQ_DEF, r.data.valor);
    }
  } catch (e) {
    console.error("[req] reqCarregarCalib: exception:", e);
    if (typeof toast === "function") toast("⚠️", "Erro ao ler calibração (usando padrão). Veja console.");
    _reqCalib = Object.assign({}, REQ_DEF);
  }
  return _reqCalib;
}

// ⚡ NOVO v3.5 (28/05/2026) — Sempre busca fresco do banco antes de imprimir.
// Caso: voce calibra num PC, outros PCs ja tem _reqCalib cacheado em memoria
// (populado na primeira impressao da sessao) e nao busca de novo, entao
// imprimem com calibracao antiga. Agora toda impressao chama esta funcao,
// que ignora o cache e busca o valor atual. O cache (_reqCalib) ainda vale
// pra preview/tela de calibracao — so a impressao real e sempre fresca.
async function reqCarregarCalibFresco() {
  return reqCarregarCalib(true);
}

async function reqSalvarCalib(novo) {
  var valor = Object.assign({}, REQ_DEF, _reqCalib || {}, novo);
  var r = await supa.from("configuracoes").upsert({
    chave: REQ_KEY,
    valor: valor,
    updated_at: new Date().toISOString()
  }, { onConflict: "chave" });
  if (r.error) {
    console.error("[req] erro ao salvar calib:", r.error);
    if (typeof toast === "function") toast("⚠️", "Erro ao salvar calibração.");
    throw r.error;
  }
  _reqCalib = valor;
  return valor;
}

// ----------------------------------------------------------------------------
// Buscar dentista + endereços
// ----------------------------------------------------------------------------

async function reqBuscarDentista(agId) {
  var ag = ags.find(function(x){ return x.id === agId; });
  var dentId = ag && ag.dId;

  if (!dentId) {
    var rAg = await supa.from("agendamentos").select("dentista_id").eq("id", agId).single();
    if (rAg.error || !rAg.data || !rAg.data.dentista_id) {
      throw new Error("Agendamento sem dentista indicado.");
    }
    dentId = rAg.data.dentista_id;
  }

  // Cache local (dents) tem nome/cro/telefone (e logo a partir de v3.10.7)
  var dCache = fdent(dentId);

  // Busca completa (caso cache não tenha)
  // ⚡ v3.3 (28/05/2026) — SELECT inclui logo_path pra Etapa 3 da logo.
  var rD = !dCache
    ? await supa.from("dentistas").select("nome, cro, telefone, logo_path").eq("id", dentId).single()
    : null;

  // Sempre busca todos os endereços
  var rE = await supa.from("dentista_enderecos")
    .select("id, descricao, endereco, complemento, bairro, cidade, cep, principal")
    .eq("dentista_id", dentId)
    .order("principal", { ascending: false })
    .order("id", { ascending: true });

  // ⚡ FIX v3 (28/05/2026) — tratar erro da query. Antes, rE.error era
  // ignorado e rE.data||[] virava lista vazia → o codigo tratava como
  // "dentista sem endereco" e imprimia errado (sem endereco) numa falha
  // de rede/RLS. Agora lanca erro pra o usuario saber que algo falhou.
  if (rE.error) {
    console.error("[req] erro ao buscar enderecos:", rE.error);
    throw new Error("Falha ao buscar endereços do dentista: " + (rE.error.message || "erro desconhecido"));
  }

  // Idem para a busca completa do dentista (quando cache nao tem)
  if (rD && rD.error) {
    console.error("[req] erro ao buscar dentista:", rD.error);
    throw new Error("Falha ao buscar dados do dentista: " + (rD.error.message || "erro desconhecido"));
  }

  return {
    dentId: dentId,
    nome: dCache ? dCache.n : (rD.data && rD.data.nome) || "",
    cro:  dCache ? dCache.cro : (rD.data && rD.data.cro) || "",
    telefone: dCache ? dCache.tel : (rD.data && rD.data.telefone) || "",
    // ⚡ v3.3 (28/05/2026) — logo path do bucket dentista-logos (ou "").
    logo: dCache ? (dCache.logo || "") : ((rD.data && rD.data.logo_path) || ""),
    enderecos: rE.data || []
  };
}

function reqFormatarEnd(e) {
  var l1 = [e.endereco, e.complemento].filter(Boolean).join(", ");
  var l2 = [e.bairro, e.cidade].filter(Boolean).join(" - ");
  return [l1, l2].filter(Boolean).join(" - ");
}

// ----------------------------------------------------------------------------
// HTML da requisição
// ----------------------------------------------------------------------------

function reqGerarHtml(dados, c, qtd) {
  // ⚡ v3.1 (28/05/2026) — quantidade de folhas (padrao 1). Cada folha gera
  // um <div class='folha'> com page-break entre eles, e o navegador imprime
  // tudo numa unica chamada window.print(). Folhas sao identicas (mesmo
  // dentista, mesmo endereco) — uso tipico: pre-imprimir um bloco de
  // requisicoes pro dentista levar pro consultorio.
  qtd = Math.max(1, Math.min(50, parseInt(qtd, 10) || 1));

  // ⚡ v3.3 (28/05/2026) — Etapa 3 da logo. Gera <img> posicionado em mm
  // se: (a) o dentista tem logo (dados.logo), (b) calib.logo_mostrar = true.
  // Tamanho via width:Wmm e height:auto (mantem proporcao por padrao). Se
  // logo_h estiver explicitamente setado, usa como max-height pra nao
  // extrapolar a area calibrada — assim a logo cabe na caixa
  // logo_w x logo_h sem deformar.
  var logoHtml = "";
  if (dados.logo && c.logo_mostrar !== false) {
    var logoSrc = reqLogoUrl(dados.logo); // URL publica do bucket
    logoHtml =
      "<img class='logo' src='" + esc(logoSrc) + "' alt='logo' " +
        "style='position:absolute;left:" + c.logo_x + "mm;top:" + c.logo_y + "mm;" +
              "width:" + c.logo_w + "mm;max-height:" + c.logo_h + "mm;" +
              "object-fit:contain'>";
  }

  var folha =
    "<div class='folha'>" +
      logoHtml +
      "<div class='campo' style='left:" + c.x_dent + "mm;top:" + c.y_dent + "mm'>" + esc(dados.nome) + "</div>" +
      "<div class='campo' style='left:" + c.x_cro  + "mm;top:" + c.y_cro  + "mm'>" + esc(dados.cro) + "</div>" +
      "<div class='campo' style='left:" + c.x_end  + "mm;top:" + c.y_end  + "mm'>" + esc(dados.endereco) + "</div>" +
      (dados.telefone
        ? "<div class='campo' style='left:" + c.x_tel + "mm;top:" + c.y_tel + "mm'>" + esc(dados.telefone) + "</div>"
        : "") +
    "</div>";

  var folhas = "";
  for (var i = 0; i < qtd; i++) folhas += folha;

  return "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>" +
    "<title>Requisição</title>" +
    "<style>" +
    // ⚡ v3.4 (28/05/2026) — Papel pre-impresso COR e 150x250mm (nao A4).
    // size define o tamanho fisico da pagina no print do navegador. Antes
    // estava A4 (210x297), o que fazia a impressao em folha A4 ficar com
    // tudo num canto. Agora o navegador entende que a pagina e 150x250 e
    // ajusta a impressao (em impressoras com bandeja de tamanho custom).
    // Se a impressora estiver configurada pra A4, o navegador escala — em
    // todo caso, a calibracao em mm permanece valida.
    "@page{size:150mm 250mm;margin:0}" +
    "*{box-sizing:border-box;margin:0;padding:0}" +
    "body{font-family:Arial,sans-serif}" +
    // ⚡ v3.4 (28/05/2026) — folha 150x250mm (papel pre-impresso COR)
    ".folha{position:relative;width:150mm;height:250mm;page-break-after:always}" +
    // ⚡ FIX v3.2 #3 (28/05/2026) — last-of-type em vez de last-child.
    // Antes, o <script> apos as folhas fazia a ultima folha NAO ser
    // last-child (o script era), entao a regra nao aplicava e saia uma
    // pagina em branco extra ao imprimir varias folhas. last-of-type
    // ignora outros tipos de elemento (script, etc) e pega so a ultima
    // folha de fato.
    ".folha:last-of-type{page-break-after:auto}" +
    ".campo{position:absolute;font-size:" + c.fonte + "pt;color:#000;white-space:nowrap;overflow:hidden}" +
    "@media print{.folha{box-shadow:none}}" +
    "</style></head><body>" +
    folhas +
    // ⚡ FIX v3 (28/05/2026) — nao chamar print() direto no onload.
    // Aguarda TODAS as imagens da pagina decodificarem antes de imprimir
    // (img.decode() / complete). Sem isso, quando houver logo do dentista
    // (Etapa 3), a imagem poderia sair em branco no print. Com folha so-texto
    // (sem <img>), o Promise.all resolve na hora. Timeout de seguranca de 3s
    // garante que nunca trava se uma imagem falhar.
    "<script>(function(){" +
      "function go(){ try{ window.focus(); }catch(e){} window.print(); }" +
      "function ready(){" +
        "var imgs = Array.prototype.slice.call(document.images || []);" +
        "if(!imgs.length){ go(); return; }" +
        "var ps = imgs.map(function(im){" +
          "if(im.complete && im.naturalWidth>0) return Promise.resolve();" +
          "if(im.decode){ return im.decode().catch(function(){}); }" +
          "return new Promise(function(res){ im.onload=res; im.onerror=res; });" +
        "});" +
        "var done=false; function fire(){ if(done) return; done=true; go(); }" +
        "Promise.all(ps).then(fire);" +
        "setTimeout(fire, 3000);" + // timeout de seguranca
      "}" +
      "if(document.readyState==='complete'){ ready(); }" +
      "else{ window.addEventListener('load', ready); }" +
    "})();<\/script>" +
    "</body></html>";
}

// ⚡ NOVO v3.2 #2 (28/05/2026) — Abertura da janela ja no gesto do clique
// pra evitar bloqueio de pop-up. Apos awaits (carregar calib + buscar
// dentista + buscar enderecos), o navegador pode considerar que o gesto
// do clique se perdeu e bloquear o window.open. Solucao: chamadores
// abrem a aba IMEDIATAMENTE no handler do click (synchronous), com
// loading visivel, e passam essa janela pra reqAbrirImpressao quando
// os dados chegam.
function reqAbrirJanelaComLoading() {
  var w = window.open("", "_blank");
  if (!w) return null;
  try {
    w.document.open();
    w.document.write(
      "<!DOCTYPE html><html lang='pt-BR'><head><meta charset='UTF-8'>" +
      "<title>Carregando requisição...</title>" +
      "<style>" +
        "body{margin:0;font-family:Arial,sans-serif;background:#f7f7f7;color:#444;" +
            "display:flex;flex-direction:column;align-items:center;justify-content:center;" +
            "min-height:100vh;text-align:center;padding:20px}" +
        ".sp{width:38px;height:38px;border:3px solid #ddd;border-top-color:#4ade80;" +
            "border-radius:50%;animation:r 0.9s linear infinite;margin-bottom:14px}" +
        "@keyframes r{to{transform:rotate(360deg)}}" +
        "h3{font-size:1rem;margin:0 0 4px;font-weight:600}" +
        "p{font-size:.85rem;color:#888;margin:0}" +
      "</style></head><body>" +
      "<div class='sp'></div>" +
      "<h3>Preparando requisição…</h3>" +
      "<p>Buscando dados do dentista. Aguarde.</p>" +
      "</body></html>"
    );
    w.document.close();
  } catch (e) { /* janela pode ter sido fechada — ignora */ }
  return w;
}

function reqAbrirImpressao(html, winPreAberta) {
  // Se quem chamou ja abriu uma janela no gesto do clique (forma segura),
  // reusa ela. Senao, tenta abrir agora (forma legada — pode ser bloqueada).
  var win = winPreAberta || window.open("", "_blank");
  if (!win) {
    if (typeof toast === "function") toast("⚠️", "Bloqueio de pop-up. Permite janelas pra imprimir.");
    return;
  }
  try {
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (e) {
    console.error("[req] erro ao escrever na janela:", e);
    if (typeof toast === "function") toast("⚠️", "Erro ao gerar requisicao.");
  }
}

// ----------------------------------------------------------------------------
// Marcar endereço como principal (atomico: desmarca outros, marca o escolhido)
// ----------------------------------------------------------------------------

async function reqMarcarPrincipal(dentId, endId) {
  // Desmarca todos os outros
  var r1 = await supa.from("dentista_enderecos")
    .update({ principal: false })
    .eq("dentista_id", dentId)
    .neq("id", endId);
  if (r1.error) {
    console.error("[req] desmarcar:", r1.error);
    throw r1.error;
  }
  // Marca o escolhido
  var r2 = await supa.from("dentista_enderecos")
    .update({ principal: true })
    .eq("id", endId);
  if (r2.error) {
    console.error("[req] marcar:", r2.error);
    throw r2.error;
  }
}

// ============================================================================
// PÚBLICO 1: Imprimir requisição
// ============================================================================

async function imprimirRequisicao(agId, qtd) {
  // ⚡ v3.1 (28/05/2026) — qtd opcional (padrao 1). Mantem retrocompat com
  // chamadas antigas que so passam agId.
  // ⚡ v3.5 (28/05/2026) — usa reqCarregarCalibFresco pra sempre pegar a
  // calibracao mais recente do banco (evita cache desatualizado entre PCs).
  try {
    var calib = await reqCarregarCalibFresco();
    var d = await reqBuscarDentista(agId);

    if (!d.nome) {
      if (typeof toast === "function") toast("⚠️", "Dentista sem nome cadastrado.");
      return;
    }

    // Sem endereços
    if (!d.enderecos.length) {
      if (!confirm('Dentista "' + d.nome + '" não tem endereço cadastrado.\nImprimir mesmo assim?')) return;
      reqImprimirComEndereco(d, "", calib, qtd);
      return;
    }

    // 1 endereço só → direto
    if (d.enderecos.length === 1) {
      reqImprimirComEndereco(d, reqFormatarEnd(d.enderecos[0]), calib, qtd);
      return;
    }

    // 2+ endereços → seletor
    abrirSeletorEndereco(d, calib, qtd);

  } catch (e) {
    console.error("[req] erro:", e);
    if (typeof toast === "function") toast("⚠️", "Falha: " + (e.message || e));
    else alert("Falha: " + (e.message || e));
  }
}

// ============================================================================
// PÚBLICO 3 (v3.1): Imprimir requisição direto pelo cadastro do dentista
// ============================================================================
// Diferente de imprimirRequisicao(agId): nao depende de agendamento.
// Usado pelo modal de edicao do dentista no App COR — pra pre-imprimir
// um bloco de requisicoes que o dentista leva pro consultorio.

async function imprimirRequisicaoPorDentista(dentId, qtd, winPreAberta) {
  // ⚡ v3.2 #2 (28/05/2026) — winPreAberta: janela aberta no gesto do
  // clique (no chamador), passada pra ca pra ser preenchida quando os
  // dados chegarem. Sem isso, o navegador pode bloquear window.open
  // depois dos awaits abaixo. Fechamos a janela em todos os caminhos
  // que NAO terminam imprimindo (erro, cancelamento, dentista invalido).
  function fechaJanela(){
    if (winPreAberta) { try { winPreAberta.close(); } catch(_){} }
  }

  if (!dentId) {
    if (typeof toast === "function") toast("⚠️", "ID do dentista invalido.");
    fechaJanela();
    return;
  }
  try {
    // ⚡ v3.5 (28/05/2026) — calibracao fresca a cada impressao
    var calib = await reqCarregarCalibFresco();
    var d = await reqBuscarDentistaPorId(dentId);

    if (!d.nome) {
      if (typeof toast === "function") toast("⚠️", "Dentista sem nome cadastrado.");
      fechaJanela();
      return;
    }

    if (!d.enderecos.length) {
      if (!confirm('Dentista "' + d.nome + '" não tem endereço cadastrado.\nImprimir mesmo assim?')) {
        fechaJanela();
        return;
      }
      reqImprimirComEndereco(d, "", calib, qtd, winPreAberta);
      return;
    }

    if (d.enderecos.length === 1) {
      reqImprimirComEndereco(d, reqFormatarEnd(d.enderecos[0]), calib, qtd, winPreAberta);
      return;
    }

    abrirSeletorEndereco(d, calib, qtd, winPreAberta);

  } catch (e) {
    console.error("[req] erro (por dentista):", e);
    if (typeof toast === "function") toast("⚠️", "Falha: " + (e.message || e));
    else alert("Falha: " + (e.message || e));
    fechaJanela();
  }
}

// Versao de reqBuscarDentista que recebe o dentId direto (sem agendamento).
// Reusa a mesma logica de cache (fdent) + busca completa + enderecos.
async function reqBuscarDentistaPorId(dentId) {
  // Cache local (dents) tem nome/cro/telefone (e logo a partir de v3.10.7)
  var dCache = (typeof fdent === "function") ? fdent(dentId) : null;

  // Busca completa (caso cache nao tenha)
  // ⚡ v3.3 (28/05/2026) — SELECT inclui logo_path pra Etapa 3 da logo.
  var rD = !dCache
    ? await supa.from("dentistas").select("nome, cro, telefone, logo_path").eq("id", dentId).single()
    : null;
  if (rD && rD.error) {
    console.error("[req] erro ao buscar dentista:", rD.error);
    throw new Error("Falha ao buscar dados do dentista: " + (rD.error.message || "erro desconhecido"));
  }

  var rE = await supa.from("dentista_enderecos")
    .select("id, descricao, endereco, complemento, bairro, cidade, cep, principal")
    .eq("dentista_id", dentId)
    .order("principal", { ascending: false })
    .order("id", { ascending: true });
  if (rE.error) {
    console.error("[req] erro ao buscar enderecos:", rE.error);
    throw new Error("Falha ao buscar endereços do dentista: " + (rE.error.message || "erro desconhecido"));
  }

  return {
    dentId: dentId,
    nome: dCache ? dCache.n : (rD.data && rD.data.nome) || "",
    cro:  dCache ? dCache.cro : (rD.data && rD.data.cro) || "",
    telefone: dCache ? dCache.tel : (rD.data && rD.data.telefone) || "",
    // ⚡ v3.3 (28/05/2026) — logo path do bucket dentista-logos (ou "").
    logo: dCache ? (dCache.logo || "") : ((rD.data && rD.data.logo_path) || ""),
    enderecos: rE.data || []
  };
}

function reqImprimirComEndereco(d, enderecoStr, calib, qtd, winPreAberta) {
  // ⚡ v3.1 (28/05/2026) — qtd opcional (padrao 1). Passa pra reqGerarHtml
  // que monta N folhas no mesmo HTML, com page-break entre elas.
  // ⚡ v3.2 #2 (28/05/2026) — winPreAberta opcional pra evitar pop-up block.
  // ⚡ v3.3 (28/05/2026) — logo (path) propagado pra reqGerarHtml; quando
  // presente e calib.logo_mostrar=true, gera <img> posicionado.
  var nFolhas = Math.max(1, Math.min(50, parseInt(qtd, 10) || 1));
  var html = reqGerarHtml({
    nome: d.nome,
    cro: d.cro,
    endereco: enderecoStr,
    telefone: d.telefone,
    logo: d.logo || ""
  }, calib, nFolhas);
  reqAbrirImpressao(html, winPreAberta);
  if (typeof toast === "function") {
    toast("🖨️", nFolhas > 1 ? "Requisição enviada (" + nFolhas + " folhas)." : "Requisição enviada.");
  }
}

// ----------------------------------------------------------------------------
// Modal seletor de endereço
// ----------------------------------------------------------------------------

function abrirSeletorEndereco(d, calib, qtd, winPreAberta) {
  var ant = document.getElementById("modal-sel-end");
  if (ant) ant.remove();

  // Endereço pré-selecionado: principal, ou primeiro
  var preId = (d.enderecos.find(function(e){ return e.principal; }) || d.enderecos[0]).id;

  var m = document.createElement("div");
  m.id = "modal-sel-end";

  var cards = d.enderecos.map(function(e){
    var label = e.descricao || ("Endereço #" + e.id);
    var endLinha = reqFormatarEnd(e);
    var isPrincipal = !!e.principal;
    return "<div class='card-end" + (e.id === preId ? " sel" : "") + "' data-id='" + e.id + "' onclick='reqSelEndereco(" + e.id + ")'>" +
      "<div class='lbl'>" +
        "<input type='radio' name='end-radio' " + (e.id === preId ? "checked" : "") + ">" +
        "<strong>" + esc(label) + "</strong>" +
        (isPrincipal ? "<span class='star' title='Endereço principal'>⭐</span>" : "") +
      "</div>" +
      "<div class='end'>" + esc(endLinha) + "</div>" +
      (e.cep ? "<div class='cep'>CEP: " + esc(e.cep) + "</div>" : "") +
    "</div>";
  }).join("");

  m.innerHTML =
    "<style>" +
    "#modal-sel-end{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px}" +
    "#modal-sel-end .box{background:var(--bg,#1a1d24);color:var(--wh,#fff);padding:18px;border-radius:10px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;border:1px solid rgba(255,255,255,.08)}" +
    "#modal-sel-end h3{font-size:1rem;margin-bottom:4px}" +
    "#modal-sel-end .sub{font-size:.78rem;color:var(--gr,#9aa);margin-bottom:14px}" +
    "#modal-sel-end .card-end{background:rgba(255,255,255,.03);border:1.5px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:all .12s}" +
    "#modal-sel-end .card-end:hover{border-color:#4ade80;background:rgba(74,222,128,.05)}" +
    "#modal-sel-end .card-end.sel{border-color:#4ade80;background:rgba(74,222,128,.08)}" +
    "#modal-sel-end .lbl{display:flex;align-items:center;gap:8px;margin-bottom:4px}" +
    "#modal-sel-end .lbl strong{font-size:.88rem}" +
    "#modal-sel-end .star{font-size:.85rem}" +
    "#modal-sel-end .end{font-size:.78rem;color:var(--gr,#aab);line-height:1.4}" +
    "#modal-sel-end .cep{font-size:.72rem;color:var(--gr,#9aa);margin-top:2px;font-family:DM Mono,monospace}" +
    "#modal-sel-end .ac{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap}" +
    "#modal-sel-end .ac .esq{display:flex;gap:6px;flex-wrap:wrap}" +
    "#modal-sel-end .ac .dir{display:flex;gap:6px;flex-wrap:wrap}" +
    "</style>" +
    "<div class='box'>" +
      "<h3>📍 Escolher endereço</h3>" +
      "<div class='sub'>" + esc(d.nome) + " tem " + d.enderecos.length + " endereços. Selecione qual usar:</div>" +
      "<div id='lista-ends'>" + cards + "</div>" +
      "<div class='ac'>" +
        "<div class='esq'>" +
          "<button class='btn btnt bsm' onclick='reqDefinirComoPrincipal()'>⭐ Tornar principal</button>" +
        "</div>" +
        "<div class='dir'>" +
          // ⚡ v3.2 #2 — botao Cancelar agora usa reqCancelarSeletor() que
          // tambem fecha a janela de loading aberta antecipadamente.
          "<button class='btn bsm' onclick='reqCancelarSeletor()'>Cancelar</button>" +
          "<button class='btn btng bsm' onclick='reqConfirmarImpressao()'>🖨️ Imprimir</button>" +
        "</div>" +
      "</div>" +
    "</div>";

  document.body.appendChild(m);

  // Estado do modal (acessado pelas funções globais abaixo)
  // ⚡ v3.1 — qtd preservada pra reqConfirmarImpressao usar quando o usuario
  // confirmar o endereco escolhido.
  // ⚡ v3.2 #2 — winPreAberta tambem preservada pra ser fechada no cancelar.
  window._reqModalState = { dentista: d, calib: calib, selecionadoId: preId, qtd: qtd, winPreAberta: winPreAberta };
}

function reqCancelarSeletor() {
  // ⚡ NOVO v3.2 #2 — fecha o modal E a janela de loading (se houver).
  var m = document.getElementById("modal-sel-end");
  if (m) m.remove();
  var st = window._reqModalState;
  if (st && st.winPreAberta) {
    try { st.winPreAberta.close(); } catch(_){}
  }
  window._reqModalState = null;
}

function reqSelEndereco(id) {
  var st = window._reqModalState;
  if (!st) return;
  st.selecionadoId = id;
  // Atualiza visual
  document.querySelectorAll("#modal-sel-end .card-end").forEach(function(c){
    var on = parseInt(c.getAttribute("data-id")) === id;
    c.classList.toggle("sel", on);
    var radio = c.querySelector("input[type=radio]");
    if (radio) radio.checked = on;
  });
}

function reqConfirmarImpressao() {
  var st = window._reqModalState;
  if (!st) return;
  var end = st.dentista.enderecos.find(function(e){ return e.id === st.selecionadoId; });
  if (!end) return;
  document.getElementById("modal-sel-end").remove();
  reqImprimirComEndereco(st.dentista, reqFormatarEnd(end), st.calib, st.qtd, st.winPreAberta);
}

async function reqDefinirComoPrincipal() {
  var st = window._reqModalState;
  if (!st) return;
  var end = st.dentista.enderecos.find(function(e){ return e.id === st.selecionadoId; });
  if (!end) return;
  if (end.principal) {
    if (typeof toast === "function") toast("⭐", "Já é o principal.");
    return;
  }
  try {
    await reqMarcarPrincipal(st.dentista.dentId, end.id);
    // Atualiza estado em memória
    st.dentista.enderecos.forEach(function(e){ e.principal = (e.id === end.id); });
    if (typeof toast === "function") toast("⭐", "Marcado como principal.");
    // Reabre o modal pra refletir a estrelinha (preservando qtd e janela)
    abrirSeletorEndereco(st.dentista, st.calib, st.qtd, st.winPreAberta);
  } catch (e) {
    if (typeof toast === "function") toast("⚠️", "Erro: " + e.message);
  }
}

// ============================================================================
// PÚBLICO 2: Tela de calibração
// ============================================================================

async function abrirCalibracaoRequisicao() {
  var c = await reqCarregarCalib();
  var ant = document.getElementById("modal-calib-req");
  if (ant) ant.remove();

  var m = document.createElement("div");
  m.id = "modal-calib-req";
  m.innerHTML =
    "<style>" +
    "#modal-calib-req{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px}" +
    "#modal-calib-req .box{background:var(--bg,#1a1d24);color:var(--wh,#fff);padding:20px;border-radius:10px;max-width:760px;width:100%;max-height:90vh;overflow-y:auto;border:1px solid rgba(255,255,255,.08)}" +
    "#modal-calib-req h3{margin-bottom:10px;font-size:1rem}" +
    "#modal-calib-req .av{background:rgba(240,180,0,.08);border-left:3px solid #f0b500;padding:8px 10px;font-size:.8rem;color:#f0c040;margin-bottom:14px;border-radius:4px;line-height:1.5}" +
    "#modal-calib-req .gd{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}" +
    "#modal-calib-req label{font-size:.72rem;color:var(--gr,#9aa);display:flex;flex-direction:column;gap:3px;text-transform:uppercase;font-weight:600}" +
    "#modal-calib-req input[type=number]{padding:6px 8px;font-size:.85rem;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--wh,#fff);border-radius:5px}" +
    "#modal-calib-req .ac{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}" +
    "@media(max-width:600px){#modal-calib-req .gd{grid-template-columns:repeat(2,1fr)}}" +
    "</style>" +
    "<div class='box'>" +
      "<h3>📐 Calibração da Requisição</h3>" +
      "<div class='av'><strong>Como calibrar:</strong> clica em <em>🖨️ Imprimir teste</em> em folha branca, sobrepõe na requisição contra a luz, ajusta os mm pra direita/esquerda (X) ou baixo/cima (Y), reimprime até alinhar. Depois <em>💾 Salvar</em>.</div>" +
      "<div class='gd'>" +
        cInput("x_dent", "Dentista X (mm)", c.x_dent) +
        cInput("y_dent", "Dentista Y (mm)", c.y_dent) +
        cInput("x_cro",  "CRO X (mm)",      c.x_cro)  +
        cInput("y_cro",  "CRO Y (mm)",      c.y_cro)  +
        cInput("x_end",  "Endereço X (mm)", c.x_end)  +
        cInput("y_end",  "Endereço Y (mm)", c.y_end)  +
        cInput("x_tel",  "Telefone X (mm)", c.x_tel)  +
        cInput("y_tel",  "Telefone Y (mm)", c.y_tel)  +
        cInput("fonte",  "Fonte (pt)",      c.fonte)  +
      "</div>" +
      // ⚡ v3.3 (28/05/2026) — Etapa 3: secao de calibracao da LOGO.
      "<div style='border-top:1px solid rgba(255,255,255,.08);margin-top:6px;padding-top:14px'>" +
        "<div style='display:flex;align-items:center;gap:14px;margin-bottom:10px;flex-wrap:wrap'>" +
          "<label style='font-size:.85rem;color:var(--wh,#fff);text-transform:none;font-weight:600;flex-direction:row;align-items:center;cursor:pointer;gap:8px'>" +
            "<input type='checkbox' id='ck-logo_mostrar' " + (c.logo_mostrar !== false ? "checked" : "") + " style='width:auto;margin:0'>" +
            "🖼️ Mostrar logo do dentista" +
          "</label>" +
          "<span style='font-size:.7rem;color:var(--gr,#9aa)'>(quando o dentista tem logo cadastrada)</span>" +
        "</div>" +
        "<div class='gd'>" +
          cInput("logo_x", "Logo X (mm)",          c.logo_x) +
          cInput("logo_y", "Logo Y (mm)",          c.logo_y) +
          cInput("logo_w", "Largura (mm)",         c.logo_w) +
          cInput("logo_h", "Altura max (mm)",      c.logo_h) +
        "</div>" +
        "<div style='font-size:.7rem;color:var(--gr,#9aa);line-height:1.4;margin-top:4px'>" +
          "Largura controla o tamanho. Altura max impede que a logo extrapole a area definida. " +
          "Proporcao da imagem original e preservada (object-fit: contain)." +
        "</div>" +
      "</div>" +
      "<div class='ac'>" +
        "<button class='btn btnt bsm' onclick='reqImprimirTeste()'>🖨️ Imprimir teste</button>" +
        "<button class='btn bsm' onclick='document.getElementById(\"modal-calib-req\").remove()'>Cancelar</button>" +
        "<button class='btn btng bsm' onclick='reqSalvarCalibFromModal()'>💾 Salvar</button>" +
      "</div>" +
    "</div>";

  document.body.appendChild(m);

  function cInput(id, lbl, val) {
    return "<label>" + lbl +
      "<input type='number' id='ck-" + id + "' value='" + val + "' step='0.5'></label>";
  }
}

// ⚡ FIX v3 (28/05/2026) — leitura segura de campo numerico da calibracao.
// Antes usava parseFloat direto: campo vazio → NaN → salvava NaN no Supabase
// e a impressao saia com left:NaNmm. Agora cai pro valor atual (_reqCalib)
// e, se nao houver, pro padrao (REQ_DEF).
function reqLerNum(id) {
  var el = document.getElementById("ck-" + id);
  var n = el ? parseFloat(el.value) : NaN;
  if (isFinite(n)) return n;
  // fallback: valor atual salvo > padrao
  var atual = (_reqCalib && isFinite(_reqCalib[id])) ? _reqCalib[id] : REQ_DEF[id];
  return atual;
}

async function reqSalvarCalibFromModal() {
  try {
    // ⚡ v3.3 (28/05/2026) — checkbox logo_mostrar lido separado
    var chkMostrar = document.getElementById("ck-logo_mostrar");
    await reqSalvarCalib({
      x_dent: reqLerNum("x_dent"), y_dent: reqLerNum("y_dent"),
      x_cro:  reqLerNum("x_cro"),  y_cro:  reqLerNum("y_cro"),
      x_end:  reqLerNum("x_end"),  y_end:  reqLerNum("y_end"),
      x_tel:  reqLerNum("x_tel"),  y_tel:  reqLerNum("y_tel"),
      fonte:  reqLerNum("fonte"),
      logo_x: reqLerNum("logo_x"), logo_y: reqLerNum("logo_y"),
      logo_w: reqLerNum("logo_w"), logo_h: reqLerNum("logo_h"),
      logo_mostrar: chkMostrar ? !!chkMostrar.checked : true
    });
    var m = document.getElementById("modal-calib-req");
    if (m) m.remove();
    if (typeof toast === "function") toast("💾", "Calibração salva!");
  } catch (e) {
    alert("Erro ao salvar: " + e.message);
  }
}

function reqImprimirTeste() {
  // ⚡ v3.3 (28/05/2026) — leitura inclui campos da logo, e usa um
  // PLACEHOLDER inline (data URI) pra logo no teste — assim a posicao/
  // tamanho podem ser calibrados antes de qualquer dentista ter logo.
  // O placeholder e um SVG simples (renderizado pelo navegador) que
  // mostra a area calibrada com "LOGO" escrito.
  var chkMostrar = document.getElementById("ck-logo_mostrar");
  var calib = {
    x_dent: reqLerNum("x_dent"), y_dent: reqLerNum("y_dent"),
    x_cro:  reqLerNum("x_cro"),  y_cro:  reqLerNum("y_cro"),
    x_end:  reqLerNum("x_end"),  y_end:  reqLerNum("y_end"),
    x_tel:  reqLerNum("x_tel"),  y_tel:  reqLerNum("y_tel"),
    fonte:  reqLerNum("fonte"),
    logo_x: reqLerNum("logo_x"), logo_y: reqLerNum("logo_y"),
    logo_w: reqLerNum("logo_w"), logo_h: reqLerNum("logo_h"),
    logo_mostrar: chkMostrar ? !!chkMostrar.checked : true
  };
  // SVG placeholder pra teste de logo (sem precisar de upload real)
  var logoPlaceholder = "data:image/svg+xml;utf8," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 100'>" +
      "<rect x='2' y='2' width='196' height='96' fill='none' stroke='#000' stroke-width='1' stroke-dasharray='4,2'/>" +
      "<text x='100' y='58' text-anchor='middle' font-family='Arial' font-size='28' font-weight='bold' fill='#000'>LOGO</text>" +
    "</svg>"
  );
  reqAbrirImpressao(reqGerarHtml({
    nome: "Dr. TESTE DE CALIBRAÇÃO",
    cro:  "CRO-RS 99999",
    endereco: "Rua de Teste, 999 - Bairro Teste - Santa Maria",
    telefone: "(55) 99999-9999",
    logo: logoPlaceholder // passa data URI direto; reqLogoUrl nao trata isso
  }, calib));
}
