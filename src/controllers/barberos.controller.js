import { pool } from "../db/mysql.js";
import path from "path";
import fs from "fs";
import { query } from "../db/mysql.js";

const ROLE_NAME = "Barbero";

export async function listarBarberos(req, res) {
  const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
  const per = Math.min(
    100,
    Math.max(1, parseInt(req.query.per_page ?? "12", 10))
  );
  const q = req.query.q ? `%${req.query.q}%` : null;
  const estado =
    req.query.estado === "inactivo"
      ? 0
      : req.query.estado === "activo"
      ? 1
      : null;
  const cond = [
    "EXISTS(SELECT 1 FROM usuario_rol ur JOIN roles r ON r.id=ur.rol_id AND r.esta_activo=1 WHERE ur.usuario_id=u.id AND ur.esta_activo=1 AND LOWER(TRIM(r.nombre))=?)",
  ];
  const vals = [ROLE_NAME];
  if (q) {
    cond.push(
      "(u.correo_electronico LIKE ? OR u.nombres LIKE ? OR u.apellidos LIKE ? OR u.telefono LIKE ?)"
    );
    vals.push(q, q, q, q);
  }
  if (estado !== null) {
    cond.push("u.esta_activo=?");
    vals.push(estado);
  }
  const where = `WHERE ${cond.join(" AND ")}`;
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(1) total FROM usuarios u ${where}`,
    vals
  );
  const [rows] = await pool.query(
    `SELECT u.id,u.correo_electronico,u.nombres,u.apellidos,u.telefono,u.esta_activo,u.creado_en
     FROM usuarios u ${where}
     ORDER BY COALESCE(u.nombres,''),COALESCE(u.apellidos,'')
     LIMIT ? OFFSET ?`,
    [...vals, per, (page - 1) * per]
  );
  if (!rows.length) return res.status(404).json({ mensaje: "No encontrado" });
  res.json({
    data: rows,
    meta: { total, page, per_page: per, pages: Math.ceil(total / per) },
  });
}

export async function detalleBarbero(req, res) {
  const id = Number(req.params.id);
  const [u] = await pool.execute(
    `SELECT u.id,u.correo_electronico,u.nombres,u.apellidos,u.telefono,u.esta_activo,u.creado_en
     FROM usuarios u WHERE u.id=?`,
    [id]
  );
  if (!u.length) return res.status(404).json({ mensaje: "No encontrado" });
  const [ok] = await pool.execute(
    `SELECT 1 FROM usuario_rol ur JOIN roles r ON r.id=ur.rol_id AND r.esta_activo=1
     WHERE ur.usuario_id=? AND ur.esta_activo=1 AND LOWER(TRIM(r.nombre))=? LIMIT 1`,
    [id, ROLE_NAME]
  );
  if (!ok.length) return res.status(404).json({ mensaje: "No encontrado" });
  res.json({ data: u[0] });
}

export async function listarServiciosBarbero(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.execute(
    `SELECT s.id,s.nombre,s.descripcion
     FROM barbero_servicios bs
     JOIN servicios s ON s.id=bs.servicio_id AND s.esta_activo=1
     WHERE bs.barbero_id=? AND bs.esta_activo=1
     ORDER BY s.nombre`,
    [id]
  );
  res.json({ data: rows });
}

export async function syncServiciosBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const lista = Array.isArray(req.body?.servicios)
    ? req.body.servicios.map(Number).filter(Boolean)
    : [];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE barbero_servicios SET esta_activo=0, actualizado_por=? WHERE barbero_id=?",
      [req.usuario.sub, id]
    );
    if (lista.length) {
      const [serv] = await conn.query(
        "SELECT id FROM servicios WHERE id IN (?) AND esta_activo=1",
        [lista]
      );
      const setOk = new Set(serv.map((x) => x.id));
      for (const sid of lista) {
        if (!setOk.has(sid)) continue;
        await conn.execute(
          "INSERT INTO barbero_servicios (barbero_id,servicio_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=1, actualizado_por=VALUES(actualizado_por)",
          [id, sid, 1, req.usuario.sub, req.usuario.sub]
        );
      }
    }
    await conn.commit();
    const [rows] = await conn.execute(
      `SELECT s.id,s.nombre FROM barbero_servicios bs JOIN servicios s ON s.id=bs.servicio_id
       WHERE bs.barbero_id=? AND bs.esta_activo=1 AND s.esta_activo=1 ORDER BY s.nombre`,
      [id]
    );
    res.json({ data: rows });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ mensaje: e.message });
  } finally {
    conn.release();
  }
}

export async function listarHorariosBarbero(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.execute(
    `SELECT id,dia_semana,hora_inicio,hora_fin,esta_activo
     FROM barbero_horarios WHERE barbero_id=? AND esta_activo=1
     ORDER BY dia_semana,hora_inicio`,
    [id]
  );
  res.json({ data: rows });
}

function parseHM(x) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(x || ""));
  if (!m) return null;
  const hh = Number(m[1]),
    mm = Number(m[2]);
  return hh * 60 + mm;
}

export async function upsertHorariosBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const horarios = Array.isArray(req.body?.horarios) ? req.body.horarios : [];
  if (!horarios.length) {
    await pool.execute(
      "UPDATE barbero_horarios SET esta_activo=0, actualizado_por=? WHERE barbero_id=?",
      [req.usuario.sub, id]
    );
    return res.json({ data: [] });
  }
  const porDia = new Map();
  for (const h of horarios) {
    const d = Number(h.dia_semana);
    const hi = parseHM(h.hora_inicio);
    const hf = parseHM(h.hora_fin);
    if (![1, 2, 3, 4, 5, 6, 7].includes(d))
      return res.status(422).json({ mensaje: "Día inválido" });
    if (hi == null || hf == null || hi >= hf)
      return res.status(422).json({ mensaje: "Rango inválido" });
    const arr = porDia.get(d) || [];
    arr.push([hi, hf]);
    porDia.set(d, arr);
  }
  for (const [d, arr] of porDia.entries()) {
    arr.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i][0] < arr[i - 1][1])
        return res.status(422).json({ mensaje: `Traslape en día ${d}` });
    }
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE barbero_horarios SET esta_activo=0, actualizado_por=? WHERE barbero_id=?",
      [req.usuario.sub, id]
    );
    for (const [d, arr] of porDia.entries()) {
      for (const [hi, hf] of arr) {
        const sHi = `${String(Math.floor(hi / 60)).padStart(2, "0")}:${String(
          hi % 60
        ).padStart(2, "0")}`;
        const sHf = `${String(Math.floor(hf / 60)).padStart(2, "0")}:${String(
          hf % 60
        ).padStart(2, "0")}`;
        await conn.execute(
          "INSERT INTO barbero_horarios (barbero_id,dia_semana,hora_inicio,hora_fin,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=1, actualizado_por=VALUES(actualizado_por)",
          [id, d, sHi, sHf, 1, req.usuario.sub, req.usuario.sub]
        );
      }
    }
    await conn.commit();
    const [rows] = await conn.execute(
      `SELECT id,dia_semana,hora_inicio,hora_fin,esta_activo
       FROM barbero_horarios WHERE barbero_id=? AND esta_activo=1
       ORDER BY dia_semana,hora_inicio`,
      [id]
    );
    res.json({ data: rows });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ mensaje: e.message });
  } finally {
    conn.release();
  }
}

export async function listarBloqueosBarbero(req, res) {
  const id = Number(req.params.id);
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const cond = ["barbero_id=?", "esta_activo=1"];
  const vals = [id];
  if (desde) {
    cond.push("fecha>=?");
    vals.push(desde);
  }
  if (hasta) {
    cond.push("fecha<=?");
    vals.push(hasta);
  }
  const [rows] = await pool.execute(
    `SELECT id,fecha,hora_inicio,hora_fin,motivo,esta_activo
     FROM barbero_bloqueos WHERE ${cond.join(" AND ")}
     ORDER BY fecha DESC,hora_inicio`,
    vals
  );
  res.json({ data: rows });
}

export async function crearBloqueoBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const fecha = req.body?.fecha;
  const hi = req.body?.hora_inicio;
  const hf = req.body?.hora_fin;
  const motivo = req.body?.motivo ?? null;
  if (!fecha || !hi || !hf)
    return res.status(422).json({ mensaje: "Datos inválidos" });
  const [ex] = await pool.execute(
    `SELECT 1 FROM barbero_bloqueos
     WHERE barbero_id=? AND fecha=? AND esta_activo=1 AND NOT (? >= hora_fin OR ? <= hora_inicio) LIMIT 1`,
    [id, fecha, hi, hf]
  );
  if (ex.length)
    return res.status(409).json({ mensaje: "Traslape con otro bloqueo" });
  const [r] = await pool.execute(
    `INSERT INTO barbero_bloqueos (barbero_id,fecha,hora_inicio,hora_fin,motivo,esta_activo,creado_por,actualizado_por)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, fecha, hi, hf, motivo, 1, req.usuario.sub, req.usuario.sub]
  );
  const [row] = await pool.execute(
    "SELECT id,fecha,hora_inicio,hora_fin,motivo,esta_activo FROM barbero_bloqueos WHERE id=?",
    [r.insertId]
  );
  res.status(201).json({ data: row[0] });
}

