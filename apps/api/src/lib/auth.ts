import crypto from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config";
import type { Db } from "../db";
import { forbidden, unauthorized } from "./errors";
import { newId } from "./ids";

export interface AuthUser {
  id: string;
  kycLevel: number;
  /** Account status, set by the request hook (active, suspended or frozen). */
  status?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

// OWASP-recommended Argon2id parameters.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export class TokenService {
  private key: Uint8Array;
  constructor(private cfg: Config) {
    this.key = new TextEncoder().encode(cfg.jwtSecret);
  }

  async signAccess(user: AuthUser): Promise<string> {
    return new SignJWT({ kyc: user.kycLevel })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.accessTokenTtlSec}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      if (!payload.sub) return null;
      return { id: payload.sub, kycLevel: Number(payload.kyc ?? 0) };
    } catch {
      return null;
    }
  }

  /** Issue a refresh token. A new login starts a new family; rotation keeps the family. */
  async issueRefresh(db: Db, userId: string, familyId: string | null, userAgent?: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + this.cfg.refreshTokenTtlDays * 86400_000);
    await db`
      INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at, user_agent)
      VALUES (${newId()}, ${userId}, ${familyId ?? newId()}, ${sha256(token)}, ${expires}, ${userAgent ?? null})`;
    return token;
  }

  /**
   * Rotate a refresh token. Presenting an already-used token means it was stolen:
   * revoke the whole family so both the attacker and the victim must log in again.
   */
  async rotateRefresh(db: Db, token: string, userAgent?: string): Promise<{ userId: string; refreshToken: string }> {
    const [row] = await db<{ id: string; user_id: string; family_id: string; revoked_at: Date | null; expires_at: Date }[]>`
      SELECT id, user_id, family_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = ${sha256(token)}`;
    if (!row) throw unauthorized("Invalid refresh token");
    if (row.revoked_at) {
      await db`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = ${row.family_id} AND revoked_at IS NULL`;
      throw unauthorized("Refresh token reuse detected; please sign in again");
    }
    if (row.expires_at < new Date()) throw unauthorized("Refresh token expired");
    const [user] = await db<{ status: string }[]>`SELECT status FROM users WHERE id = ${row.user_id}`;
    if (!user || user.status === "deleted" || user.status === "banned") throw unauthorized("Account unavailable");
    // Conditional update makes concurrent rotations of the same token safe: only one wins.
    const updated = await db`UPDATE refresh_tokens SET revoked_at = now() WHERE id = ${row.id} AND revoked_at IS NULL`;
    if (updated.count === 0) throw unauthorized("Refresh token already used");
    const refreshToken = await this.issueRefresh(db, row.user_id, row.family_id, userAgent);
    return { userId: row.user_id, refreshToken };
  }

  async revokeRefresh(db: Db, token: string): Promise<void> {
    await db`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = ${sha256(token)} AND revoked_at IS NULL`;
  }

  async revokeAll(db: Db, userId: string): Promise<void> {
    await db`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
  }
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * Guard for every write. While KYC_ENFORCED is false this only checks authentication;
 * once the KYC flow ships, unverified (level 0) users become read-only.
 */
export function makeRequireVerified(cfg: Config) {
  return async function requireVerified(req: FastifyRequest, _reply: FastifyReply) {
    const user = requireUser(req);
    if (cfg.kycEnforced && user.kycLevel < 1) {
      throw forbidden("Verify your identity to post, follow or message", "KYC_REQUIRED");
    }
  };
}
