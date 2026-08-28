// Fonte: Windy Point Forecast API (https://api.windy.com/point-forecast/docs)
// API paga, exige chave própria (WINDY_API_KEY no .env).
//
// Papel desta fonte no protocolo: TERCEIRA fonte independente para o
// cruzamento exigido na Etapa 1 do protocolo ("comparar dados entre fontes;
// explicitar divergências sem fabricar consenso artificial"). É também a
// ferramenta que o CIM usa no acompanhamento diário — ter o mesmo número no
// informativo evita a situação de o painel dizer uma coisa e a tela do
// operador dizer outra.
//
// Se WINDY_API_KEY não estiver configurada, buscarWindy() devolve null e o
// restante do sistema segue normalmente com Open-Meteo + INMET.

const ENDPOINT = "https://api.windy.com/api/point-forecast/v2";

// Modelo padrão. "gfs" tem cobertura global e está disponível em todos os
// planos; ajustável por WINDY_MODELO no .env (ex.: "ecmwf" se o plano
// contratado incluir).
const MODELO_PADRAO = "gfs";

const PERIODOS = {
  manha: { label: "Manhã", horaInicio: 6, horaFim: 12 },
  tarde: { label: "Tarde", horaInicio: 12, horaFim: 18 },
  noite: { label: "Noite", horaInicio: 18, horaFim: 24 },
};

function temChave() {
  return Boolean(process.env.WINDY_API_KEY && process.env.WINDY_API_KEY.trim());
}

const kelvinParaCelsius = (k) => (k === null || k === undefined ? null : k - 273.15);
const msParaKmh = (ms) => (ms === null || ms === undefined ? null : ms * 3.6);

function arredondar(valor, casas = 0) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return null;
  const f = Math.pow(10, casas);
  return Math.round(valor * f) / f;
}

function direcaoCardinal(graus) {
  if (graus === null || graus === undefined || Number.isNaN(graus)) return "—";
  const pontos = [
    "N", "N-NE", "NE", "E-NE", "E", "E-SE", "SE", "S-SE",
    "S", "S-SW", "SW", "W-SW", "W", "W-NW", "NW", "N-NW",
  ];
  return pontos[Math.round(graus / 22.5) % 16];
}

// O Windy entrega vento em componentes u/v (m/s). A direção meteorológica é a
// de ONDE o vento vem, por isso o +180 na conversão.
function velocidadeEDirecao(u, v) {
  if (u == null || v == null) return { velocidadeKmh: null, direcaoGraus: null };
  const velocidade = Math.sqrt(u * u + v * v);
  const direcao = (Math.atan2(-u, -v) * 180) / Math.PI;
  return {
    velocidadeKmh: msParaKmh(velocidade),
    direcaoGraus: (direcao + 360) % 360,
  };
}

function maximo(valores) {
  const v = valores.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return v.length ? Math.max(...v) : null;
}
function minimo(valores) {
  const v = valores.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return v.length ? Math.min(...v) : null;
}
function somar(valores) {
  const v = valores.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

// Índices do array de timestamps que caem hoje, dentro da faixa horária do
// período. O Windy devolve os timestamps em UTC (ms); a comparação é feita no
// fuso de Brasília para bater com o restante do informativo.
function indicesDoPeriodo(timestamps, chavePeriodo) {
  const { horaInicio, horaFim } = PERIODOS[chavePeriodo];
  const hojeBrasilia = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  ).toDateString();

  return timestamps
    .map((ts, i) => {
      const local = new Date(
        new Date(ts).toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
      );
      return { i, hora: local.getHours(), dia: local.toDateString() };
    })
    .filter((x) => x.dia === hojeBrasilia && x.hora >= horaInicio && x.hora < horaFim)
    .map((x) => x.i);
}

async function chamarWindy(corpo) {
  const resposta = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(20000),
  });

  if (resposta.status === 401 || resposta.status === 403) {
    throw new Error(
      "Windy recusou a chave (HTTP " +
        resposta.status +
        "). Verifique WINDY_API_KEY no .env e se o plano cobre o modelo solicitado."
    );
  }
  if (resposta.status === 429) {
    throw new Error("Windy: limite de requisições do plano atingido (HTTP 429).");
  }
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => "");
    throw new Error(`Windy respondeu HTTP ${resposta.status}. ${texto.slice(0, 160)}`);
  }

  const json = await resposta.json();

  // TRAVA DE SEGURANÇA — não remover.
  // Chaves em modo de teste/trial devolvem HTTP 200 com dados EMBARALHADOS
  // ("randomly shuffled and slightly modified"), sinalizados só neste campo
  // `warning`. São números plausíveis à vista, mas fisicamente incoerentes
  // (ex.: 33 °C às 3h da manhã). Publicar isso num informativo de segurança
  // seria pior que não ter a fonte: induziria decisão operacional errada com
  // aparência de dado oficial. Na dúvida, recusamos a resposta.
  if (json.warning && /test|shuffl|development/i.test(json.warning)) {
    throw new Error(
      `Windy devolveu DADOS DE TESTE EMBARALHADOS, não utilizáveis operacionalmente ` +
        `(aviso da API: "${json.warning}"). A chave está em modo de desenvolvimento — ` +
        `verifique em https://api.windy.com/keys se o plano pago está ativo para esta chave.`
    );
  }

  return json;
}

