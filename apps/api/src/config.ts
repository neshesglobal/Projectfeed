import path from "node:path";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL", isProd ? undefined : "postgres://projectfeed:projectfeed@localhost:5432/projectfeed"),
  jwtSecret: required("JWT_SECRET", isProd ? undefined : "dev-only-secret-do-not-use-in-production-0123456789"),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:4000",
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "./uploads"),
  /** When true, users below KYC level 1 are read-only. Off until the vendor flow ships. */
  kycEnforced: process.env.KYC_ENFORCED === "true",
  accessTokenTtlSec: 15 * 60,
  refreshTokenTtlDays: 30,
  maxMediaBytes: 10 * 1024 * 1024,
};

export type Config = typeof config;
