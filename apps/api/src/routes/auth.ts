import type { FastifyPluginAsync } from "fastify";
import { loginSchema, refreshSchema, registerSchema, type AuthTokens } from "@projectfeed/shared";
import { conflict, parse, unauthorized } from "../lib/errors";
import { hashPassword, verifyPassword } from "../lib/auth";
import { newId } from "../lib/ids";
import { userProfile } from "../services/hydrate";

// Pre-computed hash so failed logins for unknown users take the same time as real ones.
let dummyHash: Promise<string> | null = null;

const authRoutes: FastifyPluginAsync = async (app) => {
  const { sql, tokens, storage } = app.ctx;
  const strict = { config: { rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 10), timeWindow: "1 minute" } } };

  async function session(userId: string, familyId: string | null, ua?: string, refreshToken?: string): Promise<AuthTokens> {
    const [u] = await sql<{ kyc_level: number }[]>`SELECT kyc_level FROM users WHERE id = ${userId}`;
    const accessToken = await tokens.signAccess({ id: userId, kycLevel: u!.kyc_level });
    const rt = refreshToken ?? (await tokens.issueRefresh(sql, userId, familyId, ua));
    const user = (await userProfile({ db: sql, storage }, userId, userId))!;
    return { accessToken, refreshToken: rt, user };
  }

  app.post("/register", strict, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const id = newId();
    const passwordHash = await hashPassword(input.password);
    try {
      await sql`
        INSERT INTO users (id, email, password_hash, handle, display_name)
        VALUES (${id}, ${input.email}, ${passwordHash}, ${input.handle}, ${input.displayName})`;
    } catch (e) {
      const err = e as { code?: string; constraint_name?: string };
      if (err.code === "23505") {
        throw err.constraint_name?.includes("handle")
          ? conflict("That handle is taken", "HANDLE_TAKEN")
          : conflict("An account with that email already exists", "EMAIL_TAKEN");
      }
      throw e;
    }
    reply.status(201);
    return session(id, null, req.headers["user-agent"]);
  });

  app.post("/login", strict, async (req) => {
    const input = parse(loginSchema, req.body);
    const ident = input.identifier.replace(/^@/, "");
    const [u] = await sql<{ id: string; password_hash: string; status: string }[]>`
      SELECT id, password_hash, status FROM users WHERE email = ${ident} OR handle = ${ident} LIMIT 1`;
    if (!u) {
      dummyHash ??= hashPassword("dummy-password-for-timing");
      await verifyPassword(await dummyHash, input.password);
      throw unauthorized("Incorrect email/handle or password");
    }
    if (!(await verifyPassword(u.password_hash, input.password))) throw unauthorized("Incorrect email/handle or password");
    // Suspended accounts may sign in (read-only, so they can read the notice and appeal); banned ones may not.
    if (u.status === "deleted" || u.status === "banned") throw unauthorized("This account is unavailable");
    return session(u.id, null, req.headers["user-agent"]);
  });

  app.post("/refresh", strict, async (req) => {
    const { refreshToken } = parse(refreshSchema, req.body);
    const rotated = await tokens.rotateRefresh(sql, refreshToken, req.headers["user-agent"]);
    return session(rotated.userId, null, undefined, rotated.refreshToken);
  });

  app.post("/logout", async (req, reply) => {
    const body = req.body as { refreshToken?: string; pushToken?: string } | undefined;
    if (body?.refreshToken) await tokens.revokeRefresh(sql, body.refreshToken);
    // This device stops receiving the account's notifications.
    if (typeof body?.pushToken === "string") await sql`DELETE FROM push_tokens WHERE token = ${body.pushToken}`;
    reply.status(204);
  });
};

export default authRoutes;
