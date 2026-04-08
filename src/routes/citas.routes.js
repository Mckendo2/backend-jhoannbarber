import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  serviciosActivos,
  barberosDisponibles,
  crearCita,
  citasSemana,
  actualizarEstadoCita,
  eliminarCita,
  misCitas,
} from "../controllers/citas.controller.js";

const r = Router();

r.get("/servicios", serviciosActivos);
r.get("/barberos-disponibles", barberosDisponibles);
r.post("/", crearCita);

r.get("/admin/semana", requireAuth, citasSemana);
r.patch("/:id/estado", actualizarEstadoCita);
r.delete("/:id", eliminarCita);

r.get("/mias", misCitas);

export default r;
