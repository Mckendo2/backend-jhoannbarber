import { Router } from "express";
import {
  iniciarSesion,
  sesion,
  cerrarSesion,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const r = Router();

r.post("/login", iniciarSesion);
r.get("/sesion", requireAuth, sesion);
r.post("/logout", requireAuth, cerrarSesion);

export default r;
