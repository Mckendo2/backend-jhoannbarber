import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

function extraerToken(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return req.cookies?.[config.jwt.cookieName] || null;
}

export function requireAuth(req, res, next) {
  const token = extraerToken(req);
  if (!token) return res.status(401).json({ mensaje: "No autenticado" });
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.usuario = payload;
    next();
  } catch {
    return res.status(401).json({ mensaje: "Token inválido" });
  }
}

export function optionalAuth(req, _res, next) {
  const token = extraerToken(req);
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      req.usuario = payload;
    } catch {}
  }
  next();
}
