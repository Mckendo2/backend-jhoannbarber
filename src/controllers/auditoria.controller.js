import { pool } from "../db/mysql.js";

export async function listarEventos(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    100,
    Math.max(1, parseInt(req.query.per_page || "20", 10))
  );
  const q = req.query.q ? `%${req.query.q}%` : null;
  const metodo = req.query.metodo || null;
  const usuarioId = req.query.usuario_id ? Number(req.query.usuario_id) : null;
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const cond = [];
  const vals = [];
  if (q) {
    cond.push("(ruta LIKE ? OR accion LIKE ?)");
    vals.push(q, q);
  }
  if (metodo) {
    cond.push("metodo=?");
    vals.push(metodo);
  }
  if (usuarioId) {
    cond.push("usuario_id=?");
    vals.push(usuarioId);
  }
  if (desde) {
    cond.push("creado_en>=?");
    vals.push(desde + " 00:00:00");
  }
  if (hasta) {
    cond.push("creado_en<=?");
    vals.push(hasta + " 23:59:59");
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) total FROM auditoria_eventos ${where}`,
    vals
  );
  const [rows] = await pool.query(
    `SELECT a.id,a.usuario_id,a.metodo,a.ruta,a.accion,a.ip,a.user_agent,a.creado_en,
            CONCAT(IFNULL(u.nombres,''),' ',IFNULL(u.apellidos,'')) AS usuario_nombre
     FROM auditoria_eventos a
     LEFT JOIN usuarios u ON u.id=a.usuario_id
     ${where}
     ORDER BY a.id DESC
     LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );
  res.json({
    data: rows,
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}

export async function detalleEvento(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.execute(
    `SELECT a.id,a.usuario_id,a.metodo,a.ruta,a.accion,a.ip,a.user_agent,a.payload,a.creado_en,
            CONCAT(IFNULL(u.nombres,''),' ',IFNULL(u.apellidos,'')) AS usuario_nombre
     FROM auditoria_eventos a
     LEFT JOIN usuarios u ON u.id=a.usuario_id
     WHERE a.id=?`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ mensaje: "No encontrado" });
  res.json({ data: rows[0] });
}

export async function listarSesiones(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    100,
    Math.max(1, parseInt(req.query.per_page || "20", 10))
  );
  const usuarioId = req.query.usuario_id ? Number(req.query.usuario_id) : null;
  const cond = [];
  const vals = [];
  if (usuarioId) {
    cond.push("s.usuario_id=?");
    vals.push(usuarioId);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) total FROM sesiones_login s ${where}`,
    vals
  );
  const [rows] = await pool.query(
    `SELECT s.id,s.usuario_id,s.ip,s.user_agent,s.inicio_en,s.fin_en,
            CONCAT(IFNULL(u.nombres,''),' ',IFNULL(u.apellidos,'')) AS usuario_nombre
     FROM sesiones_login s
     JOIN usuarios u ON u.id=s.usuario_id
     ${where}
     ORDER BY s.id DESC
     LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );
  res.json({
    data: rows,
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}
