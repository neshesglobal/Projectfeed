import Fastify, { type FastifyInstance, type preHandlerHookHandler } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import type { Config } from "./config";
import type { Sql } from "./db";
import { AppError } from "./lib/errors";
import { TokenService, makeRequireVerified } from "./lib/auth";
import { LocalStorage, type Storage } from "./lib/storage";
import { VideoProcessor } from "./services/video";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import postRoutes from "./routes/posts";
import feedRoutes from "./routes/feed";
import notificationRoutes from "./routes/notifications";
import searchRoutes from "./routes/search";
import mediaRoutes from "./routes/media";
import messageRoutes from "./routes/messages";
import listRoutes from "./routes/lists";
import safetyRoutes from "./routes/safety";
import settingsRoutes from "./routes/settings";

export interface AppCtx {
  sql: Sql;
  cfg: Config;
  storage: Storage;
  tokens: TokenService;
  video: VideoProcessor;
  /** preHandler for every write endpoint (auth + future KYC gate). */
  requireVerified: preHandlerHookHandler;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppCtx;
  }
}

export async function buildApp(cfg: Config, sql: Sql, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  const storage = new LocalStorage(cfg.uploadDir, cfg.publicBaseUrl);
  const ctx: AppCtx = {
    sql,
    cfg,
    storage,
    tokens: new TokenService(cfg),
    video: new VideoProcessor(sql, storage),
    requireVerified: makeRequireVerified(cfg) as preHandlerHookHandler,
  };
  app.decorate("ctx", ctx);
  await ctx.video.recover();
  app.decorateRequest("user", null);

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: cfg.maxMediaBytes, files: 1 } });
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_PER_MIN ?? 600),
    timeWindow: "1 minute",
    hook: "preHandler",
    keyGenerator: (req) => req.user?.id ?? req.ip,
  });
  await app.register(fastifyStatic, { root: cfg.uploadDir, prefix: "/media/", decorateReply: false, maxAge: "365d", immutable: true });

  // Authenticate on every request when a bearer token is present. Account status and KYC level are
  // read from the database (not the token) so suspensions and verification changes apply immediately.
  app.addHook("onRequest", async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const claims = await ctx.tokens.verifyAccess(header.slice(7));
    if (!claims) throw new AppError(401, "TOKEN_INVALID", "Access token invalid or expired");
    const [u] = await sql<{ status: string; kyc_level: number }[]>`SELECT status, kyc_level FROM users WHERE id = ${claims.id}`;
    if (!u || u.status === "deleted" || u.status === "suspended") {
      throw new AppError(401, "ACCOUNT_UNAVAILABLE", "This account is unavailable");
    }
    if (u.status === "frozen" && req.method !== "GET") {
      throw new AppError(403, "ACCOUNT_UNDER_REVIEW", "Account under review");
    }
    req.user = { id: claims.id, kycLevel: u.kyc_level };
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error(err);
      if (process.env.DEBUG_ERRORS) console.error(err);
    }
    const e = err as { code?: string; message: string };
    return reply.status(status).send({
      error: {
        code: status >= 500 ? "INTERNAL" : status === 429 ? "RATE_LIMITED" : (e.code ?? "BAD_REQUEST"),
        message: status >= 500 ? "Internal error" : e.message,
      },
    });
  });

  app.get("/health", async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: "/v1/auth" });
  await app.register(userRoutes, { prefix: "/v1" });
  await app.register(postRoutes, { prefix: "/v1" });
  await app.register(feedRoutes, { prefix: "/v1" });
  await app.register(notificationRoutes, { prefix: "/v1" });
  await app.register(searchRoutes, { prefix: "/v1" });
  await app.register(mediaRoutes, { prefix: "/v1" });
  await app.register(messageRoutes, { prefix: "/v1" });
  await app.register(listRoutes, { prefix: "/v1" });
  await app.register(safetyRoutes, { prefix: "/v1" });
  await app.register(settingsRoutes, { prefix: "/v1" });

  return app;
}
