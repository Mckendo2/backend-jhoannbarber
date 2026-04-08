import path from "path";
import ejs from "ejs";
import puppeteer from "puppeteer";
import { pool } from "../db/mysql.js";
import dayjs from "dayjs";

function parseDateRange(q) {
  const from = q.from || q.start || q.desde;
  const to = q.to || q.end || q.hasta;
  const desde = from
    ? `${from} 00:00:00`
    : dayjs().startOf("month").format("YYYY-MM-DD 00:00:00");
  const hasta = to
    ? `${to} 23:59:59`
    : dayjs().endOf("month").format("YYYY-MM-DD 23:59:59");
  return { desde, hasta, rawFrom: from, rawTo: to };
}

const NEGOCIO = process.env.APP_NAME || "Jhoann Barber";

async function renderPdfOrHtml(
  req,
  res,
  rows,
  headers,
  rowsFormatted,
  templateName,
  title,
  desdeVal,
  hastaVal
) {
  const templatePath = path.resolve(
    "src",
    "templates",
    "reportes",
    "report-base.ejs"
  );
  const html = await ejs.renderFile(templatePath, {
    title,
    rows: rowsFormatted,
    headers,
    desde: desdeVal,
    hasta: hastaVal,
    generatedAt: dayjs().format("YYYY-MM-DD HH:mm"),
    negocio: NEGOCIO,
    generatedBy: req.usuario?.correo_electronico || "Sistema",
  });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
      defaultViewport: { width: 1024, height: 768 },
      timeout: 30000,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${templateName}-${Date.now()}.pdf"`
    );
    return res.send(pdfBuffer);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (err) {}
  }
}

export async function barberosDesempenoJson(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const [rows] = await pool.query(
      `SELECT u.id,
              CONCAT(COALESCE(u.nombres,''),' ',COALESCE(u.apellidos,'')) AS nombre,
              COUNT(vs.id) AS total_servicios,
              SUM(vs.subtotal) AS ingresos,
              COUNT(DISTINCT v.id) AS ventas_count
       FROM venta_servicios vs
       JOIN ventas v ON vs.venta_id = v.id
       JOIN usuarios u ON vs.barbero_id = u.id
       WHERE v.fecha_hora BETWEEN ? AND ?
       GROUP BY u.id
       ORDER BY ingresos DESC`,
      [desde, hasta]
    );
    return res.json({ data: rows, meta: { desde, hasta } });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al generar reporte" });
  }
}

export async function barberosDesempenoPdf(req, res) {
  try {
    const { desde, hasta, rawFrom, rawTo } = parseDateRange(req.query);
    const [rows] = await pool.query(
      `SELECT u.id,
              CONCAT(COALESCE(u.nombres,''),' ',COALESCE(u.apellidos,'')) AS nombre,
              COUNT(vs.id) AS total_servicios,
              SUM(vs.subtotal) AS ingresos,
              COUNT(DISTINCT v.id) AS ventas_count
       FROM venta_servicios vs
       JOIN ventas v ON vs.venta_id = v.id
       JOIN usuarios u ON vs.barbero_id = u.id
       WHERE v.fecha_hora BETWEEN ? AND ?
       GROUP BY u.id
       ORDER BY ingresos DESC`,
      [desde, hasta]
    );

    const headers = [
      { label: "#", align: "left" },
      { label: "Barbero", align: "left" },
      { label: "Servicios", align: "right" },
      { label: "Ingresos (Bs.)", align: "right" },
      { label: "Ventas", align: "right" },
    ];

    const rowsFormatted = (rows || []).map((r, i) => [
      { html: String(i + 1), align: "left" },
      { html: r.nombre || "", align: "left" },
      { html: String(r.total_servicios || 0), align: "right" },
      { html: Number(r.ingresos || 0).toFixed(2), align: "right" },
      { html: String(r.ventas_count || 0), align: "right" },
    ]);

    const desdeVal = rawFrom || desde.split(" ")[0];
    const hastaVal = rawTo || hasta.split(" ")[0];

    return await renderPdfOrHtml(
      req,
      res,
      rows,
      headers,
      rowsFormatted,
      "barbero-desempeno",
      "Desempeño de Barberos",
      desdeVal,
      hastaVal
    );
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al generar PDF" });
  }
}

