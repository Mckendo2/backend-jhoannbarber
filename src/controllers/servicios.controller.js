import { z } from "zod";
import { pool } from "../db/mysql.js";
import fs from "fs/promises";
import path from "path";

const crearSchema = z.object({
  nombre: z.string().min(3).max(150),
  descripcion: z.string().optional(),
  duracion_minutos: z.number().int().positive(),
  precio: z.number().nonnegative(),
  comision_pct: z.number().min(0).max(100).optional(),
  esta_activo: z.boolean().optional(),
  esta_publicado: z.boolean().optional(),
});

const actualizarSchema = z.object({
  nombre: z.string().min(3).max(150).optional(),
  descripcion: z.string().optional(),
  duracion_minutos: z.number().int().positive().optional(),
  precio: z.number().nonnegative().optional(),
  comision_pct: z.number().min(0).max(100).optional(),
  esta_activo: z.boolean().optional(),
  esta_publicado: z.boolean().optional(),
});

function toUrl(fileName) {
  return `/upload/servicios/${fileName}`;
}
function toAbs(url) {
  return path.join(process.cwd(), url.replace(/^\//, ""));
}
async function borrarArchivo(url) {
  try {
    await fs.unlink(toAbs(url));
  } catch {}
}

export async function crearServicio(req, res) {
  const p = crearSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const {
    nombre,
    descripcion,
    duracion_minutos,
    precio,
    comision_pct,
    esta_activo,
    esta_publicado,
  } = p.data;
  try {
    const [ex] = await pool.execute(
      "SELECT id FROM servicios WHERE nombre=? LIMIT 1",
      [nombre]
    );
    if (ex.length) return res.status(409).json({ mensaje: "Nombre duplicado" });
    const [r] = await pool.execute(
      "INSERT INTO servicios (nombre,descripcion,duracion_minutos,precio,comision_pct,esta_activo,esta_publicado,creado_por,actualizado_por,foto_principal) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        nombre,
        descripcion ?? null,
        duracion_minutos,
        precio,
        typeof comision_pct === "number" ? comision_pct : null,
        typeof esta_activo === "boolean" ? (esta_activo ? 1 : 0) : 1,
        typeof esta_publicado === "boolean" ? (esta_publicado ? 1 : 0) : 1,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
        null,
      ]
    );
    const [row] = await pool.execute(
      "SELECT id,nombre,descripcion,duracion_minutos,precio,comision_pct,esta_activo,esta_publicado,creado_en,actualizado_en,foto_principal FROM servicios WHERE id=?",
      [r.insertId]
    );
    return res.status(201).json({ data: row[0] });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function listarServicios(req, res) {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const perPage = Math.min(
    Math.max(parseInt(req.query.per_page || "10", 10), 1),
    100
  );
  const q = req.query.q ? `%${req.query.q}%` : null;
  const estado = req.query.estado;
  const publicado = req.query.publicado;
  const cond = [];
  const vals = [];
  if (q) {
    cond.push("(nombre LIKE ? OR descripcion LIKE ?)");
    vals.push(q, q);
  }
  if (estado === "activo") cond.push("esta_activo=1");
  if (estado === "inactivo") cond.push("esta_activo=0");
  if (publicado === "publicado") cond.push("esta_publicado=1");
  if (publicado === "no_publicado") cond.push("esta_publicado=0");
  let where = cond.length ? " WHERE " + cond.join(" AND ") : "";
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) AS total FROM servicios${where}`,
    vals
  );
  const pages = Math.ceil(total / perPage);
  const offset = (page - 1) * perPage;
  const [rows] = await pool.query(
    `SELECT id,nombre,descripcion,duracion_minutos,precio,comision_pct,esta_activo,esta_publicado,creado_en,actualizado_en,foto_principal
     FROM servicios${where}
     ORDER BY creado_en DESC
     LIMIT ? OFFSET ?`,
    [...vals, perPage, offset]
  );
  return res.json({
    data: rows,
    meta: { total, page, per_page: perPage, pages },
  });
}

export async function detalleServicio(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const [r] = await pool.execute(
    "SELECT id,nombre,descripcion,duracion_minutos,precio,comision_pct,esta_activo,esta_publicado,creado_en,actualizado_en,foto_principal FROM servicios WHERE id=?",
    [id]
  );
  if (!r.length) return res.status(404).json({ mensaje: "No encontrado" });
  return res.json({ data: r[0] });
}

export async function actualizarServicio(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const p = actualizarSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const {
    nombre,
    descripcion,
    duracion_minutos,
    precio,
    comision_pct,
    esta_activo,
    esta_publicado,
  } = p.data;
  try {
    if (nombre) {
      const [ex] = await pool.execute(
        "SELECT id FROM servicios WHERE nombre=? AND id<>? LIMIT 1",
        [nombre, id]
      );
      if (ex.length)
        return res.status(409).json({ mensaje: "Nombre duplicado" });
    }
    await pool.execute(
      "UPDATE servicios SET nombre=COALESCE(?,nombre), descripcion=COALESCE(?,descripcion), duracion_minutos=COALESCE(?,duracion_minutos), precio=COALESCE(?,precio), comision_pct=COALESCE(?,comision_pct), esta_activo=COALESCE(?,esta_activo), esta_publicado=COALESCE(?,esta_publicado), actualizado_por=?, actualizado_en=NOW() WHERE id=?",
      [
        nombre ?? null,
        descripcion ?? null,
        typeof duracion_minutos === "number" ? duracion_minutos : null,
        typeof precio === "number" ? precio : null,
        typeof comision_pct === "number" ? comision_pct : null,
        typeof esta_activo === "boolean" ? (esta_activo ? 1 : 0) : null,
        typeof esta_publicado === "boolean" ? (esta_publicado ? 1 : 0) : null,
        req.usuario?.sub || null,
        id,
      ]
    );
    const [row] = await pool.execute(
      "SELECT id,nombre,descripcion,duracion_minutos,precio,comision_pct,esta_activo,esta_publicado,creado_en,actualizado_en,foto_principal FROM servicios WHERE id=?",
      [id]
    );
    if (!row.length) return res.status(404).json({ mensaje: "No encontrado" });
    return res.json({ data: row[0] });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function eliminarServicio(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  try {
    await pool.execute(
      "UPDATE servicios SET esta_activo=0, actualizado_por=?, actualizado_en=NOW() WHERE id=?",
      [req.usuario?.sub || null, id]
    );
    return res.json({ mensaje: "Eliminado" });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function listarServiciosPublico(req, res) {
  try {
    const { activo = 1, publicado = 1 } = req.query;

    let query = `
      SELECT 
        id,
        nombre,
        descripcion,
        duracion_minutos,
        precio + 0 AS precio,
        foto_principal
      FROM servicios
      WHERE 1=1
    `;
    const params = [];

    if (activo !== undefined && activo !== "") {
      query += " AND esta_activo = ?";
      params.push(activo === "1" || activo === 1 ? 1 : 0);
    }

    if (publicado !== undefined && publicado !== "") {
      query += " AND esta_publicado = ?";
      params.push(publicado === "1" || publicado === 1 ? 1 : 0);
    }

    query += " ORDER BY nombre ASC";

    const [rows] =
      params.length > 0
        ? await pool.execute(query, params)
        : await pool.query(query);

    const normalized = (rows || []).map((r) => ({
      ...r,
      precio: r.precio == null || r.precio === "" ? null : Number(r.precio),
    }));

    return res.json({ data: normalized });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al listar servicios" });
  }
}

export async function obtenerServicioPublico(req, res) {
  try {
    const { id } = req.params;

    const [[row]] = await pool.query(
      `
      SELECT 
        id,
        nombre,
        descripcion,
        duracion_minutos,
        precio + 0 AS precio,
        foto_principal
      FROM servicios
      WHERE id = ? AND esta_publicado = 1
      `,
      [id]
    );

    if (!row)
      return res.status(404).json({ mensaje: "Servicio no encontrado" });

    row.precio =
      row.precio == null || row.precio === "" ? null : Number(row.precio);

    return res.json({ data: row });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al obtener servicio" });
  }
}

export async function agregarImagenServicio(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ mensaje: "ID inválido" });
  if (!req.file) return res.status(422).json({ mensaje: "Sin archivo" });

  try {
    const url = toUrl(path.basename(req.file.path));
    const [old] = await pool.execute(
      "SELECT foto_principal FROM servicios WHERE id=?",
      [id]
    );
    if (!old.length)
      return res.status(404).json({ mensaje: "Servicio no encontrado" });

    if (old[0].foto_principal) {
      try {
        await borrarArchivo(old[0].foto_principal);
      } catch {}
    }

    await pool.execute(
      "UPDATE servicios SET foto_principal=?, actualizado_por=?, actualizado_en=NOW() WHERE id=?",
      [url, req.usuario?.sub || null, id]
    );

    return res.status(201).json({ url });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function eliminarImagenServicio(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ mensaje: "ID inválido" });

  try {
    const [r] = await pool.execute(
      "SELECT foto_principal FROM servicios WHERE id=?",
      [id]
    );
    if (!r.length)
      return res.status(404).json({ mensaje: "Servicio no encontrado" });
    const url = r[0].foto_principal;
    if (!url) return res.status(400).json({ mensaje: "No tiene imagen" });

    await pool.execute(
      "UPDATE servicios SET foto_principal=NULL, actualizado_por=?, actualizado_en=NOW() WHERE id=?",
      [req.usuario?.sub || null, id]
    );
    try {
      await borrarArchivo(url);
    } catch {}

    return res.json({ mensaje: "Eliminado" });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message || "Error" });
  }
}
