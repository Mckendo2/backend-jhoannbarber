import { Router } from "express";
import {
  getContacto,
  upsertContacto,
  crearMensajeContacto,
} from "../controllers/contacto.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const r = Router();

r.get("/", getContacto);
r.put("/", requireAuth, upsertContacto);
r.post("/", crearMensajeContacto);

export default r;
