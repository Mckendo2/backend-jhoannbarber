import { z } from "zod";
import { pool } from "../db/mysql.js";
import dayjs from "dayjs";

const crearCitaSchema = z.object({
  cliente: z
    .object({
      nombres: z.string().max(100).nullable().optional(),
      apellidos: z.string().max(100).nullable().optional(),
      correo_electronico: z.string().email().nullable().optional(),
      telefono: z.string().max(30).nullable().optional(),
    })
    .optional(),
  cliente_id: z.number().int().positive().nullable().optional(),
  barbero_id: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  duracion_minutos: z.number().int().positive(),
  servicios: z.array(z.number().int().positive()).min(1),
  notas: z.string().nullable().optional(),
});

function diaSemana(fecha) {
  const d = new Date(`${fecha}T00:00:00`);
  const js = d.getUTCDay();
  return js === 0 ? 7 : js;
}

function cubreServiciosSql(idsLen) {
  const placeholders = Array(idsLen).fill("?").join(",");
  return `
    SELECT COUNT(1) AS n
    FROM barbero_servicios bs
    WHERE bs.barbero_id=? AND bs.esta_activo=1 AND bs.servicio_id IN (${placeholders})
  `;
}

export async function serviciosActivos(req, res) {
  const qtxt = req.query.q ? `%${req.query.q}%` : null;
  const vals = [];
  let where = "WHERE s.esta_activo=1";
  if (qtxt) {
    where += " AND (s.nombre LIKE ? OR s.descripcion LIKE ?)";
    vals.push(qtxt, qtxt);
  }

  const [rows] = await pool.query(
    `SELECT s.id,
            s.nombre,
            s.duracion_minutos,
            s.precio,
            s.foto_principal
     FROM servicios s
     ${where}
     ORDER BY s.nombre
     LIMIT 100`,
    vals
  );

  const out = rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    duracion_minutos: Number(r.duracion_minutos || 0),
    precio: r.precio == null ? "0.00" : String(r.precio),
    foto_principal: r.foto_principal || null,
  }));

  res.json({ data: out });
}

