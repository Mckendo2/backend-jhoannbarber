import { Router } from "express";
import {
  listarServiciosPublico,
  obtenerServicioPublico,
  crearServicio,
  listarServicios,
  detalleServicio,
  actualizarServicio,
  eliminarServicio,
  agregarImagenServicio,
  eliminarImagenServicio,
} from "../controllers/servicios.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import { uploadServicios } from "../lib/upload.js";

const r = Router();

r.get("/public", listarServiciosPublico);
r.get("/public/:id", obtenerServicioPublico);

r.post("/", requireAuth, crearServicio);
r.get("/", requireAuth, listarServicios);
r.get("/:id", requireAuth, detalleServicio);
r.put("/:id", requireAuth, actualizarServicio);
r.delete("/:id", requireAuth, eliminarServicio);

r.post(
  "/:id/imagen",
  requireAuth,
  uploadServicios.single("imagen"),
  agregarImagenServicio
);

r.delete("/:id/imagen", requireAuth, eliminarImagenServicio);

export default r;
