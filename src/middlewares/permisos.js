import { pool } from "../db/mysql.js";

async function usuarioTienePermiso(usuarioId, permisos) {
  const lista = permisos
    .flat()
    .filter(Boolean)
    .map((n) => String(n).trim().toLowerCase());
  if (!usuarioId || lista.length === 0) return false;
  const marcadores = lista.map(() => "?").join(",");
  try {
    const [rows] = await pool.execute(
      `SELECT 1
       FROM usuario_permiso up
       JOIN permisos p ON p.id = up.permiso_id AND p.esta_activo = 1
       WHERE up.usuario_id = ? 
         AND up.esta_activo = 1 
         AND LOWER(p.clave) IN (${marcadores})
       LIMIT 1`,
      [usuarioId, ...lista]
    );
    return rows.length > 0;
  } catch (error) {
    return false;
  }
}

export function requierePermiso(...permisos) {
  return async (req, res, next) => {
    const usuarioId = req.usuario?.sub;
    if (!usuarioId) {
      return res.status(401).json({ mensaje: "No autenticado" });
    }
    const ok = await usuarioTienePermiso(usuarioId, permisos);
    if (!ok) {
      return res.status(403).json({ mensaje: "Prohibido" });
    }
    next();
  };
}
