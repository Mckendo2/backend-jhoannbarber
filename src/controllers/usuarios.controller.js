import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { pool, query } from "../db/mysql.js";
import { enviarCorreo } from "../lib/mailer.js";
import { credencialesHtml } from "../mails/credenciales.js";
import { config } from "../config/env.js";

const schema = z.object({
  correo_electronico: z.string().email(),
  nombres: z.string().max(100).nullable().optional(),
  apellidos: z.string().max(100).nullable().optional(),
  telefono: z.string().max(30).nullable().optional(),
  esta_activo: z.boolean().optional(),
  rol_id: z.number().int().positive().optional(),
  rol_nombre: z.string().max(100).optional(),
});

async function resolverRol(conn, { rol_id, rol_nombre }) {
  if (rol_id) {
    const [r] = await conn.execute(
      "SELECT id,nombre FROM roles WHERE id=? AND esta_activo=1",
      [rol_id]
    );
    if (!r.length) throw new Error("Rol no existe o inactivo");
    return r[0];
  }
  if (rol_nombre) {
    const [r] = await conn.execute(
      "SELECT id,nombre FROM roles WHERE nombre=? AND esta_activo=1",
      [rol_nombre]
    );
    if (!r.length) throw new Error("Rol no existe o inactivo");
    return r[0];
  }
  throw new Error("Debe especificar rol_id o rol_nombre");
}

export async function listarUsuarios(req, res) {
  const page = Math.max(1, parseInt(req.query.page ?? "1", 10));
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(req.query.per_page ?? "10", 10))
  );
  const q = req.query.q ? `%${req.query.q}%` : null;
  const estado =
    req.query.estado === "inactivo"
      ? 0
      : req.query.estado === "activo"
      ? 1
      : null;
  const rolId = req.query.rol_id ? Number(req.query.rol_id) : null;
  const rolNombre = req.query.rol_nombre || null;
  const cond = [];
  const vals = [];
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
  if (rolId !== null) {
    cond.push(
      "EXISTS(SELECT 1 FROM usuario_rol ur WHERE ur.usuario_id=u.id AND ur.rol_id=? AND ur.esta_activo=1)"
    );
    vals.push(rolId);
  }
  if (rolNombre) {
    cond.push(
      "EXISTS(SELECT 1 FROM usuario_rol ur JOIN roles r ON r.id=ur.rol_id AND r.esta_activo=1 WHERE ur.usuario_id=u.id AND ur.esta_activo=1 AND r.nombre=?)"
    );
    vals.push(rolNombre);
  }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  const [countRow] = await pool.execute(
    `SELECT COUNT(1) AS total FROM usuarios u ${where}`,
    vals
  );
  const total = countRow[0]?.total || 0;
  const offset = (page - 1) * perPage;
  const rows = await query(
    `SELECT
       u.id,u.correo_electronico,u.nombres,u.apellidos,u.telefono,u.esta_activo,u.creado_en,
       (SELECT r.id FROM usuario_rol ur JOIN roles r ON r.id=ur.rol_id AND r.esta_activo=1 WHERE ur.usuario_id=u.id AND ur.esta_activo=1 ORDER BY r.nombre LIMIT 1) AS rol_id,
       (SELECT r.nombre FROM usuario_rol ur JOIN roles r ON r.id=ur.rol_id AND r.esta_activo=1 WHERE ur.usuario_id=u.id AND ur.esta_activo=1 ORDER BY r.nombre LIMIT 1) AS rol_nombre
     FROM usuarios u
     ${where}
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`,
    [...vals, perPage, offset]
  );
  res.json({
    data: rows,
    meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
  });
}

export async function detalleUsuario(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const [u] = await pool.execute(
    `SELECT id,correo_electronico,nombres,apellidos,telefono,esta_activo,creado_en,actualizado_en
     FROM usuarios WHERE id=?`,
    [id]
  );
  if (!u.length) return res.status(404).json({ mensaje: "No encontrado" });
  const [roles] = await pool.execute(
    `SELECT r.id,r.nombre
     FROM usuario_rol ur JOIN roles r ON r.id=ur.rol_id
     WHERE ur.usuario_id=? AND ur.esta_activo=1 AND r.esta_activo=1
     ORDER BY r.nombre`,
    [id]
  );
  res.json({ data: { ...u[0], roles } });
}

