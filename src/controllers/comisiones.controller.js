import { pool } from "../db/mysql.js";

function calcularSemanaInicio(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  const weekday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

export async function obtenerComisionesSemana(req, res) {
  try {
    let fechaInicio = req.query.fechaInicio;
    let fechaFin = req.query.fechaFin;

    if (!fechaInicio || !fechaFin) {
      const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
      fechaInicio = calcularSemanaInicio(fecha);
      const semanaFinDate = new Date(fechaInicio + "T00:00:00Z");
      semanaFinDate.setUTCDate(semanaFinDate.getUTCDate() + 7);
      fechaFin = semanaFinDate.toISOString().slice(0, 10);
    }

    const sql = `
      SELECT
        vs.barbero_id,
        COALESCE(u.nombres, '') AS nombres,
        COALESCE(u.apellidos, '') AS apellidos,
        ? AS semana_inicio,
        ROUND(IFNULL(SUM(vs.subtotal),0),2) AS total_generado,
        ROUND(IFNULL(SUM(COALESCE(vs.comision_monto, vs.subtotal * (cc.pct_por_defecto/100))),0),2) AS monto_barbero_bruto,
        ROUND(IFNULL((SELECT SUM(bs.monto) FROM barbero_sanciones bs WHERE bs.barbero_id = vs.barbero_id AND bs.esta_activo = 1 AND bs.fecha >= ? AND bs.fecha <= ?), 0), 2) AS total_sanciones,
        COALESCE(ls.pagado, 0) AS pagado,
        ls.pagado_en
      FROM venta_servicios vs
      JOIN ventas v ON vs.venta_id = v.id
      JOIN usuarios u ON vs.barbero_id = u.id
      CROSS JOIN configuracion_comisiones cc
      LEFT JOIN liquidaciones_semanales ls ON ls.barbero_id = vs.barbero_id AND ls.semana_inicio = ?
      WHERE v.estado = 'pagada'
        AND v.fecha_hora >= ?
        AND v.fecha_hora <= ?
      GROUP BY vs.barbero_id, ls.pagado, ls.pagado_en
      ORDER BY total_generado DESC
    `;

    const conn = await pool.getConnection();
    const [rows] = await conn.query(sql, [
      fechaInicio,
      fechaInicio,
      fechaFin,
      fechaInicio,
      fechaInicio + " 00:00:00",
      fechaFin + " 23:59:59",
    ]);
    conn.release();

    const normalized = (rows || []).map((r) => {
      const total_generado = Number(r.total_generado);
      const monto_barbero_bruto = Number(r.monto_barbero_bruto);
      const total_sanciones = Number(r.total_sanciones);
      
      const monto_barbero = Math.max(0, monto_barbero_bruto - total_sanciones);
      const monto_barberia = total_generado - monto_barbero;

      return {
        barbero_id: r.barbero_id,
        nombres: r.nombres,
        apellidos: r.apellidos,
        semana_inicio: r.semana_inicio,
        total_generado,
        total_sanciones,
        monto_barbero,
        monto_barberia,
        pagado: Boolean(r.pagado),
        pagado_en: r.pagado_en ? new Date(r.pagado_en).toISOString() : null,
      };
    });

    return res.json(normalized);
  } catch (e) {
    return res.status(500).json({ mensaje: e.message || "Error interno" });
  }
}

export async function pagarComision(req, res) {
  try {
    const { barbero_id, semana_inicio, fecha_fin } = req.body;
    if (!barbero_id || !semana_inicio)
      return res
        .status(400)
        .json({ mensaje: "barbero_id y semana_inicio son requeridos" });

    let semanaFin = fecha_fin;
    if (!semanaFin) {
      const semanaFinDate = new Date(semana_inicio + "T00:00:00Z");
      semanaFinDate.setUTCDate(semanaFinDate.getUTCDate() + 7);
      semanaFin = semanaFinDate.toISOString().slice(0, 10);
    }

    const sqlTotales = `
      SELECT
        ROUND(IFNULL(SUM(vs.subtotal),0),2) AS total_generado,
        ROUND(IFNULL(SUM(COALESCE(vs.comision_monto, vs.subtotal * (cc.pct_por_defecto/100))),0),2) AS monto_barbero_bruto,
        ROUND(IFNULL((SELECT SUM(bs.monto) FROM barbero_sanciones bs WHERE bs.barbero_id = ? AND bs.esta_activo = 1 AND bs.fecha >= ? AND bs.fecha <= ?), 0), 2) AS total_sanciones
      FROM venta_servicios vs
      JOIN ventas v ON vs.venta_id = v.id
      CROSS JOIN configuracion_comisiones cc
      WHERE vs.barbero_id = ? AND v.estado = 'pagada' AND v.fecha_hora >= ? AND v.fecha_hora <= ?
    `;

    const conn = await pool.getConnection();
    const [rows] = await conn.query(sqlTotales, [
      barbero_id,
      semana_inicio,
      semanaFin,
      barbero_id,
      semana_inicio + " 00:00:00",
      semanaFin + " 23:59:59",
    ]);

    const total_generado = parseFloat(rows[0].total_generado || 0);
    const monto_barbero_bruto = parseFloat(rows[0].monto_barbero_bruto || 0);
    const total_sanciones = parseFloat(rows[0].total_sanciones || 0);
    
    const monto_barbero = parseFloat(Math.max(0, monto_barbero_bruto - total_sanciones).toFixed(2));
    const monto_barberia = parseFloat((total_generado - monto_barbero).toFixed(2));

    const sqlUpsert = `
      INSERT INTO liquidaciones_semanales (barbero_id, semana_inicio, total_generado, monto_barbero, monto_barberia, pagado, pagado_en)
      VALUES (?, ?, ?, ?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE
        total_generado = VALUES(total_generado),
        monto_barbero = VALUES(monto_barbero),
        monto_barberia = VALUES(monto_barberia),
        pagado = 1,
        pagado_en = NOW()
    `;
    await conn.query(sqlUpsert, [
      barbero_id,
      semana_inicio,
      total_generado,
      monto_barbero,
      monto_barberia,
    ]);
    conn.release();

    return res.json({
      barbero_id,
      semana_inicio,
      total_generado,
      total_sanciones,
      monto_barbero,
      monto_barberia,
      pagado: true,
      pagado_en: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ mensaje: e.message || "Error interno" });
  }
}
