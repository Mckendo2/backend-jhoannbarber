import { Router } from "express";
import {
  crearVenta,
  listarVentas,
  detalleVenta,
  agregarServicio,
  agregarProducto,
  quitarServicio,
  quitarProducto,
  registrarPago,
  anularVenta,
} from "../controllers/ventas.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const r = Router();

r.post("/", requireAuth, crearVenta);
r.get("/", requireAuth, listarVentas);
r.get("/:id", requireAuth, detalleVenta);
r.post("/:id/servicios", requireAuth, agregarServicio);
r.post("/:id/productos", requireAuth, agregarProducto);
r.delete("/:id/servicios/:itemId", requireAuth, quitarServicio);
r.delete("/:id/productos/:itemId", requireAuth, quitarProducto);
r.post("/:id/pagos", requireAuth, registrarPago);
r.post("/:id/anular", requireAuth, anularVenta);

export default r;
