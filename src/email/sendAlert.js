const nodemailer = require("nodemailer");
const { renderAlertEmailHtml, assuntoAlerta } = require("../render/alertEmailTemplate");
const { listaDestinatarios } = require("./sendReport");

function criarTransportador() {
  const usuario = process.env.GMAIL_USER;
  const senha = process.env.GMAIL_APP_PASSWORD;
  if (!usuario || !senha) {
    throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD não configurados no .env.");
  }
  return nodemailer.createTransport({ service: "gmail", auth: { user: usuario, pass: senha } });
}

/**
 * Envia um alerta para os responsáveis da base afetada.
 *
 * Sem anexo, por decisão: alerta é para ser lido no celular em segundos.
 * Gerar o PDF levaria ~7s por base e atrasaria justamente o que precisa ser
 * rápido — o relatório completo já foi enviado de manhã.
 */
async function enviarAlertaPorEmail(base) {
  const destinatarios = listaDestinatarios(base.chave);
  if (destinatarios.length === 0) {
    throw new Error(
      `Nenhum destinatário cadastrado para "${base.cidade.nome}" — alerta não enviado.`
    );
  }

  const transportador = criarTransportador();
  const info = await transportador.sendMail({
    from: `"Alerta CIM" <${process.env.GMAIL_USER}>`,
    to: destinatarios.join(", "),
    subject: assuntoAlerta(base),
    html: renderAlertEmailHtml(base),
    // Prioridade alta: alguns clientes destacam a mensagem na lista.
    priority: "high",
  });

  return { messageId: info.messageId, destinatarios };
}

module.exports = { enviarAlertaPorEmail };
