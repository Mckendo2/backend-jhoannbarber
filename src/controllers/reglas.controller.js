import { pool } from "../db/mysql.js";

export async function listarReglas(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    200,
    Math.max(1, parseInt(req.query.per_page || "50", 10))
  );
  const onlyActive = req.query.public === "1" || req.query.esta_activa === "1";
  const cond = [];
  const vals = [];

  if (onlyActive) {
    cond.push("esta_activa = 1");
  }

  if (req.query.q) {
    cond.push("(titulo LIKE ? OR texto LIKE ?)");
    vals.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }

  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) AS total FROM reglas ${where}`,
    vals
  );

  const [rows] = await pool.query(
    `SELECT id,titulo,texto,categoria,orden,esta_activa,creado_en,actualizado_en,creado_por,actualizado_por
     FROM reglas
     ${where}
     ORDER BY orden ASC, id ASC
     LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );

  res.json({
    data: rows,
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}

export async function listarReglasPublicas(req, res) {
  const [rows] = await pool.query(
    `SELECT id,titulo,texto,categoria,orden FROM reglas WHERE esta_activa = 1 ORDER BY orden ASC, id ASC`
  );
  res.json({ data: rows });
}

export async function obtenerRegla(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query("SELECT * FROM reglas WHERE id = ? LIMIT 1", [
    id,
  ]);
  if (!rows.length) return res.status(404).json({ mensaje: "No encontrado" });
  res.json({ data: rows[0] });
}

export async function crearRegla(req, res) {
  const { titulo, texto, categoria, orden, esta_activa } = req.body;
  if (!titulo || !texto)
    return res.status(400).json({ mensaje: "titulo y texto requeridos" });

  const [[{ maxo }]] = await pool.query(
    "SELECT COALESCE(MAX(orden), -1) AS maxo FROM reglas"
  );
  const nextOrder = typeof orden === "number" ? orden : maxo + 1;

  const [r] = await pool.query(
    `INSERT INTO reglas (titulo, texto, categoria, orden, esta_activa, creado_por, actualizado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      titulo,
      texto,
      categoria || "General",
      nextOrder,
      esta_activa ? 1 : 1,
      req.user?.id || null,
      req.user?.id || null,
    ]
  );

  const [rows] = await pool.query("SELECT * FROM reglas WHERE id = ? LIMIT 1", [
    r.insertId,
  ]);
  res.status(201).json({ data: rows[0] });
}

export async function actualizarRegla(req, res) {
  const id = Number(req.params.id);
  const { titulo, texto, categoria, orden, esta_activa } = req.body;
  const [r] = await pool.query(
    `UPDATE reglas SET titulo = ?, texto = ?, categoria = ?, orden = ?, esta_activa = ?, actualizado_por = ?
     WHERE id = ?`,
    [
      titulo,
      texto,
      categoria || "General",
      orden || 0,
      esta_activa ? 1 : 0,
      req.user?.id || null,
      id,
    ]
  );
  if (r.affectedRows === 0)
    return res.status(404).json({ mensaje: "No encontrado" });
  const [rows] = await pool.query("SELECT * FROM reglas WHERE id = ? LIMIT 1", [
    id,
  ]);
  res.json({ data: rows[0] });
}

export async function eliminarReglaSoft(req, res) {
  const id = Number(req.params.id);
  const [r] = await pool.query(
    `UPDATE reglas SET esta_activa = 0, actualizado_por = ? WHERE id = ?`,
    [req.user?.id || null, id]
  );
  if (r.affectedRows === 0)
    return res.status(404).json({ mensaje: "No encontrado" });
  res.json({ ok: true });
}

export async function toggleRegla(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.query(
    "SELECT esta_activa FROM reglas WHERE id = ? LIMIT 1",
    [id]
  );
  if (!rows.length) return res.status(404).json({ mensaje: "No encontrado" });
  const newVal = rows[0].esta_activa ? 0 : 1;
  await pool.query(
    "UPDATE reglas SET esta_activa = ?, actualizado_por = ? WHERE id = ?",
    [newVal, req.user?.id || null, id]
  );
  const [n] = await pool.query("SELECT * FROM reglas WHERE id = ? LIMIT 1", [
    id,
  ]);
  res.json({ data: n[0] });
}
