import multer from "multer";
import path from "path";
import fs from "fs";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function storageFactory(subfolder) {
  const dir = path.join(process.cwd(), "upload", subfolder);
  ensureDir(dir);
  return multer.diskStorage({
    destination: (_, __, cb) => cb(null, dir),
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname || "");
      const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, name);
    },
  });
}

export const uploadProductos = multer({ storage: storageFactory("productos") });
export const uploadGastos = multer({ storage: storageFactory("gastos") });
export const uploadServicios = multer({ storage: storageFactory("servicios") });
export const uploadContratos = multer({ storage: storageFactory("contratos") });
