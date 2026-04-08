import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";
import { query, pool } from "../db/mysql.js";
import { config } from "../config/env.js";
import crypto from "crypto";

function firmarJwt(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.ttl,
    jwtid: crypto.randomBytes(12).toString("hex"),
  });
}

function setCookie(res, token) {
  res.cookie(config.jwt.cookieName, token, {
    httpOnly: true,
    sameSite: config.jwt.cookieSameSite,
    secure: config.jwt.cookieSecure,
    maxAge:
      typeof config.jwt.ttl === "string"
        ? undefined
        : Number(config.jwt.ttl) * 1000,
  });
}

export async function iniciarSesion(req, res) {
  const { correo_electronico, pin } = req.body || {};
  if (!correo_electronico || !pin)
    return res.status(422).json({ mensaje: "Datos incompletos" });
  const filas = await query(
    "SELECT id, correo_electronico, pin FROM usuarios WHERE correo_electronico = ? LIMIT 1",
    [correo_electronico]
  );
  const u = filas[0];
  if (!u) return res.status(401).json({ mensaje: "Credenciales inválidas" });
  const ok = await bcrypt.compare(String(pin), String(u.pin));
  if (!ok) return res.status(401).json({ mensaje: "Credenciales inválidas" });
  const ahora = dayjs().unix();
  const token = firmarJwt({
    sub: u.id,
    correo: u.correo_electronico,
    iat: ahora,
  });
  setCookie(res, token);
  try {
    await pool.execute(
      "INSERT INTO sesiones_login (usuario_id,ip,user_agent,inicio_en,creado_por,actualizado_por) VALUES (?,?,?,?,?,?)",
      [
        u.id,
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null,
        req.get("user-agent") || null,
        new Date(),
        u.id,
        u.id,
      ]
    );
  } catch {}
  return res.json({
    token,
    usuario: { id: u.id, correo_electronico: u.correo_electronico },
  });
}

export async function sesion(req, res) {
  return res.json({ usuario: req.usuario });
}

export async function cerrarSesion(req, res) {
  try {
    await pool.execute(
      "UPDATE sesiones_login SET fin_en=?, actualizado_por=? WHERE usuario_id=? AND fin_en IS NULL ORDER BY id DESC LIMIT 1",
      [new Date(), req.usuario?.sub || null, req.usuario?.sub || 0]
    );
  } catch {}
  res.clearCookie(config.jwt.cookieName);
  return res.json({ mensaje: "Sesión cerrada" });
}
