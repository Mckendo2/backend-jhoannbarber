import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { uploadGastos } from "../lib/upload.js";
import {
  listarCategorias,
  crearCategoria,
  actualizarCategoria,
} from "../controllers/gasto_categorias.controller.js";
import {
  listarGastos,
  crearGasto,
  actualizarGasto,
  eliminarGasto,
} from "../controllers/gastos.controller.js";
import {
  listarMovimientos,
  crearMovimiento,
} from "../controllers/movimientos.controller.js";

const r = Router();

r.get("/categorias", requireAuth, listarCategorias);
r.post("/categorias", requireAuth, crearCategoria);
r.put("/categorias/:id", requireAuth, actualizarCategoria);

r.get("/", requireAuth, listarGastos);
r.post("/", requireAuth, uploadGastos.single("comprobante"), crearGasto);
r.put("/:id", requireAuth, uploadGastos.single("comprobante"), actualizarGasto);
r.delete("/:id", requireAuth, eliminarGasto);

r.get("/movimientos/listado", requireAuth, listarMovimientos);
r.post("/movimientos", requireAuth, crearMovimiento);

export default r;