export async function eliminarBloqueoBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const bloqueoId = Number(req.params.bloqueoId);
  await pool.execute(
    "UPDATE barbero_bloqueos SET esta_activo=0, actualizado_por=? WHERE id=? AND barbero_id=?",
    [req.usuario.sub, bloqueoId, id]
  );
  res.json({ mensaje: "Eliminado" });
}

export async function obtenerContratoBarbero(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.execute(
    "SELECT id,barbero_id,fecha_inicio,fecha_fin,comprobante_url,esta_activo FROM barbero_contratos WHERE barbero_id=? AND esta_activo=1",
    [id]
  );
  res.json({ data: rows });
}

export async function subirContratoBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const fecha_inicio = req.body?.fecha_inicio || null;
  const fecha_fin = req.body?.fecha_fin || null;
  if (!fecha_inicio)
    return res.status(422).json({ mensaje: "Fecha inicio requerida" });

  const comprobante = req.file
    ? `/upload/contratos/${req.file.filename}`
    : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE barbero_contratos SET esta_activo=0, actualizado_por=? WHERE barbero_id=?",
      [req.usuario.sub, id]
    );
    const [r] = await conn.execute(
      `INSERT INTO barbero_contratos (barbero_id,fecha_inicio,fecha_fin,comprobante_url,esta_activo,creado_por,actualizado_por)
       VALUES (?,?,?,?,?,?,?)`,
      [
        id,
        fecha_inicio,
        fecha_fin || null,
        comprobante,
        1,
        req.usuario.sub,
        req.usuario.sub,
      ]
    );
    await conn.commit();
    const [row] = await conn.execute(
      "SELECT id,barbero_id,fecha_inicio,fecha_fin,comprobante_url,esta_activo FROM barbero_contratos WHERE id=?",
      [r.insertId]
    );
    res.status(201).json({ data: row[0] });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ mensaje: e.message });
  } finally {
    conn.release();
  }
}