export async function registrarUsuario(req, res) {
  const parse = schema.safeParse(req.body || {});
  if (!parse.success)
    return res
      .status(422)
      .json({ mensaje: "Datos inválidos", errores: parse.error.flatten() });
  const d = parse.data;
  const existe = await query(
    "SELECT id FROM usuarios WHERE correo_electronico=? LIMIT 1",
    [d.correo_electronico]
  );
  if (existe.length)
    return res.status(409).json({ mensaje: "Correo ya registrado" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const rol = await resolverRol(conn, {
      rol_id: d.rol_id,
      rol_nombre: d.rol_nombre,
    });

    const pinPlano = crypto.randomBytes(6).toString("hex");
    const pinHash = await bcrypt.hash(pinPlano, 10);

    const [ins] = await conn.execute(
      "INSERT INTO usuarios (correo_electronico,pin,nombres,apellidos,telefono,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
      [
        d.correo_electronico,
        pinHash,
        d.nombres ?? null,
        d.apellidos ?? null,
        d.telefono ?? null,
        d.esta_activo !== false ? 1 : 0,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    const usuarioId = ins.insertId;

    await conn.execute(
      "INSERT INTO usuario_rol (usuario_id,rol_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?)",
      [usuarioId, rol.id, 1, req.usuario?.sub || null, req.usuario?.sub || null]
    );

    const [permsRol] = await conn.execute(
      "SELECT p.clave FROM permisos p JOIN rol_permiso rp ON rp.permiso_id=p.id WHERE rp.rol_id=? AND rp.esta_activo=1 AND p.esta_activo=1",
      [rol.id]
    );

    await conn.commit();

    let correoEnviado = false;
    try {
      const html = credencialesHtml({
        nombre: d.nombres || "",
        correo: d.correo_electronico,
        pin: pinPlano,
        rol: rol.nombre,
        loginUrl: config.appUrl || "",
      });
      await enviarCorreo({
        para: d.correo_electronico,
        asunto: "Tus credenciales de acceso",
        html,
        texto: `Bienvenido. Correo: ${d.correo_electronico} PIN: ${pinPlano} Rol: ${rol.nombre} Acceso: ${config.appUrl}`,
      });
      correoEnviado = true;
    } catch (mailErr) {
      throw mailErr;
    }

    return res.status(201).json({
      mensaje: "Usuario registrado",
      usuario: {
        id: usuarioId,
        correo_electronico: d.correo_electronico,
        nombres: d.nombres ?? null,
        apellidos: d.apellidos ?? null,
        telefono: d.telefono ?? null,
        esta_activo: d.esta_activo !== false,
      },
      rol: { id: rol.id, nombre: rol.nombre },
      permisos_desde_rol: permsRol.map((x) => x.clave).sort(),
      correo_enviado: correoEnviado,
    });
  } catch (e) {
    await conn.rollback();
    return res.status(400).json({ mensaje: e.message || "Error al registrar" });
  } finally {
    conn.release();
  }
}

const updateSchema = z
  .object({
    correo_electronico: z.string().email().optional(),
    nombres: z.string().max(100).optional(),
    apellidos: z.string().max(100).optional(),
    telefono: z.string().max(30).optional().nullable(),
    esta_activo: z.boolean().optional(),
    rol_id: z.number().int().positive().optional(),
    rol_nombre: z.string().optional(),
  })
  .strict();

export async function actualizarUsuario(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const p = updateSchema.safeParse(req.body || {});
  if (!p.success) {
    return res.status(422).json({
      mensaje: "Datos inválidos",
      errores: p.error.flatten(),
    });
  }

  const d = p.data;

  if (d.correo_electronico) {
    const ex = await query(
      "SELECT id FROM usuarios WHERE correo_electronico=? AND id<>? LIMIT 1",
      [d.correo_electronico, id]
    );
    if (ex.length)
      return res.status(409).json({ mensaje: "Correo ya registrado" });
  }

  const esta_activo_val =
    typeof d.esta_activo === "boolean" ? (d.esta_activo ? 1 : 0) : null;

  await pool.execute(
    "UPDATE usuarios SET correo_electronico=COALESCE(?,correo_electronico), nombres=COALESCE(?,nombres), apellidos=COALESCE(?,apellidos), telefono=COALESCE(?,telefono), esta_activo=COALESCE(?,esta_activo), actualizado_por=? WHERE id=?",
    [
      d.correo_electronico ?? null,
      d.nombres ?? null,
      d.apellidos ?? null,
      d.telefono ?? null,
      esta_activo_val,
      req.usuario?.sub || null,
      id,
    ]
  );

  if (d.rol_id || d.rol_nombre) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const rol = await resolverRol(conn, {
        rol_id: d.rol_id,
        rol_nombre: d.rol_nombre,
      });

      await conn.execute(
        "UPDATE usuario_rol SET esta_activo=0, actualizado_por=? WHERE usuario_id=? AND rol_id<>?",
        [req.usuario?.sub || null, id, rol.id]
      );

      await conn.execute(
        "INSERT INTO usuario_rol (usuario_id,rol_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=1, actualizado_por=?",
        [
          id,
          rol.id,
          1,
          req.usuario?.sub || null,
          req.usuario?.sub || null,
          req.usuario?.sub || null,
        ]
      );

      await conn.execute(
        "UPDATE usuario_permiso SET esta_activo=0, actualizado_por=? WHERE usuario_id=?",
        [req.usuario?.sub || null, id]
      );

      const [permisosRol] = await conn.execute(
        `SELECT rp.permiso_id FROM rol_permiso rp 
         WHERE rp.rol_id=? AND rp.esta_activo=1`,
        [rol.id]
      );

      for (const perm of permisosRol) {
        await conn.execute(
          "INSERT INTO usuario_permiso (usuario_id,permiso_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=1, actualizado_por=?",
          [
            id,
            perm.permiso_id,
            1,
            req.usuario?.sub || null,
            req.usuario?.sub || null,
            req.usuario?.sub || null,
          ]
        );
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      return res
        .status(400)
        .json({ mensaje: e.message || "Error al actualizar rol" });
    } finally {
      conn.release();
    }
  }

  const [row] = await pool.execute(
    `SELECT id, correo_electronico, nombres, apellidos, telefono, esta_activo FROM usuarios WHERE id=?`,
    [id]
  );

  if (!row.length) return res.status(404).json({ mensaje: "No encontrado" });

  res.json({ mensaje: "Actualizado", data: row[0] });
}

export async function eliminarUsuario(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  await pool.execute(
    "UPDATE usuarios SET esta_activo=0, actualizado_por=? WHERE id=?",
    [req.usuario?.sub || null, id]
  );
  res.json({ mensaje: "Eliminado" });
}
