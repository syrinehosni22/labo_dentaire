const nodemailer = require('nodemailer');
const { getSetting } = require('../db');

// Settings screen first; otherwise SMTP_* variables from .env
async function smtpConfig() {
  const c = ((await getSetting('notifications')) || {}).channels?.email || {};
  if (c.enabled && c.host) return c;
  const e = process.env;
  if (e.SMTP_HOST) {
    return { host: e.SMTP_HOST, port: Number(e.SMTP_PORT) || 587, secure: /^(1|true|oui)$/i.test(e.SMTP_SECURE || ''), user: e.SMTP_USER || '', pass: e.SMTP_PASS || '', from: e.SMTP_FROM || e.SMTP_USER };
  }
  return null;
}

const isConfigured = async () => !!(await smtpConfig());

async function sendMail({ to, subject, text, html }) {
  const c = await smtpConfig();
  if (!c) return { sent: false, reason: "Le serveur d'e-mail (SMTP) n'est pas configuré." };
  try {
    const t = nodemailer.createTransport({ host: c.host, port: Number(c.port) || 587, secure: !!c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined });
    await t.sendMail({ from: c.from || c.user, to, subject, text, html });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

module.exports = { sendMail, isConfigured, smtpConfig };
