import { pool } from "../db/mysql.js";

export async function resumenGeneral(req, res) {
  try {
    const [[{ ventasHoy = 0 }]] = await pool.query(
      `SELECT IFNULL(SUM(total), 0) ventasHoy FROM ventas 
       WHERE DATE(fecha_hora) = CURDATE() AND estado = 'pagada' AND esta_activo = 1`
    );

    const [[{ gastosHoy = 0 }]] = await pool.query(
      `SELECT IFNULL(SUM(monto), 0) gastosHoy FROM gastos 
       WHERE DATE(fecha) = CURDATE() AND esta_activo = 1`
    );

    const [[{ citasHoy = 0 }]] = await pool.query(
      `SELECT COUNT(1) citasHoy FROM citas 
       WHERE DATE(fecha) = CURDATE() AND estado IN ('pendiente', 'confirmada', 'completada')`
    );

    const [[{ clientesActivos = 0 }]] = await pool.query(
      `SELECT COUNT(1) clientesActivos FROM clientes WHERE esta_activo = 1`
    );

    res.json({
      data: {
        ventasHoy: Number(ventasHoy),
        gastosHoy: Number(gastosHoy),
        citasHoy: Number(citasHoy),
        clientesActivos: Number(clientesActivos),
      },
    });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function ventasUltimos7Dias(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT DATE(fecha_hora) fecha, SUM(total) total, COUNT(1) cantidad
       FROM ventas 
       WHERE fecha_hora >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) 
       AND estado = 'pagada' AND esta_activo = 1
       GROUP BY DATE(fecha_hora)
       ORDER BY fecha ASC`
    );

    const data = rows.map((r) => ({
      fecha: r.fecha,
      total: Number(r.total),
      cantidad: Number(r.cantidad),
    }));

    res.json({ data });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function gastosUltimos7Dias(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT DATE(fecha) fecha, SUM(monto) total, COUNT(1) cantidad
       FROM gastos 
       WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND esta_activo = 1
       GROUP BY DATE(fecha)
       ORDER BY fecha ASC`
    );

    const data = rows.map((r) => ({
      fecha: r.fecha,
      total: Number(r.total),
      cantidad: Number(r.cantidad),
    }));

    res.json({ data });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function ventasPorBarbero(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT 
         u.id, 
         COALESCE(CONCAT(IFNULL(u.nombres,''), ' ', IFNULL(u.apellidos,'')), u.correo_electronico) nombre,
         SUM(vs.subtotal) total,
         COUNT(DISTINCT vs.venta_id) cantidad
       FROM venta_servicios vs
       JOIN usuarios u ON u.id = vs.barbero_id
       JOIN ventas v ON v.id = vs.venta_id AND v.estado = 'pagada'
       WHERE DATE(v.fecha_hora) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY u.id, nombre
       ORDER BY total DESC
       LIMIT 10`
    );

    const data = rows.map((r) => ({
      barbero: r.nombre,
      total: Number(r.total),
      cantidad: Number(r.cantidad),
    }));

    res.json({ data });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function citasPorEstado(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT estado, COUNT(1) cantidad
       FROM citas
       WHERE DATE(fecha) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY estado`
    );

    const data = rows.map((r) => ({
      estado: r.estado,
      cantidad: Number(r.cantidad),
    }));

    res.json({ data });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function productosMasVendidos(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT 
         p.id,
         p.nombre,
         SUM(vp.cantidad) cantidad,
         SUM(vp.subtotal) total
       FROM venta_productos vp
       JOIN productos p ON p.id = vp.producto_id
       JOIN ventas v ON v.id = vp.venta_id AND v.estado = 'pagada'
       WHERE DATE(v.fecha_hora) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY p.id, p.nombre
       ORDER BY cantidad DESC
       LIMIT 10`
    );

    const data = rows.map((r) => ({
      producto: r.nombre,
      cantidad: Number(r.cantidad),
      total: Number(r.total),
    }));

    res.json({ data });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function comparativoIngresoGasto(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT t.fecha, SUM(t.monto) AS total
       FROM (
         SELECT DATE(fecha_hora) AS fecha, SUM(total) AS monto
         FROM ventas
         WHERE estado = 'pagada' AND esta_activo = 1
         GROUP BY DATE(fecha_hora)

         UNION ALL

         SELECT DATE(fecha) AS fecha, -SUM(monto) AS monto
         FROM gastos
         WHERE esta_activo = 1
         GROUP BY DATE(fecha)
       ) t
       WHERE t.fecha >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY t.fecha
       ORDER BY t.fecha ASC`
    );

    const data = rows.map((r) => ({
      fecha: r.fecha,
      total: Number(r.total),
    }));

    res.json({ data });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function listaBarberos(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT 
         u.id,
         COALESCE(CONCAT(IFNULL(u.nombres,''), ' ', IFNULL(u.apellidos,'')), u.correo_electronico) nombre,
         SUM(vs.subtotal) total_ingresos,
         COUNT(DISTINCT vs.venta_id) total_citas,
         AVG(COALESCE((SELECT AVG(CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(c.notas, 'rating:', -1), ' ', 1) AS DECIMAL(3,1))) FROM citas c WHERE c.barbero_id = u.id AND DATE(c.fecha) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)), 0)) calificacion_promedio,
         ROUND((COUNT(CASE WHEN c.estado = 'completada' THEN 1 END) / NULLIF(COUNT(CASE WHEN c.estado IN ('completada', 'cancelada', 'no_asistio') THEN 1 END), 0) * 100), 2) tasa_completado
       FROM usuarios u
       JOIN usuario_rol ur ON ur.usuario_id = u.id AND ur.esta_activo = 1
       JOIN roles r ON r.id = ur.rol_id AND r.nombre = 'Barbero'
       LEFT JOIN venta_servicios vs ON vs.barbero_id = u.id
       LEFT JOIN ventas v ON v.id = vs.venta_id AND v.estado = 'pagada'
       LEFT JOIN citas c ON c.barbero_id = u.id AND DATE(c.fecha) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       WHERE u.esta_activo = 1
       GROUP BY u.id, nombre
       ORDER BY total_ingresos DESC`
    );

    const data = rows.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      totalIngresos: Number(r.total_ingresos) || 0,
      totalCitas: Number(r.total_citas) || 0,
      calificacion: Number(r.calificacion_promedio) || 0,
      tasaCompletado: Number(r.tasa_completado) || 0,
    }));

    res.json({ data });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}

export async function detalleBarbero(req, res) {
  const barberoId = Number(req.params.id);
  if (!barberoId) return res.status(404).json({ mensaje: "No encontrado" });

  try {
    // Datos generales
    const [[usuario]] = await pool.query(
      `SELECT 
         u.id,
         COALESCE(CONCAT(IFNULL(u.nombres,''), ' ', IFNULL(u.apellidos,'')), u.correo_electronico) nombre,
         u.correo_electronico,
         u.telefono
       FROM usuarios u
       WHERE u.id = ? AND u.esta_activo = 1`,
      [barberoId]
    );

    if (!usuario) return res.status(404).json({ mensaje: "No encontrado" });

    // Totales 30 días
    const [[totales]] = await pool.query(
      `SELECT 
         SUM(vs.subtotal) total_ingresos,
         COUNT(DISTINCT vs.venta_id) total_citas,
         COUNT(CASE WHEN c.estado = 'completada' THEN 1 END) citas_completadas,
         ROUND((COUNT(CASE WHEN c.estado = 'completada' THEN 1 END) / NULLIF(COUNT(CASE WHEN c.estado IN ('completada', 'cancelada', 'no_asistio') THEN 1 END), 0) * 100), 2) tasa_completado
       FROM venta_servicios vs
       JOIN ventas v ON v.id = vs.venta_id AND v.estado = 'pagada'
       LEFT JOIN citas c ON c.barbero_id = vs.barbero_id AND DATE(c.fecha) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       WHERE vs.barbero_id = ? AND DATE(v.fecha_hora) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
      [barberoId]
    );

    // Tendencia últimos 6 meses
    const [tendencia] = await pool.query(
      `SELECT DATE_FORMAT(DATE(v.fecha_hora), '%Y-%m') mes, SUM(vs.subtotal) total
       FROM venta_servicios vs
       JOIN ventas v ON v.id = vs.venta_id AND v.estado = 'pagada'
       WHERE vs.barbero_id = ? AND DATE(v.fecha_hora) >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(DATE(v.fecha_hora), '%Y-%m')
       ORDER BY mes ASC`,
      [barberoId]
    );

    // Servicios realizados
    const [servicios] = await pool.query(
      `SELECT 
         s.nombre,
         COUNT(DISTINCT vs.venta_id) cantidad,
         SUM(vs.subtotal) total
       FROM venta_servicios vs
       JOIN servicios s ON s.id = vs.servicio_id
       JOIN ventas v ON v.id = vs.venta_id AND v.estado = 'pagada'
       WHERE vs.barbero_id = ? AND DATE(v.fecha_hora) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY s.id, s.nombre
       ORDER BY total DESC`,
      [barberoId]
    );

    res.json({
      data: {
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          correo: usuario.correo_electronico,
          telefono: usuario.telefono,
        },
        totales: {
          ingresos: Number(totales?.total_ingresos) || 0,
          citas: Number(totales?.total_citas) || 0,
          citasCompletadas: Number(totales?.citas_completadas) || 0,
          tasaCompletado: Number(totales?.tasa_completado) || 0,
        },
        tendencia: tendencia.map((t) => ({
          mes: t.mes,
          total: Number(t.total),
        })),
        servicios: servicios.map((s) => ({
          servicio: s.nombre,
          cantidad: Number(s.cantidad),
          total: Number(s.total),
        })),
      },
    });
  } catch (e) {
    res.status(400).json({ mensaje: e.message });
  }
}
