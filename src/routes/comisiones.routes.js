import { Router } from "express";
import {
  obtenerComisionesSemana,
  pagarComision,
} from "../controllers/comisiones.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const r = Router();

r.get("/semana", requireAuth, obtenerComisionesSemana);
r.post("/pagar", requireAuth, pagarComision);

export default r;
