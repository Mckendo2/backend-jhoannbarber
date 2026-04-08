import { z } from "zod";
import { pool } from "../db/mysql.js";
import fs from "fs/promises";
import path from "path";

function toUrl(fileName) {
  return `/upload/productos/${fileName}`;
}
function toAbs(url) {
  return path.join(process.cwd(), url.replace(/^\//, ""));
}
async function borrarArchivo(url) {
  try {
    await fs.unlink(toAbs(url));
  } catch {}
}

const createSchema = z.object({
  nombre: z.string().min(1).max(150),
  descripcion: z.string().nullable().optional(),
  sku: z.string().max(80).nullable().optional(),
  precio_unitario: z.coerce.number().nonnegative(),
  costo_unitario: z
    .union([z.coerce.number().nonnegative(), z.null()])
    .optional(),
  stock: z.coerce.number().int().nonnegative(),
  esta_activo: z.boolean().optional(),
});

const updateSchema = z.object({
  nombre: z.string().min(1).max(150).optional(),
  descripcion: z.string().nullable().optional(),
  sku: z.string().max(80).nullable().optional(),
  precio_unitario: z.coerce.number().nonnegative().optional(),
  costo_unitario: z
    .union([z.coerce.number().nonnegative(), z.null()])
    .optional(),
  stock: z.coerce.number().int().nonnegative().optional(),
  esta_activo: z.boolean().optional(),
});

function mapProducto(row) {
  return {
    ...row,
    precio_unitario:
      row.precio_unitario != null ? Number(row.precio_unitario) : null,
    costo_unitario:
      row.costo_unitario != null ? Number(row.costo_unitario) : null,
    stock: row.stock != null ? Number(row.stock) : null,
    esta_activo: row.esta_activo != null ? Number(row.esta_activo) : null,
  };
}

export async function crearProducto(req, res) {
  const p = createSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const d = p.data;
  try {
    const [ex1] = await pool.execute(
      "SELECT id FROM productos WHERE nombre=? LIMIT 1",
      [d.nombre]
    );
    if (ex1.length)
      return res.status(409).json({ mensaje: "Nombre duplicado" });
    if (d.sku) {
      const [ex2] = await pool.execute(
        "SELECT id FROM productos WHERE sku=? LIMIT 1",
        [d.sku]
      );
      if (ex2.length) return res.status(409).json({ mensaje: "SKU duplicado" });
    }
    const [r] = await pool.execute(
      `INSERT INTO productos (nombre,descripcion,sku,precio_unitario,costo_unitario,stock,foto_principal,esta_activo,creado_por,actualizado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        d.nombre,
        d.descripcion ?? null,
        d.sku ?? null,
        d.precio_unitario,
        d.costo_unitario ?? null,
        d.stock,
        null,
        d.esta_activo ?? true ? 1 : 0,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    const [row] = await pool.execute(
      `SELECT id,nombre,descripcion,sku,precio_unitario,costo_unitario,stock,foto_principal,esta_activo,creado_en
       FROM productos WHERE id=?`,
      [r.insertId]
    );
    res.status(201).json({ data: mapProducto(row[0]) });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function listarProductos(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    50,
    Math.max(1, parseInt(req.query.per_page || "9", 10))
  );
  const q = req.query.q ? `%${req.query.q}%` : null;
  const estado = req.query.estado;
  const cond = [];
  const vals = [];
  if (q) {
    cond.push("(nombre LIKE ? OR sku LIKE ?)");
    vals.push(q, q);
  }
  if (estado === "activo") cond.push("esta_activo=1");
  if (estado === "inactivo") cond.push("esta_activo=0");
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) total FROM productos ${where}`,
    vals
  );
  const [rows] = await pool.query(
    `SELECT id,nombre,sku,precio_unitario,costo_unitario,stock,foto_principal,esta_activo,creado_en
     FROM productos ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );
  res.json({
    data: rows.map(mapProducto),
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}

export async function detalleProducto(req, res) {
  const id = Number(req.params.id);
  const [r] = await pool.execute(
    `SELECT id,nombre,descripcion,sku,precio_unitario,costo_unitario,stock,foto_principal,esta_activo,creado_en,actualizado_en
     FROM productos WHERE id=?`,
    [id]
  );
  if (!r.length) return res.status(404).json({ mensaje: "No encontrado" });
  const [f] = await pool.execute(
    `SELECT id,url,es_principal,orden
     FROM producto_fotos WHERE producto_id=? AND esta_activo=1
     ORDER BY es_principal DESC, orden ASC, id ASC`,
    [id]
  );
  res.json({ data: { ...mapProducto(r[0]), fotos: f } });
}

export async function actualizarProducto(req, res) {
  const id = Number(req.params.id);
  const p = updateSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const d = p.data;
  try {
    if (d.nombre) {
      const [ex] = await pool.execute(
        "SELECT id FROM productos WHERE nombre=? AND id<>? LIMIT 1",
        [d.nombre, id]
      );
      if (ex.length)
        return res.status(409).json({ mensaje: "Nombre duplicado" });
    }
    if (d.sku) {
      const [ex2] = await pool.execute(
        "SELECT id FROM productos WHERE sku=? AND id<>? LIMIT 1",
        [d.sku, id]
      );
      if (ex2.length) return res.status(409).json({ mensaje: "SKU duplicado" });
    }
    await pool.execute(
      `UPDATE productos SET
         nombre=COALESCE(?,nombre),
         descripcion=COALESCE(?,descripcion),
         sku=COALESCE(?,sku),
         precio_unitario=COALESCE(?,precio_unitario),
         costo_unitario=COALESCE(?,costo_unitario),
         stock=COALESCE(?,stock),
         esta_activo=COALESCE(?,esta_activo),
         actualizado_por=?,
         actualizado_en=NOW()
       WHERE id=?`,
      [
        d.nombre ?? null,
        d.descripcion ?? null,
        d.sku ?? null,
        d.precio_unitario ?? null,
        d.costo_unitario ?? null,
        d.stock ?? null,
        typeof d.esta_activo === "boolean" ? (d.esta_activo ? 1 : 0) : null,
        req.usuario?.sub || null,
        id,
      ]
    );
    const [row] = await pool.execute(
      `SELECT id,nombre,descripcion,sku,precio_unitario,costo_unitario,stock,foto_principal,esta_activo
       FROM productos WHERE id=?`,
      [id]
    );
    if (!row.length) return res.status(404).json({ mensaje: "No encontrado" });
    res.json({ data: mapProducto(row[0]) });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function eliminarProducto(req, res) {
  const id = Number(req.params.id);
  try {
    await pool.execute(
      "UPDATE productos SET esta_activo=0, actualizado_por=?, actualizado_en=NOW() WHERE id=?",
      [req.usuario?.sub || null, id]
    );
    res.json({ mensaje: "Inhabilitado" });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function agregarFotos(req, res) {
  const id = Number(req.params.id);
  if (!req.files?.length)
    return res.status(422).json({ mensaje: "Sin archivos" });
  try {
    for (const f of req.files) {
      const url = toUrl(path.basename(f.path));
      await pool.execute(
        "INSERT INTO producto_fotos (producto_id,url,es_principal,orden,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?)",
        [id, url, 0, 1, 1, req.usuario?.sub || null, req.usuario?.sub || null]
      );
    }
    const [fotos] = await pool.execute(
      "SELECT id,url,es_principal,orden FROM producto_fotos WHERE producto_id=? AND esta_activo=1 ORDER BY es_principal DESC, orden ASC, id ASC",
      [id]
    );
    res.status(201).json({ data: fotos });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function eliminarFoto(req, res) {
  const id = Number(req.params.id);
  const fotoId = Number(req.params.fotoId);
  try {
    const [f] = await pool.execute(
      "SELECT id,url,es_principal FROM producto_fotos WHERE id=? AND producto_id=?",
      [fotoId, id]
    );
    if (!f.length) return res.status(404).json({ mensaje: "No encontrado" });
    await pool.execute("DELETE FROM producto_fotos WHERE id=?", [fotoId]);
    if (f[0].es_principal) {
      const [next] = await pool.execute(
        "SELECT id,url FROM producto_fotos WHERE producto_id=? AND esta_activo=1 ORDER BY id ASC LIMIT 1",
        [id]
      );
      if (next.length) {
        await pool.execute(
          "UPDATE producto_fotos SET es_principal=1 WHERE id=?",
          [next[0].id]
        );
        await pool.execute("UPDATE productos SET foto_principal=? WHERE id=?", [
          next[0].url,
          id,
        ]);
      } else {
        await pool.execute(
          "UPDATE productos SET foto_principal=NULL WHERE id=?",
          [id]
        );
      }
    }
    await borrarArchivo(f[0].url);
    res.json({ mensaje: "Eliminado" });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function setFotoPrincipal(req, res) {
  const id = Number(req.params.id);
  const fotoId = Number(req.params.fotoId);
  try {
    const [f] = await pool.execute(
      "SELECT id,url FROM producto_fotos WHERE id=? AND producto_id=?",
      [fotoId, id]
    );
    if (!f.length) return res.status(404).json({ mensaje: "No encontrado" });
    await pool.execute(
      "UPDATE producto_fotos SET es_principal=0 WHERE producto_id=?",
      [id]
    );
    await pool.execute("UPDATE producto_fotos SET es_principal=1 WHERE id=?", [
      fotoId,
    ]);
    await pool.execute("UPDATE productos SET foto_principal=? WHERE id=?", [
      f[0].url,
      id,
    ]);
    res.json({ mensaje: "Principal actualizado", url: f[0].url });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}
