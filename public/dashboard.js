const conteudo = document.getElementById("conteudo");
const relogioEl = document.getElementById("relogio");
const subtituloEl = document.getElementById("subtitulo-cidade");
const ultimaAtualizacaoEl = document.getElementById("ultima-atualizacao");
const seletorBaseEl = document.getElementById("seletor-base");

const overlaySenha = document.getElementById("overlay-senha");
const inputSenha = document.getElementById("input-senha");
const modalMensagem = document.getElementById("modal-mensagem");
const botaoConfig = document.getElementById("botao-config");
const botaoCancelar = document.getElementById("botao-cancelar");
const botaoConfirmar = document.getElementById("botao-confirmar");
const toastEl = document.getElementById("toast");

const REFRESH_MS = 10 * 60 * 1000; // 10 minutos

let cidadeAtivaChave = null; // preenchido após o primeiro /api/preview

async function carregarLogos() {
  try {
    const resp = await fetch("/api/logos");
    const dados = await resp.json();
    if (!dados.ok) return;

    const logoCim = document.getElementById("logo-cim");
    if (dados.cim) {
      logoCim.src = dados.cim;
      logoCim.classList.remove("oculto");
    }

    const logoPetrobrasCard = document.getElementById("logo-petrobras-card");
    if (dados.petrobras) {
      document.getElementById("logo-petrobras").src = dados.petrobras;
      logoPetrobrasCard.classList.remove("oculto");
    }
  } catch (erro) {
    // Sem logo cadastrado ainda (pasta Logo/ vazia) — painel segue normal, só sem as imagens.
  }
}
carregarLogos();

