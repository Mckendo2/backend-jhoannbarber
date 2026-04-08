import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { requierePermiso } from "../middlewares/permisos.js";
import {
  listarUsuarios,
  detalleUsuario,
  registrarUsuario,
  actualizarUsuario,
  eliminarUsuario,
} from "../controllers/usuarios.controller.js";

const r = Router();

r.get("/", requireAuth, listarUsuarios);
r.get("/:id", requireAuth, detalleUsuario);
r.post("/", requireAuth, registrarUsuario);
r.put("/:id", requireAuth, actualizarUsuario);
r.delete("/:id", requireAuth, eliminarUsuario);

export default r;
