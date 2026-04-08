import { z } from "zod";
import dayjs from "dayjs";
import { pool, query } from "../db/mysql.js";

async function recalc(ventaId) {
  const [[{ t1 = 0 }]] = await pool.query(
    "SELECT IFNULL(SUM(subtotal),0) t1 FROM venta_servicios WHERE venta_id=? AND esta_activo=1",
    [ventaId]
  );
  const [[{ t2 = 0 }]] = await pool.query(
    "SELECT IFNULL(SUM(subtotal),0) t2 FROM venta_productos WHERE venta_id=? AND esta_activo=1",
    [ventaId]
  );
  const total = Number(t1) + Number(t2);
  await pool.execute("UPDATE ventas SET total=? WHERE id=?", [total, ventaId]);
  const [[{ pagado = 0 }]] = await pool.query(
    "SELECT IFNULL(SUM(monto),0) pagado FROM pagos WHERE venta_id=? AND esta_activo=1",
    [ventaId]
  );
  const estado = pagado >= total && total > 0 ? "pagada" : "abierta";
  await pool.execute(
    "UPDATE ventas SET estado=?, metodo_pago=CASE WHEN ?>=? AND ?>0 THEN COALESCE(metodo_pago,'mixto') ELSE metodo_pago END WHERE id=?",
    [estado, pagado, total, total, ventaId]
  );
  return { total, pagado, saldo: Number(total) - Number(pagado), estado };
}

const ventaCreateSchema = z.object({
  cliente_id: z.number().int().positive().nullable().optional(),
});
export async function crearVenta(req, res) {
  const p = ventaCreateSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const cliente = p.data.cliente_id ?? null;
  const [r] = await pool.execute(
    "INSERT INTO ventas (cliente_id,cajero_id,estado,total,metodo_pago,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
    [
      cliente,
      req.usuario?.sub || null,
      "abierta",
      0,
      null,
      1,
      req.usuario?.sub || null,
      req.usuario?.sub || null,
    ]
  );
  const id = r.insertId;
  const [row] = await pool.execute(
    "SELECT id,cliente_id,cajero_id,fecha_hora,estado,total,metodo_pago FROM ventas WHERE id=?",
    [id]
  );
  res.status(201).json({ data: row[0] });
}

export async function listarVentas(req, res) {
  const estado = req.query.estado || "abierta";
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    50,
    Math.max(1, parseInt(req.query.per_page || "10", 10))
  );
  const [[{ total }]] = await pool.query(
    "SELECT COUNT(1) total FROM ventas WHERE esta_activo=1 AND estado=?",
    [estado]
  );
  const [rows] = await pool.query(
    "SELECT id,cliente_id,cajero_id,fecha_hora,estado,total,metodo_pago FROM ventas WHERE esta_activo=1 AND estado=? ORDER BY id DESC LIMIT ? OFFSET ?",
    [estado, per, (page - 1) * per]
  );
  res.json({
    data: rows,
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}

export async function detalleVenta(req, res) {
  const id = Number(req.params.id);
  const [v] = await pool.execute(
    "SELECT id,cliente_id,cajero_id,fecha_hora,estado,total,metodo_pago FROM ventas WHERE id=?",
    [id]
  );
  if (!v.length) return res.status(404).json({ mensaje: "No encontrado" });
  const [sv] = await pool.execute(
    "SELECT vs.id,vs.servicio_id,s.nombre servicio,vs.barbero_id,u.nombres barbero,vs.duracion_minutos,vs.precio_unitario,vs.subtotal,vs.comision_pct,vs.comision_monto FROM venta_servicios vs JOIN servicios s ON s.id=vs.servicio_id JOIN usuarios u ON u.id=vs.barbero_id WHERE vs.venta_id=? AND vs.esta_activo=1 ORDER BY vs.id DESC",
    [id]
  );
  const [pv] = await pool.execute(
    "SELECT vp.id,vp.producto_id,p.nombre producto,vp.cantidad,vp.precio_unitario,vp.subtotal FROM venta_productos vp JOIN productos p ON p.id=vp.producto_id WHERE vp.venta_id=? AND vp.esta_activo=1 ORDER BY vp.id DESC",
    [id]
  );
  const [pg] = await pool.execute(
    "SELECT id,fecha_hora,metodo,monto,referencia FROM pagos WHERE venta_id=? AND esta_activo=1 ORDER BY id ASC",
    [id]
  );
  res.json({ data: { ...v[0], servicios: sv, productos: pv, pagos: pg } });
}

const addServicioSchema = z.object({
  servicio_id: z.number().int().positive(),
  barbero_id: z.number().int().positive(),
  duracion_minutos: z.number().int().positive(),
  precio_unitario: z.number().nonnegative(),
  comision_pct: z.number().nonnegative().nullable().optional(),
});
export async function agregarServicio(req, res) {
  const ventaId = Number(req.params.id);
  const p = addServicioSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const d = p.data;
  const subtotal = Number(d.precio_unitario);
  const comision_monto =
    d.comision_pct != null
      ? Number((subtotal * d.comision_pct) / 100).toFixed(2)
      : null;
  await pool.execute(
    "INSERT INTO venta_servicios (venta_id,cita_id,servicio_id,barbero_id,duracion_minutos,precio_unitario,subtotal,comision_pct,comision_monto,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      ventaId,
      null,
      d.servicio_id,
      d.barbero_id,
      d.duracion_minutos,
      d.precio_unitario,
      subtotal,
      d.comision_pct ?? null,
      comision_monto,
      1,
      req.usuario?.sub || null,
      req.usuario?.sub || null,
    ]
  );
  const tot = await recalc(ventaId);
  res.status(201).json({ mensaje: "Agregado", totales: tot });
}

