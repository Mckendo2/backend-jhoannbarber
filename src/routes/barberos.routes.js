import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listarBarberos,
  detalleBarbero,
  listarServiciosBarbero,
  syncServiciosBarbero,
  listarHorariosBarbero,
  upsertHorariosBarbero,
  listarBloqueosBarbero,
  crearBloqueoBarbero,
  eliminarBloqueoBarbero,
  obtenerContratoBarbero,
  subirContratoBarbero,
  eliminarContratoBarbero,
  listarSancionesBarbero,
  crearSancionBarbero,
  eliminarSancionBarbero,
} from "../controllers/barberos.controller.js";
import { uploadContratos } from "../lib/upload.js";

const r = Router();

r.get("/", requireAuth, listarBarberos);
r.get("/:id", requireAuth, detalleBarbero);
r.get("/:id/servicios", requireAuth, listarServiciosBarbero);
r.patch("/:id/servicios", requireAuth, syncServiciosBarbero);
r.get("/:id/horarios", requireAuth, listarHorariosBarbero);
r.patch("/:id/horarios", requireAuth, upsertHorariosBarbero);
r.get("/:id/bloqueos", requireAuth, listarBloqueosBarbero);
r.post("/:id/bloqueos", requireAuth, crearBloqueoBarbero);
r.delete("/:id/bloqueos/:bloqueoId", requireAuth, eliminarBloqueoBarbero);
r.get("/:id/contrato", requireAuth, obtenerContratoBarbero);
r.post(
  "/:id/contrato",
  requireAuth,
  uploadContratos.single("comprobante"),
  subirContratoBarbero
);
r.delete("/:id/contrato/:contratoId", requireAuth, eliminarContratoBarbero);

r.get("/:id/sanciones", requireAuth, listarSancionesBarbero);
r.post("/:id/sanciones", requireAuth, crearSancionBarbero);
r.delete("/:id/sanciones/:sancionId", requireAuth, eliminarSancionBarbero);
export default r;
