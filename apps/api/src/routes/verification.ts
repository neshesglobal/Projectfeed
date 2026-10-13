// Business and creator verification (paid badges) and employee affiliations — the user side.
// Staff review lives in routes/admin.ts. Badges for public figures, government and news are granted, never sold.

import type { FastifyPluginAsync } from "fastify";
import {
  affiliateInviteSchema,
  validateRegistration,
  verificationApplySchema,
  type Affiliation,
  type VerificationApplication,
  type VerificationStatus,
} from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { AppError, badRequest, conflict, forbidden, notFound, parse } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { effectiveBadge } from "../services/badges";
import { userSummaries } from "../services/hydrate";

const verificationRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified } = app.ctx;
  const hctx = { db: sql, storage };

  async function affiliationsWhere(column: "org_id" | "member_id", userId: string): Promise<Affiliation[]> {
    const rows = await sql<{ org_id: string; member_id: string; title: string; status: Affiliation["status"] }[]>`
      SELECT org_id, member_id, title, status FROM affiliations WHERE ${sql(column)} = ${userId} ORDER BY invited_at DESC LIMIT 200`;
    const users = await userSummaries(hctx, [...new Set(rows.flatMap((r) => [r.org_id, r.member_id]))]);
    return rows
      .filter((r) => users.has(r.org_id) && users.has(r.member_id))
      .map((r) => ({ org: users.get(r.org_id)!, member: users.get(r.member_id)!, title: r.title, status: r.status }));
  }

  app.get("/me/verification", async (req): Promise<VerificationStatus> => {
    const me = requireUser(req);
    const [apps, [sub], badge, affiliations, affiliates] = await Promise.all([
      sql<{ id: string; kind: "business" | "creator"; status: VerificationApplication["status"]; legal_name: string | null; reg_type: string | null; reg_number: string | null; category: string | null; review_note: string | null; created_at: Date; decided_at: Date | null }[]>`
        SELECT id, kind, status, legal_name, reg_type, reg_number, category, review_note, created_at, decided_at
        FROM verification_applications WHERE user_id = ${me.id} ORDER BY id DESC LIMIT 10`,
      sql<{ plan: "business" | "creator"; status: string; current_period_end: Date }[]>`
        SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = ${me.id} ORDER BY current_period_end DESC LIMIT 1`,
      effectiveBadge(sql, me.id),
      affiliationsWhere("member_id", me.id),
      affiliationsWhere("org_id", me.id),
    ]);
    return {
      kycLevel: me.kycLevel,
      badge,
      subscription: sub ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.current_period_end.toISOString() } : null,
      applications: apps.map((a) => ({
        id: a.id,
        kind: a.kind,
        status: a.status,
        legalName: a.legal_name,
        regType: a.reg_type,
        regNumber: a.reg_number,
        category: a.category,
        reviewNote: a.review_note,
        createdAt: a.created_at.toISOString(),
        decidedAt: a.decided_at?.toISOString() ?? null,
      })),
      affiliations,
      affiliates,
    };
  });

  /** Apply for a business or creator badge. Requires a verified identity: the badge is only as good as the ID behind it. */
  app.post("/me/verification/apply", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    if (me.kycLevel < 1) throw forbidden("Verify your identity first", "KYC_REQUIRED");
    const input = parse(verificationApplySchema, req.body);
    if (input.kind === "business") {
      const err = validateRegistration(input.regType, input.regNumber);
      if (err) throw badRequest(err);
    }
    const id = newId();
    try {
      await sql`
        INSERT INTO verification_applications (id, user_id, kind, legal_name, reg_type, reg_number, country, website,
                                               signatory_name, signatory_role, category, links, about)
        VALUES (${id}, ${me.id}, ${input.kind},
                ${input.kind === "business" ? input.legalName : null}, ${input.kind === "business" ? input.regType : null},
                ${input.kind === "business" ? input.regNumber.toUpperCase() : null}, ${input.kind === "business" ? input.country.toUpperCase() : null},
                ${input.kind === "business" ? input.website : null}, ${input.kind === "business" ? input.signatoryName : null},
                ${input.kind === "business" ? input.signatoryRole : null}, ${input.kind === "creator" ? input.category : null},
                ${input.kind === "creator" ? input.links : []}, ${input.kind === "creator" ? input.about : null})`;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("You already have an application under review", "APPLICATION_PENDING");
      throw e;
    }
    reply.status(201);
    return { id, status: "pending" };
  });

  app.post("/me/verification/withdraw", async (req) => {
    const me = requireUser(req);
    await sql`UPDATE verification_applications SET status = 'withdrawn', decided_at = now() WHERE user_id = ${me.id} AND status = 'pending'`;
    return { ok: true };
  });

  // ───────────── Affiliations ─────────────

  /** A verified business invites a person; the person must accept before the business logo shows on their profile. */
  app.post("/me/affiliates", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    if ((await effectiveBadge(sql, me.id)) !== "business") throw forbidden("Only verified businesses can add affiliates", "NOT_A_BUSINESS");
    const input = parse(affiliateInviteSchema, req.body);
    const [m] = await sql<{ id: string }[]>`SELECT id FROM users WHERE handle = ${input.handle.replace(/^@/, "")} AND status = 'active'`;
    if (!m) throw notFound("User");
    if (m.id === me.id) throw badRequest("You can't affiliate with yourself");
    await sql`
      INSERT INTO affiliations (org_id, member_id, title) VALUES (${me.id}, ${m.id}, ${input.title})
      ON CONFLICT (org_id, member_id) DO UPDATE SET title = excluded.title`;
    reply.status(201);
    return { ok: true };
  });

  app.delete<{ Params: { memberId: string } }>("/me/affiliates/:memberId", async (req, reply) => {
    const me = requireUser(req);
    if (!isId(req.params.memberId)) throw notFound("Affiliate");
    await sql.begin(async (tx) => {
      await tx`DELETE FROM affiliations WHERE org_id = ${me.id} AND member_id = ${req.params.memberId}`;
      await tx`UPDATE users SET affiliated_org_id = NULL WHERE id = ${req.params.memberId} AND affiliated_org_id = ${me.id}`;
    });
    reply.status(204);
  });

  app.post<{ Params: { orgId: string; action: string } }>("/me/affiliations/:orgId/:action", async (req) => {
    const me = requireUser(req);
    const { orgId, action } = req.params;
    if (!isId(orgId) || !["accept", "decline", "leave"].includes(action)) throw notFound("Affiliation");
    await sql.begin(async (tx) => {
      const [a] = await tx<{ status: string }[]>`SELECT status FROM affiliations WHERE org_id = ${orgId} AND member_id = ${me.id} FOR UPDATE`;
      if (!a) throw notFound("Affiliation");
      if (action === "accept") {
        if (a.status !== "pending") throw new AppError(409, "NOT_PENDING", "Already accepted");
        // One displayed affiliation at a time: accepting a new one ends the previous one.
        await tx`DELETE FROM affiliations WHERE member_id = ${me.id} AND status = 'active' AND org_id <> ${orgId}`;
        await tx`UPDATE affiliations SET status = 'active', accepted_at = now() WHERE org_id = ${orgId} AND member_id = ${me.id}`;
        await tx`UPDATE users SET affiliated_org_id = ${orgId} WHERE id = ${me.id}`;
      } else {
        await tx`DELETE FROM affiliations WHERE org_id = ${orgId} AND member_id = ${me.id}`;
        await tx`UPDATE users SET affiliated_org_id = NULL WHERE id = ${me.id} AND affiliated_org_id = ${orgId}`;
      }
    });
    return { ok: true };
  });

  /** Public: the people who work at a verified business. */
  app.get<{ Params: { id: string } }>("/users/:id/affiliates", async (req) => {
    if (!isId(req.params.id)) throw notFound("User");
    const rows = await sql<{ member_id: string; title: string }[]>`
      SELECT member_id, title FROM affiliations WHERE org_id = ${req.params.id} AND status = 'active' ORDER BY accepted_at LIMIT 200`;
    const users = await userSummaries(hctx, rows.map((r) => r.member_id));
    return { items: rows.filter((r) => users.has(r.member_id)).map((r) => ({ user: users.get(r.member_id)!, title: r.title })) };
  });
};

export default verificationRoutes;
