import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listarEventos,
  detalleEvento,
  listarSesiones,
} from "../controllers/auditoria.controller.js";

const r = Router();

r.get("/eventos", requireAuth, listarEventos);
r.get("/eventos/:id", requireAuth, detalleEvento);
r.get("/sesiones", requireAuth, listarSesiones);

export default r;
