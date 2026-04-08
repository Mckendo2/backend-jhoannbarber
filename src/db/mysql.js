import mysql from "mysql2/promise";
import { config } from "../config/env.js";

const tick = (name) => "`" + String(name).replace(/`/g, "``") + "`";

export async function ensureDatabase() {
  const admin = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false,
    charset: "utf8mb4",
  });
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS ${tick(
      config.db.database
    )} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
  );
  await admin.end();
}

export let pool;

export function initPool() {
  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: config.db.poolLimit,
    queueLimit: 0,
    dateStrings: true,
    timezone: config.db.timezone,
    charset: "utf8mb4",
  });

  try {
    pool.on("connection", (conn) => {
      try {
        conn.query(
          "SET time_zone = ?",
          [config.db.timezone || "-04:00"],
          (err) => {
            if (err) {
              console.error(
                "Error setting time_zone on connection:",
                err.message || err
              );
            }
          }
        );
      } catch (e) {
        console.error(
          "Error ejecutando query de timezone en connection hook:",
          e?.message || e
        );
      }
    });
  } catch (err) {
    console.error("Pool event hook failed:", err);
  }
}

export async function query(sql, params) {
  if (!pool) throw new Error("Pool not initialized");
  const [rows] = await pool.query(sql, params);
  return rows;
}