export async function productosMasVendidosJson(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre, p.sku, SUM(vp.cantidad) AS cantidad_vendida, SUM(vp.subtotal) AS total_vendido
       FROM venta_productos vp
       JOIN ventas v ON vp.venta_id = v.id
       JOIN productos p ON vp.producto_id = p.id
       WHERE v.fecha_hora BETWEEN ? AND ?
       GROUP BY p.id
       ORDER BY cantidad_vendida DESC
       LIMIT ?`,
      [desde, hasta, Number(req.query.limit || 50)]
    );
    return res.json({ data: rows });
  } catch (e) {
    return res
      .status(500)
      .json({ mensaje: "Error al generar reporte productos" });
  }
}

export async function productosMasVendidosPdf(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre, p.sku, SUM(vp.cantidad) AS cantidad_vendida, SUM(vp.subtotal) AS total_vendido
       FROM venta_productos vp
       JOIN ventas v ON vp.venta_id = v.id
       JOIN productos p ON vp.producto_id = p.id
       WHERE v.fecha_hora BETWEEN ? AND ?
       GROUP BY p.id
       ORDER BY cantidad_vendida DESC
       LIMIT ?`,
      [desde, hasta, Number(req.query.limit || 50)]
    );

    const headers = [
      { label: "#", align: "left" },
      { label: "Producto", align: "left" },
      { label: "SKU", align: "left" },
      { label: "Cantidad vendida", align: "right" },
      { label: "Total (Bs.)", align: "right" },
    ];

    const rowsFormatted = (rows || []).map((r, i) => [
      { html: String(i + 1), align: "left" },
      { html: r.nombre || "", align: "left" },
      { html: r.sku || "", align: "left" },
      { html: String(r.cantidad_vendida || 0), align: "right" },
      { html: Number(r.total_vendido || 0).toFixed(2), align: "right" },
    ]);

    const desdeVal = req.query.from || desde.split(" ")[0];
    const hastaVal = req.query.to || hasta.split(" ")[0];

    return await renderPdfOrHtml(
      req,
      res,
      rows,
      headers,
      rowsFormatted,
      "productos-mas-vendidos",
      "Productos más vendidos",
      desdeVal,
      hastaVal
    );
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al generar PDF productos" });
  }
}

export async function ingresosPeriodoJson(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const group = (req.query.group || "month").toLowerCase();
    if (group === "year") {
      const [rows] = await pool.query(
        `SELECT YEAR(v.fecha_hora) AS periodo, SUM(v.total) AS total_ingresos
         FROM ventas v
         WHERE v.fecha_hora BETWEEN ? AND ?
         GROUP BY YEAR(v.fecha_hora)
         ORDER BY periodo ASC`,
        [desde, hasta]
      );
      return res.json({ data: rows });
    } else {
      const [rows] = await pool.query(
        `SELECT DATE_FORMAT(v.fecha_hora, '%Y-%m') AS periodo, SUM(v.total) AS total_ingresos
         FROM ventas v
         WHERE v.fecha_hora BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(v.fecha_hora, '%Y-%m')
         ORDER BY periodo ASC`,
        [desde, hasta]
      );
      return res.json({ data: rows });
    }
  } catch (e) {
    return res
      .status(500)
      .json({ mensaje: "Error al generar ingresos por periodo" });
  }
}

export async function ingresosPeriodoPdf(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const group = (req.query.group || "month").toLowerCase();
    let rows;
    if (group === "year") {
      [rows] = await pool.query(
        `SELECT YEAR(v.fecha_hora) AS periodo, SUM(v.total) AS total_ingresos
         FROM ventas v
         WHERE v.fecha_hora BETWEEN ? AND ?
         GROUP BY YEAR(v.fecha_hora)
         ORDER BY periodo ASC`,
        [desde, hasta]
      );
    } else {
      [rows] = await pool.query(
        `SELECT DATE_FORMAT(v.fecha_hora, '%Y-%m') AS periodo, SUM(v.total) AS total_ingresos
         FROM ventas v
         WHERE v.fecha_hora BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(v.fecha_hora, '%Y-%m')
         ORDER BY periodo ASC`,
        [desde, hasta]
      );
    }

    const headers = [
      { label: "#", align: "left" },
      { label: "Periodo", align: "left" },
      { label: "Ingresos (Bs.)", align: "right" },
    ];

    const rowsFormatted = (rows || []).map((r, i) => [
      { html: String(i + 1), align: "left" },
      { html: r.periodo || "", align: "left" },
      { html: Number(r.total_ingresos || 0).toFixed(2), align: "right" },
    ]);

    const desdeVal = req.query.from || desde.split(" ")[0];
    const hastaVal = req.query.to || hasta.split(" ")[0];

    return await renderPdfOrHtml(
      req,
      res,
      rows,
      headers,
      rowsFormatted,
      `ingresos-${group}`,
      `Ingresos (${group === "year" ? "Anual" : "Mensual"})`,
      desdeVal,
      hastaVal
    );
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al generar PDF ingresos" });
  }
}

