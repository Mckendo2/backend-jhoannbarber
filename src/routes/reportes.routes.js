import { Router } from "express";
import {
  barberosDesempenoJson,
  barberosDesempenoPdf,
  productosMasVendidosJson,
  productosMasVendidosPdf,
  ingresosPeriodoJson,
  ingresosPeriodoPdf,
  inventarioPeriodoJson,
  inventarioPeriodoPdf,
  comisionesPeriodoJson,
  comisionesPeriodoPdf,
} from "../controllers/reportes.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const r = Router();

r.get("/barberos/desempeno", requireAuth, barberosDesempenoJson);
r.get("/barberos/desempeno/pdf", requireAuth, barberosDesempenoPdf);

r.get("/productos/mas-vendidos", requireAuth, productosMasVendidosJson);
r.get("/productos/mas-vendidos/pdf", requireAuth, productosMasVendidosPdf);

r.get("/ingresos", requireAuth, ingresosPeriodoJson);
r.get("/ingresos/pdf", requireAuth, ingresosPeriodoPdf);

r.get("/inventario", requireAuth, inventarioPeriodoJson);
r.get("/inventario/pdf", requireAuth, inventarioPeriodoPdf);

r.get("/comisiones", requireAuth, comisionesPeriodoJson);
r.get("/comisiones/pdf", requireAuth, comisionesPeriodoPdf);

export default r;
