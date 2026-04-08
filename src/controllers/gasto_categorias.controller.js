import { z } from "zod";
import { pool } from "../db/mysql.js";

const crearSchema = z.object({
  nombre: z.string().min(2).max(120),
  descripcion: z.string().max(255).nullable().optional(),
  esta_activo: z.boolean().optional(),
});

const actualizarSchema = z.object({
  nombre: z.string().min(2).max(120).optional(),
  descripcion: z.string().max(255).nullable().optional(),
  esta_activo: z.boolean().optional(),
});

export async function listarCategorias(req, res) {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const soloActivos = req.query.solo_activos === "1";
  const cond = [];
  const vals = [];
  if (q) {
    cond.push("(nombre LIKE ? OR descripcion LIKE ?)");
    vals.push(q, q);
  }
  if (soloActivos) cond.push("esta_activo=1");
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT id,nombre,descripcion,esta_activo,creado_en,actualizado_en FROM gasto_categorias ${where} ORDER BY nombre`,
    vals
  );
  res.json({ data: rows });
}

export async function crearCategoria(req, res) {
  const p = crearSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const { nombre, descripcion, esta_activo } = p.data;
  const [ex] = await pool.execute(
    "SELECT id FROM gasto_categorias WHERE nombre=? LIMIT 1",
    [nombre]
  );
  if (ex.length) return res.status(409).json({ mensaje: "Nombre duplicado" });
  const [r] = await pool.execute(
    "INSERT INTO gasto_categorias (nombre,descripcion,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?)",
    [
      nombre,
      descripcion ?? null,
      esta_activo ?? true ? 1 : 0,
      req.usuario?.sub || null,
      req.usuario?.sub || null,
    ]
  );
  const [row] = await pool.execute(
    "SELECT id,nombre,descripcion,esta_activo FROM gasto_categorias WHERE id=?",
    [r.insertId]
  );
  res.status(201).json({ data: row[0] });
}

export async function actualizarCategoria(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const p = actualizarSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const { nombre, descripcion, esta_activo } = p.data;
  if (nombre) {
    const [ex] = await pool.execute(
      "SELECT id FROM gasto_categorias WHERE nombre=? AND id<>? LIMIT 1",
      [nombre, id]
    );
    if (ex.length) return res.status(409).json({ mensaje: "Nombre duplicado" });
  }
  await pool.execute(
    "UPDATE gasto_categorias SET nombre=COALESCE(?,nombre), descripcion=COALESCE(?,descripcion), esta_activo=COALESCE(?,esta_activo), actualizado_por=? WHERE id=?",
    [
      nombre ?? null,
      descripcion ?? null,
      typeof esta_activo === "boolean" ? (esta_activo ? 1 : 0) : null,
      req.usuario?.sub || null,
      id,
    ]
  );
  const [row] = await pool.execute(
    "SELECT id,nombre,descripcion,esta_activo FROM gasto_categorias WHERE id=?",
    [id]
  );
  if (!row.length) return res.status(404).json({ mensaje: "No encontrado" });
  res.json({ data: row[0] });
}
