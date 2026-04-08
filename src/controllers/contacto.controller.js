import { pool } from "../db/mysql.js";
import { z } from "zod";

const contactoSchema = z.object({
  nombre: z.string().min(2).max(190),
  email: z.string().email().max(190),
  celular: z.string().max(50).nullable().optional(),
  asunto: z.string().max(255).nullable().optional(),
  mensaje: z.string().min(5),
});

export async function crearMensajeContacto(req, res) {
  const p = contactoSchema.safeParse(req.body || {});
  if (!p.success) return res.status(422).json({ mensaje: "Datos inválidos" });
  const d = p.data;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ip = req.headers["x-forwarded-for"] || req.ip || null;
    const ua = req.headers["user-agent"] || null;
    const [ins] = await conn.execute(
      `INSERT INTO mensajes_contacto
        (nombre,email,celular,asunto,mensaje,origen_ip,user_agent,leido)
       VALUES (?,?,?,?,?,?,?,0)`,
      [
        d.nombre,
        d.email,
        d.celular ?? null,
        d.asunto ?? null,
        d.mensaje,
        ip,
        ua,
      ]
    );
    await conn.commit();
    res.status(201).json({ data: { id: ins.insertId } });
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    res.status(400).json({ mensaje: e.message || "Error" });
  } finally {
    conn.release();
  }
}

export async function getContacto(req, res) {
  try {
    const [[row]] = await pool.query(
      "SELECT * FROM informacion_contacto ORDER BY id LIMIT 1"
    );
    return res.json({ data: row || null });
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al leer información" });
  }
}

export async function upsertContacto(req, res) {
  try {
    const body = req.body || {};
    const {
      telefono = "",
      direccion = "",
      facebook = null,
      instagram = null,
      tiktok = null,
      youtube = null,
      whatsapp = null,
      horarios_atencion = "",
      dias_atencion = "",
    } = body;

    if (!telefono || !direccion || !horarios_atencion || !dias_atencion) {
      return res.status(400).json({ mensaje: "Faltan campos requeridos" });
    }

    const [[existing]] = await pool.query(
      "SELECT id FROM informacion_contacto ORDER BY id LIMIT 1"
    );
    if (!existing) {
      const [r] = await pool.execute(
        `INSERT INTO informacion_contacto
          (telefono,direccion,facebook,instagram,tiktok,youtube,whatsapp,horarios_atencion,dias_atencion)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          telefono,
          direccion,
          facebook,
          instagram,
          tiktok,
          youtube,
          whatsapp,
          horarios_atencion,
          dias_atencion,
        ]
      );
      const [[newRow]] = await pool.query(
        "SELECT * FROM informacion_contacto WHERE id = ?",
        [r.insertId]
      );
      return res.json({ data: newRow });
    } else {
      await pool.execute(
        `UPDATE informacion_contacto SET
           telefono=?, direccion=?, facebook=?, instagram=?, tiktok=?, youtube=?, whatsapp=?, horarios_atencion=?, dias_atencion=?, actualizado_en=NOW()
         WHERE id=?`,
        [
          telefono,
          direccion,
          facebook,
          instagram,
          tiktok,
          youtube,
          whatsapp,
          horarios_atencion,
          dias_atencion,
          existing.id,
        ]
      );
      const [[row]] = await pool.query(
        "SELECT * FROM informacion_contacto WHERE id = ?",
        [existing.id]
      );
      return res.json({ data: row });
    }
  } catch (e) {
    return res.status(500).json({ mensaje: "Error al guardar información" });
  }
}
