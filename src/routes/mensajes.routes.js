import { Router } from "express";
import {
  listarMensajes,
  obtenerMensaje,
  marcarLeido,
  eliminarMensaje,
} from "../controllers/mensajes.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const r = Router();

r.get("/", requireAuth, listarMensajes);
r.get("/:id", requireAuth, obtenerMensaje);
r.patch("/:id/leido", requireAuth, marcarLeido);
r.delete("/:id", requireAuth, eliminarMensaje);

export default r;
