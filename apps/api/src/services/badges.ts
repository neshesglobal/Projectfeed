import type { Badge } from "@projectfeed/shared";
import type { Db } from "../db";

/** The badge a user currently displays (paid badges only while their subscription is active). */
export async function effectiveBadge(db: Db, userId: string): Promise<Badge | null> {
  const [r] = await db<{ badge: Badge | null }[]>`
    SELECT CASE WHEN u.badge IN ('public_figure','government','news') THEN u.badge
                WHEN u.badge IN ('business','creator') AND EXISTS (
                  SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.plan = u.badge AND s.status = 'active'
                    AND s.current_period_end > now()) THEN u.badge END AS badge
    FROM users u WHERE u.id = ${userId}`;
  return r?.badge ?? null;
}
