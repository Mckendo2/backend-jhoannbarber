import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listarReglas,
  listarReglasPublicas,
  obtenerRegla,
  crearRegla,
  actualizarRegla,
  eliminarReglaSoft,
  toggleRegla,
} from "../controllers/reglas.controller.js";

const r = Router();

r.get("/public", listarReglasPublicas);
r.get("/", requireAuth, listarReglas);
r.get("/:id", requireAuth, obtenerRegla);
r.post("/", requireAuth, crearRegla);
r.put("/:id", requireAuth, actualizarRegla);
r.delete("/:id", requireAuth, eliminarReglaSoft);
r.patch("/:id/toggle", requireAuth, toggleRegla);

export default r;
