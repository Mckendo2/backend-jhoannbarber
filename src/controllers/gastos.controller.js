import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { pool } from "../db/mysql.js";

function toUrl(name) {
  return `/upload/gastos/${name}`;
}
function toAbs(url) {
  return path.join(process.cwd(), url.replace(/^\//, ""));
}
async function borrarArchivo(url) {
  try {
    await fs.unlink(toAbs(url));
  } catch {}
}

const crearSchema = z.object({
  fecha: z.string().min(8),
  monto: z.number().positive(),
  descripcion: z.string().min(2).max(255),
  gasto_categoria_id: z.number().int().positive(),
});

const actualizarSchema = z.object({
  fecha: z.string().min(8).optional(),
  monto: z.number().positive().optional(),
  descripcion: z.string().min(2).max(255).optional(),
  gasto_categoria_id: z.number().int().positive().optional(),
  esta_activo: z.boolean().optional(),
});

export async function listarGastos(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    50,
    Math.max(1, parseInt(req.query.per_page || "10", 10))
  );
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const cat = req.query.categoria_id ? Number(req.query.categoria_id) : null;
  const q = req.query.q ? `%${req.query.q}%` : null;
  const cond = ["g.esta_activo=1"];
  const vals = [];
  if (desde) {
    cond.push("g.fecha>=?");
    vals.push(desde);
  }
  if (hasta) {
    cond.push("g.fecha<=?");
    vals.push(hasta);
  }
  if (cat) {
    cond.push("g.gasto_categoria_id=?");
    vals.push(cat);
  }
  if (q) {
    cond.push("(g.descripcion LIKE ?)");
    vals.push(q);
  }
  const where = `WHERE ${cond.join(" AND ")}`;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) total FROM gastos g ${where}`,
    vals
  );
  const [rows] = await pool.query(
    `SELECT g.id,g.fecha,g.monto,g.descripcion,g.gasto_categoria_id,g.comprobante_url,g.creado_en,c.nombre AS categoria
     FROM gastos g JOIN gasto_categorias c ON c.id=g.gasto_categoria_id
     ${where}
     ORDER BY g.fecha DESC,g.id DESC
     LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );
  res.json({
    data: rows,
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}

export async function crearGasto(req, res) {
  const raw = req.body || {};
  const p = crearSchema.safeParse({
    fecha: raw.fecha,
    monto: Number(raw.monto),
    descripcion: raw.descripcion,
    gasto_categoria_id: Number(raw.gasto_categoria_id),
  });
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const file = req.file ? toUrl(path.basename(req.file.path)) : null;
  const [r] = await pool.execute(
    "INSERT INTO gastos (fecha,monto,descripcion,gasto_categoria_id,comprobante_url,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
    [
      p.data.fecha,
      p.data.monto,
      p.data.descripcion,
      p.data.gasto_categoria_id,
      file,
      1,
      req.usuario?.sub || null,
      req.usuario?.sub || null,
    ]
  );
  await pool.execute(
    "INSERT INTO movimientos_financieros (fecha,tipo,categoria,monto,fuente_tipo,fuente_id,nota,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      `${p.data.fecha} 00:00:00`,
      "egreso",
      null,
      p.data.monto,
      "gasto",
      r.insertId,
      p.data.descripcion,
      1,
      req.usuario?.sub || null,
      req.usuario?.sub || null,
    ]
  );
  const [row] = await pool.execute(
    "SELECT id,fecha,monto,descripcion,gasto_categoria_id,comprobante_url FROM gastos WHERE id=?",
    [r.insertId]
  );
  res.status(201).json({ data: row[0] });
}

export async function actualizarGasto(req, res) {
  const id = Number(req.params.id);
  const raw = req.body || {};
  const p = actualizarSchema.safeParse({
    fecha: raw.fecha,
    monto: raw.monto != null ? Number(raw.monto) : undefined,
    descripcion: raw.descripcion,
    gasto_categoria_id:
      raw.gasto_categoria_id != null
        ? Number(raw.gasto_categoria_id)
        : undefined,
    esta_activo:
      typeof raw.esta_activo === "boolean" ? raw.esta_activo : undefined,
  });
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const [prev] = await pool.execute(
    "SELECT comprobante_url FROM gastos WHERE id=?",
    [id]
  );
  if (!prev.length) return res.status(404).json({ mensaje: "No encontrado" });
  let nuevoComprobante = prev[0].comprobante_url;
  if (req.file) {
    const url = toUrl(path.basename(req.file.path));
    if (nuevoComprobante && url !== nuevoComprobante)
      await borrarArchivo(nuevoComprobante);
    nuevoComprobante = url;
  }
  await pool.execute(
    "UPDATE gastos SET fecha=COALESCE(?,fecha), monto=COALESCE(?,monto), descripcion=COALESCE(?,descripcion), gasto_categoria_id=COALESCE(?,gasto_categoria_id), comprobante_url=?, esta_activo=COALESCE(?,esta_activo), actualizado_por=? WHERE id=?",
    [
      p.data.fecha ?? null,
      p.data.monto ?? null,
      p.data.descripcion ?? null,
      p.data.gasto_categoria_id ?? null,
      nuevoComprobante,
      typeof p.data.esta_activo === "boolean"
        ? p.data.esta_activo
          ? 1
          : 0
        : null,
      req.usuario?.sub || null,
      id,
    ]
  );
  const [g] = await pool.execute(
    "SELECT fecha,monto,descripcion FROM gastos WHERE id=?",
    [id]
  );
  await pool.execute(
    "UPDATE movimientos_financieros SET fecha=?, monto=?, nota=?, actualizado_por=? WHERE fuente_tipo='gasto' AND fuente_id=?",
    [
      `${g[0].fecha} 00:00:00`,
      g[0].monto,
      g[0].descripcion,
      req.usuario?.sub || null,
      id,
    ]
  );
  const [row] = await pool.execute(
    "SELECT id,fecha,monto,descripcion,gasto_categoria_id,comprobante_url,esta_activo FROM gastos WHERE id=?",
    [id]
  );
  res.json({ data: row[0] });
}

export async function eliminarGasto(req, res) {
  const id = Number(req.params.id);
  await pool.execute(
    "UPDATE gastos SET esta_activo=0, actualizado_por=? WHERE id=?",
    [req.usuario?.sub || null, id]
  );
  await pool.execute(
    "UPDATE movimientos_financieros SET esta_activo=0, actualizado_por=? WHERE fuente_tipo='gasto' AND fuente_id=?",
    [req.usuario?.sub || null, id]
  );
  res.json({ mensaje: "Eliminado" });
}