function atualizarRelogio() {
  const agora = new Date();
  relogioEl.textContent = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
setInterval(atualizarRelogio, 1000);
atualizarRelogio();

function nivelEvento(evento) {
  if (!evento) return "baixo";
  if (evento.nivel >= 4) return "alto";
  if (evento.nivel >= 2) return "medio";
  return "baixo";
}

// Cores das faixas do índice UV, seguindo a convenção visual da OMS
// (verde/amarelo/laranja/vermelho/violeta).
function corUv(categoria) {
  switch (categoria) {
    case "extremo": return "#8E44AD";
    case "muito_alto": return "#E74C3C";
    case "alto": return "#F39C12";
    case "moderado": return "#F1C40F";
    default: return "#2ECC71";
  }
}

function corSeveridade(severidade = "") {
  const s = severidade.toLowerCase();
  if (s.includes("grande perigo")) return "#7B241C";
  if (s.includes("perigo")) return "#E74C3C";
  if (s.includes("atenção") || s.includes("atencao")) return "#F39C12";
  return "#00843D";
}

function renderPainel(report) {
  subtituloEl.textContent = `${report.cidade.nome} — ${report.cidade.uf} · ${report.dataFormatadaLonga}`;
  ultimaAtualizacaoEl.textContent = `Última atualização: ${report.horaConsulta} (Horário de Brasília)`;

  const evento = report.eventoMaisRelevante;
  const nivel = nivelEvento(evento);

  const rajadasConhecidas = report.ventoPorPeriodo
    .map((p) => p.rajadaMaxKmh)
    .filter((v) => v !== null && v !== undefined);
  const rajadaMax = rajadasConhecidas.length ? Math.max(...rajadasConhecidas) : null;

  const avisosHtml = (report.avisosInmet || [])
    .map(
      (a) => `<div class="aviso-item" style="border-left-color:${corSeveridade(a.severidade)}">
        <span class="sev" style="color:${corSeveridade(a.severidade)}">${a.severidade}</span> — ${a.descricao}
        <div style="color:var(--texto-suave);font-size:0.85em;margin-top:4px;">Vigência: ${a.inicio} até ${a.fim}</div>
      </div>`
    )
    .join("");

  const avisosColetaHtml = (report.avisosColeta || []).length
    ? `<div class="faixa-coleta">
        <div class="icone">📡</div>
        <div class="texto">
          <strong>Atenção: coleta parcial de dados</strong>
          <span>${report.avisosColeta.map((a) => a).join(" · ")} Os campos sem dado aparecem como "—".</span>
        </div>
      </div>`
    : "";

  conteudo.innerHTML = `
    ${avisosColetaHtml}
    <div class="faixa-evento nivel-${nivel}">
      <div class="icone">${nivel === "alto" ? "⛔" : nivel === "medio" ? "⚠️" : "✅"}</div>
      <div class="texto">
        <strong>${evento ? "Evento mais relevante do dia" : "Sem evento extremo identificado"}</strong>
        <span>${evento ? evento.descricao + " — janela prevista: " + evento.janela : "Condições dentro da normalidade com base nas fontes automatizadas consultadas."}</span>
      </div>
    </div>

    <div class="grid-cards">
      <div class="card">
        <div class="rotulo">Condição geral</div>
        <div class="valor" style="font-size:clamp(18px,2vw,28px)">${report.condicaoGeral}</div>
      </div>
      <div class="card">
        <div class="rotulo">Temperatura</div>
        <div class="valor">${report.tempMin}° / ${report.tempMax}°C</div>
        <div class="detalhe">mínima / máxima prevista</div>
      </div>
      <div class="card">
        <div class="rotulo">Umidade relativa</div>
        <div class="valor">${report.umidadeMin}% / ${report.umidadeMax}%</div>
        <div class="detalhe">mínima / máxima prevista</div>
      </div>
      <div class="card">
        <div class="rotulo">Rajada de vento máx.</div>
        <div class="valor">${rajadaMax === null ? "—" : rajadaMax + " km/h"}</div>
        <div class="detalhe">${rajadaMax === null ? "sem dado nas fontes disponíveis" : "pico previsto no dia"}</div>
      </div>
      ${
        report.qualidadeAr?.uvMax != null
          ? `<div class="card">
        <div class="rotulo">Índice UV máx.</div>
        <div class="valor" style="color:${corUv(report.qualidadeAr.uvClassificacao.categoria)}">${report.qualidadeAr.uvMax}</div>
        <div class="detalhe">${report.qualidadeAr.uvClassificacao.nivel}${report.qualidadeAr.horaPicoUv ? " · pico ~" + report.qualidadeAr.horaPicoUv : ""}</div>
      </div>`
          : ""
      }
      ${
        report.qualidadeAr?.pm25Medio != null
          ? `<div class="card">
        <div class="rotulo">Qualidade do ar (PM2,5)</div>
        <div class="valor" style="font-size:clamp(20px,2.2vw,32px)">${report.qualidadeAr.pm25Classificacao.nivel}</div>
        <div class="detalhe">${report.qualidadeAr.pm25Medio} µg/m³ · diretriz OMS: 15</div>
      </div>`
          : ""
      }
      ${
        report.mar?.alturaMaxDiaM != null
          ? `<div class="card">
        <div class="rotulo">Mar — altura máx. de onda</div>
        <div class="valor">${report.mar.alturaMaxDiaM} m</div>
        <div class="detalhe">${report.mar.estadoMarDia}${report.mar.temperaturaMarC != null ? " · água " + report.mar.temperaturaMarC + "°C" : ""}</div>
      </div>`
          : ""
      }
    </div>

    ${
      report.mar?.periodos?.length
        ? `<div class="secao-periodos">
      <h3>Condições de mar por período${report.mar.referenciaPonto ? ` <span style="color:var(--texto-suave);font-weight:400">— ponto: ${report.mar.referenciaPonto}</span>` : ""}</h3>
      <table class="tabela-periodos">
        <thead><tr><th>Período</th><th>Estado do mar</th><th>Altura máx.</th><th>Período de onda</th><th>Direção</th><th>Marulho</th></tr></thead>
        <tbody>
          ${report.mar.periodos
            .map(
              (p) => `<tr>
                <td>${p.periodo}</td>
                <td>${p.estadoMar}</td>
                <td>${p.alturaMaxM == null ? "—" : p.alturaMaxM + " m"}</td>
                <td>${p.periodoOndaS == null ? "—" : p.periodoOndaS + " s"}</td>
                <td>${p.direcaoOnda}</td>
                <td>${p.marulhoMaxM == null ? "—" : p.marulhoMaxM + " m"}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`
        : ""
    }

    <div class="secao-periodos">
      <h3>Vento e chuva por período</h3>
      <table class="tabela-periodos">
        <thead><tr><th>Período</th><th>Vento</th><th>Rajada</th><th>Chance de chuva</th><th>Acumulado</th></tr></thead>
        <tbody>
          ${report.ventoPorPeriodo
            .map((v, i) => {
              const c = report.chuvaPorPeriodo[i];
              return `<tr>
                <td>${v.periodo}</td>
                <td>${v.direcao} · ${v.intensidade}</td>
                <td>${v.rajadaMaxKmh == null ? "—" : v.rajadaMaxKmh + " km/h"}</td>
                <td>${c?.probabilidade == null ? "—" : c.probabilidade + "%"}</td>
                <td>${c?.precipitacaoMm == null ? "—" : c.precipitacaoMm + " mm"}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>

    ${
      avisosHtml
        ? `<div class="secao-periodos">
        <h3>Avisos oficiais INMET ativos</h3>
        <div class="avisos-inmet">${avisosHtml}</div>
      </div>`
        : ""
    }

    <div class="secao-periodos">
      <h3>Destinatários deste informativo</h3>
      <div id="lista-destinatarios-painel">Carregando…</div>
    </div>

    <div class="rodape">
      Fontes: Open-Meteo (previsão numérica${report.mar ? ", ondas" : ""}, índice UV e qualidade do ar) · INMET (previsão oficial e avisos de perigo).
      Dados de referência apenas — consulte também Alerta Rio/COR-Rio/Defesa Civil local para confirmação operacional.
      Painel atualizado automaticamente a cada 10 minutos.
    </div>
  `;

  cidadeAtivaChave = report.cidade.chave;
  document.getElementById("resp-nome-base").textContent = `${report.cidade.nome} — ${report.cidade.uf}`;
  carregarDestinatariosPainel();
}

function renderListaDestinatariosPainel(responsaveis) {
  const alvo = document.getElementById("lista-destinatarios-painel");
  if (!alvo) return;
  if (!responsaveis || responsaveis.length === 0) {
    alvo.innerHTML = `<span style="color:var(--laranja)">Nenhum responsável cadastrado para esta base — o botão 👥 permite cadastrar.</span>`;
    return;
  }
  alvo.innerHTML = `<div class="chips-destinatarios">${responsaveis
    .map((r) => `<span class="chip-destinatario">${r.nome} — ${r.email}</span>`)
    .join("")}</div>`;
}

async function carregarDestinatariosPainel() {
  if (!cidadeAtivaChave) return;
  try {
    const resp = await fetch(`/api/responsaveis?cidade=${encodeURIComponent(cidadeAtivaChave)}`);
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar responsáveis.");
    renderListaDestinatariosPainel(dados.bases[0]?.responsaveis || []);
  } catch (erro) {
    const alvo = document.getElementById("lista-destinatarios-painel");
    if (alvo) alvo.innerHTML = `<span style="color:var(--vermelho)">Erro ao carregar: ${erro.message}</span>`;
  }
}

// ---------------------------------------------------------------------
// Seletor de base — permite trocar a instalação exibida no painel. A base
// escolhida fica salva na URL (?cidade=chave), então uma TV específica pode
// ser fixada numa base salvando/abrindo sempre o mesmo link.
// ---------------------------------------------------------------------
function baseNaUrl() {
  return new URLSearchParams(window.location.search).get("cidade");
}
function definirBaseNaUrl(chave) {
  const url = new URL(window.location.href);
  url.searchParams.set("cidade", chave);
  window.history.replaceState({}, "", url);
}

async function popularSeletorBase() {
  const resp = await fetch("/api/cidades");
  const dados = await resp.json();
  const escolhidaNaUrl = baseNaUrl();
  const inicial = escolhidaNaUrl || dados.ativa;

  seletorBaseEl.innerHTML = dados.disponiveis
    .map((c) => `<option value="${c.chave}">${c.nome} — ${c.uf}</option>`)
    .join("");
  seletorBaseEl.value = inicial;
  return seletorBaseEl.value || dados.ativa;
}

seletorBaseEl.addEventListener("change", () => {
  definirBaseNaUrl(seletorBaseEl.value);
  carregarPreview();
});

async function carregarPreview() {
  try {
    const cidade = seletorBaseEl.value;
    const resp = await fetch(`/api/preview?cidade=${encodeURIComponent(cidade)}`);
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar dados.");
    renderPainel(dados.report);
  } catch (erro) {
    conteudo.innerHTML = `<div class="erro">Não foi possível carregar os dados meteorológicos: ${erro.message}</div>`;
  }
}

(async function iniciar() {
  const inicial = await popularSeletorBase();
  definirBaseNaUrl(inicial);
  await carregarPreview();
  setInterval(carregarPreview, REFRESH_MS);
})();

// ---------------------------------------------------------------------
// Modal de senha / geração + envio manual
// ---------------------------------------------------------------------
function abrirModal() {
  overlaySenha.classList.remove("oculto");
  modalMensagem.textContent = "";
  inputSenha.value = "";
  inputSenha.focus();
}
function fecharModal() {
  overlaySenha.classList.add("oculto");
}

botaoConfig.addEventListener("click", abrirModal);
botaoCancelar.addEventListener("click", fecharModal);
overlaySenha.addEventListener("click", (e) => {
  if (e.target === overlaySenha) fecharModal();
});
inputSenha.addEventListener("keydown", (e) => {
  if (e.key === "Enter") botaoConfirmar.click();
});

function mostrarToast(mensagem, tipo = "sucesso") {
  toastEl.textContent = mensagem;
  toastEl.className = `toast ${tipo === "erro" ? "erro" : ""}`;
  setTimeout(() => toastEl.classList.add("oculto"), 8000);
}

botaoConfirmar.addEventListener("click", async () => {
  const senha = inputSenha.value;
  if (!senha) {
    modalMensagem.textContent = "Digite a senha.";
    return;
  }
  botaoConfirmar.disabled = true;
  botaoConfirmar.textContent = "Gerando…";
  modalMensagem.textContent = "";

  try {
    const resp = await fetch("/api/gerar-relatorio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao gerar relatório.");

    fecharModal();
    mostrarToast(
      `Relatório gerado e enviado para: ${dados.destinatarios.join(", ")}.`,
      "sucesso"
    );
    carregarPreview();
  } catch (erro) {
    modalMensagem.textContent = erro.message;
  } finally {
    botaoConfirmar.disabled = false;
    botaoConfirmar.textContent = "Gerar e Enviar";
  }
});

// ---------------------------------------------------------------------
// Modal de gerenciamento de responsáveis (nome + e-mail) por base
// ---------------------------------------------------------------------
const overlayResponsaveis = document.getElementById("overlay-responsaveis");
const botaoResponsaveis = document.getElementById("botao-responsaveis");
const respBlocoSenha = document.getElementById("resp-bloco-senha");
const respBlocoGestao = document.getElementById("resp-bloco-gestao");
const respInputSenha = document.getElementById("resp-input-senha");
const respSenhaMensagem = document.getElementById("resp-senha-mensagem");
const respBotaoDesbloquear = document.getElementById("resp-botao-desbloquear");
const respBotaoCancelar = document.getElementById("resp-botao-cancelar");
const respBotaoFechar = document.getElementById("resp-botao-fechar");
const respLista = document.getElementById("resp-lista");
const respForm = document.getElementById("resp-form");
const respInputNome = document.getElementById("resp-input-nome");
const respInputEmail = document.getElementById("resp-input-email");
const respFormMensagem = document.getElementById("resp-form-mensagem");

let senhaDesbloqueada = null; // guardada em memória só durante a sessão do modal aberto

function abrirModalResponsaveis() {
  if (!cidadeAtivaChave) return;
  overlayResponsaveis.classList.remove("oculto");
  respBlocoSenha.classList.remove("oculto");
  respBlocoGestao.classList.add("oculto");
  respInputSenha.value = "";
  respSenhaMensagem.textContent = "";
  senhaDesbloqueada = null;
  respInputSenha.focus();
}
function fecharModalResponsaveis() {
  overlayResponsaveis.classList.add("oculto");
  senhaDesbloqueada = null;
}

botaoResponsaveis.addEventListener("click", abrirModalResponsaveis);
respBotaoCancelar.addEventListener("click", fecharModalResponsaveis);
respBotaoFechar.addEventListener("click", fecharModalResponsaveis);
overlayResponsaveis.addEventListener("click", (e) => {
  if (e.target === overlayResponsaveis) fecharModalResponsaveis();
});
respInputSenha.addEventListener("keydown", (e) => {
  if (e.key === "Enter") respBotaoDesbloquear.click();
});

async function renderListaModal() {
  respLista.innerHTML = `<li class="resp-vazio">Carregando…</li>`;
  const resp = await fetch(`/api/responsaveis?cidade=${encodeURIComponent(cidadeAtivaChave)}`);
  const dados = await resp.json();
  if (!dados.ok) throw new Error(dados.erro || "Falha ao carregar responsáveis.");
  const lista = dados.bases[0]?.responsaveis || [];

  respLista.innerHTML =
    lista.length === 0
      ? `<li class="resp-vazio">Nenhum responsável cadastrado ainda.</li>`
      : lista
          .map(
            (r) => `<li>
              <span>${r.nome} <span class="resp-email">${r.email}</span></span>
              <button class="resp-remover" data-email="${r.email}" title="Remover">✕</button>
            </li>`
          )
          .join("");

  respLista.querySelectorAll(".resp-remover").forEach((btn) => {
    btn.addEventListener("click", () => removerResponsavel(btn.dataset.email));
  });

  renderListaDestinatariosPainel(lista); // mantém o painel principal sincronizado
}

respBotaoDesbloquear.addEventListener("click", async () => {
  const senha = respInputSenha.value;
  if (!senha) {
    respSenhaMensagem.textContent = "Digite a senha.";
    return;
  }
  respBotaoDesbloquear.disabled = true;
  respBotaoDesbloquear.textContent = "Verificando…";
  try {
    const resp = await fetch("/api/verificar-senha", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Senha incorreta.");

    senhaDesbloqueada = senha;
    respBlocoSenha.classList.add("oculto");
    respBlocoGestao.classList.remove("oculto");
    respFormMensagem.textContent = "";
    await renderListaModal();
  } catch (erro) {
    respSenhaMensagem.textContent = erro.message;
  } finally {
    respBotaoDesbloquear.disabled = false;
    respBotaoDesbloquear.textContent = "Desbloquear";
  }
});

respForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = respInputNome.value.trim();
  const email = respInputEmail.value.trim();
  if (!nome || !email) {
    respFormMensagem.textContent = "Preencha nome e e-mail.";
    return;
  }
  respFormMensagem.textContent = "";
  try {
    const resp = await fetch("/api/responsaveis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaDesbloqueada, cidade: cidadeAtivaChave, nome, email }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao cadastrar responsável.");
    respInputNome.value = "";
    respInputEmail.value = "";
    await renderListaModal();
    mostrarToast(`${nome} cadastrado(a) para receber o informativo desta base.`, "sucesso");
  } catch (erro) {
    respFormMensagem.textContent = erro.message;
    if (/senha/i.test(erro.message)) {
      // senha incorreta ou expirada: força novo desbloqueio
      respBlocoGestao.classList.add("oculto");
      respBlocoSenha.classList.remove("oculto");
      senhaDesbloqueada = null;
    }
  }
});

async function removerResponsavel(email) {
  respFormMensagem.textContent = "";
  try {
    const resp = await fetch("/api/responsaveis", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: senhaDesbloqueada, cidade: cidadeAtivaChave, email }),
    });
    const dados = await resp.json();
    if (!dados.ok) throw new Error(dados.erro || "Falha ao remover responsável.");
    await renderListaModal();
    mostrarToast(`${email} removido(a) da lista desta base.`, "sucesso");
  } catch (erro) {
    respFormMensagem.textContent = erro.message;
    if (/senha/i.test(erro.message)) {
      respBlocoGestao.classList.add("oculto");
      respBlocoSenha.classList.remove("oculto");
      senhaDesbloqueada = null;
    }
  }
}
