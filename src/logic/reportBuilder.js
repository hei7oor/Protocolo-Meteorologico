const { buscarOpenMeteo } = require("../sources/openMeteo");
const { buscarPrevisaoInmet, buscarAvisosInmet } = require("../sources/inmet");
const { buscarMar } = require("../sources/marine");
const { buscarQualidadeAr } = require("../sources/airQuality");
const {
  avaliarRiscos,
  recomendacoesDeslocamento,
  recomendacoesEdificacao,
} = require("./riskEngine");

function agora() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
}

function slugCidade(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function detectarDivergencias(openMeteo, inmet) {
  const divergencias = [];
  const diffMax = Math.abs(openMeteo.tempMax - (inmet.periodos.tarde?.tempMax ?? openMeteo.tempMax));
  const diffMin = Math.abs(openMeteo.tempMin - (inmet.periodos.manha?.tempMin ?? openMeteo.tempMin));

  if (diffMax >= 3) {
    divergencias.push(
      `Divergência de temperatura máxima entre Open-Meteo (${openMeteo.tempMax}°C) e INMET (${inmet.periodos.tarde?.tempMax ?? "—"}°C).`
    );
  }
  if (diffMin >= 3) {
    divergencias.push(
      `Divergência de temperatura mínima entre Open-Meteo (${openMeteo.tempMin}°C) e INMET (${inmet.periodos.manha?.tempMin ?? "—"}°C).`
    );
  }

  const resumoInmet = [inmet.periodos.manha, inmet.periodos.tarde, inmet.periodos.noite]
    .map((p) => p?.resumo || "")
    .join(" ")
    .toLowerCase();
  const mencionaChuvaInmet = /chuva|pancada|tempestade|garoa/.test(resumoInmet);
  const mencionaChuvaOpenMeteo = openMeteo.probabilidadeChuvaMax >= 30;

  if (mencionaChuvaInmet !== mencionaChuvaOpenMeteo) {
    divergencias.push(
      "As fontes divergem quanto à indicação de chuva relevante para o dia — considerado o cenário mais conservador (maior risco) para fins de planejamento de segurança."
    );
  }

  return divergencias;
}

/**
 * Monta o objeto de dados completo do informativo para uma cidade cadastrada
 * em src/config/cities.js. Não lança em caso de falha parcial de uma fonte —
 * cada fonte que falhar é sinalizada em `avisosColeta` e o restante segue.
 */
async function montarRelatorio(cidade) {
  const avisosColeta = [];
  let openMeteo, inmetPrevisao, inmetAvisos;

  try {
    openMeteo = await buscarOpenMeteo(cidade.latitude, cidade.longitude);
  } catch (erro) {
    avisosColeta.push(`Open-Meteo indisponível no momento da coleta: ${erro.message}`);
  }

  try {
    inmetPrevisao = await buscarPrevisaoInmet(cidade.codigoIbge);
  } catch (erro) {
    avisosColeta.push(`INMET (previsão) indisponível no momento da coleta: ${erro.message}`);
  }

  try {
    inmetAvisos = await buscarAvisosInmet(cidade.codigoIbge);
  } catch (erro) {
    avisosColeta.push(`INMET (avisos) indisponível no momento da coleta: ${erro.message}`);
  }

  // Condições de mar: só para bases costeiras/portuárias/offshore.
  let mar = null;
  if (cidade.costeira) {
    const ponto = cidade.pontoMar || { latitude: cidade.latitude, longitude: cidade.longitude };
    try {
      mar = await buscarMar(ponto.latitude, ponto.longitude);
      if (cidade.pontoMar?.referencia) mar.referenciaPonto = cidade.pontoMar.referencia;
    } catch (erro) {
      avisosColeta.push(`Condições de mar indisponíveis no momento da coleta: ${erro.message}`);
    }
  }

  // Qualidade do ar e índice UV: relevantes em todas as bases (exposição de
  // equipes em trabalho externo e qualidade do ar respirável).
  let qualidadeAr = null;
  try {
    qualidadeAr = await buscarQualidadeAr(cidade.latitude, cidade.longitude);
  } catch (erro) {
    avisosColeta.push(`Qualidade do ar / índice UV indisponíveis no momento da coleta: ${erro.message}`);
  }

  if (!openMeteo && !inmetPrevisao) {
    throw new Error(
      "Nenhuma fonte meteorológica respondeu (Open-Meteo e INMET indisponíveis). Verifique a conexão com a internet e tente novamente."
    );
  }

  // Open-Meteo é a base numérica primária (dados horários granulares);
  // INMET entra como validação oficial cruzada e fonte de avisos.
  const base = openMeteo || {
    condicaoGeral: inmetPrevisao.periodos.tarde?.resumo || "Indisponível",
    tempMin: inmetPrevisao.periodos.manha?.tempMin ?? null,
    tempMax: inmetPrevisao.periodos.tarde?.tempMax ?? null,
    umidadeMin: inmetPrevisao.periodos.tarde?.umidadeMin ?? null,
    umidadeMax: inmetPrevisao.periodos.manha?.umidadeMax ?? null,
    precipitacaoTotalMm: null,
    probabilidadeChuvaMax: null,
    rajadaMaxKmh: null,
    temTempestadeHoje: false,
    // null (e não 0) é essencial aqui: o INMET não fornece rajada em km/h nem
    // probabilidade de chuva numérica. Zerar esses campos faria o painel
    // exibir "0 km/h" / "0%" como se fossem previsões reais de calmaria,
    // quando na verdade o dado não existe — o painel renderiza null como "—".
    periodos: {
      manha: { periodo: "Manhã", direcao: inmetPrevisao.periodos.manha?.direcaoVento || "—", intensidadeVento: inmetPrevisao.periodos.manha?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
      tarde: { periodo: "Tarde", direcao: inmetPrevisao.periodos.tarde?.direcaoVento || "—", intensidadeVento: inmetPrevisao.periodos.tarde?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
      noite: { periodo: "Noite", direcao: inmetPrevisao.periodos.noite?.direcaoVento || "—", intensidadeVento: inmetPrevisao.periodos.noite?.intensidadeVento || "—", rajadaMaxKmh: null, probabilidadeChuva: null, precipitacaoMm: null, tempestade: false },
    },
  };

  const avisosInmet = inmetAvisos?.avisos || [];

  const { eventoMaisRelevante, categoriasAtivas } = avaliarRiscos({
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    rajadaMaxKmh: base.rajadaMaxKmh,
    probabilidadeChuvaMax: base.probabilidadeChuvaMax,
    precipitacaoTotalMm: base.precipitacaoTotalMm,
    temTempestadeHoje: base.temTempestadeHoje,
    periodos: base.periodos,
    avisosInmet,
    mar,
    qualidadeAr,
  });

  const janelaChuva = ["manha", "tarde", "noite"]
    .map((k) => base.periodos[k])
    .find((p) => p.probabilidadeChuva >= 30)?.periodo;

  const deslocamento = recomendacoesDeslocamento(categoriasAtivas, janelaChuva);
  const edificacao = recomendacoesEdificacao(categoriasAtivas);

  const divergencias =
    openMeteo && inmetPrevisao ? detectarDivergencias(openMeteo, inmetPrevisao) : [];

  const dataNow = agora();
  const tabelaTemperaturaUmidade = [];
  if (openMeteo) {
    tabelaTemperaturaUmidade.push({
      fonte: "Open-Meteo",
      tempMin: openMeteo.tempMin,
      tempMax: openMeteo.tempMax,
      umidadeMin: openMeteo.umidadeMin,
      umidadeMax: openMeteo.umidadeMax,
    });
  }
  if (inmetPrevisao) {
    tabelaTemperaturaUmidade.push({
      fonte: "INMET",
      tempMin: inmetPrevisao.periodos.manha?.tempMin ?? "—",
      tempMax: inmetPrevisao.periodos.tarde?.tempMax ?? "—",
      umidadeMin: inmetPrevisao.periodos.tarde?.umidadeMin ?? "—",
      umidadeMax: inmetPrevisao.periodos.manha?.umidadeMax ?? "—",
    });
  }

  const ventoPorPeriodo = ["manha", "tarde", "noite"].map((k) => {
    const p = base.periodos[k];
    const i = inmetPrevisao?.periodos[k];
    return {
      periodo: p.periodo,
      direcao: p.direcao,
      intensidade: p.intensidadeVento,
      rajadaMaxKmh: p.rajadaMaxKmh,
      referenciaInmet: i ? `${i.direcaoVento || "—"} / ${i.intensidadeVento || "—"}` : null,
    };
  });

  const chuvaPorPeriodo = ["manha", "tarde", "noite"].map((k) => {
    const p = base.periodos[k];
    const i = inmetPrevisao?.periodos[k];
    return {
      periodo: p.periodo,
      probabilidade: p.probabilidadeChuva,
      precipitacaoMm: p.precipitacaoMm,
      resumoInmet: i?.resumo || null,
    };
  });

  const fontes = [];
  if (openMeteo) fontes.push({ nome: "Open-Meteo — previsão numérica", url: openMeteo.url });
  if (inmetPrevisao) fontes.push({ nome: "INMET — previsão oficial", url: inmetPrevisao.url });
  if (inmetAvisos) fontes.push({ nome: "INMET — avisos de perigo ativos", url: inmetAvisos.url });
  if (mar)
    fontes.push({
      nome: `Open-Meteo Marine — ondas, marulho e temperatura do mar${mar.referenciaPonto ? ` (ponto: ${mar.referenciaPonto})` : ""}`,
      url: mar.url,
    });
  if (qualidadeAr)
    fontes.push({
      nome: "Open-Meteo Air Quality — material particulado e índice UV",
      url: qualidadeAr.url,
    });
  if (cidade.links?.alertaRio)
    fontes.push({
      nome: "Alerta Rio / Defesa Civil Municipal (verificação manual — sem API pública estável)",
      url: cidade.links.alertaRio,
    });
  if (cidade.links?.corRio)
    fontes.push({
      nome: "COR-Rio — estágios operacionais (verificação manual — sem API pública estável)",
      url: cidade.links.corRio,
    });
  if (cidade.links?.codesal)
    fontes.push({
      nome: "CODESAL (verificação manual — sem API pública estável)",
      url: cidade.links.codesal,
    });
  if (cidade.links?.climatempo)
    fontes.push({
      nome: "Climatempo (verificação manual — sem API pública gratuita)",
      url: cidade.links.climatempo,
    });
  fontes.push({
    nome: "Windy.com: inacessível para integração automática (SPA sem API pública gratuita). Não incluído nesta coleta automatizada.",
    url: "https://www.windy.com",
  });

  return {
    cidade: { chave: cidade.chave, nome: cidade.nome, uf: cidade.uf },
    nomeArquivoBase: `Informativo_Meteorologico_${slugCidade(cidade.nome)}_${dataNow.toISOString().slice(0, 10)}`,
    dataFormatadaLonga: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
      timeZone: "America/Sao_Paulo",
    }).format(dataNow),
    dataFormatadaCurta: new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(dataNow),
    horaConsulta: new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).format(dataNow),
    condicaoGeral: base.condicaoGeral,
    tempMin: base.tempMin,
    tempMax: base.tempMax,
    umidadeMin: base.umidadeMin,
    umidadeMax: base.umidadeMax,
    tabelaTemperaturaUmidade,
    ventoPorPeriodo,
    chuvaPorPeriodo,
    mar,
    qualidadeAr,
    eventoMaisRelevante,
    avisosInmet,
    divergencias,
    avisosColeta,
    deslocamento,
    edificacao,
    fontes,
    geradoEmISO: dataNow.toISOString(),
  };
}

module.exports = { montarRelatorio };
