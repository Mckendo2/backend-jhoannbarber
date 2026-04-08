import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  crearProducto,
  listarProductos,
  detalleProducto,
  actualizarProducto,
  eliminarProducto,
  agregarFotos,
  eliminarFoto,
  setFotoPrincipal,
} from "../controllers/productos.controller.js";
import { uploadProductos } from "../lib/upload.js";

const r = Router();

r.post("/", requireAuth, crearProducto);
r.get("/", requireAuth, listarProductos);
r.get("/:id", requireAuth, detalleProducto);
r.put("/:id", requireAuth, actualizarProducto);
r.delete("/:id", requireAuth, eliminarProducto);
r.post(
  "/:id/fotos",
  requireAuth,
  uploadProductos.array("fotos", 10),
  agregarFotos
);
r.delete("/:id/fotos/:fotoId", requireAuth, eliminarFoto);
r.patch("/:id/fotos/:fotoId/principal", requireAuth, setFotoPrincipal);

export default r;
