import { z } from "zod";
import bcrypt from "bcryptjs";
import { pool } from "../db/mysql.js";

const cambiarPinSchema = z.object({
  pin_nuevo: z.string().min(6, "El PIN debe tener al menos 6 caracteres"),
});

export async function obtenerPerfil(req, res) {
  const uid = req.usuario?.sub;
  if (!uid) return res.status(401).json({ error: "No autorizado" });

  try {
    const [[usuario]] = await pool.query(
      `SELECT id, correo_electronico AS correo, nombres, apellidos, telefono, esta_activo, creado_en, actualizado_en
       FROM usuarios WHERE id=? LIMIT 1`,
      [uid]
    );
    if (!usuario)
      return res.status(404).json({ error: "Usuario no encontrado" });

    const [[rol]] = await pool.query(
      `SELECT r.id,r.nombre,r.descripcion,r.esta_activo
       FROM usuario_rol ur
       JOIN roles r ON r.id=ur.rol_id
       WHERE ur.usuario_id=? AND ur.esta_activo=1 AND r.esta_activo=1
       ORDER BY r.nombre LIMIT 1`,
      [uid]
    );

    const [permisosRol] = rol
      ? await pool.query(
          `SELECT DISTINCT p.id,p.clave,p.descripcion
           FROM rol_permiso rp
           JOIN permisos p ON p.id=rp.permiso_id
           WHERE rp.rol_id=? AND rp.esta_activo=1 AND p.esta_activo=1
           ORDER BY p.clave`,
          [rol.id]
        )
      : [[], []];

    const [permisosUsuario] = await pool.query(
      `SELECT DISTINCT p.id,p.clave,p.descripcion
       FROM usuario_permiso up
       JOIN permisos p ON p.id=up.permiso_id
       WHERE up.usuario_id=? AND up.esta_activo=1 AND p.esta_activo=1
       ORDER BY p.clave`,
      [uid]
    );

    const mapa = new Map();
    permisosRol.forEach((p) => mapa.set(p.id, p));
    permisosUsuario.forEach((p) => mapa.set(p.id, p));

    const [sesiones] = await pool.query(
      `SELECT id, inicio_en, fin_en, ip, user_agent FROM sesiones_login WHERE usuario_id=? ORDER BY inicio_en DESC LIMIT 10`,
      [uid]
    );

    const [auditoria] = await pool
      .query(
        `SELECT id, metodo, ruta, accion, ip, creado_en FROM auditoria_eventos WHERE usuario_id=? ORDER BY creado_en DESC LIMIT 10`,
        [uid]
      )
      .catch(() => [[]]);

    res.json({
      usuario,
      rol,
      permisos: Array.from(mapa.values()),
      sesiones,
      auditoria,
    });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener perfil" });
  }
}

export async function cambiarPin(req, res) {
  const uid = req.usuario?.sub;
  if (!uid) return res.status(401).json({ error: "No autorizado" });

  try {
    const { pin_nuevo } = cambiarPinSchema.parse(req.body);

    const salt = await bcrypt.genSalt(10);
    const pinHasheado = await bcrypt.hash(pin_nuevo, salt);

    await pool.query(
      "UPDATE usuarios SET pin=?, actualizado_en=NOW() WHERE id=?",
      [pinHasheado, uid]
    );

    res.json({ mensaje: "PIN actualizado correctamente" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    res.status(500).json({ error: "Error al cambiar PIN" });
  }
}