const addProductoSchema = z.object({
  producto_id: z.number().int().positive(),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().nonnegative(),
});
export async function agregarProducto(req, res) {
  const ventaId = Number(req.params.id);
  const p = addProductoSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const d = p.data;
  const [[prod]] = await pool.query(
    "SELECT id,stock FROM productos WHERE id=?",
    [d.producto_id]
  );
  if (!prod) return res.status(404).json({ mensaje: "Producto no existe" });
  if (prod.stock < d.cantidad)
    return res.status(409).json({ mensaje: "Stock insuficiente" });
  const subtotal = Number(d.cantidad) * Number(d.precio_unitario);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "INSERT INTO venta_productos (venta_id,producto_id,cantidad,precio_unitario,subtotal,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
      [
        ventaId,
        d.producto_id,
        d.cantidad,
        d.precio_unitario,
        subtotal,
        1,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    await conn.execute("UPDATE productos SET stock=stock-? WHERE id=?", [
      d.cantidad,
      d.producto_id,
    ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    conn.release();
    return res.status(400).json({ mensaje: e.message });
  }
  conn.release();
  const tot = await recalc(ventaId);
  res.status(201).json({ mensaje: "Agregado", totales: tot });
}

export async function quitarServicio(req, res) {
  const ventaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  await pool.execute(
    "UPDATE venta_servicios SET esta_activo=0, actualizado_por=? WHERE id=?",
    [req.usuario?.sub || null, itemId]
  );
  const tot = await recalc(ventaId);
  res.json({ mensaje: "Quitado", totales: tot });
}

export async function quitarProducto(req, res) {
  const ventaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const [[row]] = await pool.query(
    "SELECT producto_id,cantidad FROM venta_productos WHERE id=?",
    [itemId]
  );
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE venta_productos SET esta_activo=0, actualizado_por=? WHERE id=?",
      [req.usuario?.sub || null, itemId]
    );
    if (row)
      await conn.execute("UPDATE productos SET stock=stock+? WHERE id=?", [
        row.cantidad,
        row.producto_id,
      ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    conn.release();
    return res.status(400).json({ mensaje: e.message });
  }
  conn.release();
  const tot = await recalc(ventaId);
  res.json({ mensaje: "Quitado", totales: tot });
}

const pagoSchema = z.object({
  metodo: z.enum(["efectivo", "tarjeta", "transferencia"]),
  monto: z.number().positive(),
  referencia: z.string().max(120).nullable().optional(),
});
export async function registrarPago(req, res) {
  const ventaId = Number(req.params.id);
  const p = pagoSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const d = p.data;
  const [v] = await pool.execute(
    "SELECT id,total,estado FROM ventas WHERE id=?",
    [ventaId]
  );
  if (!v.length) return res.status(404).json({ mensaje: "No encontrado" });
  if (v[0].estado === "anulada")
    return res.status(409).json({ mensaje: "Venta anulada" });
  await pool.execute(
    "INSERT INTO pagos (venta_id,fecha_hora,metodo,monto,referencia,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
    [
      ventaId,
      dayjs().format("YYYY-MM-DD HH:mm:ss"),
      d.metodo,
      d.monto,
      d.referencia ?? null,
      1,
      req.usuario?.sub || null,
      req.usuario?.sub || null,
    ]
  );
  await pool.execute(
    "UPDATE ventas SET metodo_pago=CASE WHEN metodo_pago IS NULL THEN ? WHEN metodo_pago<>'mixto' AND metodo_pago<>? THEN 'mixto' ELSE metodo_pago END WHERE id=?",
    [d.metodo, d.metodo, ventaId]
  );
  const tot = await recalc(ventaId);
  res.status(201).json({ mensaje: "Pago registrado", totales: tot });
}

export async function anularVenta(req, res) {
  const ventaId = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE ventas SET estado='anulada', actualizado_por=? WHERE id=?",
      [req.usuario?.sub || null, ventaId]
    );
    const [prods] = await conn.query(
      "SELECT producto_id,cantidad FROM venta_productos WHERE venta_id=? AND esta_activo=1",
      [ventaId]
    );
    for (const it of prods)
      await conn.execute("UPDATE productos SET stock=stock+? WHERE id=?", [
        it.cantidad,
        it.producto_id,
      ]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    conn.release();
    return res.status(400).json({ mensaje: e.message });
  }
  conn.release();
  res.json({ mensaje: "Anulada" });
}