/**
 * Busca a previsão do Windy para um ponto. Devolve null (sem lançar) quando a
 * chave não está configurada — assim o sistema funciona sem o Windy.
 */
async function buscarWindy(latitude, longitude) {
  if (!temChave()) return null;

  const modelo = process.env.WINDY_MODELO || MODELO_PADRAO;

  const json = await chamarWindy({
    lat: Number(latitude),
    lon: Number(longitude),
    model: modelo,
    parameters: ["temp", "wind", "windGust", "precip", "rh"],
    levels: ["surface"],
    key: process.env.WINDY_API_KEY.trim(),
  });

  const ts = json.ts || [];
  if (ts.length === 0) {
    throw new Error("Windy devolveu resposta sem série temporal (ts vazio).");
  }

  const temps = (json["temp-surface"] || []).map(kelvinParaCelsius);
  const rh = json["rh-surface"] || [];
  const ventoU = json["wind_u-surface"] || [];
  const ventoV = json["wind_v-surface"] || [];
  const rajadas = (json["gust-surface"] || []).map(msParaKmh);
  // O Windy entrega precipitação acumulada no passo do modelo (mm).
  const precip = json["past3hprecip-surface"] || json["precip-surface"] || [];

  const periodos = Object.keys(PERIODOS).map((chave) => {
    const idxs = indicesDoPeriodo(ts, chave);
    const pegar = (arr) => idxs.map((i) => arr[i]);

    const ventos = idxs.map((i) => velocidadeEDirecao(ventoU[i], ventoV[i]));
    const velocidades = ventos.map((v) => v.velocidadeKmh);
    const direcaoMedia = ventos.length
      ? ventos.reduce((a, v) => a + (v.direcaoGraus ?? 0), 0) / ventos.length
      : null;

    return {
      periodo: PERIODOS[chave].label,
      tempMin: arredondar(minimo(pegar(temps))),
      tempMax: arredondar(maximo(pegar(temps))),
      ventoMaxKmh: arredondar(maximo(velocidades)),
      rajadaMaxKmh: arredondar(maximo(pegar(rajadas))),
      direcaoVento: direcaoCardinal(direcaoMedia),
      precipitacaoMm: arredondar(somar(pegar(precip)), 1),
    };
  });

  // Só considera o dia de hoje no consolidado diário.
  const idxHoje = Object.keys(PERIODOS).flatMap((c) => indicesDoPeriodo(ts, c));
  const doDia = (arr) => idxHoje.map((i) => arr[i]);

  return {
    fonte: "Windy",
    modelo,
    tempMin: arredondar(minimo(doDia(temps))),
    tempMax: arredondar(maximo(doDia(temps))),
    umidadeMin: arredondar(minimo(doDia(rh))),
    umidadeMax: arredondar(maximo(doDia(rh))),
    rajadaMaxKmh: arredondar(maximo(doDia(rajadas))),
    precipitacaoTotalMm: arredondar(somar(doDia(precip)), 1),
    periodos,
  };
}

/**
 * Condições de mar pelo Windy (modelo de ondas). Usado apenas em bases
 * costeiras, como segunda opinião sobre a altura de onda.
 */
async function buscarMarWindy(latitude, longitude) {
  if (!temChave()) return null;

  const modelo = process.env.WINDY_MODELO_MAR || "gfsWave";

  const json = await chamarWindy({
    lat: Number(latitude),
    lon: Number(longitude),
    model: modelo,
    parameters: ["waves", "swell1"],
    levels: ["surface"],
    key: process.env.WINDY_API_KEY.trim(),
  });

  const ts = json.ts || [];
  const alturas = json["waves_height-surface"] || [];
  const periodosOnda = json["waves_period-surface"] || [];

  const idxHoje = Object.keys(PERIODOS).flatMap((c) => indicesDoPeriodo(ts, c));
  if (idxHoje.length === 0) return null;

  return {
    fonte: "Windy",
    modelo,
    alturaMaxDiaM: arredondar(maximo(idxHoje.map((i) => alturas[i])), 1),
    periodoOndaS: arredondar(maximo(idxHoje.map((i) => periodosOnda[i])), 1),
  };
}

module.exports = { buscarWindy, buscarMarWindy, temChave };
