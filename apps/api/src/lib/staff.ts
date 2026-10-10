// Staff (moderation console) authentication and role-based access.
// Staff tokens are signed with a key derived separately from user tokens, so neither can be used as the other.

import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import type { Config } from "../config";
import type { Db } from "../db";
import { AppError, forbidden, unauthorized } from "./errors";
import { newId } from "./ids";

export const STAFF_ROLES = ["support", "moderator", "senior_moderator", "compliance", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles are cumulative: each one can do everything the roles before it can. */
const RANK: Record<StaffRole, number> = { support: 0, moderator: 1, senior_moderator: 2, compliance: 3, admin: 4 };

/**
 * The permission matrix. Keep in sync with docs/MODERATION.md and the privacy policy.
 *  support            view queues, public content and account status (no PII)
 *  moderator          + act on posts, warn, suspend up to 7 days, resolve reports
 *  senior_moderator   + longer suspensions, bans, decide appeals, view reported/flagged protected posts (logged)
 *  compliance         + view reported DMs (logged), reveal PII (logged), freeze/unfreeze, quarantine
 *  admin              + manage staff, read the access log
 */
export const PERMS = {
  view: "support",
  act: "moderator",
  suspendLong: "senior_moderator",
  ban: "senior_moderator",
  decideAppeals: "senior_moderator",
  viewProtected: "senior_moderator",
  viewDms: "compliance",
  revealPii: "compliance",
  freeze: "compliance",
  quarantine: "compliance",
  manageStaff: "admin",
  readAccessLog: "admin",
} as const satisfies Record<string, StaffRole>;
export type Perm = keyof typeof PERMS;

export const can = (role: StaffRole, perm: Perm) => RANK[role] >= RANK[PERMS[perm]];

export interface StaffUser {
  id: string;
  role: StaffRole;
  displayName: string;
}

declare module "fastify" {
  interface FastifyRequest {
    staff: StaffUser | null;
  }
}

export class StaffTokens {
  private key: Uint8Array;
  constructor(cfg: Config) {
    this.key = crypto.createHash("sha256").update(`${cfg.jwtSecret}:staff-console`).digest();
  }

  sign(staffId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(staffId)
      .setAudience("staff")
      .setIssuedAt()
      .setExpirationTime("8h")
      .sign(this.key);
  }

  async verify(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], audience: "staff" });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}

export function requireStaff(req: FastifyRequest, perm: Perm = "view"): StaffUser {
  if (!req.staff) throw unauthorized();
  if (!can(req.staff.role, perm)) throw forbidden(`Your role (${req.staff.role}) cannot do this`, "ROLE_FORBIDDEN");
  return req.staff;
}

/** Sensitive access needs a written reason that a reviewer could audit later. */
export function requireJustification(text: unknown): string {
  const j = typeof text === "string" ? text.trim() : "";
  if (j.length < 15) throw new AppError(400, "JUSTIFICATION_REQUIRED", "Give a justification of at least 15 characters");
  return j.slice(0, 2000);
}

/** Append to the access log (the table rejects UPDATE/DELETE). */
export async function logAccess(
  db: Db,
  req: FastifyRequest,
  entry: { action: string; targetType?: string; targetId?: string | null; justification?: string | null; reportId?: string | null },
): Promise<void> {
  await db`
    INSERT INTO access_log (id, staff_id, action, target_type, target_id, justification, report_id, ip)
    VALUES (${newId()}, ${req.staff?.id ?? null}, ${entry.action}, ${entry.targetType ?? null}, ${entry.targetId ?? null},
            ${entry.justification ?? null}, ${entry.reportId ?? null}, ${req.ip})`;
}
