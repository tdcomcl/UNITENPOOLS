const nodemailer = require('nodemailer');

function getMailConfig() {
  return {
    host: process.env.SMTP_HOST || '10.10.10.176',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true', // true para 465, false para 587 STARTTLS
    user: process.env.SMTP_USER || 'notificaciones@tdcom.cl',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'notificaciones@tdcom.cl',
    to: (process.env.ALERT_EMAILS || 'crt@tdcom.cl,franciscaasenciomaleno1@gmail.com')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  };
}

function createTransport() {
  const cfg = getMailConfig();
  if (!cfg.pass) {
    throw new Error('SMTP_PASS no configurado');
  }
  const tlsRejectUnauthorized = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'false') === 'true';
  const tlsServername = process.env.SMTP_TLS_SERVERNAME || undefined;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass
    },
    tls: {
      // En entornos internos (mailcow con cert para hostname) puede fallar por mismatch al conectarse por IP.
      // Por defecto NO validamos el certificado (false). En producción, configura SMTP_TLS_REJECT_UNAUTHORIZED=true
      // y usa un host/hostname que calce con el certificado.
      rejectUnauthorized: tlsRejectUnauthorized,
      ...(tlsServername ? { servername: tlsServername } : {})
    }
  });
}

async function sendOdooErrorEmail({ subject, text }) {
  const cfg = getMailConfig();
  const transporter = createTransport();
  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject,
    text
  });
}

module.exports = {
  getMailConfig,
  sendOdooErrorEmail
};


