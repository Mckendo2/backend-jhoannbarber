import { config } from "./config/env.js";
process.env.TZ = process.env.TZ || config.app?.timezone || "America/La_Paz";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { query } from "./db/mysql.js";
import authRoutes from "./routes/auth.routes.js";
import aclRoutes from "./routes/acl.routes.js";
import usuariosRoutes from "./routes/usuarios.routes.js";
import serviciosRoutes from "./routes/servicios.routes.js";
import productosRoutes from "./routes/productos.routes.js";
import barberosRoutes from "./routes/barberos.routes.js";
import gastosRoutes from "./routes/gastos.routes.js";
import ventasRoutes from "./routes/ventas.routes.js";
import pagosRoutes from "./routes/pagos.routes.js";
import auditoriaRoutes from "./routes/auditoria.routes.js";
import citasRoutes from "./routes/citas.routes.js";
import perfilRoutes from "./routes/perfil.routes.js";
import contactoRoutes from "./routes/contacto.routes.js";
import mensajesRoutes from "./routes/mensajes.routes.js";
import path from "path";
import { auditar } from "./middlewares/auditoria.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import reportesRoutes from "./routes/reportes.routes.js";
import comisionesRoutes from "./routes/comisiones.routes.js";
import reglasRoutes from "./routes/reglas.routes.js";

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

const allowed = config.corsOrigins;
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (!allowed.length || allowed.includes(origin)) return cb(null, true);
      cb(new Error("CORS bloqueado"));
    },
    credentials: true,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/db/health", async (_req, res) => {
  try {
    const rows = await query("SELECT 1 AS db_ok");
    res.json({
      ok: true,
      db_ok: rows[0]?.db_ok === 1,
      database: config.db.database,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use("/auth", authRoutes);
app.use(auditar());
app.use("/perfil", perfilRoutes);
app.use("/acl", aclRoutes);
app.use("/usuarios", usuariosRoutes);
app.use("/servicios", serviciosRoutes);
app.use("/upload", express.static(path.resolve("upload")));
app.use("/productos", productosRoutes);
app.use("/barberos", barberosRoutes);
app.use("/gastos", gastosRoutes);
app.use("/ventas", ventasRoutes);
app.use("/pagos", pagosRoutes);
app.use("/auditoria", auditoriaRoutes);
app.use("/citas", citasRoutes);
app.use("/contacto", contactoRoutes);
app.use("/admin/contacto", contactoRoutes);
app.use("/admin/mensajes", mensajesRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/reportes", reportesRoutes);
app.use("/comisiones", comisionesRoutes);
app.use("/reglas", reglasRoutes);
app.get("/db/tables", async (req, res) => {
  try {
    const schema = req.query.schema || config.db.database;
    const rows = await query(
      `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [schema]
    );
    res.json({
      db: schema,
      tables: rows.map((r) => r.table_name),
      has_permisos: rows.some((r) => r.table_name === "permisos"),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use((_req, res) => res.status(404).json({ message: "No encontrado" }));
app.use((err, req, res, next) => {
  console.error(err);
  const code = err.status || 500;
  res.status(code).json({ mensaje: err.message || "Error" });
});

export default app;