export async function barberosDisponibles(req, res) {
  const fecha = String(req.query.fecha || "");
  const hora = String(req.query.hora || "");

  const rawSrv = req.query.servicios ?? [];
  const servicios = []
    .concat(rawSrv)
    .flatMap((v) => (Array.isArray(v) ? v : String(v).split(",")))
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!fecha || !hora || servicios.length === 0) {
    return res.json({ data: [] });
  }

  const hoy = dayjs().format("YYYY-MM-DD");
  if (fecha < hoy) {
    return res
      .status(400)
      .json({ mensaje: "La fecha no puede ser en el pasado" });
  }

  const maxFecha = dayjs().add(14, "days").format("YYYY-MM-DD");
  if (fecha > maxFecha) {
    return res
      .status(400)
      .json({ mensaje: "La cita no puede ser más de 2 semanas en adelante" });
  }

  const srvPh = servicios.map(() => "?").join(",");
  const dia = diaSemana(fecha);

  try {
    const [[durRow]] = await pool.query(
      `SELECT COALESCE(SUM(s.duracion_minutos), 0) AS duracion_total
       FROM servicios s
       WHERE s.id IN (${srvPh}) AND s.esta_activo = 1`,
      servicios
    );
    const durTotal = Number(durRow?.duracion_total || 0);
    if (durTotal === 0) {
      return res.json({ data: [] });
    }
    const params = [
      ...servicios,
      fecha,
      hora,
      hora,
      durTotal,
      dia,
      hora,
      hora,
      durTotal,
      fecha,
      hora,
      hora,
      durTotal,
      servicios.length,
    ];

    const [rows] = await pool.query(
      `
      SELECT
        u.id,
        COALESCE(NULLIF(CONCAT(IFNULL(u.nombres,''),' ',IFNULL(u.apellidos,'')),' '), u.correo_electronico) AS nombre
      FROM usuarios u
      JOIN usuario_rol ur ON ur.usuario_id = u.id AND ur.esta_activo = 1
      JOIN roles r ON r.id = ur.rol_id AND r.esta_activo = 1 AND r.nombre = 'Barbero'
      JOIN barbero_servicios bs
        ON bs.barbero_id = u.id
        AND bs.esta_activo = 1
        AND bs.servicio_id IN (${srvPh})
      WHERE
        u.esta_activo = 1
        AND NOT EXISTS (
          SELECT 1
          FROM citas c
          WHERE c.barbero_id = u.id
            AND c.fecha = ?
            AND c.estado IN ('pendiente','confirmada')
            AND TIME(?) < ADDTIME(c.hora, SEC_TO_TIME(c.duracion_minutos*60))
            AND c.hora < ADDTIME(TIME(?), SEC_TO_TIME(?*60))
        )
        AND EXISTS (
          SELECT 1
          FROM barbero_horarios bh
          WHERE bh.barbero_id = u.id
            AND bh.esta_activo = 1
            AND bh.dia_semana = ?
            AND TIME(?) >= bh.hora_inicio
            AND ADDTIME(TIME(?), SEC_TO_TIME(?*60)) <= bh.hora_fin
        )
        AND NOT EXISTS (
          SELECT 1
          FROM barbero_bloqueos bb
          WHERE bb.barbero_id = u.id
            AND bb.fecha = ?
            AND bb.esta_activo = 1
            AND TIME(?) < bb.hora_fin
            AND bb.hora_inicio < ADDTIME(TIME(?), SEC_TO_TIME(?*60))
        )
      GROUP BY u.id, u.nombres, u.apellidos, u.correo_electronico
      HAVING COUNT(DISTINCT bs.servicio_id) = ?
      ORDER BY nombre
      `,
      params
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function crearCita(req, res) {
  const p = crearCitaSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const d = p.data;

  const hoy = dayjs().format("YYYY-MM-DD");
  if (d.fecha < hoy) {
    return res
      .status(400)
      .json({ mensaje: "La fecha no puede ser en el pasado" });
  }

  const maxFecha = dayjs().add(14, "days").format("YYYY-MM-DD");
  if (d.fecha > maxFecha) {
    return res
      .status(400)
      .json({ mensaje: "La cita no puede ser más de 2 semanas en adelante" });
  }

  const dia = diaSemana(d.fecha);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let clienteId = d.cliente_id ?? null;
    if (!clienteId && d.cliente) {
      const [ins] = await conn.execute(
        `INSERT INTO clientes (nombres,apellidos,correo_electronico,telefono,esta_activo,creado_por,actualizado_por)
         VALUES (?,?,?,?,?,?,?)`,
        [
          d.cliente.nombres ?? null,
          d.cliente.apellidos ?? null,
          d.cliente.correo_electronico ?? null,
          d.cliente.telefono ?? null,
          1,
          null,
          null,
        ]
      );
      clienteId = ins.insertId;
    }

    const [[durRow]] = await conn.query(
      `SELECT COALESCE(SUM(duracion_minutos), 0) AS duracion_total
       FROM servicios
       WHERE id IN (${d.servicios
         .map(() => "?")
         .join(",")}) AND esta_activo = 1`,
      d.servicios
    );

    const durTotal = Number(durRow?.duracion_total || 0);

    if (durTotal === 0) {
      await conn.rollback();
      return res.status(400).json({ mensaje: "Los servicios no existen" });
    }

    const [[{ n: nOvl }]] = await conn.query(
      `SELECT COUNT(1) AS n
       FROM citas
       WHERE barbero_id=? AND fecha=? AND estado IN ('pendiente','confirmada')
         AND TIME(?) < ADDTIME(hora, SEC_TO_TIME(duracion_minutos*60))
         AND hora < ADDTIME(TIME(?), SEC_TO_TIME(?*60))`,
      [d.barbero_id, d.fecha, d.hora, d.hora, durTotal]
    );
    if (Number(nOvl) > 0) {
      await conn.rollback();
      return res.status(409).json({ mensaje: "Horario no disponible" });
    }

    const [[{ n: nTurno }]] = await conn.query(
      `SELECT COUNT(1) AS n
       FROM barbero_horarios h
       WHERE h.barbero_id=? AND h.esta_activo=1 AND h.dia_semana=?
         AND TIME(?) >= h.hora_inicio
         AND ADDTIME(TIME(?), SEC_TO_TIME(?*60)) <= h.hora_fin`,
      [d.barbero_id, dia, d.hora, d.hora, durTotal]
    );
    if (Number(nTurno) === 0) {
      await conn.rollback();
      return res.status(409).json({ mensaje: "Fuera del horario del barbero" });
    }

    const [[{ n: nSrv }]] = await conn.query(
      cubreServiciosSql(d.servicios.length),
      [d.barbero_id, ...d.servicios]
    );
    if (Number(nSrv) !== d.servicios.length) {
      await conn.rollback();
      return res.status(409).json({
        mensaje: "El barbero no presta todos los servicios seleccionados",
      });
    }

    const [[{ n: nBloqueo }]] = await conn.query(
      `SELECT COUNT(1) AS n
       FROM barbero_bloqueos
       WHERE barbero_id=? AND fecha=? AND esta_activo=1
         AND TIME(?) < hora_fin
         AND hora_inicio < ADDTIME(TIME(?), SEC_TO_TIME(?*60))`,
      [d.barbero_id, d.fecha, d.hora, d.hora, d.duracion_minutos]
    );
    if (Number(nBloqueo) > 0) {
      await conn.rollback();
      return res
        .status(409)
        .json({ mensaje: "El barbero tiene un bloqueo en ese horario" });
    }

    const [insCita] = await conn.execute(
      `INSERT INTO citas (cliente_id,barbero_id,fecha,hora,duracion_minutos,estado,notas,creado_por,actualizado_por)
       VALUES (?,?,?,?,?,'pendiente',?,?,?)`,
      [
        clienteId,
        d.barbero_id,
        d.fecha,
        d.hora,
        durTotal,
        d.notas ?? null,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    const citaId = insCita.insertId;

    for (const sid of d.servicios) {
      await conn.execute(
        `INSERT INTO cita_servicio (cita_id,servicio_id,precio_aplicado,esta_activo,creado_por,actualizado_por)
         VALUES (?,?,?,?,?,?)`,
        [
          citaId,
          sid,
          null,
          1,
          req.usuario?.sub || null,
          req.usuario?.sub || null,
        ]
      );
    }
    await conn.commit();
    res.status(201).json({ data: { id: citaId } });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    res.status(400).json({ mensaje: e.message || "Error" });
  } finally {
    conn.release();
  }
}

export async function citasSemana(req, res) {
  const start = req.query.start;
  const end = req.query.end;
  if (!start || !end)
    return res.status(422).json({ mensaje: "Datos inválidos" });

  try {
    const usuarioId = req.usuario?.sub ? Number(req.usuario.sub) : null;
    let esBarbero = false;
    if (usuarioId) {
      const [roles] = await pool.query(
        `SELECT r.nombre
         FROM usuario_rol ur
         JOIN roles r ON r.id = ur.rol_id
         WHERE ur.usuario_id = ? AND ur.esta_activo = 1`,
        [usuarioId]
      );
      esBarbero = roles.some(
        (r) => String(r.nombre).toLowerCase() === "barbero"
      );
    }

    const whereClauses = ["c.fecha >= ? AND c.fecha < ?"];
    const params = [start, end];

    if (esBarbero) {
      whereClauses.push("c.barbero_id = ?");
      params.push(usuarioId);
    }

    const whereSql = "WHERE " + whereClauses.join(" AND ");

    const [rows] = await pool.query(
      `SELECT 
         c.id,
         c.fecha,
         c.hora,
         c.duracion_minutos,
         c.estado,
         c.notas,
         c.barbero_id,
         COALESCE(NULLIF(CONCAT(IFNULL(u.nombres,''),' ',IFNULL(u.apellidos,'')),' '),u.correo_electronico) AS barbero_nombre,
         c.cliente_id,
         COALESCE(NULLIF(CONCAT(IFNULL(cl.nombres,''),' ',IFNULL(cl.apellidos,'')),' '),cl.correo_electronico) AS cliente_nombre,
         GROUP_CONCAT(s.nombre SEPARATOR '||') AS servicios_nombres,
         GROUP_CONCAT(cs.servicio_id) AS servicios_ids
       FROM citas c
       JOIN usuarios u ON u.id=c.barbero_id
       LEFT JOIN clientes cl ON cl.id=c.cliente_id
       LEFT JOIN cita_servicio cs ON cs.cita_id = c.id AND cs.esta_activo = 1
       LEFT JOIN servicios s ON s.id = cs.servicio_id
       ${whereSql}
       GROUP BY c.id
       ORDER BY c.fecha,c.hora`,
      params
    );

    const out = rows.map((r) => ({
      ...r,
      servicios: r.servicios_nombres ? r.servicios_nombres.split("||") : [],
      servicios_ids: r.servicios_ids
        ? r.servicios_ids.split(",").map((x) => Number(x))
        : [],
    }));

    res.json({ data: out });
  } catch (e) {
    res.status(400).json({ mensaje: e.message || "Error" });
  }
}

export async function actualizarEstadoCita(req, res) {
  const id = Number(req.params.id);
  const estado = String(req.body?.estado || "").trim();
  if (!id || !estado)
    return res.status(422).json({ mensaje: "Datos inválidos" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[cita]] = await conn.query("SELECT * FROM citas WHERE id=?", [id]);
    if (!cita) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ mensaje: "No encontrado" });
    }

    await conn.execute(
      "UPDATE citas SET estado=?, actualizado_por=? WHERE id=?",
      [estado, req.usuario?.sub || null, id]
    );

    if (estado === "completada") {
      const [[ex]] = await conn.query(
        "SELECT v.id FROM venta_servicios vs JOIN ventas v ON v.id=vs.venta_id WHERE vs.cita_id=? LIMIT 1",
        [id]
      );

      if (!ex) {
        const clienteId = cita.cliente_id || null;
        const [insertVenta] = await conn.execute(
          "INSERT INTO ventas (cliente_id,cajero_id,estado,total,metodo_pago,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
          [
            clienteId,
            req.usuario?.sub || null,
            "pagada",
            0,
            "efectivo",
            1,
            req.usuario?.sub || null,
            req.usuario?.sub || null,
          ]
        );
        const ventaId = insertVenta.insertId;

        const [cs] = await conn.query(
          `SELECT 
             cs.id,
             cs.servicio_id,
             cs.precio_aplicado,
             s.precio AS servicio_precio,
             s.duracion_minutos AS servicio_duracion
           FROM cita_servicio cs
           JOIN servicios s ON s.id = cs.servicio_id
           WHERE cs.cita_id=? AND cs.esta_activo=1`,
          [id]
        );

        let total = 0;
        for (const it of cs) {
          const precio = Number(it.precio_aplicado ?? it.servicio_precio ?? 0);
          const duracion = Number(
            it.servicio_duracion ?? cita.duracion_minutos ?? 60
          );

          const subtotal = precio;

          total += subtotal;

          const barberoId = cita.barbero_id || null;

          await conn.execute(
            `INSERT INTO venta_servicios 
              (venta_id,cita_id,servicio_id,barbero_id,duracion_minutos,precio_unitario,subtotal,comision_pct,comision_monto,esta_activo,creado_por,actualizado_por)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              ventaId,
              id,
              it.servicio_id,
              barberoId,
              duracion,
              precio,
              subtotal,
              null,
              null,
              1,
              req.usuario?.sub || null,
              req.usuario?.sub || null,
            ]
          );
        }

        await conn.execute("UPDATE ventas SET total=? WHERE id=?", [
          total,
          ventaId,
        ]);
      }
    }
    await conn.commit();
    res.json({ mensaje: "Actualizado" });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ mensaje: e.message || "Error" });
  } finally {
    conn.release();
  }
}

export async function eliminarCita(req, res) {
  const id = Number(req.params.id);
  await pool.execute("DELETE FROM citas WHERE id=?", [id]);
  res.json({ mensaje: "Eliminado" });
}

export async function misCitas(req, res) {
  const correo = req.query.correo || null;
  const telefono = req.query.telefono || null;
  if (!correo && !telefono) return res.json({ data: [] });
  const [rows] = await pool.query(
    `SELECT
       c.id,c.fecha,c.hora,c.duracion_minutos,c.estado,c.notas,
       c.barbero_id,
       COALESCE(NULLIF(CONCAT(IFNULL(u.nombres,''),' ',IFNULL(u.apellidos,'')),' '),u.correo_electronico) AS barbero_nombre
     FROM citas c
     JOIN clientes cl ON cl.id=c.cliente_id
     JOIN usuarios u ON u.id=c.barbero_id
     WHERE (cl.correo_electronico=? OR cl.telefono=?) AND cl.esta_activo=1
     ORDER BY c.fecha DESC,c.hora DESC
     LIMIT 100`,
    [correo, telefono]
  );
  res.json({ data: rows });
}
