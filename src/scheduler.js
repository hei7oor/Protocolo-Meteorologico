const cron = require("node-cron");
const { executarPipeline } = require("./pipeline");
const { CIDADES } = require("./config/cities");

/**
 * Quais bases recebem o envio automático diário. Por padrão, TODAS as
 * cadastradas em src/config/cities.js (cada uma para seus próprios
 * responsáveis — ver src/config/recipients.js). Para restringir a um
 * subconjunto, defina no .env:
 *   BASES_ENVIO_DIARIO=rio_de_janeiro,salvador
 */
function basesParaEnvioDiario() {
  const restricao = process.env.BASES_ENVIO_DIARIO;
  if (!restricao) return Object.keys(CIDADES);
  return restricao
    .split(",")
    .map((c) => c.trim())
    .filter((chave) => {
      if (!CIDADES[chave]) {
        console.warn(`[CIM] BASES_ENVIO_DIARIO cita base desconhecida "${chave}" — ignorada.`);
        return false;
      }
      return true;
    });
}

/**
 * Agenda o envio automático diário do informativo para cada base cadastrada.
 * Controlado por env:
 *   HORA_ENVIO_DIARIO=06:00   (HH:mm, horário de Brasília)
 *   ENVIO_AUTOMATICO_DIARIO=false   (desliga o agendamento; padrão: ligado)
 *   BASES_ENVIO_DIARIO=chave1,chave2   (opcional; padrão: todas as bases)
 */
function iniciarAgendamentoDiario(onResultado) {
  if (process.env.ENVIO_AUTOMATICO_DIARIO === "false") {
    console.log("[CIM] Agendamento diário desativado via ENVIO_AUTOMATICO_DIARIO=false.");
    return null;
  }

  const horario = process.env.HORA_ENVIO_DIARIO || "06:00";
  const [hora, minuto] = horario.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(hora) || Number.isNaN(minuto)) {
    console.warn(`[CIM] HORA_ENVIO_DIARIO inválida ("${horario}"), usando 06:00.`);
  }
  const expressao = `${Number.isNaN(minuto) ? 0 : minuto} ${Number.isNaN(hora) ? 6 : hora} * * *`;

  const tarefa = cron.schedule(
    expressao,
    async () => {
      const bases = basesParaEnvioDiario();
      console.log(`[CIM] Disparando envio automático diário agendado (${horario}) para: ${bases.join(", ")}...`);
      for (const cidadeChave of bases) {
        try {
          const resultado = await executarPipeline({ cidadeChave, enviarEmail: true });
          console.log(`[CIM] Envio automático concluído (${cidadeChave}): ${resultado.arquivoPdf}`);
          onResultado?.(null, resultado);
        } catch (erro) {
          console.error(`[CIM] Falha no envio automático diário (${cidadeChave}):`, erro.message);
          onResultado?.(erro, null);
        }
      }
    },
    { timezone: "America/Sao_Paulo" }
  );

  console.log(
    `[CIM] Envio automático diário agendado para ${horario} (America/Sao_Paulo), bases: ${basesParaEnvioDiario().join(", ")}.`
  );
  return tarefa;
}

module.exports = { iniciarAgendamentoDiario };
