import nodemailer from "nodemailer";
import { config } from "../config/env.js";

export const transporter = nodemailer.createTransport({
  host: config.mail.host,
  port: config.mail.port,
  secure: config.mail.secure,
  auth: { user: config.mail.user, pass: config.mail.pass },
});

export function enviarCorreo({ para, asunto, html, texto }) {
  return transporter.sendMail({
    from: `"${config.mail.fromName}" <${config.mail.from}>`,
    to: para,
    subject: asunto,
    text: texto || "",
    html,
  });
}
