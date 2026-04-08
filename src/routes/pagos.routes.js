import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import {
  listarVentas,
  crearVenta,
  actualizarVenta,
  detalleVenta,
  eliminarVenta,
  anularVenta,
  pagarVenta,
  ticketVenta,
  agregarServicioAVenta,
  eliminarServicioDeVenta,
  agregarProductoAVenta,
  eliminarProductoDeVenta,
  buscarClientes,
  listarBarberos,
  buscarServicios,
  buscarProductos,
} from "../controllers/pagos.controller.js";

const r = Router();

r.get("/ventas", requireAuth, listarVentas);
r.post("/ventas", requireAuth, crearVenta);
r.get("/ventas/:id", requireAuth, detalleVenta);
r.put("/ventas/:id", requireAuth, actualizarVenta);
r.delete("/ventas/:id", requireAuth, eliminarVenta);
r.post("/ventas/:id/anular", requireAuth, anularVenta);
r.post("/ventas/:id/pagar", requireAuth, pagarVenta);
r.get("/ventas/:id/ticket", requireAuth, ticketVenta);

r.post("/ventas/:id/servicios", requireAuth, agregarServicioAVenta);
r.delete("/ventas/:id/servicios/:itemId", requireAuth, eliminarServicioDeVenta);

r.post("/ventas/:id/productos", requireAuth, agregarProductoAVenta);
r.delete("/ventas/:id/productos/:itemId", requireAuth, eliminarProductoDeVenta);

r.get("/clientes", requireAuth, buscarClientes);
r.get("/barberos", requireAuth, listarBarberos);
r.get("/servicios", requireAuth, buscarServicios);
r.get("/productos", requireAuth, buscarProductos);

export default r;
