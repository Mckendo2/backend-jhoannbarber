import { z } from "zod";
import { pool } from "../db/mysql.js";

const crearSchema = z.object({
  nombre: z.string().min(3).max(100),
  descripcion: z.string().max(255).optional(),
  esta_activo: z.boolean().optional(),
  permisos: z.array(z.string()).optional(),
});

const actualizarSchema = z.object({
  nombre: z.string().min(3).max(100).optional(),
  descripcion: z.string().max(255).optional(),
  esta_activo: z.boolean().optional(),
});

const syncSchema = z.object({
  permisos: z.array(z.string()).default([]),
});

export async function crearRol(req, res) {
  const p = crearSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const { nombre, descripcion, esta_activo, permisos } = p.data;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ex] = await conn.execute(
      "SELECT id FROM roles WHERE nombre=? LIMIT 1",
      [nombre]
    );
    if (ex.length) {
      await conn.rollback();
      conn.release();
      return res.status(409).json({ mensaje: "Nombre duplicado" });
    }
    const [r] = await conn.execute(
      "INSERT INTO roles (nombre,descripcion,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?)",
      [
        nombre,
        descripcion ?? null,
        esta_activo ?? true ? 1 : 0,
        req.usuario?.sub || null,
        req.usuario?.sub || null,
      ]
    );
    const rolId = r.insertId;
    if (permisos && permisos.length) {
      const [permRows] = await conn.query(
        "SELECT id,clave FROM permisos WHERE clave IN (?) AND esta_activo=1",
        [permisos]
      );
      const mapa = new Map(permRows.map((x) => [x.clave, x.id]));
      for (const clave of permisos) {
        const permisoId = mapa.get(clave);
        if (permisoId) {
          await conn.execute(
            "INSERT INTO rol_permiso (rol_id,permiso_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=VALUES(esta_activo), actualizado_por=VALUES(actualizado_por)",
            [
              rolId,
              permisoId,
              1,
              req.usuario?.sub || null,
              req.usuario?.sub || null,
            ]
          );
        }
      }
    }
    await conn.commit();
    const [row] = await conn.execute(
      "SELECT id,nombre,descripcion,esta_activo FROM roles WHERE id=?",
      [rolId]
    );
    conn.release();
    return res.status(201).json({ data: row[0] });
  } catch (e) {
    await conn.rollback();
    conn.release();
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function listarRoles(_req, res) {
  const [rows] = await pool.execute(
    "SELECT id,nombre,descripcion,esta_activo,creado_en,actualizado_en FROM roles ORDER BY nombre"
  );
  return res.json({ data: rows });
}

export async function detalleRol(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const [r] = await pool.execute(
    "SELECT id,nombre,descripcion,esta_activo FROM roles WHERE id=?",
    [id]
  );
  if (!r.length) return res.status(404).json({ mensaje: "No encontrado" });
  const [p] = await pool.execute(
    `SELECT p.id,p.clave,p.descripcion
     FROM rol_permiso rp
     JOIN permisos p ON p.id=rp.permiso_id
     WHERE rp.rol_id=? AND rp.esta_activo=1 AND p.esta_activo=1
     ORDER BY p.clave`,
    [id]
  );
  return res.json({ data: { ...r[0], permisos: p } });
}

export async function actualizarRol(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const p = actualizarSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const { nombre, descripcion, esta_activo } = p.data;
  try {
    if (nombre) {
      const [ex] = await pool.execute(
        "SELECT id FROM roles WHERE nombre=? AND id<>? LIMIT 1",
        [nombre, id]
      );
      if (ex.length)
        return res.status(409).json({ mensaje: "Nombre duplicado" });
    }
    await pool.execute(
      "UPDATE roles SET nombre=COALESCE(?,nombre), descripcion=COALESCE(?,descripcion), esta_activo=COALESCE(?,esta_activo), actualizado_por=? WHERE id=?",
      [
        nombre ?? null,
        descripcion ?? null,
        typeof esta_activo === "boolean" ? (esta_activo ? 1 : 0) : null,
        req.usuario?.sub || null,
        id,
      ]
    );
    const [row] = await pool.execute(
      "SELECT id,nombre,descripcion,esta_activo FROM roles WHERE id=?",
      [id]
    );
    if (!row.length) return res.status(404).json({ mensaje: "No encontrado" });
    return res.json({ data: row[0] });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function asignarPermiso(req, res) {
  const id = Number(req.params.id);
  const permisoId = Number(req.params.permisoId);
  if (!id || !permisoId)
    return res.status(404).json({ mensaje: "No encontrado" });
  try {
    const [r] = await pool.execute(
      "SELECT id FROM roles WHERE id=? AND esta_activo=1",
      [id]
    );
    if (!r.length) return res.status(404).json({ mensaje: "Rol no existe" });
    const [p] = await pool.execute(
      "SELECT id FROM permisos WHERE id=? AND esta_activo=1",
      [permisoId]
    );
    if (!p.length)
      return res.status(404).json({ mensaje: "Permiso no existe" });
    await pool.execute(
      "INSERT INTO rol_permiso (rol_id,permiso_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=1, actualizado_por=VALUES(actualizado_por)",
      [id, permisoId, 1, req.usuario?.sub || null, req.usuario?.sub || null]
    );
    return res.status(201).json({ mensaje: "Asignado" });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function quitarPermiso(req, res) {
  const id = Number(req.params.id);
  const permisoId = Number(req.params.permisoId);
  if (!id || !permisoId)
    return res.status(404).json({ mensaje: "No encontrado" });
  try {
    await pool.execute(
      "UPDATE rol_permiso SET esta_activo=0, actualizado_por=? WHERE rol_id=? AND permiso_id=?",
      [req.usuario?.sub || null, id, permisoId]
    );
    return res.json({ mensaje: "Quitado" });
  } catch (e) {
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function sincronizarPermisos(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(404).json({ mensaje: "No encontrado" });
  const p = syncSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const claves = p.data.permisos;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rol] = await conn.execute("SELECT id FROM roles WHERE id=?", [id]);
    if (!rol.length) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ mensaje: "No encontrado" });
    }
    await conn.execute(
      "UPDATE rol_permiso SET esta_activo=0, actualizado_por=? WHERE rol_id=?",
      [req.usuario?.sub || null, id]
    );
    if (claves.length) {
      const [permRows] = await conn.query(
        "SELECT id,clave FROM permisos WHERE clave IN (?) AND esta_activo=1",
        [claves]
      );
      const mapa = new Map(permRows.map((x) => [x.clave, x.id]));
      for (const clave of claves) {
        const permisoId = mapa.get(clave);
        if (permisoId) {
          await conn.execute(
            "INSERT INTO rol_permiso (rol_id,permiso_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=1, actualizado_por=VALUES(actualizado_por)",
            [
              id,
              permisoId,
              1,
              req.usuario?.sub || null,
              req.usuario?.sub || null,
            ]
          );
        }
      }
    }
    await conn.commit();
    conn.release();
    return res.json({ mensaje: "Sincronizado" });
  } catch (e) {
    await conn.rollback();
    conn.release();
    return res.status(400).json({ mensaje: e.message });
  }
}

export async function rolDeUsuario(req, res) {
  const usuarioId = Number(req.params.id);
  if (!usuarioId) return res.status(404).json({ mensaje: "No encontrado" });
  const [r] = await pool.execute(
    `SELECT r.id,r.nombre,r.descripcion,r.esta_activo
     FROM usuario_rol ur
     JOIN roles r ON r.id=ur.rol_id
     WHERE ur.usuario_id=? AND ur.esta_activo=1 AND r.esta_activo=1
     ORDER BY r.nombre
     LIMIT 1`,
    [usuarioId]
  );
  if (!r.length) return res.status(404).json({ mensaje: "No encontrado" });
  const rol = r[0];
  const [p] = await pool.execute(
    `SELECT p.id,p.clave,p.descripcion
     FROM rol_permiso rp
     JOIN permisos p ON p.id=rp.permiso_id
     WHERE rp.rol_id=? AND rp.esta_activo=1 AND p.esta_activo=1
     ORDER BY p.clave`,
    [rol.id]
  );
  return res.json({ data: { ...rol, permisos: p } });
}
