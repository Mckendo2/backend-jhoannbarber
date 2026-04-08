import { z } from "zod";
import { pool } from "../db/mysql.js";

const crearSchema = z.object({
  clave: z.string().min(3).max(150),
  descripcion: z.string().max(255).optional(),
  esta_activo: z.boolean().optional(),
});

const actualizarSchema = z.object({
  clave: z.string().min(3).max(150).optional(),
  descripcion: z.string().max(255).optional(),
  esta_activo: z.boolean().optional(),
});

export async function crearPermiso(req, res) {
  const p = crearSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const { clave, descripcion, esta_activo } = p.data;
  try {
    const [ex] = await pool.execute(
      "SELECT id FROM permisos WHERE clave=? LIMIT 1",
      [clave]
    );
    if (ex.length) return res.status(409).json({ mensaje: "Clave duplicada" });
    const [r] = await pool.execute(
      "INSERT INTO permisos (clave,descripcion,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?)",
      [
        clave,
        descripcion ?? null,
        esta_activo ?? true ? 1 : 0,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    const [row] = await pool.execute(
      "SELECT id,clave,descripcion,esta_activo FROM permisos WHERE id=?",
      [r.insertId]
    );
    return res.status(201).json({ data: row[0] });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function listarPermisos(req, res) {
  const soloActivos = req.query.solo_activos === "1";
  const q = req.query.q ? `%${req.query.q}%` : null;
  let sql =
    "SELECT id,clave,descripcion,esta_activo,creado_en,actualizado_en FROM permisos";
  const cond = [];
  const vals = [];
  if (soloActivos) {
    cond.push("esta_activo=1");
  }
  if (q) {
    cond.push("(clave LIKE ? OR descripcion LIKE ?)");
    vals.push(q, q);
  }
  if (cond.length) sql += " WHERE " + cond.join(" AND ");
  sql += " ORDER BY clave";
  const [rows] = await pool.execute(sql, vals);
  return res.json({ data: rows });
}

export async function actualizarPermiso(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const p = actualizarSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const { clave, descripcion, esta_activo } = p.data;
  try {
    if (clave) {
      const [ex] = await pool.execute(
        "SELECT id FROM permisos WHERE clave=? AND id<>? LIMIT 1",
        [clave, id]
      );
      if (ex.length)
        return res.status(409).json({ mensaje: "Clave duplicada" });
    }
    await pool.execute(
      "UPDATE permisos SET clave=COALESCE(?,clave), descripcion=COALESCE(?,descripcion), esta_activo=COALESCE(?,esta_activo), actualizado_por=? WHERE id=?",
      [
        clave ?? null,
        descripcion ?? null,
        typeof esta_activo === "boolean" ? (esta_activo ? 1 : 0) : null,
        req.usuario?.sub || null,
        id,
      ]
    );
    const [row] = await pool.execute(
      "SELECT id,clave,descripcion,esta_activo FROM permisos WHERE id=?",
      [id]
    );
    if (!row.length) return res.status(404).json({ mensaje: "No encontrado" });
    return res.json({ data: row[0] });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}