export async function eliminarContratoBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const contratoId = Number(req.params.contratoId);
  await pool.execute(
    "UPDATE barbero_contratos SET esta_activo=0, actualizado_por=? WHERE id=? AND barbero_id=?",
    [req.usuario.sub, contratoId, id]
  );
  res.json({ mensaje: "Contrato eliminado" });
}

export async function listarSancionesBarbero(req, res) {
  const id = Number(req.params.id);
  const [rows] = await pool.execute(
    "SELECT id,barbero_id,motivo,fecha,monto,creado_en,esta_activo FROM barbero_sanciones WHERE barbero_id=? ORDER BY fecha DESC",
    [id]
  );
  res.json({ data: rows });
}

export async function crearSancionBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const motivo = String(req.body?.motivo || "").trim();
  const fecha = req.body?.fecha;
  const monto = Number(req.body?.monto || 0);
  if (!motivo || !fecha || !monto || monto <= 0)
    return res.status(422).json({ mensaje: "Datos inválidos" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      "INSERT INTO barbero_sanciones (barbero_id,motivo,fecha,monto,creado_por,esta_activo) VALUES (?,?,?,?,?,?)",
      [id, motivo, fecha, monto, req.usuario.sub, 1]
    );
    const sancionId = r.insertId;
    await conn.execute(
      "INSERT INTO movimientos_financieros (fecha,tipo,categoria,monto,fuente_tipo,fuente_id,nota,creado_por) VALUES (?, 'egreso', ?, ?, 'sancion', ?, ?, ?)",
      [
        new Date(),
        "Sanción barbero",
        monto,
        sancionId,
        `Sanción ${sancionId}`,
        req.usuario.sub,
      ]
    );
    await conn.commit();
    const [row] = await conn.execute(
      "SELECT id,barbero_id,motivo,fecha,monto,creado_en,esta_activo FROM barbero_sanciones WHERE id=?",
      [sancionId]
    );
    res.status(201).json({ data: row[0] });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ mensaje: e.message });
  } finally {
    conn.release();
  }
}

export async function eliminarSancionBarbero(req, res) {
  if (!req.usuario?.sub)
    return res.status(401).json({ mensaje: "No autorizado" });
  const id = Number(req.params.id);
  const sancionId = Number(req.params.sancionId);
  await pool.execute(
    "UPDATE barbero_sanciones SET esta_activo=0 WHERE id=? AND barbero_id=?",
    [sancionId, id]
  );
  await pool.execute(
    "UPDATE movimientos_financieros SET esta_activo=0 WHERE fuente_tipo='sancion' AND fuente_id=?",
    [sancionId]
  );
  res.json({ mensaje: "Sanción eliminada" });
}
