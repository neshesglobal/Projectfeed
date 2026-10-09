import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthTokens } from "@projectfeed/shared";
import { buildApp } from "../src/app";
import { config, type Config } from "../src/config";
import { createDb, migrate, type Sql } from "../src/db";

export const TEST_DB =
  process.env.TEST_DATABASE_URL ?? "postgres://projectfeed:projectfeed@localhost:5432/projectfeed_test";

export interface TestEnv {
  app: FastifyInstance;
  sql: Sql;
  close: () => Promise<void>;
}

/** Fresh schema per test file, so files are independent. */
export async function setup(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const sql = createDb(TEST_DB);
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(sql);
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "pf-uploads-"));
  process.env.RATE_LIMIT_PER_MIN = "100000";
  process.env.AUTH_RATE_LIMIT_PER_MIN = "100000";
  const app = await buildApp({ ...config, databaseUrl: TEST_DB, uploadDir, ...overrides }, sql);
  return {
    app,
    sql,
    close: async () => {
      await app.close();
      await sql.end();
      await app.ctx.video.idle();
      fs.rmSync(uploadDir, { recursive: true, force: true });
      fs.rmSync(`${uploadDir}-tmp`, { recursive: true, force: true });
    },
  };
}

let counter = 0;

export interface TestUser {
  id: string;
  handle: string;
  token: string;
  refreshToken: string;
  auth: { authorization: string };
}

export async function register(app: FastifyInstance, handle?: string): Promise<TestUser> {
  const h = handle ?? `user${++counter}_${Math.floor(Math.random() * 1000)}`;
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: `${h}@example.com`, password: "correct-horse-battery", handle: h, displayName: h },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json<AuthTokens>();
  return {
    id: body.user.id,
    handle: h,
    token: body.accessToken,
    refreshToken: body.refreshToken,
    auth: { authorization: `Bearer ${body.accessToken}` },
  };
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Small request helper: returns { status, body }. */
export async function call<T = any>(app: FastifyInstance, user: TestUser | null, method: Method, url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as any, headers: user ? user.auth : {} });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as T };
}

export async function post(app: FastifyInstance, user: TestUser, text: string, extra: Record<string, unknown> = {}) {
  const r = await call(app, user, "POST", "/v1/posts", { text, ...extra });
  if (r.status !== 201) throw new Error(`post failed: ${JSON.stringify(r.body)}`);
  return r.body as { id: string } & Record<string, any>;
}

/** Multipart upload of a file buffer to /v1/media. */
export async function upload(app: FastifyInstance, user: TestUser, data: Buffer, contentType: string, filename = "file") {
  const boundary = "----pftest";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: "/v1/media",
    payload,
    headers: { ...user.auth, "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
}