export async function inventarioPeriodoJson(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre, p.sku, p.stock,
              COALESCE(SUM(vp.cantidad),0) AS vendidos_periodo
       FROM productos p
       LEFT JOIN venta_productos vp ON vp.producto_id = p.id
       LEFT JOIN ventas v ON vp.venta_id = v.id AND v.fecha_hora BETWEEN ? AND ?
       GROUP BY p.id
       ORDER BY vendidos_periodo DESC`,
      [desde, hasta]
    );
    return res.json({ data: rows });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al generar inventario" });
  }
}

export async function inventarioPeriodoPdf(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const [rows] = await pool.query(
      `SELECT p.id, p.nombre, p.sku, p.stock,
              COALESCE(SUM(vp.cantidad),0) AS vendidos_periodo
       FROM productos p
       LEFT JOIN venta_productos vp ON vp.producto_id = p.id
       LEFT JOIN ventas v ON vp.venta_id = v.id AND v.fecha_hora BETWEEN ? AND ?
       GROUP BY p.id
       ORDER BY vendidos_periodo DESC`,
      [desde, hasta]
    );

    const headers = [
      { label: "#", align: "left" },
      { label: "Producto", align: "left" },
      { label: "SKU", align: "left" },
      { label: "Stock actual", align: "right" },
      { label: "Vendidos en periodo", align: "right" },
    ];

    const rowsFormatted = (rows || []).map((r, i) => [
      { html: String(i + 1), align: "left" },
      { html: r.nombre || "", align: "left" },
      { html: r.sku || "", align: "left" },
      { html: String(r.stock || 0), align: "right" },
      { html: String(r.vendidos_periodo || 0), align: "right" },
    ]);

    const desdeVal = req.query.from || desde.split(" ")[0];
    const hastaVal = req.query.to || hasta.split(" ")[0];

    return await renderPdfOrHtml(
      req,
      res,
      rows,
      headers,
      rowsFormatted,
      "inventario",
      "Inventario por periodo",
      desdeVal,
      hastaVal
    );
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al generar PDF inventario" });
  }
}
export async function comisionesPeriodoJson(req, res) {
  try {
    const { desde, hasta } = parseDateRange(req.query);
    const group = (req.query.group || "month").toLowerCase();
    let periodoExpr;
    if (group === "day") periodoExpr = "DATE(v.fecha_hora)";
    else if (group === "week") periodoExpr = "YEARWEEK(v.fecha_hora,1)";
    else periodoExpr = "DATE_FORMAT(v.fecha_hora, '%Y-%m')";

    const sql = `
      SELECT
        ${periodoExpr} AS periodo,
        vs.barbero_id,
        CONCAT(COALESCE(u.nombres,''),' ',COALESCE(u.apellidos,'')) AS nombre,
        COUNT(vs.id) AS servicios_count,
        COUNT(DISTINCT v.id) AS ventas_count,
        ROUND(SUM(vs.subtotal),2) AS total_generado,
        ROUND(SUM(COALESCE(vs.comision_monto, vs.subtotal * (cc.pct_por_defecto/100))),2) AS monto_barbero,
        ROUND(SUM(vs.subtotal) - SUM(COALESCE(vs.comision_monto, vs.subtotal * (cc.pct_por_defecto/100))),2) AS monto_barberia
      FROM venta_servicios vs
      JOIN ventas v ON vs.venta_id = v.id
      JOIN usuarios u ON vs.barbero_id = u.id
      CROSS JOIN configuracion_comisiones cc
      WHERE v.fecha_hora BETWEEN ? AND ?
      GROUP BY periodo, vs.barbero_id
      ORDER BY periodo ASC, total_generado DESC
    `;

    const [rows] = await pool.query(sql, [desde, hasta]);
    return res.json({ data: rows });
  } catch (e) {
    return res
      .status(500)
      .json({ mensaje: "Error al generar reporte de comisiones" });
  }
}

export async function comisionesPeriodoPdf(req, res) {
  try {
    const { desde, hasta, rawFrom, rawTo } = parseDateRange(req.query);
    const group = (req.query.group || "month").toLowerCase();
    let periodoExpr, periodoLabel;
    if (group === "day") {
      periodoExpr = "DATE(v.fecha_hora)";
      periodoLabel = "Día";
    } else if (group === "week") {
      periodoExpr = "YEARWEEK(v.fecha_hora,1)";
      periodoLabel = "Semana (ISO)";
    } else {
      periodoExpr = "DATE_FORMAT(v.fecha_hora, '%Y-%m')";
      periodoLabel = "Mes";
    }

    const sql = `
      SELECT
        ${periodoExpr} AS periodo,
        vs.barbero_id,
        CONCAT(COALESCE(u.nombres,''),' ',COALESCE(u.apellidos,'')) AS nombre,
        COUNT(vs.id) AS servicios_count,
        COUNT(DISTINCT v.id) AS ventas_count,
        ROUND(SUM(vs.subtotal),2) AS total_generado,
        ROUND(SUM(COALESCE(vs.comision_monto, vs.subtotal * (cc.pct_por_defecto/100))),2) AS monto_barbero,
        ROUND(SUM(vs.subtotal) - SUM(COALESCE(vs.comision_monto, vs.subtotal * (cc.pct_por_defecto/100))),2) AS monto_barberia
      FROM venta_servicios vs
      JOIN ventas v ON vs.venta_id = v.id
      JOIN usuarios u ON vs.barbero_id = u.id
      CROSS JOIN configuracion_comisiones cc
      WHERE v.fecha_hora BETWEEN ? AND ?
      GROUP BY periodo, vs.barbero_id
      ORDER BY periodo ASC, total_generado DESC
    `;

    const [rows] = await pool.query(sql, [desde, hasta]);

    const headers = [
      { label: "#", align: "left" },
      { label: periodoLabel, align: "left" },
      { label: "Barbero", align: "left" },
      { label: "Servicios", align: "right" },
      { label: "Ventas", align: "right" },
      { label: "Total generado (Bs.)", align: "right" },
      { label: "Monto barbero (Bs.)", align: "right" },
      { label: "Monto barbería (Bs.)", align: "right" },
    ];

    const rowsFormatted = (rows || []).map((r, i) => {
      let periodoDisplay = String(r.periodo);
      if (group === "week") {
        const yw = String(r.periodo);
        const year = yw.slice(0, 4);
        const week = yw.slice(4);
        periodoDisplay = `${year}-W${week}`;
      }
      return [
        { html: String(i + 1), align: "left" },
        { html: periodoDisplay, align: "left" },
        { html: r.nombre || "", align: "left" },
        { html: String(r.servicios_count || 0), align: "right" },
        { html: String(r.ventas_count || 0), align: "right" },
        { html: Number(r.total_generado || 0).toFixed(2), align: "right" },
        { html: Number(r.monto_barbero || 0).toFixed(2), align: "right" },
        { html: Number(r.monto_barberia || 0).toFixed(2), align: "right" },
      ];
    });

    const desdeVal = rawFrom || desde.split(" ")[0];
    const hastaVal = rawTo || hasta.split(" ")[0];

    const logoPath = "/mnt/data/5eeba4eb-aacd-4364-b103-8adc7678f555.png";

    const summary = rows.reduce(
      (acc, cur) => {
        acc.total_generado += Number(cur.total_generado || 0);
        acc.monto_barbero += Number(cur.monto_barbero || 0);
        acc.monto_barberia += Number(cur.monto_barberia || 0);
        acc.total_servicios += Number(cur.servicios_count || 0);
        acc.total_ventas += Number(cur.ventas_count || 0);
        return acc;
      },
      {
        total_generado: 0,
        monto_barbero: 0,
        monto_barberia: 0,
        total_servicios: 0,
        total_ventas: 0,
      }
    );

    const extra = { logo: logoPath, summary };

    return await renderPdfOrHtml(
      req,
      res,
      rows,
      headers,
      rowsFormatted,
      `comisiones-${group}`,
      `Comisiones (${
        group === "day" ? "Diario" : group === "week" ? "Semanal" : "Mensual"
      })`,
      desdeVal,
      hastaVal,
      extra
    );
  } catch (e) {
    return res
      .status(500)
      .json({ mensaje: "Error al generar PDF de comisiones" });
  }
}
