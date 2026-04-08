import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { config } from "../config/env.js";

const pool = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  port: config.db.port || 3306,
  waitForConnections: true,
  connectionLimit: 10,
});

async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

const usuariosSeed = [
  {
    correo: "jhoannbarber@gmail.com",
    pinPlano: "123456",
    nombres: "Jhoann",
    apellidos: "Barber",
    rol: "Administrador",
  },
  {
    correo: "cajero@gmail.com",
    pinPlano: "234567",
    nombres: "Cajero",
    apellidos: "Caja",
    rol: "Cajero",
  },
  {
    correo: "barbero@gmail.com",
    pinPlano: "345678",
    nombres: "Barbero",
    apellidos: "Salon",
    rol: "Barbero",
  },
];

const permisos = {
  Administrador: [
    "gestionar_auditoria",
    "gestionar_barberos",
    "gestionar_citas",
    "gestionar_contactos",
    "gestionar_gastos",
    "gestionar_mensajes",
    "gestionar_permisos",
    "gestionar_productos",
    "gestionar_reglas",
    "gestionar_reportes",
    "gestionar_roles",
    "gestionar_servicios",
    "gestionar_usuarios",
    "gestionar_ventas",
  ],
  Cajero: [
    "gestionar_citas",
    "gestionar_gastos",
    "gestionar_mensajes",
    "gestionar_productos",
    "gestionar_reportes",
    "gestionar_servicios",
  ],
  Barbero: [
    "gestionar_citas",
    "gestionar_mensajes",
    "gestionar_productos",
    "gestionar_ventas",
  ],
};

async function ensurePermisos(claves) {
  for (const clave of claves) {
    const ex = await q("SELECT id FROM permisos WHERE clave=? LIMIT 1", [
      clave,
    ]);
    if (!ex.length) {
      await q(
        "INSERT INTO permisos (clave,descripcion,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?)",
        [clave, clave.replace(/_/g, " "), 1, null, null]
      );
    } else {
      await q("UPDATE permisos SET esta_activo=1 WHERE id=?", [ex[0].id]);
    }
  }
}

async function ensureRol(nombre) {
  const r = await q("SELECT id FROM roles WHERE nombre=? LIMIT 1", [nombre]);
  if (r.length) {
    await q("UPDATE roles SET esta_activo=1 WHERE id=?", [r[0].id]);
    return r[0].id;
  }
  await q(
    "INSERT INTO roles (nombre,descripcion,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?)",
    [nombre, `Rol ${nombre}`, 1, null, null]
  );
  const r2 = await q("SELECT id FROM roles WHERE nombre=? LIMIT 1", [nombre]);
  return r2[0].id;
}

async function idsPermisosPorClave(claves) {
  if (!claves.length) return new Map();
  const rows = await q(
    `SELECT id,clave FROM permisos WHERE clave IN (${claves
      .map(() => "?")
      .join(",")})`,
    claves
  );
  return new Map(rows.map((x) => [x.clave, x.id]));
}

async function syncPermisosARol(rolId, claves) {
  const mapa = await idsPermisosPorClave(claves);
  for (const clave of claves) {
    const pid = mapa.get(clave);
    if (!pid) continue;
    await q(
      "INSERT INTO rol_permiso (rol_id,permiso_id,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=VALUES(esta_activo), actualizado_por=VALUES(actualizado_por)",
      [rolId, pid, 1, null, null]
    );
  }
}

async function asignarPermisosAUsuario(usuarioId, permisos) {
  const permisosIds = await idsPermisosPorClave(permisos);
  for (const clave of permisos) {
    const permisoId = permisosIds.get(clave);
    if (!permisoId) continue;
    await q(
      "INSERT INTO usuario_permiso (usuario_id, permiso_id, esta_activo, creado_en, actualizado_en) VALUES (?, ?, 1, NOW(), NOW()) ON DUPLICATE KEY UPDATE esta_activo=VALUES(esta_activo), actualizado_por=VALUES(actualizado_por)",
      [usuarioId, permisoId]
    );
  }
}

async function ensureUsuario({
  correo,
  pinPlano,
  nombres,
  apellidos,
  rolId,
  permisos,
}) {
  const ex = await q(
    "SELECT id FROM usuarios WHERE correo_electronico=? LIMIT 1",
    [correo]
  );
  if (ex.length) {
    const uid = ex[0].id;
    await q("UPDATE usuarios SET esta_activo=1 WHERE id=?", [uid]);
    await q(
      "INSERT INTO usuario_rol (usuario_id, rol_id, esta_activo, creado_por, actualizado_por) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE esta_activo=VALUES(esta_activo), actualizado_por=VALUES(actualizado_por)",
      [uid, rolId, 1, null, null]
    );
    await asignarPermisosAUsuario(uid, permisos);
    return uid;
  }
  const hash = await bcrypt.hash(pinPlano, 10);
  await q(
    "INSERT INTO usuarios (correo_electronico,pin,nombres,apellidos,telefono,esta_activo,creado_por,actualizado_por) VALUES (?,?,?,?,?,?,?,?)",
    [correo, hash, nombres, apellidos, null, 1, null, null]
  );
  const u2 = await q(
    "SELECT id FROM usuarios WHERE correo_electronico=? LIMIT 1",
    [correo]
  );
  const uid = u2[0].id;
  await q(
    "INSERT INTO usuario_rol (usuario_id, rol_id, esta_activo, creado_por, actualizado_por) VALUES (?,?,?,?,?)",
    [uid, rolId, 1, null, null]
  );
  await asignarPermisosAUsuario(uid, permisos);
  return uid;
}

async function main() {
  try {
    const todasClaves = Array.from(new Set(Object.values(permisos).flat()));
    await ensurePermisos(todasClaves);
    const rolesIds = {};
    for (const nombre of Object.keys(permisos)) {
      rolesIds[nombre] = await ensureRol(nombre);
      await syncPermisosARol(rolesIds[nombre], permisos[nombre]);
    }
    for (const u of usuariosSeed) {
      await ensureUsuario({
        ...u,
        rolId: rolesIds[u.rol],
        permisos: permisos[u.rol],
      });
    }
    console.log("Listo. Usuarios y roles creados.");
    console.log("Admin -> admin@local.com / 123456");
    console.log("Cajero -> cajero@local.com / 234567");
    console.log("Barbero -> barbero@local.com / 345678");
    process.exit(0);
  } catch (e) {
    console.error("Error:", e.message || e);
    process.exit(1);
  }
}

main();
