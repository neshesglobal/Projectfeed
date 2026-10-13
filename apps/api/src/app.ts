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
import { createScanner, type MediaScanner } from "./services/screening";
import { createTranslator, type Translator } from "./services/translate";
import { ConnectionTracker, createGeoIp, type GeoIpProvider } from "./services/location";
import { StaffTokens, type StaffRole } from "./lib/staff";
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
import moderationRoutes from "./routes/moderation";
import adminRoutes from "./routes/admin";
import translateRoutes from "./routes/translate";
import aboutRoutes from "./routes/about";
import verificationRoutes from "./routes/verification";
import notesRoutes from "./routes/notes";
import discoverRoutes from "./routes/discover";
import gifRoutes from "./routes/gifs";
import { createGifProvider, type GifProvider } from "./services/gifs";
import { NotesScheduler } from "./services/notes";

export interface AppCtx {
  sql: Sql;
  cfg: Config;
  storage: Storage;
  tokens: TokenService;
  video: VideoProcessor;
  scanner: MediaScanner;
  /** Post translation provider; null when translation is switched off. */
  translator: Translator | null;
  /** GIF library behind the composer's GIF button; null when switched off. */
  gifs: GifProvider | null;
  /** IP → country and VPN/proxy detection, for "About this account". */
  geo: GeoIpProvider;
  connections: ConnectionTracker;
  /** Re-scores Community Notes shortly after new ratings. */
  notes: NotesScheduler;
  staffTokens: StaffTokens;
  /** preHandler for every write endpoint (auth + future KYC gate). */
  requireVerified: preHandlerHookHandler;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppCtx;
  }
}

/** Writes a suspended (read-only) account may still make: appeal, acknowledge notices, sign out, telemetry. */
const SUSPENDED_WRITES = [/^\/v1\/me\/appeals$/, /^\/v1\/me\/moderation-notices\/read$/, /^\/v1\/auth\/logout$/, /^\/v1\/events$/];
/** Frozen accounts (under compliance review) may only sign out. */
const FROZEN_WRITES = [/^\/v1\/auth\/logout$/, /^\/v1\/events$/];
const allowed = (list: RegExp[], url: string) => list.some((r) => r.test(url.split("?")[0]!));

export async function buildApp(
  cfg: Config,
  sql: Sql,
  opts: { logger?: boolean; scanner?: MediaScanner; translator?: Translator | null; geo?: GeoIpProvider; gifs?: GifProvider | null } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  const storage = new LocalStorage(cfg.uploadDir, cfg.publicBaseUrl);
  const scanner = opts.scanner ?? createScanner(cfg.isProd);
  const geo = opts.geo ?? (await createGeoIp(cfg.isProd));
  const ctx: AppCtx = {
    sql,
    cfg,
    storage,
    tokens: new TokenService(cfg),
    video: new VideoProcessor(sql, storage, scanner),
    scanner,
    geo,
    connections: new ConnectionTracker(sql, geo),
    notes: new NotesScheduler(sql),
    translator: opts.translator === undefined ? createTranslator(cfg.isProd) : opts.translator,
    gifs: opts.gifs === undefined ? createGifProvider(cfg.isProd, storage) : opts.gifs,
    staffTokens: new StaffTokens(cfg),
    requireVerified: makeRequireVerified(cfg) as preHandlerHookHandler,
  };
  app.decorate("ctx", ctx);
  await ctx.video.recover();
  app.decorateRequest("user", null);
  app.decorateRequest("staff", null);

  // @fastify/cors only allows GET, HEAD and POST unless told otherwise; the web app also edits and deletes.
  await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] });
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
    const token = header.slice(7);

    // Moderation console: separate token type, separate table.
    if (req.url.startsWith("/admin/")) {
      const staffId = await ctx.staffTokens.verify(token);
      if (!staffId) throw new AppError(401, "TOKEN_INVALID", "Session expired. Sign in again.");
      const [st] = await sql<{ id: string; role: StaffRole; display_name: string; status: string }[]>`
        SELECT id, role, display_name, status FROM staff WHERE id = ${staffId}`;
      if (!st || st.status !== "active") throw new AppError(401, "ACCOUNT_UNAVAILABLE", "Staff account disabled");
      req.staff = { id: st.id, role: st.role, displayName: st.display_name };
      return;
    }

    const claims = await ctx.tokens.verifyAccess(token);
    if (!claims) throw new AppError(401, "TOKEN_INVALID", "Access token invalid or expired");
    const [u] = await sql<{ status: string; kyc_level: number; suspended_until: Date | null }[]>`
      SELECT status, kyc_level, suspended_until FROM users WHERE id = ${claims.id}`;
    if (!u || u.status === "deleted" || u.status === "banned") {
      throw new AppError(401, "ACCOUNT_UNAVAILABLE", "This account is unavailable");
    }
    if (u.status === "suspended" && u.suspended_until && u.suspended_until <= new Date()) {
      // Timed suspension has lapsed: reinstate lazily on the next request.
      await sql`UPDATE users SET status = 'active', suspended_until = NULL WHERE id = ${claims.id} AND status = 'suspended'`;
      u.status = "active";
    }
    if (req.method !== "GET") {
      if (u.status === "suspended" && !allowed(SUSPENDED_WRITES, req.url)) {
        throw new AppError(403, "ACCOUNT_SUSPENDED", "Your account is suspended and read-only. See Settings → Account status.");
      }
      if (u.status === "frozen" && !allowed(FROZEN_WRITES, req.url)) {
        throw new AppError(403, "ACCOUNT_UNDER_REVIEW", "Account under review");
      }
    }
    req.user = { id: claims.id, kycLevel: u.kyc_level, status: u.status };
    // Country-level connection signal for "About this account" (one write per user, address and day).
    await ctx.connections.record(claims.id, req.ip).catch((e) => req.log.warn(e));
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
  await app.register(moderationRoutes, { prefix: "/v1" });
  await app.register(translateRoutes, { prefix: "/v1" });
  await app.register(aboutRoutes, { prefix: "/v1" });
  await app.register(verificationRoutes, { prefix: "/v1" });
  await app.register(notesRoutes, { prefix: "/v1" });
  await app.register(discoverRoutes, { prefix: "/v1" });
  await app.register(gifRoutes, { prefix: "/v1" });
  await app.register(adminRoutes, { prefix: "/admin/v1" });

  return app;
}
