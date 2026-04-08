import { z } from "zod";
import dayjs from "dayjs";
import { pool } from "../db/mysql.js";
import { config } from "../config/env.js";

const NEGOCIO = config?.APP_NAME || "Jhoann Barber";

const abrirVentaSchema = z.object({
  cliente_id: z.number().int().positive().nullable().optional(),
});

const servicioItemSchema = z.object({
  servicio_id: z.number().int().positive(),
  barbero_id: z.number().int().positive(),
  duracion_minutos: z.number().int().positive(),
  precio_unitario: z.number().positive(),
});

const productoItemSchema = z.object({
  producto_id: z.number().int().positive(),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().positive(),
});

const pagarSchema = z.object({
  metodo: z.enum(["efectivo", "tarjeta", "transferencia", "mixto"]),
  pagos: z
    .array(
      z.object({
        metodo: z.enum(["efectivo", "tarjeta", "transferencia"]),
        monto: z.number().positive(),
        referencia: z.string().max(120).nullable().optional(),
      })
    )
    .default([]),
});

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function recalcVenta(ventaId) {
  const [[{ total_serv }]] = await pool.query(
    "SELECT IFNULL(SUM(subtotal),0) total_serv FROM venta_servicios WHERE venta_id=? AND esta_activo=1",
    [ventaId]
  );
  const [[{ total_prod }]] = await pool.query(
    "SELECT IFNULL(SUM(subtotal),0) total_prod FROM venta_productos WHERE venta_id=? AND esta_activo=1",
    [ventaId]
  );
  const total = toNum(total_serv) + toNum(total_prod);
  await pool.execute("UPDATE ventas SET total=? WHERE id=?", [total, ventaId]);
  const [[{ pagado }]] = await pool.query(
    "SELECT IFNULL(SUM(monto),0) pagado FROM pagos WHERE venta_id=? AND esta_activo=1",
    [ventaId]
  );
  const estado = toNum(pagado) >= total && total > 0 ? "pagada" : "abierta";
  await pool.execute("UPDATE ventas SET estado=? WHERE id=?", [
    estado,
    ventaId,
  ]);
  return { total, pagado: toNum(pagado), estado };
}

