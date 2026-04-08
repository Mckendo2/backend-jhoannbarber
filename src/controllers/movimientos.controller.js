import { z } from "zod";
import { pool } from "../db/mysql.js";

const crearSchema = z.object({
  fecha: z.string().min(8),
  tipo: z.enum(["ingreso", "egreso"]),
  categoria: z.string().max(120).nullable().optional(),
  monto: z.number().positive(),
  nota: z.string().max(255).nullable().optional(),
});

export async function listarMovimientos(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    50,
    Math.max(1, parseInt(req.query.per_page || "10", 10))
  );
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const tipo = req.query.tipo || null;
  const q = req.query.q ? `%${req.query.q}%` : null;
  const cond = ["esta_activo=1"];
  const vals = [];
  if (desde) {
    cond.push("fecha>=?");
    vals.push(`${desde} 00:00:00`);
  }
  if (hasta) {
    cond.push("fecha<=?");
    vals.push(`${hasta} 23:59:59`);
  }
  if (tipo === "ingreso" || tipo === "egreso") {
    cond.push("tipo=?");
    vals.push(tipo);
  }
  if (q) {
    cond.push("(nota LIKE ? OR categoria LIKE ?)");
    vals.push(q, q);
  }
  const where = `WHERE ${cond.join(" AND ")}`;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) total FROM movimientos_financieros ${where}`,
    vals
  );
  const [rows] = await pool.query(
    `SELECT id,fecha,tipo,categoria,monto,fuente_tipo,fuente_id,nota
     FROM movimientos_financieros
     ${where}
     ORDER BY fecha DESC,id DESC
     LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );
  res.json({
    data: rows,
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}

export async function crearMovimiento(req, res) {
  const raw = req.body || {};
  const p = crearSchema.safeParse({
    fecha: raw.fecha,
    tipo: raw.tipo,
    categoria: raw.categoria ?? null,
    monto: Number(raw.monto),
    nota: raw.nota ?? null,
  });
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const [r] = await pool.execute(
    "INSERT INTO movimientos_financieros (fecha,tipo,categoria,monto,fuente_tipo,fuente_id,nota,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [
      `${p.data.fecha} 00:00:00`,
      p.data.tipo,
      p.data.categoria,
      p.data.monto,
      null,
      null,
      p.data.nota,
      1,
      req.usuario?.sub || null,
      req.usuario?.sub || null,
    ]
  );
  const [row] = await pool.execute(
    "SELECT id,fecha,tipo,categoria,monto,fuente_tipo,fuente_id,nota FROM movimientos_financieros WHERE id=?",
    [r.insertId]
  );
  res.status(201).json({ data: row[0] });
}
