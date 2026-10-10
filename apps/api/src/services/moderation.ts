// Moderation decisions: one function applies every action, so the console, appeals and screening
// all produce the same effects, audit rows and user notices.

import type { ModerationActionType } from "@projectfeed/shared";
import type { Db } from "../db";
import { AppError, badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";

export const POST_ACTIONS = new Set<ModerationActionType>([
  "remove_post",
  "restore_post",
  "label_sensitive",
  "unlabel_sensitive",
  "limit_reach",
  "unlimit_reach",
]);

/** Actions that count as a strike against the account. */
const STRIKES = new Set<ModerationActionType>(["remove_post", "warn", "suspend"]);

/** Users are not told about freezes: alerting a suspect can prejudice an investigation. */
const SILENT = new Set<ModerationActionType>(["freeze", "unfreeze"]);

/** What overturning an appealed decision does. */
export const REVERSAL: Partial<Record<ModerationActionType, ModerationActionType>> = {
  remove_post: "restore_post",
  label_sensitive: "unlabel_sensitive",
  limit_reach: "unlimit_reach",
  suspend: "unsuspend",
  ban: "unban",
};

export interface ActionInput {
  staffId: string | null;
  action: ModerationActionType;
  targetId: string;
  reasonCode: string;
  statement: string;
  reportId?: string | null;
  /** Suspensions only. null = indefinite. */
  durationDays?: number | null;
}

export async function applyAction(tx: Db, input: ActionInput): Promise<{ actionId: string; userId: string; targetType: "post" | "user" }> {
  const { action, targetId } = input;
  const targetType = POST_ACTIONS.has(action) ? "post" : "user";
  let userId: string;

  if (targetType === "post") {
    const [p] = await tx<{ author_id: string; removed_at: Date | null; deleted_at: Date | null }[]>`
      SELECT author_id, removed_at, deleted_at FROM posts WHERE id = ${targetId} FOR UPDATE`;
    if (!p) throw notFound("Post");
    userId = p.author_id;
    if (action === "remove_post") {
      if (p.removed_at) throw new AppError(409, "ALREADY_REMOVED", "Post is already removed");
      await tx`UPDATE posts SET removed_at = now(), removed_reason = ${input.reasonCode} WHERE id = ${targetId}`;
    } else if (action === "restore_post") {
      if (!p.removed_at) throw new AppError(409, "NOT_REMOVED", "Post is not removed");
      await tx`UPDATE posts SET removed_at = NULL, removed_reason = NULL WHERE id = ${targetId}`;
    } else if (action === "label_sensitive" || action === "unlabel_sensitive") {
      await tx`UPDATE posts SET sensitive = ${action === "label_sensitive"} WHERE id = ${targetId}`;
    } else {
      await tx`UPDATE posts SET limited = ${action === "limit_reach"} WHERE id = ${targetId}`;
    }
  } else {
    const [u] = await tx<{ status: string }[]>`SELECT status FROM users WHERE id = ${targetId} FOR UPDATE`;
    if (!u || u.status === "deleted") throw notFound("User");
    userId = targetId;
    const need = (ok: string[]) => {
      if (!ok.includes(u.status)) throw new AppError(409, "INVALID_STATE", `Account is ${u.status}`);
    };
    switch (action) {
      case "warn":
        break;
      case "suspend": {
        need(["active", "suspended"]);
        const days = input.durationDays;
        if (days != null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw badRequest("Invalid duration");
        await tx`UPDATE users SET status = 'suspended',
                   suspended_until = ${days == null ? null : new Date(Date.now() + days * 86400_000)} WHERE id = ${userId}`;
        break;
      }
      case "unsuspend":
        need(["suspended"]);
        await tx`UPDATE users SET status = 'active', suspended_until = NULL WHERE id = ${userId}`;
        break;
      case "freeze":
        need(["active", "suspended"]);
        await tx`UPDATE users SET status = 'frozen' WHERE id = ${userId}`;
        break;
      case "unfreeze":
        need(["frozen"]);
        await tx`UPDATE users SET status = 'active' WHERE id = ${userId}`;
        break;
      case "ban":
        need(["active", "suspended", "frozen"]);
        await tx`UPDATE users SET status = 'banned', suspended_until = NULL WHERE id = ${userId}`;
        await tx`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`;
        break;
      case "unban":
        need(["banned"]);
        await tx`UPDATE users SET status = 'active' WHERE id = ${userId}`;
        break;
      default:
        throw badRequest("Unknown action");
    }
  }

  if (STRIKES.has(action)) await tx`UPDATE users SET strike_count = strike_count + 1 WHERE id = ${userId}`;

  const actionId = newId();
  const expires = action === "suspend" && input.durationDays != null ? new Date(Date.now() + input.durationDays * 86400_000) : null;
  await tx`
    INSERT INTO moderation_actions (id, staff_id, target_type, target_id, user_id, action, reason_code, statement, report_id, expires_at)
    VALUES (${actionId}, ${input.staffId}, ${targetType}, ${targetId}, ${userId}, ${action}, ${input.reasonCode},
            ${input.statement}, ${input.reportId ?? null}, ${expires})`;
  if (!SILENT.has(action)) {
    await tx`INSERT INTO moderation_notices (id, user_id, action_id) VALUES (${newId()}, ${userId}, ${actionId})`;
  }

  // Close the report that prompted this, and any other open reports on the same target.
  if (input.reportId) {
    const [r] = await tx<{ target_type: string; target_id: string }[]>`SELECT target_type, target_id FROM reports WHERE id = ${input.reportId}`;
    if (r) {
      await tx`
        UPDATE reports SET status = 'actioned', resolved_at = now(), resolved_by = ${input.staffId}, resolution = ${action}
        WHERE status = 'open' AND (id = ${input.reportId} OR (target_type = ${r.target_type} AND target_id = ${r.target_id}))`;
    }
  }
  return { actionId, userId, targetType };
}
