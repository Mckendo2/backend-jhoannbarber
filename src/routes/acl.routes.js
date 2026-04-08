import { Router } from "express";
import {
  crearPermiso,
  listarPermisos,
  actualizarPermiso,
} from "../controllers/permisos.controller.js";
import {
  crearRol,
  listarRoles,
  detalleRol,
  actualizarRol,
  asignarPermiso,
  quitarPermiso,
  sincronizarPermisos,
  rolDeUsuario,
} from "../controllers/roles.controller.js";

const r = Router();

r.post("/permisos", crearPermiso);
r.get("/permisos", listarPermisos);
r.put("/permisos/:id", actualizarPermiso);

r.post("/roles", crearRol);
r.get("/roles", listarRoles);
r.get("/roles/:id", detalleRol);
r.put("/roles/:id", actualizarRol);
r.post("/roles/:id/permisos/:permisoId", asignarPermiso);
r.delete("/roles/:id/permisos/:permisoId", quitarPermiso);
r.patch("/roles/:id/permisos", sincronizarPermisos);

r.get("/usuarios/:id/rol", rolDeUsuario);

export default r;
