import "dotenv/config";

function bool(v, d = false) {
  if (v == null) return d;
  return String(v).toLowerCase() === "true";
}

const mailPort = parseInt(process.env.MAIL_PORT, 10);

export const config = {
  app: {
    name: process.env.APP_NAME,
    port: process.env.PORT || 4000,
    timezone: process.env.APP_TIMEZONE || "America/La_Paz",
  },
  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    poolLimit: parseInt(process.env.DB_POOL_LIMIT, 10) || 10,
    timezone: process.env.DB_TIMEZONE || "-04:00",
  },
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwt: {
    secret: process.env.JWT_SECRET,
    ttl: process.env.JWT_TTL || "1d",
    cookieName: process.env.JWT_COOKIE_NAME || "token",
    cookieSameSite: (process.env.JWT_COOKIE_SAMESITE || "lax").toLowerCase(),
    cookieSecure: bool(process.env.JWT_COOKIE_SECURE, false),
  },
  mail: {
    host: process.env.MAIL_HOST,
    port: mailPort,
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
    from: process.env.MAIL_FROM,
    fromName: process.env.MAIL_FROM_NAME,
    secure: bool(process.env.MAIL_SECURE, mailPort === 465),
  },
};
