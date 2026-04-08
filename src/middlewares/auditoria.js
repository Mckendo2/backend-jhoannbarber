import { pool } from "../db/mysql.js";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

export function auditar() {
  return async (req, res, next) => {
    const t0 = Date.now();
    const m = req.method.toUpperCase();
    const loggable =
      ["POST", "PUT", "PATCH", "DELETE"].includes(m) ||
      req.headers["x-aud-accion"];
    const ruta = req.originalUrl || req.url;
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null;
    const ua = req.get("user-agent") || null;
    const payload = loggable ? JSON.stringify(req.body || {}) : null;
    const accion = req.headers["x-aud-accion"] || null;

    let usuarioId = null;
    const token =
      req.cookies?.token || req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwt.secret);
        usuarioId = decoded.sub;
      } catch (e) {
        usuarioId = null;
      }
    }

    const originalJson = res.json;
    res.json = function (data) {
      if (loggable && usuarioId) {
        pool
          .query(
            `INSERT INTO auditoria_eventos (usuario_id, metodo, ruta, accion, ip, user_agent, payload, creado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [usuarioId, m, ruta, accion, ip, ua, payload]
          )
          .catch((err) => console.error("Error guardando auditoría:", err));
      }

      return originalJson.call(this, data);
    };

    next();
  };
}
