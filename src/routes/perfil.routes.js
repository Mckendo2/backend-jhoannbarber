import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { obtenerPerfil, cambiarPin } from "../controllers/perfil.controller.js";

const r = Router();

r.get("/", requireAuth, obtenerPerfil);
r.post("/cambiar-pin", requireAuth, cambiarPin);

export default r;
