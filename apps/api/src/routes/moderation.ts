// User-facing side of moderation: account standing, statements of reasons and appeals.

import type { FastifyPluginAsync } from "fastify";
import { APPEALABLE_ACTIONS, appealSchema, type AccountStanding, type ModerationActionType, type ModerationNotice } from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { AppError, notFound, parse } from "../lib/errors";
import { isId, newId } from "../lib/ids";

/** Appeals must be lodged within this window of the decision. */
const APPEAL_WINDOW_DAYS = 90;
const APPEALABLE = new Set<string>(APPEALABLE_ACTIONS);

interface NoticeRow {
  id: string;
  action_id: string;
  action: ModerationActionType;
  reason_code: string;
  statement: string;
  target_type: string;
  target_id: string;
  post_text: string | null;
  expires_at: Date | null;
  created_at: Date;
  read_at: Date | null;
  appeal_status: "open" | "upheld" | "overturned" | null;
  decision_note: string | null;
}

const moderationRoutes: FastifyPluginAsync = async (app) => {
  const { sql } = app.ctx;

  /** Account status plus every moderation notice for this account, newest first. */
  app.get("/me/standing", async (req): Promise<AccountStanding> => {
    const me = requireUser(req);
    const [u] = await sql<{ status: AccountStanding["status"]; suspended_until: Date | null; strike_count: number }[]>`
      SELECT status, suspended_until, strike_count FROM users WHERE id = ${me.id}`;
    const rows = await sql<NoticeRow[]>`
      SELECT n.id, n.action_id, a.action, a.reason_code, a.statement, a.target_type, a.target_id,
             CASE WHEN a.target_type = 'post' THEN left(p.text, 280) END AS post_text,
             a.expires_at, n.created_at, n.read_at, ap.status AS appeal_status, ap.decision_note
      FROM moderation_notices n
      JOIN moderation_actions a ON a.id = n.action_id
      LEFT JOIN posts p ON a.target_type = 'post' AND p.id = a.target_id
      LEFT JOIN appeals ap ON ap.action_id = a.id
      WHERE n.user_id = ${me.id}
      ORDER BY n.id DESC LIMIT 100`;
    const cutoff = Date.now() - APPEAL_WINDOW_DAYS * 86400_000;
    const notices: ModerationNotice[] = rows.map((r) => ({
      id: r.id,
      actionId: r.action_id,
      action: r.action,
      reasonCode: r.reason_code,
      statement: r.statement,
      postExcerpt: r.post_text,
      postId: r.target_type === "post" ? r.target_id : null,
      expiresAt: r.expires_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      read: !!r.read_at,
      appeal: r.appeal_status ? { status: r.appeal_status, decisionNote: r.decision_note } : null,
      canAppeal: APPEALABLE.has(r.action) && !r.appeal_status && r.created_at.getTime() > cutoff,
    }));
    return {
      status: u!.status,
      suspendedUntil: u!.suspended_until?.toISOString() ?? null,
      strikes: u!.strike_count,
      notices,
      unread: notices.filter((n) => !n.read).length,
    };
  });

  app.post("/me/moderation-notices/read", async (req, reply) => {
    const me = requireUser(req);
    await sql`UPDATE moderation_notices SET read_at = now() WHERE user_id = ${me.id} AND read_at IS NULL`;
    reply.status(204);
  });

  /** Appeal a decision. One appeal per decision; it is reviewed by a different moderator. */
  app.post("/me/appeals", async (req, reply) => {
    const me = requireUser(req);
    const input = parse(appealSchema, req.body);
    if (!isId(input.actionId)) throw notFound("Decision");
    const [a] = await sql<{ action: string; created_at: Date }[]>`
      SELECT a.action, a.created_at FROM moderation_actions a
      JOIN moderation_notices n ON n.action_id = a.id
      WHERE a.id = ${input.actionId} AND a.user_id = ${me.id}`;
    if (!a) throw notFound("Decision");
    if (!APPEALABLE.has(a.action)) throw new AppError(400, "NOT_APPEALABLE", "This decision can't be appealed");
    if (a.created_at.getTime() < Date.now() - APPEAL_WINDOW_DAYS * 86400_000) {
      throw new AppError(400, "APPEAL_WINDOW_CLOSED", `Appeals must be made within ${APPEAL_WINDOW_DAYS} days`);
    }
    const id = newId();
    const inserted = await sql`
      INSERT INTO appeals (id, action_id, user_id, text) VALUES (${id}, ${input.actionId}, ${me.id}, ${input.text})
      ON CONFLICT (action_id) DO NOTHING`;
    if (inserted.count === 0) throw new AppError(409, "ALREADY_APPEALED", "You've already appealed this decision");
    reply.status(201);
    return { id, status: "open" };
  });
};

export default moderationRoutes;