function ticketHtml({
  curr,
  negocio,
  venta,
  cliente,
  servicios,
  productos,
  pagos,
  tot,
  autoPrint,
}) {
  const fmt = (n) => `${curr} ${Number(n || 0).toFixed(2)}`;
  const fecha = new Date(venta.fecha_hora).toLocaleString();
  const cli = cliente
    ? `${cliente.nombres || ""} ${cliente.apellidos || ""}`.trim() || "Cliente"
    : "Consumidor Final";
  const pagosHtml = (pagos || [])
    .map(
      (p) =>
        `<div class="row"><span>${String(
          p.metodo || ""
        ).toUpperCase()}</span><span>${fmt(p.monto)}</span></div>`
    )
    .join("");
  const svHtml = (servicios || [])
    .map(
      (s) =>
        `<div class="row"><div class="flex"><div class="title">${
          s.servicio_nombre
        }</div><div class="sub">Barbero: ${[s.nombres, s.apellidos]
          .filter(Boolean)
          .join(" ")}</div></div><div class="val">${fmt(
          s.subtotal
        )}</div></div>`
    )
    .join("");
  const prHtml = (productos || [])
    .map(
      (p) =>
        `<div class="row"><div class="flex"><div class="title">${
          p.producto_nombre
        }</div><div class="sub">${p.cantidad} x ${fmt(
          p.precio_unitario
        )}</div></div><div class="val">${fmt(p.subtotal)}</div></div>`
    )
    .join("");
  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ticket #${venta.id}</title>
<style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}
:root{--w:80mm}
.wrap{width:var(--w);margin:0 auto;padding:10px}
.header{text-align:center}
.h1{font:700 14px/1.2 Inter,system-ui,Arial,sans-serif}
.sub{font:500 11px/1.4 Inter,system-ui,Arial,sans-serif;color:#555}
.sep{border-top:1px dashed #bbb;margin:8px 0}
.section-title{font:700 11px Inter,system-ui,Arial,sans-serif;margin:6px 0}
.rows{font:500 11px Inter,system-ui,Arial,sans-serif}
.row{display:flex;justify-content:space-between;gap:8px;padding:4px 0}
.flex{display:flex;flex-direction:column;gap:2px;max-width:70%}
.title{font-weight:600}
.total{display:flex;justify-content:space-between;font:800 12px Inter,system-ui,Arial,sans-serif;margin-top:6px}
.badge{display:inline-block;padding:2px 6px;border-radius:999px;font:700 10px Inter,system-ui,Arial,sans-serif}
.badge.abierta{border:1px solid #999;color:#333}
.badge.pagada{background:#16a34a;color:#fff}
.badge.anulada{background:#ef4444;color:#fff}
.footer{margin-top:8px;text-align:center;font:500 10px Inter,system-ui,Arial,sans-serif;color:#666}
@page{size:auto;margin:6mm}
@media screen and (min-width:600px){.wrap{margin:16px auto;border:1px solid #eee;border-radius:10px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="h1">${negocio}</div>
    <div class="sub">Ticket #${venta.id} • ${fecha}</div>
    <div class="sub">Cliente: ${cli} • <span class="badge ${
    venta.estado
  }">${String(venta.estado || "").toUpperCase()}</span></div>
  </div>
  <div class="sep"></div>
  ${
    servicios.length
      ? `<div class="section-title">Servicios</div><div class="rows">${svHtml}</div><div class="sep"></div>`
      : ""
  }
  ${
    productos.length
      ? `<div class="section-title">Productos</div><div class="rows">${prHtml}</div><div class="sep"></div>`
      : ""
  }
  <div class="rows">
    <div class="row"><span>Subtotal servicios</span><span>${fmt(
      servicios.reduce((a, b) => a + Number(b.subtotal || 0), 0)
    )}</span></div>
    <div class="row"><span>Subtotal productos</span><span>${fmt(
      productos.reduce((a, b) => a + Number(b.subtotal || 0), 0)
    )}</span></div>
    <div class="total"><span>Total</span><span>${fmt(tot.total)}</span></div>
  </div>
  <div class="sep"></div>
  <div class="section-title">Pagos</div>
  <div class="rows">
    ${
      pagosHtml ||
      `<div class="row"><span>Sin pagos</span><span>${fmt(0)}</span></div>`
    }
    <div class="row"><span>Pagado</span><span>${fmt(tot.pagado)}</span></div>
    <div class="row"><span>Pendiente</span><span>${fmt(
      tot.total - tot.pagado
    )}</span></div>
  </div>
  <div class="footer">Gracias por su preferencia</div>
</div>
${
  autoPrint
    ? `<script>window.onload=()=>{setTimeout(()=>{window.print()},150)}</script>`
    : ""
}
</body>
</html>`;
}

export async function ticketVenta(req, res) {
  const id = Number(req.params.id);
  const [v] = await pool.execute(
    "SELECT id,cliente_id,cajero_id,fecha_hora,estado,total,metodo_pago FROM ventas WHERE id=?",
    [id]
  );
  if (!v.length) return res.status(404).json({ mensaje: "No encontrado" });
  const venta = v[0];
  const [clienteRows] = await pool.execute(
    "SELECT id,nombres,apellidos FROM clientes WHERE id=?",
    [venta.cliente_id || 0]
  );
  const cliente = clienteRows[0] || null;
  const [sv] = await pool.execute(
    `SELECT vs.id,vs.servicio_id,s.nombre AS servicio_nombre,vs.barbero_id,u.nombres,u.apellidos,vs.duracion_minutos,vs.precio_unitario,vs.subtotal
     FROM venta_servicios vs
     JOIN servicios s ON s.id=vs.servicio_id
     JOIN usuarios u ON u.id=vs.barbero_id
     WHERE vs.venta_id=? AND vs.esta_activo=1
     ORDER BY vs.id ASC`,
    [id]
  );
  const [pv] = await pool.execute(
    `SELECT vp.id,vp.producto_id,p.nombre AS producto_nombre,vp.cantidad,vp.precio_unitario,vp.subtotal
     FROM venta_productos vp
     JOIN productos p ON p.id=vp.producto_id
     WHERE vp.venta_id=? AND vp.esta_activo=1
     ORDER BY vp.id ASC`,
    [id]
  );
  const [pgs] = await pool.execute(
    "SELECT id,metodo,monto,referencia,fecha_hora FROM pagos WHERE venta_id=? AND esta_activo=1 ORDER BY id ASC",
    [id]
  );
  const [[{ total_serv }]] = await pool.query(
    "SELECT IFNULL(SUM(subtotal),0) total_serv FROM venta_servicios WHERE venta_id=? AND esta_activo=1",
    [id]
  );
  const [[{ total_prod }]] = await pool.query(
    "SELECT IFNULL(SUM(subtotal),0) total_prod FROM venta_productos WHERE venta_id=? AND esta_activo=1",
    [id]
  );
  const [[{ pagado }]] = await pool.query(
    "SELECT IFNULL(SUM(monto),0) pagado FROM pagos WHERE venta_id=? AND esta_activo=1",
    [id]
  );
  const tot = {
    total: Number(total_serv || 0) + Number(total_prod || 0),
    pagado: Number(pagado || 0),
  };
  const curr = String(req.query.curr || "Bs");
  const printFlag = String(req.query.print || "").toLowerCase();
  const autoPrint = ["1", "true", "yes", "on"].includes(printFlag);
  const html = ticketHtml({
    curr,
    negocio: NEGOCIO,
    venta,
    cliente,
    servicios: sv,
    productos: pv,
    pagos: pgs,
    tot,
    autoPrint,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
}

export async function crearVenta(req, res) {
  const p = abrirVentaSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const clienteId = p.data.cliente_id ?? null;
  const cajeroId = req.usuario?.sub || null;
  try {
    const [r] = await pool.execute(
      `INSERT INTO ventas
       (cliente_id,cajero_id,estado,total,metodo_pago,esta_activo,creado_por,actualizado_por)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        clienteId,
        cajeroId,
        "abierta",
        0,
        null,
        1,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    const [row] = await pool.execute(
      "SELECT id,cliente_id,cajero_id,fecha_hora,estado,total,metodo_pago FROM ventas WHERE id=?",
      [r.insertId]
    );
    return res.status(201).json({ data: row[0] });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function actualizarVenta(req, res) {
  const id = Number(req.params.id);
  const body = abrirVentaSchema.partial().safeParse(req.body || {});
  if (!body.success)
    return res.status(422).json({ mensaje: "Datos inválidos" });
  const clienteId = body.data.cliente_id ?? null;
  const [v] = await pool.execute("SELECT id FROM ventas WHERE id=?", [id]);
  if (!v.length) return res.status(404).json({ mensaje: "No encontrado" });
  await pool.execute("UPDATE ventas SET cliente_id=? WHERE id=?", [
    clienteId,
    id,
  ]);
  const [row] = await pool.execute(
    "SELECT id,cliente_id,cajero_id,fecha_hora,estado,total,metodo_pago FROM ventas WHERE id=?",
    [id]
  );
  res.json({ data: row[0] });
}

export async function listarVentas(req, res) {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const per = Math.min(
    50,
    Math.max(1, parseInt(req.query.per_page || "9", 10))
  );
  const q = req.query.q ? `%${req.query.q}%` : null;
  const estado = req.query.estado || null;
  const cond = [];
  const vals = [];
  if (q) {
    cond.push("(v.id LIKE ? OR c.nombres LIKE ? OR c.apellidos LIKE ?)");
    vals.push(q, q, q);
  }
  if (estado) {
    cond.push("v.estado=?");
    vals.push(estado);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) total FROM ventas v LEFT JOIN clientes c ON c.id=v.cliente_id ${where}`,
    vals
  );
  const [rows] = await pool.query(
    `SELECT v.id,v.fecha_hora,v.estado,v.total,v.metodo_pago,
        c.id AS cliente_id, CONCAT(IFNULL(c.nombres,''),' ',IFNULL(c.apellidos,'')) AS cliente_nombre,
        COALESCE(SUM(p.monto), 0) AS pagado
      FROM ventas v
      LEFT JOIN clientes c ON c.id=v.cliente_id
      LEFT JOIN pagos p ON p.venta_id = v.id AND p.esta_activo=1
      ${where}
      GROUP BY v.id, v.fecha_hora, v.estado, v.total, v.metodo_pago, c.id, cliente_nombre
      ORDER BY v.id DESC
      LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );
  rows.forEach((row) => {
    row.pagado = Number(row.pagado || 0);
  });
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
  let venta = v[0];

  if (venta.cliente_id) {
    const [clienteRows] = await pool.execute(
      "SELECT CONCAT(nombres,' ',apellidos) AS nombre FROM clientes WHERE id=?",
      [venta.cliente_id]
    );
    if (clienteRows.length) {
      venta.cliente_nombre = clienteRows[0].nombre || "";
    }
  }

  const [[{ pagado }]] = await pool.query(
    "SELECT IFNULL(SUM(monto),0) pagado FROM pagos WHERE venta_id=? AND esta_activo=1",
    [id]
  );
  venta.pagado = Number(pagado || 0);

  const [sv] = await pool.execute(
    `SELECT vs.id,vs.servicio_id,s.nombre AS servicio_nombre,vs.barbero_id,u.nombres,u.apellidos,
        vs.duracion_minutos,vs.precio_unitario,vs.subtotal,vs.comision_pct,vs.comision_monto
      FROM venta_servicios vs
      JOIN servicios s ON s.id=vs.servicio_id
      JOIN usuarios u ON u.id=vs.barbero_id
      WHERE vs.venta_id=? AND vs.esta_activo=1
      ORDER BY vs.id DESC`,
    [id]
  );
  const [pv] = await pool.execute(
    `SELECT vp.id,vp.producto_id,p.nombre AS producto_nombre,vp.cantidad,vp.precio_unitario,vp.subtotal
      FROM venta_productos vp
      JOIN productos p ON p.id=vp.producto_id
      WHERE vp.venta_id=? AND vp.esta_activo=1
      ORDER BY vp.id DESC`,
    [id]
  );
  const [pgs] = await pool.execute(
    "SELECT id,fecha_hora,metodo,monto,referencia FROM pagos WHERE venta_id=? AND esta_activo=1 ORDER BY id DESC",
    [id]
  );
  res.json({ data: { ...venta, servicios: sv, productos: pv, pagos: pgs } });
}

export async function agregarServicioAVenta(req, res) {
  const ventaId = Number(req.params.id);
  const p = servicioItemSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  try {
    const subtotal = Number(p.data.precio_unitario.toFixed(2));
    await pool.execute(
      `INSERT INTO venta_servicios
       (venta_id,servicio_id,barbero_id,duracion_minutos,precio_unitario,subtotal,esta_activo,creado_por,actualizado_por)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        ventaId,
        p.data.servicio_id,
        p.data.barbero_id,
        p.data.duracion_minutos,
        p.data.precio_unitario,
        subtotal,
        1,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    await recalcVenta(ventaId);
    const [row] = await pool.query(
      `SELECT vs.id,vs.servicio_id,s.nombre AS servicio_nombre,vs.barbero_id,u.nombres,u.apellidos,
              vs.duracion_minutos,vs.precio_unitario,vs.subtotal
       FROM venta_servicios vs
       JOIN servicios s ON s.id=vs.servicio_id
       JOIN usuarios u ON u.id=vs.barbero_id
       WHERE vs.venta_id=? AND vs.esta_activo=1
       ORDER BY vs.id DESC
       LIMIT 1`,
      [ventaId]
    );
    res.status(201).json({ data: row[0] });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function eliminarServicioDeVenta(req, res) {
  const ventaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  await pool.execute(
    "UPDATE venta_servicios SET esta_activo=0, actualizado_por=? WHERE id=? AND venta_id=?",
    [req.usuario?.sub || null, itemId, ventaId]
  );
  const tot = await recalcVenta(ventaId);
  res.json({ mensaje: "Eliminado", totales: tot });
}

export async function agregarProductoAVenta(req, res) {
  const ventaId = Number(req.params.id);
  const p = productoItemSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  try {
    const [[prod]] = await pool.execute(
      "SELECT id,stock FROM productos WHERE id=?",
      [p.data.producto_id]
    );

    if (!prod) return res.status(404).json({ mensaje: "Producto no existe" });
    if (prod.stock < p.data.cantidad)
      return res.status(409).json({ mensaje: "Stock insuficiente" });

    const subtotal = Number(
      (p.data.precio_unitario * p.data.cantidad).toFixed(2)
    );
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      await conn.execute(
        `INSERT INTO venta_productos
         (venta_id,producto_id,cantidad,precio_unitario,subtotal,esta_activo,creado_por,actualizado_por)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          ventaId,
          p.data.producto_id,
          p.data.cantidad,
          p.data.precio_unitario,
          subtotal,
          1,
          req.usuario?.sub || null,
          req.usuario?.sub || null,
        ]
      );

      await conn.execute(
        "UPDATE productos SET stock=stock-?, actualizado_por=? WHERE id=?",
        [p.data.cantidad, req.usuario?.sub || null, p.data.producto_id]
      );

      const [[updatedProd]] = await conn.execute(
        "SELECT stock FROM productos WHERE id=?",
        [p.data.producto_id]
      );

      if (updatedProd && updatedProd.stock === 0) {
        await conn.execute(
          "UPDATE productos SET esta_activo=0, actualizado_por=? WHERE id=?",
          [req.usuario?.sub || null, p.data.producto_id]
        );
      }

      await conn.commit();
      conn.release();

      await recalcVenta(ventaId);
      const [row] = await pool.query(
        `SELECT vp.id,vp.producto_id,p.nombre AS producto_nombre,vp.cantidad,vp.precio_unitario,vp.subtotal
         FROM venta_productos vp
         JOIN productos p ON p.id=vp.producto_id
         WHERE vp.venta_id=? AND vp.esta_activo=1
         ORDER BY vp.id DESC
         LIMIT 1`,
        [ventaId]
      );
      res.status(201).json({ data: row[0] });
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function eliminarProductoDeVenta(req, res) {
  const ventaId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    const [[row]] = await conn.execute(
      "SELECT producto_id,cantidad FROM venta_productos WHERE id=?",
      [itemId]
    );
    await conn.execute(
      "UPDATE venta_productos SET esta_activo=0, actualizado_por=? WHERE id=?",
      [req.usuario?.sub || null, itemId]
    );
    if (row) {
      await conn.execute(
        "UPDATE productos SET stock=stock+?, actualizado_por=? WHERE id=?",
        [row.cantidad, req.usuario?.sub || null, row.producto_id]
      );
      await conn.execute(
        "UPDATE productos SET esta_activo=1, actualizado_por=? WHERE id=? AND stock>0",
        [req.usuario?.sub || null, row.producto_id]
      );
    }
    await conn.commit();
    conn.release();
    const tot = await recalcVenta(ventaId);
    res.json({ mensaje: "Eliminado", totales: tot });
  } catch (e) {
    await conn.rollback();
    conn.release();
    res.status(400).json({ mensaje: e.message });
  }
}

export async function pagarVenta(req, res) {
  const ventaId = Number(req.params.id);
  const bodyRaw = req.body || {};

  const p = pagarSchema.safeParse(bodyRaw);

  let payload;
  if (p.success) {
    payload = p.data;
    if (
      Array.isArray(payload.pagos) &&
      payload.pagos.length === 0 &&
      (typeof bodyRaw.monto === "number" ||
        (typeof bodyRaw.monto === "string" && bodyRaw.monto.trim() !== ""))
    ) {
      const montoNum = Number(bodyRaw.monto);
      if (!Number.isFinite(montoNum) || montoNum <= 0)
        return res.status(422).json({ mensaje: "Monto inválido" });
      payload = {
        metodo: bodyRaw.metodo || payload.metodo || "efectivo",
        pagos: [
          {
            metodo: bodyRaw.metodo || payload.metodo || "efectivo",
            monto: montoNum,
            referencia: bodyRaw.referencia ?? null,
          },
        ],
      };
    }
  } else {
    if (
      typeof bodyRaw.monto === "number" ||
      (typeof bodyRaw.monto === "string" && bodyRaw.monto.trim() !== "")
    ) {
      const montoNum = Number(bodyRaw.monto);
      if (!Number.isFinite(montoNum) || montoNum <= 0)
        return res.status(422).json({ mensaje: "Monto inválido" });
      payload = {
        metodo: bodyRaw.metodo || "efectivo",
        pagos: [
          {
            metodo: bodyRaw.metodo || "efectivo",
            monto: montoNum,
            referencia: bodyRaw.referencia ?? null,
          },
        ],
      };
    } else {
      return res.status(422).json({ mensaje: "Datos inválidos" });
    }
  }

  try {
    const [[v]] = await pool.query(
      "SELECT id,total,estado FROM ventas WHERE id=?",
      [ventaId]
    );
    if (!v) return res.status(404).json({ mensaje: "No encontrado" });

    const now = dayjs().format("YYYY-MM-DD HH:mm:ss");
    const inserted = [];

    const [[beforeCountRow]] = await pool.query(
      "SELECT COUNT(1) AS c FROM pagos WHERE venta_id=?",
      [ventaId]
    );
    for (let i = 0; i < (payload.pagos || []).length; i++) {
      const pg = payload.pagos[i];
      const monto = Number(pg.monto || 0);
      if (!Number.isFinite(monto) || monto <= 0) {
        continue;
      }
      const [r] = await pool.execute(
        "INSERT INTO pagos (venta_id,fecha_hora,metodo,monto,referencia,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
        [
          ventaId,
          now,
          pg.metodo,
          monto,
          pg.referencia ?? null,
          1,
          req.usuario?.sub || null,
          req.usuario?.sub || null,
        ]
      );
      if (r && typeof r.insertId !== "undefined" && r.insertId) {
        inserted.push(r.insertId);
      } else if (
        r &&
        typeof r.affectedRows !== "undefined" &&
        r.affectedRows > 0
      ) {
        const [[last]] = await pool.query("SELECT LAST_INSERT_ID() AS id");
        if (last && last.id) inserted.push(Number(last.id));
      }
    }

    await pool.execute("UPDATE ventas SET metodo_pago=? WHERE id=?", [
      payload.metodo,
      ventaId,
    ]);

    const tot = await recalcVenta(ventaId);

    const [pagosRows] = await pool.query(
      "SELECT id,venta_id,fecha_hora,metodo,monto,referencia,esta_activo,creado_por FROM pagos WHERE venta_id=? ORDER BY id ASC",
      [ventaId]
    );

    const [[afterCountRow]] = await pool.query(
      "SELECT COUNT(1) AS c FROM pagos WHERE venta_id=?",
      [ventaId]
    );

    res.json({
      mensaje: "Pagado",
      totales: tot,
      pagos: pagosRows,
      inserted,
    });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function anularVenta(req, res) {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE ventas SET estado='anulada', actualizado_por=? WHERE id=?",
      [req.usuario?.sub || null, id]
    );
    const [prods] = await conn.execute(
      "SELECT producto_id,cantidad FROM venta_productos WHERE venta_id=? AND esta_activo=1",
      [id]
    );
    for (const it of prods) {
      await conn.execute(
        "UPDATE productos SET stock=stock+?, actualizado_por=? WHERE id=?",
        [it.cantidad, req.usuario?.sub || null, it.producto_id]
      );
      await conn.execute(
        "UPDATE productos SET esta_activo=1, actualizado_por=? WHERE id=? AND stock>0",
        [req.usuario?.sub || null, it.producto_id]
      );
    }

    await conn.execute(
      "UPDATE venta_servicios SET esta_activo=0, actualizado_por=? WHERE venta_id=?",
      [req.usuario?.sub || null, id]
    );
    await conn.execute(
      "UPDATE venta_productos SET esta_activo=0, actualizado_por=? WHERE venta_id=?",
      [req.usuario?.sub || null, id]
    );
    await conn.execute(
      "UPDATE pagos SET esta_activo=0, actualizado_por=? WHERE venta_id=?",
      [req.usuario?.sub || null, id]
    );
    await conn.commit();
    conn.release();
    res.json({ mensaje: "Anulada" });
  } catch (e) {
    try {
      await conn.rollback();
      conn.release();
    } catch {}
    res.status(400).json({ mensaje: e.message });
  }
}

export async function eliminarVenta(req, res) {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [v] = await conn.execute("SELECT id FROM ventas WHERE id=?", [id]);
    if (!v.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ mensaje: "No encontrado" });
    }
    await conn.execute("DELETE FROM venta_servicios WHERE venta_id=?", [id]);
    await conn.execute("DELETE FROM venta_productos WHERE venta_id=?", [id]);
    await conn.execute("DELETE FROM pagos WHERE venta_id=?", [id]);
    await conn.execute("DELETE FROM ventas WHERE id=?", [id]);
    await conn.commit();
    conn.release();
    res.json({ mensaje: "Eliminada" });
  } catch (e) {
    try {
      await conn.rollback();
      conn.release();
    } catch {}
    res.status(400).json({ mensaje: e.message });
  }
}

export async function buscarClientes(req, res) {
  const qtxt = req.query.q ? `%${req.query.q}%` : null;
  const [rows] = await pool.query(
    `SELECT id, CONCAT(IFNULL(nombres,''),' ',IFNULL(apellidos,'')) AS nombre, telefono, correo_electronico AS correo
     FROM clientes
     WHERE esta_activo = 1 ${
       qtxt
         ? "AND (nombres LIKE ? OR apellidos LIKE ? OR correo_electronico LIKE ? OR telefono LIKE ?)"
         : ""
     }
     ORDER BY nombres 
     LIMIT ${qtxt ? 20 : 50}`,
    qtxt ? [qtxt, qtxt, qtxt, qtxt] : []
  );
  res.json({ data: rows });
}

export async function listarBarberos(req, res) {
  const [rows] = await pool.query(
    `SELECT u.id,
            COALESCE(NULLIF(CONCAT(IFNULL(u.nombres,''),' ',IFNULL(u.apellidos,'')),' '), u.correo_electronico) AS nombre
     FROM usuarios u
     WHERE EXISTS(
       SELECT 1
       FROM usuario_rol ur
       JOIN roles r ON r.id=ur.rol_id AND r.nombre='Barbero' AND r.esta_activo=1
       WHERE ur.usuario_id=u.id AND ur.esta_activo=1
     )
     AND u.esta_activo=1
     ORDER BY nombre`
  );
  res.json({ data: rows });
}

export async function buscarServicios(req, res) {
  const qtxt = req.query.q ? `%${req.query.q}%` : null;
  const cond = [];
  const vals = [];
  cond.push("s.esta_activo=1");
  if (qtxt) {
    cond.push("(s.nombre LIKE ? OR s.descripcion LIKE ?)");
    vals.push(qtxt, qtxt);
  }
  const where = "WHERE " + cond.join(" AND ");
  const [rows] = await pool.query(
    `SELECT s.id, s.nombre, s.duracion_minutos, s.precio AS precio_unitario, 
            COALESCE(s.foto_principal, NULL) AS foto_principal
     FROM servicios s
     ${where}
     ORDER BY s.nombre LIMIT 50`,
    vals
  );
  res.json({ data: rows });
}

export async function buscarProductos(req, res) {
  const qtxt = req.query.q ? `%${req.query.q}%` : null;
  const cond = ["p.esta_activo=1"];
  const vals = [];
  if (qtxt) {
    cond.push("(p.nombre LIKE ? OR p.descripcion LIKE ? OR p.sku LIKE ?)");
    vals.push(qtxt, qtxt, qtxt);
  }
  const where = "WHERE " + cond.join(" AND ");
  const [rows] = await pool.query(
    `SELECT p.id,p.nombre,p.precio_unitario,p.stock,
            COALESCE(p.foto_principal, NULL) AS foto_principal
     FROM productos p
     ${where}
     ORDER BY p.nombre LIMIT 50`,
    vals
  );
  res.json({ data: rows });
}
