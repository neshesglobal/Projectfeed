// Moderation console API (/admin/v1). Staff-only; every sensitive read and every decision is written to the
// append-only access log. Access tiers are documented in docs/MODERATION.md.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Db } from "../db";
import { MODERATION_ACTIONS, MODERATION_REASONS, type ModerationActionType } from "@projectfeed/shared";
import { hashPassword, verifyPassword } from "../lib/auth";
import { AppError, badRequest, forbidden, notFound, parse, unauthorized } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { PERMS, STAFF_ROLES, can, logAccess, requireJustification, requireStaff, type Perm, type StaffUser } from "../lib/staff";
import { POST_ACTIONS, REVERSAL, applyAction } from "../services/moderation";
import { computeTrust } from "../services/trust";
import { idCursor, pageSize } from "../services/timeline";

const MODERATOR_MAX_SUSPENSION_DAYS = 7;

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
const actionSchema = z.object({
  action: z.enum(MODERATION_ACTIONS),
  targetId: z.string(),
  reasonCode: z.enum(MODERATION_REASONS),
  statement: z.string().trim().min(10, "Write a statement of reasons the user will see (10+ characters)").max(2000),
  reportId: z.string().optional(),
  durationDays: z.number().int().min(1).max(3650).nullable().optional(),
});
const decideSchema = z.object({ decision: z.enum(["upheld", "overturned"]), note: z.string().trim().min(10).max(2000) });
const staffCreateSchema = z.object({
  email: z.string().email(),
  displayName: z.string().trim().min(1).max(80),
  role: z.enum(STAFF_ROLES),
  password: z.string().min(12).max(200),
});
const staffPatchSchema = z.object({ role: z.enum(STAFF_ROLES).optional(), status: z.enum(["active", "disabled"]).optional() });

/** Which permission each action needs. Suspensions longer than 7 days escalate to senior moderators. */
function permFor(action: ModerationActionType, durationDays: number | null | undefined): Perm {
  if (action === "ban" || action === "unban") return "ban";
  if (action === "freeze" || action === "unfreeze") return "freeze";
  if (action === "suspend" && (durationDays == null || durationDays > MODERATOR_MAX_SUSPENSION_DAYS)) return "suspendLong";
  return "act";
}

// ───────────────────────────── Shapes ─────────────────────────────

interface AdminAuthor {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  isProtected: boolean;
}

interface AdminPost {
  id: string;
  author: AdminAuthor;
  text: string;
  createdAt: string;
  replyToId: string | null;
  media: { id: string; type: string; url: string; thumbUrl: string; width: number; height: number; altText: string }[];
  counts: { likes: number; replies: number; reposts: number; views: number };
  flags: { removed: boolean; deleted: boolean; sensitive: boolean; limited: boolean };
  openReports: number;
}

/** A report target as shown in the queue. Restricted targets carry no content until revealed (and logged). */
type Preview =
  | { kind: "post"; post: AdminPost }
  | { kind: "post"; restricted: "protected"; requires: "senior_moderator"; author: AdminAuthor | null }
  | { kind: "user"; user: AdminAuthor & { strikes: number; createdAt: string; followers: number; kycLevel: number } }
  | { kind: "message"; restricted: "dm"; requires: "compliance"; sender: AdminAuthor | null }
  | { kind: "media"; restricted: "quarantine"; requires: "compliance"; owner: AdminAuthor | null; mediaType: string }
  | { kind: "missing" };

const adminRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, staffTokens } = app.ctx;
  const strict = { config: { rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 10), timeWindow: "1 minute" } } };
  let dummyHash: Promise<string> | null = null;

  const authorOf = (r: { id: string; handle: string; display_name: string; avatar_key: string | null; status: string; is_protected: boolean }): AdminAuthor => ({
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    avatarUrl: r.avatar_key ? storage.url(r.avatar_key) : null,
    status: r.status,
    isProtected: r.is_protected,
  });

  async function authors(ids: string[]): Promise<Map<string, AdminAuthor>> {
    const out = new Map<string, AdminAuthor>();
    if (ids.length === 0) return out;
    const rows = await sql<{ id: string; handle: string; display_name: string; avatar_key: string | null; status: string; is_protected: boolean }[]>`
      SELECT u.id, u.handle::text AS handle, u.display_name, am.storage_key AS avatar_key, u.status, u.is_protected
      FROM users u LEFT JOIN media am ON am.id = u.avatar_media_id WHERE u.id = ANY(${ids}::bigint[])`;
    for (const r of rows) out.set(r.id, authorOf(r));
    return out;
  }

  /** Load posts for staff, ignoring viewer-level visibility (moderators see removed and limited posts). */
  async function adminPosts(ids: string[]): Promise<Map<string, AdminPost>> {
    const out = new Map<string, AdminPost>();
    if (ids.length === 0) return out;
    const rows = await sql<
      {
        id: string;
        author_id: string;
        text: string;
        created_at: Date;
        reply_to_id: string | null;
        like_count: number;
        reply_count: number;
        repost_count: number;
        view_count: number;
        removed_at: Date | null;
        deleted_at: Date | null;
        sensitive: boolean;
        limited: boolean;
        open_reports: number;
      }[]
    >`
      SELECT p.id, p.author_id, p.text, p.created_at, p.reply_to_id, p.like_count, p.reply_count, p.repost_count, p.view_count,
             p.removed_at, p.deleted_at, p.sensitive, p.limited,
             (SELECT count(*)::int FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.status = 'open') AS open_reports
      FROM posts p WHERE p.id = ANY(${ids}::bigint[])`;
    const media = await sql<{ post_id: string; id: string; type: string; storage_key: string; thumb_key: string; width: number; height: number; alt_text: string }[]>`
      SELECT pm.post_id, m.id, m.type, m.storage_key, m.thumb_key, m.width, m.height, m.alt_text
      FROM post_media pm JOIN media m ON m.id = pm.media_id
      WHERE pm.post_id = ANY(${ids}::bigint[]) AND m.status = 'ready' ORDER BY pm.position`;
    const who = await authors([...new Set(rows.map((r) => r.author_id))]);
    for (const r of rows) {
      out.set(r.id, {
        id: r.id,
        author: who.get(r.author_id)!,
        text: r.text,
        createdAt: r.created_at.toISOString(),
        replyToId: r.reply_to_id,
        media: media
          .filter((m) => m.post_id === r.id)
          .map((m) => ({ id: m.id, type: m.type, url: storage.url(m.storage_key), thumbUrl: storage.url(m.thumb_key), width: m.width, height: m.height, altText: m.alt_text })),
        counts: { likes: r.like_count, replies: r.reply_count, reposts: r.repost_count, views: r.view_count },
        flags: { removed: !!r.removed_at, deleted: !!r.deleted_at, sensitive: r.sensitive, limited: r.limited },
        openReports: r.open_reports,
      });
    }
    return out;
  }

  async function preview(targetType: string, targetId: string): Promise<Preview> {
    if (targetType === "post") {
      const [p] = await sql<{ author_id: string; is_protected: boolean }[]>`
        SELECT p.author_id, u.is_protected FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ${targetId}`;
      if (!p) return { kind: "missing" };
      if (p.is_protected) {
        return { kind: "post", restricted: "protected", requires: "senior_moderator", author: (await authors([p.author_id])).get(p.author_id) ?? null };
      }
      const post = (await adminPosts([targetId])).get(targetId);
      return post ? { kind: "post", post } : { kind: "missing" };
    }
    if (targetType === "user") {
      const [u] = await sql<{ strike_count: number; created_at: Date; followers_count: number; kyc_level: number }[]>`
        SELECT strike_count, created_at, followers_count, kyc_level FROM users WHERE id = ${targetId}`;
      const a = (await authors([targetId])).get(targetId);
      if (!u || !a) return { kind: "missing" };
      return { kind: "user", user: { ...a, strikes: u.strike_count, createdAt: u.created_at.toISOString(), followers: u.followers_count, kycLevel: u.kyc_level } };
    }
    if (targetType === "message") {
      const [m] = await sql<{ sender_id: string }[]>`SELECT sender_id FROM messages WHERE id = ${targetId}`;
      return { kind: "message", restricted: "dm", requires: "compliance", sender: m ? ((await authors([m.sender_id])).get(m.sender_id) ?? null) : null };
    }
    if (targetType === "media") {
      const [m] = await sql<{ owner_id: string; type: string }[]>`SELECT owner_id, type FROM media WHERE id = ${targetId}`;
      return { kind: "media", restricted: "quarantine", requires: "compliance", owner: m ? ((await authors([m.owner_id])).get(m.owner_id) ?? null) : null, mediaType: m?.type ?? "unknown" };
    }
    return { kind: "missing" };
  }

  const staffJson = (s: { id: string; email: string; display_name: string; role: string; status: string; created_at?: Date; last_login_at?: Date | null }) => ({
    id: s.id,
    email: s.email,
    displayName: s.display_name,
    role: s.role,
    status: s.status,
    createdAt: s.created_at?.toISOString() ?? null,
    lastLoginAt: s.last_login_at?.toISOString() ?? null,
  });

  // ───────────────────────────── Auth ─────────────────────────────

  app.post("/auth/login", strict, async (req) => {
    const input = parse(loginSchema, req.body);
    const [s] = await sql<{ id: string; email: string; password_hash: string; display_name: string; role: string; status: string }[]>`
      SELECT id, email::text AS email, password_hash, display_name, role, status FROM staff WHERE email = ${input.email}`;
    if (!s) {
      dummyHash ??= hashPassword("dummy-password-for-timing");
      await verifyPassword(await dummyHash, input.password);
      throw unauthorized("Incorrect email or password");
    }
    if (!(await verifyPassword(s.password_hash, input.password))) throw unauthorized("Incorrect email or password");
    if (s.status !== "active") throw unauthorized("Staff account disabled");
    await sql`UPDATE staff SET last_login_at = now() WHERE id = ${s.id}`;
    req.staff = { id: s.id, role: s.role as StaffUser["role"], displayName: s.display_name };
    await logAccess(sql, req, { action: "staff_login" });
    return { token: await staffTokens.sign(s.id), staff: staffJson(s) };
  });

  app.get("/me", async (req) => {
    const me = requireStaff(req);
    const perms = (Object.keys(PERMS) as Perm[]).filter((p) => can(me.role, p));
    return { ...me, permissions: perms };
  });

  /** Reference data for the console's forms. */
  app.get("/meta", async (req) => {
    requireStaff(req);
    return { reasons: MODERATION_REASONS, actions: MODERATION_ACTIONS, roles: STAFF_ROLES, permissions: PERMS, moderatorMaxSuspensionDays: MODERATOR_MAX_SUSPENSION_DAYS };
  });

  // ───────────────────────────── Dashboard ─────────────────────────────

  app.get("/dashboard", async (req) => {
    const me = requireStaff(req);
    const [c] = await sql<Record<string, number>[]>`
      SELECT
        (SELECT count(*)::int FROM reports WHERE status = 'open') AS "openReports",
        (SELECT count(*)::int FROM reports WHERE status = 'open' AND priority <= 1) AS "urgentReports",
        (SELECT count(*)::int FROM appeals WHERE status = 'open') AS "openAppeals",
        (SELECT count(*)::int FROM media WHERE status = 'quarantined') AS "quarantined",
        (SELECT count(*)::int FROM moderation_actions WHERE created_at > now() - interval '24 hours') AS "actions24h",
        (SELECT count(*)::int FROM posts WHERE created_at > now() - interval '24 hours') AS "posts24h",
        (SELECT count(*)::int FROM media WHERE created_at > now() - interval '24 hours' AND status = 'ready') AS "uploads24h",
        (SELECT count(*)::int FROM users WHERE created_at > now() - interval '24 hours') AS "signups24h",
        (SELECT count(*)::int FROM users WHERE status = 'suspended') AS "suspended",
        (SELECT count(*)::int FROM users WHERE status = 'frozen') AS "frozen",
        (SELECT count(*)::int FROM verification_applications WHERE status = 'pending') AS "pendingVerifications"`;
    const byReason = await sql<{ reason: string; n: number }[]>`
      SELECT reason, count(*)::int AS n FROM reports WHERE status = 'open' GROUP BY reason ORDER BY n DESC`;
    // Staff below compliance see the quarantine count only as "restricted" work, not a number to drill into.
    return { counts: { ...c, quarantined: can(me.role, "quarantine") ? c!.quarantined : null }, openByReason: byReason };
  });

  // ───────────────────────────── Reports queue ─────────────────────────────

  app.get<{ Querystring: { status?: string; reason?: string; type?: string; cursor?: string; limit?: string } }>("/reports", async (req) => {
    requireStaff(req);
    const status = req.query.status ?? "open";
    if (!["open", "actioned", "dismissed"].includes(status)) throw badRequest("Invalid status");
    const limit = pageSize(req.query.limit, 25, 100);
    const offset = Number(req.query.cursor ?? 0);
    if (!Number.isInteger(offset) || offset < 0) throw badRequest("Invalid cursor");
    const filters = [sql`r.status = ${status}`];
    if (req.query.reason) filters.push(sql`r.reason = ${req.query.reason}`);
    if (req.query.type) filters.push(sql`r.target_type = ${req.query.type}`);
    const where = filters.reduce((a, b) => sql`${a} AND ${b}`);
    const rows = await sql<
      { id: string; reporter_id: string | null; target_type: string; target_id: string; reason: string; details: string; status: string; priority: number; source: string; created_at: Date; resolved_at: Date | null; resolution: string | null; assigned_to: string | null; same_target: number }[]
    >`
      SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.details, r.status, r.priority, r.source, r.created_at,
             r.resolved_at, r.resolution, r.assigned_to,
             (SELECT count(*)::int FROM reports o WHERE o.target_type = r.target_type AND o.target_id = r.target_id AND o.status = 'open') AS same_target
      FROM reports r WHERE ${where}
      ORDER BY ${status === "open" ? sql`r.priority, r.created_at` : sql`r.resolved_at DESC NULLS LAST, r.id DESC`}
      OFFSET ${offset} LIMIT ${limit}`;
    const reporters = await authors(rows.map((r) => r.reporter_id).filter((x): x is string => !!x));
    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        priority: r.priority,
        source: r.source,
        createdAt: r.created_at.toISOString(),
        resolvedAt: r.resolved_at?.toISOString() ?? null,
        resolution: r.resolution,
        assignedTo: r.assigned_to,
        targetType: r.target_type,
        targetId: r.target_id,
        openReportsOnTarget: r.same_target,
        reporter: r.reporter_id ? (reporters.get(r.reporter_id) ?? null) : null,
        target: await preview(r.target_type, r.target_id),
      })),
    );
    return { items, nextCursor: rows.length === limit ? String(offset + limit) : null };
  });

  async function loadReport(id: string) {
    if (!isId(id)) throw notFound("Report");
    const [r] = await sql<{ id: string; reporter_id: string | null; target_type: string; target_id: string; reason: string; details: string; status: string; priority: number; source: string; created_at: Date }[]>`
      SELECT id, reporter_id, target_type, target_id, reason, details, status, priority, source, created_at FROM reports WHERE id = ${id}`;
    if (!r) throw notFound("Report");
    return r;
  }

  /** The user a report is ultimately about (post author, message sender, media owner or the user). */
  async function subjectOf(targetType: string, targetId: string): Promise<string | null> {
    const [row] =
      targetType === "post"
        ? await sql<{ uid: string }[]>`SELECT author_id AS uid FROM posts WHERE id = ${targetId}`
        : targetType === "message"
          ? await sql<{ uid: string }[]>`SELECT sender_id AS uid FROM messages WHERE id = ${targetId}`
          : targetType === "media"
            ? await sql<{ uid: string }[]>`SELECT owner_id AS uid FROM media WHERE id = ${targetId}`
            : await sql<{ uid: string }[]>`SELECT id AS uid FROM users WHERE id = ${targetId}`;
    return row?.uid ?? null;
  }

  app.get<{ Params: { id: string } }>("/reports/:id", async (req) => {
    requireStaff(req);
    const r = await loadReport(req.params.id);
    const subject = await subjectOf(r.target_type, r.target_id);
    const [others, history] = await Promise.all([
      sql<{ id: string; reason: string; details: string; created_at: Date; status: string }[]>`
        SELECT id, reason, details, created_at, status FROM reports
        WHERE target_type = ${r.target_type} AND target_id = ${r.target_id} AND id <> ${r.id} ORDER BY id DESC LIMIT 50`,
      subject ? actionHistory(subject) : Promise.resolve([]),
    ]);
    return {
      id: r.id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      priority: r.priority,
      source: r.source,
      createdAt: r.created_at.toISOString(),
      targetType: r.target_type,
      targetId: r.target_id,
      reporter: r.reporter_id ? ((await authors([r.reporter_id])).get(r.reporter_id) ?? null) : null,
      subject: subject ? ((await authors([subject])).get(subject) ?? null) : null,
      target: await preview(r.target_type, r.target_id),
      otherReports: others.map((o) => ({ id: o.id, reason: o.reason, details: o.details, status: o.status, createdAt: o.created_at.toISOString() })),
      history,
    };
  });

  async function actionHistory(userId: string) {
    const rows = await sql<{ id: string; action: string; reason_code: string; statement: string; target_type: string; target_id: string; created_at: Date; expires_at: Date | null; staff_name: string | null; appeal_status: string | null }[]>`
      SELECT a.id, a.action, a.reason_code, a.statement, a.target_type, a.target_id, a.created_at, a.expires_at,
             s.display_name AS staff_name, ap.status AS appeal_status
      FROM moderation_actions a LEFT JOIN staff s ON s.id = a.staff_id LEFT JOIN appeals ap ON ap.action_id = a.id
      WHERE a.user_id = ${userId} ORDER BY a.id DESC LIMIT 50`;
    return rows.map((a) => ({
      id: a.id,
      action: a.action,
      reasonCode: a.reason_code,
      statement: a.statement,
      targetType: a.target_type,
      targetId: a.target_id,
      createdAt: a.created_at.toISOString(),
      expiresAt: a.expires_at?.toISOString() ?? null,
      staff: a.staff_name ?? "Automated screening",
      appealStatus: a.appeal_status,
    }));
  }

  /**
   * Reveal restricted report content. Protected posts: senior moderators. DMs: compliance only, and only the
   * reported message plus the few messages before it that the reporter could already see — never the inbox.
   */
  app.post<{ Params: { id: string } }>("/reports/:id/reveal", async (req) => {
    const r = await loadReport(req.params.id);
    if (r.target_type === "post") {
      requireStaff(req, "viewProtected");
      const justification = requireJustification((req.body as { justification?: string } | undefined)?.justification);
      const post = (await adminPosts([r.target_id])).get(r.target_id);
      if (!post) throw notFound("Post");
      await logAccess(sql, req, { action: "view_protected_post", targetType: "post", targetId: r.target_id, justification, reportId: r.id });
      return { kind: "post", post };
    }
    if (r.target_type === "message") {
      requireStaff(req, "viewDms");
      const justification = requireJustification((req.body as { justification?: string } | undefined)?.justification);
      const [m] = await sql<{ conversation_id: string }[]>`SELECT conversation_id FROM messages WHERE id = ${r.target_id}`;
      if (!m) throw notFound("Message");
      const reporterIsMember = r.reporter_id
        ? (await sql`SELECT 1 FROM conversation_members WHERE conversation_id = ${m.conversation_id} AND user_id = ${r.reporter_id}`).length > 0
        : false;
      const rows = await sql<{ id: string; sender_id: string; text: string; created_at: Date; deleted_at: Date | null }[]>`
        SELECT id, sender_id, text, created_at, deleted_at FROM messages
        WHERE conversation_id = ${m.conversation_id} AND id <= ${r.target_id}
          AND (id = ${r.target_id} OR ${reporterIsMember})
        ORDER BY id DESC LIMIT 5`;
      const media = await sql<{ message_id: string; storage_key: string; thumb_key: string; type: string }[]>`
        SELECT mm.message_id, m.storage_key, m.thumb_key, m.type FROM message_media mm JOIN media m ON m.id = mm.media_id
        WHERE mm.message_id = ANY(${rows.map((x) => x.id)}::bigint[]) AND m.status = 'ready'`;
      const who = await authors([...new Set(rows.map((x) => x.sender_id))]);
      await logAccess(sql, req, { action: "view_dm_evidence", targetType: "message", targetId: r.target_id, justification, reportId: r.id });
      return {
        kind: "message",
        reportedMessageId: r.target_id,
        messages: rows.reverse().map((x) => ({
          id: x.id,
          sender: who.get(x.sender_id) ?? null,
          text: x.text,
          deleted: !!x.deleted_at,
          createdAt: x.created_at.toISOString(),
          media: media.filter((mm) => mm.message_id === x.id).map((mm) => ({ type: mm.type, url: storage.url(mm.storage_key), thumbUrl: storage.url(mm.thumb_key) })),
        })),
      };
    }
    throw badRequest("Nothing to reveal for this report");
  });

  app.post<{ Params: { id: string } }>("/reports/:id/assign", async (req) => {
    const me = requireStaff(req, "act");
    const r = await loadReport(req.params.id);
    await sql`UPDATE reports SET assigned_to = ${me.id} WHERE id = ${r.id}`;
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/reports/:id/dismiss", async (req) => {
    const me = requireStaff(req, "act");
    const r = await loadReport(req.params.id);
    if (r.status !== "open") throw new AppError(409, "NOT_OPEN", "Report is already resolved");
    if (r.target_type === "media") requireStaff(req, "quarantine");
    const note = String((req.body as { note?: string } | undefined)?.note ?? "").slice(0, 1000);
    await sql`UPDATE reports SET status = 'dismissed', resolved_at = now(), resolved_by = ${me.id}, resolution = ${note || "no_violation"}
              WHERE id = ${r.id}`;
    await logAccess(sql, req, { action: "dismiss_report", targetType: r.target_type, targetId: r.target_id, reportId: r.id, justification: note || null });
    return { ok: true };
  });

  // ───────────────────────────── Actions ─────────────────────────────

  app.post("/actions", async (req, reply) => {
    const input = parse(actionSchema, req.body);
    if (!isId(input.targetId) || (input.reportId && !isId(input.reportId))) throw badRequest("Invalid id");
    const me = requireStaff(req, permFor(input.action, input.durationDays));
    if (POST_ACTIONS.has(input.action)) {
      // Acting on a protected account's post requires the tier that may view it.
      const [p] = await sql<{ is_protected: boolean }[]>`
        SELECT u.is_protected FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ${input.targetId}`;
      if (p?.is_protected) requireStaff(req, "viewProtected");
    }
    const result = await sql.begin((tx) =>
      applyAction(tx, {
        staffId: me.id,
        action: input.action,
        targetId: input.targetId,
        reasonCode: input.reasonCode,
        statement: input.statement,
        reportId: input.reportId ?? null,
        durationDays: input.action === "suspend" ? (input.durationDays ?? null) : null,
      }),
    );
    await logAccess(sql, req, {
      action: `moderation:${input.action}`,
      targetType: result.targetType,
      targetId: input.targetId,
      justification: input.statement,
      reportId: input.reportId ?? null,
    });
    reply.status(201);
    return result;
  });

  // ───────────────────────────── Content browsing (public only) ─────────────────────────────

  /**
   * Search public posts by user, keyword, hashtag, date or media. Protected accounts are excluded entirely;
   * their posts are only reachable through a report (senior moderators, logged).
   */
  app.get<{ Querystring: { q?: string; handle?: string; tag?: string; media?: string; from?: string; to?: string; state?: string; cursor?: string; limit?: string } }>(
    "/content/posts",
    async (req) => {
      requireStaff(req);
      const q = req.query;
      const limit = pageSize(q.limit, 30, 100);
      const conds = [sql`u.is_protected = false`, sql`u.status <> 'deleted'`, sql`p.deleted_at IS NULL`, sql`p.id < ${idCursor(q.cursor)}`];
      if (q.q?.trim()) conds.push(sql`p.search @@ websearch_to_tsquery('simple', ${q.q.trim().slice(0, 200)})`);
      if (q.handle?.trim()) conds.push(sql`u.handle = ${q.handle.trim().replace(/^@/, "")}`);
      if (q.tag?.trim()) conds.push(sql`EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ${q.tag.trim().replace(/^[#$]/, "")})`);
      if (q.media === "1") conds.push(sql`EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)`);
      if (q.from) conds.push(sql`p.created_at >= ${new Date(q.from)}`);
      if (q.to) conds.push(sql`p.created_at < ${new Date(q.to)}`);
      if (q.state === "removed") conds.push(sql`p.removed_at IS NOT NULL`);
      else if (q.state === "limited") conds.push(sql`p.limited`);
      else if (q.state === "sensitive") conds.push(sql`p.sensitive`);
      else if (q.state === "reported") conds.push(sql`EXISTS (SELECT 1 FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.status = 'open')`);
      for (const d of [q.from, q.to]) if (d && Number.isNaN(new Date(d).getTime())) throw badRequest("Invalid date");
      const where = conds.reduce((a, b) => sql`${a} AND ${b}`);
      const rows = await sql<{ id: string }[]>`
        SELECT p.id FROM posts p JOIN users u ON u.id = p.author_id WHERE ${where} ORDER BY p.id DESC LIMIT ${limit}`;
      const map = await adminPosts(rows.map((r) => r.id));
      return { items: rows.map((r) => map.get(r.id)!).filter(Boolean), nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null };
    },
  );

  app.get<{ Params: { id: string } }>("/content/posts/:id", async (req) => {
    requireStaff(req);
    if (!isId(req.params.id)) throw notFound("Post");
    const post = (await adminPosts([req.params.id])).get(req.params.id);
    if (!post) throw notFound("Post");
    if (post.author.isProtected) throw forbidden("Protected account: open it through a report", "PROTECTED");
    return post;
  });

  /** Latest uploads stream: images and videos attached to public posts, newest first. */
  app.get<{ Querystring: { type?: string; cursor?: string; limit?: string } }>("/content/media", async (req) => {
    requireStaff(req);
    const limit = pageSize(req.query.limit, 48, 120);
    const type = req.query.type;
    if (type && !["image", "video", "gif"].includes(type)) throw badRequest("Invalid type");
    const rows = await sql<{ id: string; type: string; storage_key: string; thumb_key: string; width: number; height: number; duration_ms: number | null; created_at: Date; post_id: string; owner_id: string; sensitive: boolean; removed: boolean }[]>`
      SELECT m.id, m.type, m.storage_key, m.thumb_key, m.width, m.height, m.duration_ms, m.created_at, p.id AS post_id, m.owner_id,
             p.sensitive, p.removed_at IS NOT NULL AS removed
      FROM media m
      JOIN post_media pm ON pm.media_id = m.id
      JOIN posts p ON p.id = pm.post_id AND p.deleted_at IS NULL
      JOIN users u ON u.id = m.owner_id AND u.is_protected = false AND u.status <> 'deleted'
      WHERE m.status = 'ready' AND m.id < ${idCursor(req.query.cursor)} ${type ? sql`AND m.type = ${type}` : sql``}
      ORDER BY m.id DESC LIMIT ${limit}`;
    const who = await authors([...new Set(rows.map((r) => r.owner_id))]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        url: storage.url(r.storage_key),
        thumbUrl: storage.url(r.thumb_key),
        width: r.width,
        height: r.height,
        durationMs: r.duration_ms,
        createdAt: r.created_at.toISOString(),
        postId: r.post_id,
        owner: who.get(r.owner_id) ?? null,
        flags: { sensitive: r.sensitive, removed: r.removed },
      })),
      nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
    };
  });

  // ───────────────────────────── Users ─────────────────────────────

  app.get<{ Querystring: { q?: string; status?: string } }>("/users", async (req) => {
    requireStaff(req);
    const q = (req.query.q ?? "").trim().replace(/^@/, "").slice(0, 100);
    const status = req.query.status;
    if (status && !["active", "suspended", "frozen", "banned"].includes(status)) throw badRequest("Invalid status");
    if (!q && !status) return { items: [] };
    const isEmail = q.includes("@");
    if (isEmail) {
      // Looking an account up by email is a PII search: compliance only, logged.
      requireStaff(req, "revealPii");
      await logAccess(sql, req, { action: "search_by_email", justification: null });
    }
    const conds = [sql`u.status <> 'deleted'`];
    if (status) conds.push(sql`u.status = ${status}`);
    if (q) conds.push(isEmail ? sql`u.email = ${q}` : sql`(u.handle ILIKE ${q + "%"} OR u.display_name ILIKE ${"%" + q + "%"})`);
    const rows = await sql<{ id: string; strike_count: number; created_at: Date; followers_count: number; kyc_level: number; suspended_until: Date | null }[]>`
      SELECT u.id, u.strike_count, u.created_at, u.followers_count, u.kyc_level, u.suspended_until FROM users u
      WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)}
      ORDER BY u.followers_count DESC, u.id LIMIT 50`;
    const who = await authors(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({
        ...who.get(r.id)!,
        strikes: r.strike_count,
        createdAt: r.created_at.toISOString(),
        followers: r.followers_count,
        kycLevel: r.kyc_level,
        suspendedUntil: r.suspended_until?.toISOString() ?? null,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/users/:id", async (req) => {
    requireStaff(req);
    if (!isId(req.params.id)) throw notFound("User");
    const [u] = await sql<{ id: string; bio: string; strike_count: number; created_at: Date; followers_count: number; following_count: number; posts_count: number; kyc_level: number; suspended_until: Date | null; is_protected: boolean; badge: string | null; account_type: string; id_country: string | null; phone_country: string | null; conn_country: string | null }[]>`
      SELECT id, bio, strike_count, created_at, followers_count, following_count, posts_count, kyc_level, suspended_until, is_protected,
             badge, account_type, id_country, phone_country, conn_country
      FROM users WHERE id = ${req.params.id}`;
    if (!u) throw notFound("User");
    const [a, history, reports, posts] = await Promise.all([
      authors([u.id]),
      actionHistory(u.id),
      sql<{ open: number; total: number }[]>`
        SELECT count(*) FILTER (WHERE r.status = 'open')::int AS open, count(*)::int AS total FROM reports r
        WHERE (r.target_type = 'user' AND r.target_id = ${u.id})
           OR (r.target_type = 'post' AND r.target_id IN (SELECT id FROM posts WHERE author_id = ${u.id}))
           OR (r.target_type = 'message' AND r.target_id IN (SELECT id FROM messages WHERE sender_id = ${u.id}))`,
      u.is_protected
        ? Promise.resolve(null)
        : sql<{ id: string }[]>`SELECT id FROM posts WHERE author_id = ${u.id} AND deleted_at IS NULL ORDER BY id DESC LIMIT 20`,
    ]);
    const postMap = posts ? await adminPosts(posts.map((p) => p.id)) : null;
    const [sub] = await sql<{ plan: string; status: string; current_period_end: Date; provider: string }[]>`
      SELECT plan, status, current_period_end, provider FROM subscriptions WHERE user_id = ${u.id} ORDER BY current_period_end DESC LIMIT 1`;
    const trust = await computeTrust(sql, u.id);
    return {
      ...a.get(u.id)!,
      bio: u.bio,
      trust,
      badge: u.badge,
      accountType: u.account_type,
      countries: { id: u.id_country?.trim() ?? null, phone: u.phone_country?.trim() ?? null, connection: u.conn_country?.trim() ?? null },
      subscription: sub ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.current_period_end.toISOString(), provider: sub.provider } : null,
      strikes: u.strike_count,
      createdAt: u.created_at.toISOString(),
      followers: u.followers_count,
      following: u.following_count,
      postsCount: u.posts_count,
      kycLevel: u.kyc_level,
      suspendedUntil: u.suspended_until?.toISOString() ?? null,
      email: null as string | null, // PII: use /users/:id/reveal-pii
      reports: reports[0],
      history,
      recentPosts: posts && postMap ? posts.map((p) => postMap.get(p.id)!).filter(Boolean) : null,
      postsRestricted: u.is_protected,
    };
  });

  app.post<{ Params: { id: string } }>("/users/:id/reveal-pii", async (req) => {
    requireStaff(req, "revealPii");
    if (!isId(req.params.id)) throw notFound("User");
    const justification = requireJustification((req.body as { justification?: string } | undefined)?.justification);
    const [u] = await sql<{ email: string; kyc_level: number }[]>`SELECT email::text AS email, kyc_level FROM users WHERE id = ${req.params.id}`;
    if (!u) throw notFound("User");
    await logAccess(sql, req, { action: "reveal_pii", targetType: "user", targetId: req.params.id, justification });
    return { email: u.email, kycLevel: u.kyc_level };
  });

  // ───────────────────────────── Appeals ─────────────────────────────

  app.get<{ Querystring: { status?: string } }>("/appeals", async (req) => {
    const me = requireStaff(req);
    const status = req.query.status ?? "open";
    if (!["open", "upheld", "overturned"].includes(status)) throw badRequest("Invalid status");
    const rows = await sql<{ id: string; text: string; status: string; created_at: Date; decided_at: Date | null; decision_note: string | null; user_id: string; action_id: string; action: string; reason_code: string; statement: string; target_type: string; target_id: string; action_at: Date; action_staff: string | null; action_staff_name: string | null; decided_by_name: string | null }[]>`
      SELECT ap.id, ap.text, ap.status, ap.created_at, ap.decided_at, ap.decision_note, ap.user_id,
             a.id AS action_id, a.action, a.reason_code, a.statement, a.target_type, a.target_id, a.created_at AS action_at,
             a.staff_id AS action_staff, s.display_name AS action_staff_name, d.display_name AS decided_by_name
      FROM appeals ap JOIN moderation_actions a ON a.id = ap.action_id
      LEFT JOIN staff s ON s.id = a.staff_id LEFT JOIN staff d ON d.id = ap.decided_by
      WHERE ap.status = ${status}
      ORDER BY ${status === "open" ? sql`ap.created_at` : sql`ap.decided_at DESC`} LIMIT 100`;
    const who = await authors([...new Set(rows.map((r) => r.user_id))]);
    const postIds = rows.filter((r) => r.target_type === "post").map((r) => r.target_id);
    const postMap = await adminPosts(postIds);
    return {
      items: rows.map((r) => {
        const post = r.target_type === "post" ? postMap.get(r.target_id) : undefined;
        return {
          id: r.id,
          text: r.text,
          status: r.status,
          createdAt: r.created_at.toISOString(),
          decidedAt: r.decided_at?.toISOString() ?? null,
          decisionNote: r.decision_note,
          decidedBy: r.decided_by_name,
          user: who.get(r.user_id) ?? null,
          decision: {
            id: r.action_id,
            action: r.action,
            reasonCode: r.reason_code,
            statement: r.statement,
            targetType: r.target_type,
            targetId: r.target_id,
            createdAt: r.action_at.toISOString(),
            staff: r.action_staff_name ?? "Automated screening",
          },
          // A protected account's post is shown only to roles that may view it.
          post: post && (!post.author.isProtected || can(me.role, "viewProtected")) ? post : null,
          // The moderator who made the decision may not review its appeal.
          canDecide: can(me.role, "decideAppeals") && r.action_staff !== me.id,
        };
      }),
    };
  });

  app.post<{ Params: { id: string } }>("/appeals/:id/decide", async (req) => {
    const me = requireStaff(req, "decideAppeals");
    if (!isId(req.params.id)) throw notFound("Appeal");
    const input = parse(decideSchema, req.body);
    const result = await sql.begin(async (tx) => {
      const [ap] = await tx<{ id: string; status: string; action_id: string; action: ModerationActionType; staff_id: string | null; target_id: string; user_id: string }[]>`
        SELECT ap.id, ap.status, ap.action_id, a.action, a.staff_id, a.target_id, a.user_id
        FROM appeals ap JOIN moderation_actions a ON a.id = ap.action_id WHERE ap.id = ${req.params.id} FOR UPDATE OF ap`;
      if (!ap) throw notFound("Appeal");
      if (ap.status !== "open") throw new AppError(409, "ALREADY_DECIDED", "Appeal already decided");
      if (ap.staff_id === me.id) throw forbidden("An appeal must be reviewed by someone other than the original moderator", "SAME_REVIEWER");
      await tx`UPDATE appeals SET status = ${input.decision}, decided_by = ${me.id}, decision_note = ${input.note}, decided_at = now()
               WHERE id = ${ap.id}`;
      let reversal: string | null = null;
      if (input.decision === "overturned") {
        const inverse = REVERSAL[ap.action];
        if (inverse) {
          // The original state may already have changed (e.g. a suspension that lapsed); reversing is then a no-op.
          try {
            await tx.savepoint((sp) =>
              applyAction(sp, { staffId: me.id, action: inverse, targetId: ap.target_id, reasonCode: "appeal_overturned", statement: input.note }),
            );
            reversal = inverse;
          } catch (e) {
            if (!(e instanceof AppError && e.status === 409)) throw e;
          }
        }
        if (ap.action === "remove_post" || ap.action === "warn" || ap.action === "suspend") {
          await tx`UPDATE users SET strike_count = greatest(strike_count - 1, 0) WHERE id = ${ap.user_id}`;
        }
      }
      return { status: input.decision, reversal, targetId: ap.target_id };
    });
    await logAccess(sql, req, { action: `appeal_${input.decision}`, targetType: "appeal", targetId: req.params.id, justification: input.note });
    return result;
  });

  // ───────────────────────────── Quarantine (compliance) ─────────────────────────────

  /** Screening matches. Metadata only: quarantined bytes are never stored, so there is nothing to display. */
  app.get("/quarantine", async (req) => {
    requireStaff(req, "quarantine");
    const rows = await sql<{ media_id: string; type: string; owner_id: string; scanner: string; match_list: string; match_ref: string; sha256: string; created_at: Date; report_id: string | null; report_status: string | null; resolution: string | null }[]>`
      SELECT s.media_id, m.type, m.owner_id, s.scanner, s.match_list, s.match_ref, s.sha256, s.created_at,
             r.id AS report_id, r.status AS report_status, r.resolution
      FROM media_scans s JOIN media m ON m.id = s.media_id
      LEFT JOIN reports r ON r.target_type = 'media' AND r.target_id = s.media_id
      WHERE s.result = 'match' ORDER BY s.id DESC LIMIT 200`;
    const who = await authors([...new Set(rows.map((r) => r.owner_id))]);
    await logAccess(sql, req, { action: "view_quarantine_list" });
    return {
      items: rows.map((r) => ({
        mediaId: r.media_id,
        mediaType: r.type,
        owner: who.get(r.owner_id) ?? null,
        scanner: r.scanner,
        list: r.match_list,
        ref: r.match_ref,
        sha256: r.sha256,
        createdAt: r.created_at.toISOString(),
        reportId: r.report_id,
        reportStatus: r.report_status,
        resolution: r.resolution,
      })),
    };
  });

  /**
   * Resolve a screening match.
   * - confirm: ban the account and close the report. Statutory reporting to the NCA / IWF is filed outside this system.
   * - false_positive: unfreeze the account and close the report. The file stays rejected; the user may re-upload.
   */
  app.post<{ Params: { mediaId: string } }>("/quarantine/:mediaId/resolve", async (req) => {
    const me = requireStaff(req, "quarantine");
    if (!isId(req.params.mediaId)) throw notFound("Media");
    const body = req.body as { outcome?: string; justification?: string } | undefined;
    const outcome = body?.outcome;
    if (outcome !== "confirm" && outcome !== "false_positive") throw badRequest("outcome must be confirm or false_positive");
    const justification = requireJustification(body?.justification);
    await sql.begin(async (tx) => {
      const [m] = await tx<{ owner_id: string; status: string }[]>`SELECT owner_id, status FROM media WHERE id = ${req.params.mediaId}`;
      if (!m || m.status !== "quarantined") throw notFound("Quarantined media");
      const [r] = await tx<{ id: string; status: string }[]>`
        SELECT id, status FROM reports WHERE target_type = 'media' AND target_id = ${req.params.mediaId} ORDER BY id LIMIT 1`;
      if (r && r.status !== "open") throw new AppError(409, "ALREADY_RESOLVED", "Already resolved");
      const [u] = await tx<{ status: string }[]>`SELECT status FROM users WHERE id = ${m.owner_id}`;
      if (outcome === "confirm") {
        if (u?.status !== "banned") {
          await applyAction(tx, { staffId: me.id, action: "ban", targetId: m.owner_id, reasonCode: "child_safety", statement: "Your account was permanently suspended for violating our child safety policy.", reportId: r?.id ?? null });
        }
      } else if (u?.status === "frozen") {
        await applyAction(tx, { staffId: me.id, action: "unfreeze", targetId: m.owner_id, reasonCode: "other", statement: "Review complete", reportId: null });
      }
      await tx`INSERT INTO moderation_actions (id, staff_id, target_type, target_id, user_id, action, reason_code, statement, report_id)
               VALUES (${newId()}, ${me.id}, 'media', ${req.params.mediaId}, ${m.owner_id},
                       ${outcome === "confirm" ? "quarantine_media" : "release_media"}, ${outcome}, ${justification}, ${r?.id ?? null})`;
      if (r) {
        await tx`UPDATE reports SET status = ${outcome === "confirm" ? "actioned" : "dismissed"}, resolved_at = now(),
                   resolved_by = ${me.id}, resolution = ${outcome} WHERE id = ${r.id}`;
      }
    });
    await logAccess(sql, req, { action: `quarantine_${outcome}`, targetType: "media", targetId: req.params.mediaId, justification });
    return { ok: true, outcome };
  });


  // ───────────────────────────── Verification & badges (compliance) ─────────────────────────────

  app.get<{ Querystring: { status?: string } }>("/verifications", async (req) => {
    requireStaff(req, "verifyAccounts");
    const status = req.query.status ?? "pending";
    if (!["pending", "approved", "rejected", "withdrawn"].includes(status)) throw badRequest("Invalid status");
    const rows = await sql<{ id: string; user_id: string; kind: string; status: string; legal_name: string | null; reg_type: string | null; reg_number: string | null; country: string | null; website: string | null; signatory_name: string | null; signatory_role: string | null; category: string | null; links: string[]; about: string | null; review_note: string | null; created_at: Date; decided_at: Date | null; kyc_level: number; id_country: string | null }[]>`
      SELECT v.*, u.kyc_level, u.id_country FROM verification_applications v JOIN users u ON u.id = v.user_id
      WHERE v.status = ${status} ORDER BY ${status === "pending" ? sql`v.created_at` : sql`v.decided_at DESC`} LIMIT 200`;
    const who = await authors([...new Set(rows.map((r) => r.user_id))]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        user: who.get(r.user_id) ?? null,
        kind: r.kind,
        status: r.status,
        legalName: r.legal_name,
        regType: r.reg_type,
        regNumber: r.reg_number,
        country: r.country?.trim() ?? null,
        website: r.website,
        signatory: r.signatory_name ? { name: r.signatory_name, role: r.signatory_role } : null,
        category: r.category,
        links: r.links,
        about: r.about,
        reviewNote: r.review_note,
        applicantKyc: { level: r.kyc_level, country: r.id_country?.trim() ?? null },
        createdAt: r.created_at.toISOString(),
        decidedAt: r.decided_at?.toISOString() ?? null,
      })),
    };
  });

  /**
   * Approve or reject. Approval grants the badge and starts a manually invoiced subscription (until in-app billing
   * is wired). Reviewers must check the registration number against the official registry (GST portal / MCA) first.
   */
  app.post<{ Params: { id: string } }>("/verifications/:id/decide", async (req) => {
    const me = requireStaff(req, "verifyAccounts");
    if (!isId(req.params.id)) throw notFound("Application");
    const body = parse(z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().min(10).max(1000), months: z.number().int().min(1).max(24).default(1) }), req.body);
    const result = await sql.begin(async (tx) => {
      const [v] = await tx<{ user_id: string; kind: "business" | "creator"; status: string }[]>`
        SELECT user_id, kind, status FROM verification_applications WHERE id = ${req.params.id} FOR UPDATE`;
      if (!v) throw notFound("Application");
      if (v.status !== "pending") throw new AppError(409, "ALREADY_DECIDED", "Application already decided");
      await tx`UPDATE verification_applications SET status = ${body.decision}, reviewer_id = ${me.id}, review_note = ${body.note}, decided_at = now()
               WHERE id = ${req.params.id}`;
      if (body.decision === "approved") {
        await tx`UPDATE users SET badge = ${v.kind}, badge_granted_at = now(),
                   account_type = ${v.kind === "business" ? "business" : sql`account_type`},
                   kyc_level = ${v.kind === "business" ? sql`greatest(kyc_level, 2)` : sql`kyc_level`}
                 WHERE id = ${v.user_id}`;
        await extendSubscription(tx, v.user_id, v.kind, body.months);
      }
      return { userId: v.user_id, kind: v.kind };
    });
    await logAccess(sql, req, { action: `verification_${body.decision}`, targetType: "user", targetId: result.userId, justification: body.note });
    return { ok: true, ...result, decision: body.decision };
  });

  async function extendSubscription(tx: Db, userId: string, plan: "business" | "creator", months: number) {
    const [cur] = await tx<{ id: string; current_period_end: Date }[]>`
      SELECT id, current_period_end FROM subscriptions WHERE user_id = ${userId} AND plan = ${plan} AND status = 'active'
      ORDER BY current_period_end DESC LIMIT 1`;
    const from = cur && cur.current_period_end > new Date() ? cur.current_period_end : new Date();
    const end = new Date(from.getTime() + months * 30 * 86400_000);
    if (cur) await tx`UPDATE subscriptions SET current_period_end = ${end} WHERE id = ${cur.id}`;
    else await tx`INSERT INTO subscriptions (id, user_id, plan, status, provider, current_period_end) VALUES (${newId()}, ${userId}, ${plan}, 'active', 'manual', ${end})`;
  }

  /** Record a manual (invoiced) payment, extending the plan. */
  app.post<{ Params: { id: string } }>("/users/:id/subscription", async (req) => {
    requireStaff(req, "verifyAccounts");
    if (!isId(req.params.id)) throw notFound("User");
    const body = parse(z.object({ plan: z.enum(["business", "creator"]), months: z.number().int().min(1).max(24), reference: z.string().trim().min(3).max(100) }), req.body);
    await sql.begin((tx) => extendSubscription(tx, req.params.id, body.plan, body.months));
    await logAccess(sql, req, { action: "subscription_payment", targetType: "user", targetId: req.params.id, justification: `${body.plan} ${body.months}m · ${body.reference}` });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/users/:id/subscription/cancel", async (req) => {
    requireStaff(req, "verifyAccounts");
    if (!isId(req.params.id)) throw notFound("User");
    const justification = requireJustification((req.body as { justification?: string } | undefined)?.justification);
    await sql`UPDATE subscriptions SET status = 'canceled' WHERE user_id = ${req.params.id} AND status = 'active'`;
    await logAccess(sql, req, { action: "subscription_cancel", targetType: "user", targetId: req.params.id, justification });
    return { ok: true };
  });

  /** Public figure, government and news badges: granted on published criteria, never sold. */
  app.post<{ Params: { id: string } }>("/users/:id/badge", async (req) => {
    requireStaff(req, "verifyAccounts");
    if (!isId(req.params.id)) throw notFound("User");
    const body = parse(z.object({ badge: z.enum(["public_figure", "government", "news"]).nullable(), justification: z.string().trim().min(15).max(1000) }), req.body);
    const [u] = await sql<{ badge: string | null }[]>`SELECT badge FROM users WHERE id = ${req.params.id}`;
    if (!u) throw notFound("User");
    if (body.badge === null && (u.badge === "business" || u.badge === "creator")) throw badRequest("Use subscription cancel for paid badges");
    await sql`UPDATE users SET badge = ${body.badge}, badge_granted_at = ${body.badge ? sql`now()` : null} WHERE id = ${req.params.id}`;
    await logAccess(sql, req, { action: body.badge ? `badge_grant_${body.badge}` : "badge_revoke", targetType: "user", targetId: req.params.id, justification: body.justification });
    return { ok: true };
  });

  // ───────────────────────────── Access log & staff (admin) ─────────────────────────────

  app.get<{ Querystring: { staffId?: string; action?: string; targetId?: string; cursor?: string } }>("/access-log", async (req) => {
    requireStaff(req, "readAccessLog");
    const q = req.query;
    const conds = [sql`l.id < ${idCursor(q.cursor)}`];
    if (q.staffId && isId(q.staffId)) conds.push(sql`l.staff_id = ${q.staffId}`);
    if (q.action) conds.push(sql`l.action LIKE ${q.action + "%"}`);
    if (q.targetId && isId(q.targetId)) conds.push(sql`l.target_id = ${q.targetId}`);
    const rows = await sql<{ id: string; staff_id: string | null; staff_name: string | null; staff_role: string | null; action: string; target_type: string | null; target_id: string | null; justification: string | null; report_id: string | null; ip: string | null; created_at: Date }[]>`
      SELECT l.id, l.staff_id, s.display_name AS staff_name, s.role AS staff_role, l.action, l.target_type, l.target_id,
             l.justification, l.report_id, l.ip, l.created_at
      FROM access_log l LEFT JOIN staff s ON s.id = l.staff_id
      WHERE ${conds.reduce((a, b) => sql`${a} AND ${b}`)} ORDER BY l.id DESC LIMIT 100`;
    return {
      items: rows.map((r) => ({
        id: r.id,
        staff: r.staff_id ? { id: r.staff_id, displayName: r.staff_name, role: r.staff_role } : null,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        justification: r.justification,
        reportId: r.report_id,
        ip: r.ip,
        createdAt: r.created_at.toISOString(),
      })),
      nextCursor: rows.length === 100 ? rows[rows.length - 1]!.id : null,
    };
  });

  app.get("/staff", async (req) => {
    requireStaff(req, "manageStaff");
    const rows = await sql<{ id: string; email: string; display_name: string; role: string; status: string; created_at: Date; last_login_at: Date | null }[]>`
      SELECT id, email::text AS email, display_name, role, status, created_at, last_login_at FROM staff ORDER BY id`;
    return { items: rows.map(staffJson) };
  });

  app.post("/staff", async (req, reply) => {
    requireStaff(req, "manageStaff");
    const input = parse(staffCreateSchema, req.body);
    const id = newId();
    try {
      await sql`INSERT INTO staff (id, email, password_hash, display_name, role)
                VALUES (${id}, ${input.email}, ${await hashPassword(input.password)}, ${input.displayName}, ${input.role})`;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new AppError(409, "EMAIL_TAKEN", "A staff account with that email exists");
      throw e;
    }
    await logAccess(sql, req, { action: "staff_create", targetType: "staff", targetId: id, justification: `role=${input.role}` });
    reply.status(201);
    return { id };
  });

  app.patch<{ Params: { id: string } }>("/staff/:id", async (req) => {
    const me = requireStaff(req, "manageStaff");
    if (!isId(req.params.id)) throw notFound("Staff");
    if (req.params.id === me.id) throw forbidden("You can't change your own role or status", "SELF_CHANGE");
    const input = parse(staffPatchSchema, req.body);
    const [s] = await sql`
      UPDATE staff SET role = coalesce(${input.role ?? null}, role), status = coalesce(${input.status ?? null}, status)
      WHERE id = ${req.params.id} RETURNING id`;
    if (!s) throw notFound("Staff");
    await logAccess(sql, req, { action: "staff_update", targetType: "staff", targetId: req.params.id, justification: JSON.stringify(input) });
    return { ok: true };
  });
};

export default adminRoutes;

