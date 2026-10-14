import type { NotificationType } from "@projectfeed/shared";
import type { Db } from "../db";
import { newId } from "../lib/ids";

/**
 * Record a notification unless the recipient is the actor, or has blocked or muted them.
 * Duplicate (recipient, type, actor, post) pairs are ignored, so like → unlike → like does not spam.
 */
export async function notify(
  db: Db,
  n: { recipientId: string; actorId: string; type: NotificationType; postId?: string | null },
): Promise<void> {
  if (n.recipientId === n.actorId) return;
  await db`
    WITH n AS (
      INSERT INTO notifications (id, user_id, type, actor_id, post_id)
      SELECT ${newId()}, ${n.recipientId}, ${n.type}, ${n.actorId}, ${n.postId ?? null}
      WHERE NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ${n.recipientId} AND blocked_id = ${n.actorId})
        AND NOT EXISTS (SELECT 1 FROM mutes WHERE muter_id = ${n.recipientId} AND muted_id = ${n.actorId})
      ON CONFLICT (user_id, type, actor_id, post_id) DO NOTHING
      RETURNING id, user_id
    )
    -- Queue a push only for people with a device registered (see services/push.ts).
    INSERT INTO push_outbox (user_id, notification_id)
    SELECT user_id, id FROM n WHERE EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = n.user_id)`;
}

export async function unnotify(
  db: Db,
  n: { recipientId: string; actorId: string; type: NotificationType; postId?: string | null },
): Promise<void> {
  await db`
    DELETE FROM notifications
    WHERE user_id = ${n.recipientId} AND type = ${n.type} AND actor_id = ${n.actorId}
      AND post_id IS NOT DISTINCT FROM ${n.postId ?? null}::bigint AND read_at IS NULL`;
}
