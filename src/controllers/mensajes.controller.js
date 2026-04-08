import { query } from "../db/mysql.js";

export async function listarMensajes(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;
    const q = req.query.q ? String(req.query.q).trim() : "";
    const offset = (page - 1) * pageSize;

    let whereClause = "";
    const params = [];

    if (q) {
      whereClause = `WHERE (LOWER(nombre) LIKE ? OR LOWER(asunto) LIKE ? OR LOWER(email) LIKE ?)`;
      const like = `%${q.toLowerCase()}%`;
      params.push(like, like, like);
    }

    const rows = await query(
      `SELECT * FROM mensajes_contacto
       ${whereClause}
       ORDER BY creado_en DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const totalRowsQuery = await query(
      `SELECT COUNT(*) AS total FROM mensajes_contacto ${whereClause}`,
      params
    );

    const total = totalRowsQuery[0]?.total || 0;

    res.json({
      data: rows,
      meta: {
        page,
        pageSize,
        total,
      },
    });
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
  }
}

export async function obtenerMensaje(req, res) {
  try {
    const rows = await query("SELECT * FROM mensajes_contacto WHERE id = ?", [
      req.params.id,
    ]);

    if (!rows.length) return res.status(404).json({ mensaje: "No encontrado" });

    res.json({ data: rows[0] });
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
  }
}

export async function marcarLeido(req, res) {
  try {
    await query("UPDATE mensajes_contacto SET leido = 1 WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
  }
}

export async function eliminarMensaje(req, res) {
  try {
    await query("DELETE FROM mensajes_contacto WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ mensaje: e.message });
  }
}
