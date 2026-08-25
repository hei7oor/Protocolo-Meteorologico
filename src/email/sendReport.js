const nodemailer = require("nodemailer");
const { renderEmailHtml } = require("../render/emailTemplate");
const { listarPorCidade } = require("../config/recipients");

function criarTransportador() {
  const usuario = process.env.GMAIL_USER;
  const senha = process.env.GMAIL_APP_PASSWORD;
  if (!usuario || !senha) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD não configurados no arquivo .env. Veja README.md."
    );
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: usuario, pass: senha },
  });
}

// Prioriza os responsáveis cadastrados para a base (painel > Gerenciar
// responsáveis). Se nenhum estiver cadastrado, cai para REPORT_RECIPIENTS /
// GMAIL_USER do .env — mantém o comportamento antigo funcionando até que
// alguém cadastre os responsáveis de fato pela base.
function listaDestinatarios(cidadeChave) {
  if (cidadeChave) {
    const cadastrados = listarPorCidade(cidadeChave).map((r) => r.email);
    if (cadastrados.length > 0) return cadastrados;
  }

  const raw = process.env.REPORT_RECIPIENTS || process.env.GMAIL_USER || "";
  return raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

async function enviarRelatorioPorEmail(report, pdfBuffer) {
  const destinatarios = listaDestinatarios(report.cidade?.chave);
  if (destinatarios.length === 0) {
    throw new Error(
      `Nenhum destinatário cadastrado para "${report.cidade?.nome || "esta base"}". Cadastre um responsável no painel ou configure REPORT_RECIPIENTS no .env.`
    );
  }

  const transportador = criarTransportador();
  const assunto = `Informativo Meteorológico — ${report.cidade.nome} — ${report.dataFormatadaCurta}`;

  const info = await transportador.sendMail({
    from: `"Protocolo Meteorológico CIM" <${process.env.GMAIL_USER}>`,
    to: destinatarios.join(", "),
    subject: assunto,
    html: renderEmailHtml(report),
    attachments: [
      {
        filename: `${report.nomeArquivoBase}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return { messageId: info.messageId, destinatarios };
}

module.exports = { enviarRelatorioPorEmail, listaDestinatarios };
