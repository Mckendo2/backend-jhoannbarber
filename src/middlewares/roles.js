import { pool } from "../db/mysql.js";

async function usuarioTieneAlgunoDeEstosRoles(usuarioId, roles) {
  const lista = roles
    .flat()
    .filter(Boolean)
    .map((n) => String(n).trim().toLowerCase());
  if (!usuarioId || !lista.length) return false;
  const marcadores = lista.map(() => "?").join(",");
  const [rows] = await pool.execute(
    `SELECT 1
     FROM usuario_rol ur
     JOIN roles r ON r.id = ur.rol_id AND r.esta_activo=1
     WHERE ur.usuario_id=? AND ur.esta_activo=1 AND LOWER(r.nombre) IN (${marcadores})
     LIMIT 1`,
    [usuarioId, ...lista]
  );
  return rows.length > 0;
}

export function requiereRol(...roles) {
  return async (req, res, next) => {
    const ok = await usuarioTieneAlgunoDeEstosRoles(req.usuario?.sub, roles);
    if (!ok) return res.status(403).json({ mensaje: "Prohibido" });
    next();
  };
}
