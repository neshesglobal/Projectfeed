// Private trust score. Explainable by design: every point comes from a named factor the user can see on their
// own Account status screen. It is never shown to other users (a public "social score" invites defamation claims,
// brigading and comparisons with state social-credit systems), but it shapes how far an account's content travels.

import type { Db } from "../db";

export interface TrustFactor {
  key: string;
  label: string;
  points: number;
}

export type TrustBand = "Excellent" | "Good" | "Fair" | "Limited";

export interface Trust {
  score: number;
  band: TrustBand;
  factors: TrustFactor[];
}

export const band = (score: number): TrustBand => (score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Limited");

/** Below this, an account's posts are not recommended outside its followers. */
export const OUT_OF_NETWORK_MIN_TRUST = 40;

/** New conversations a user may start per day, by band. */
export const DM_DAILY_LIMIT: Record<TrustBand, number> = { Excellent: 100, Good: 50, Fair: 20, Limited: 5 };

const STRIKE_ACTIONS = ["remove_post", "warn", "suspend", "ban"];

/** Ranking multiplier: 0.6 at trust 0, 1.0 at 50, 1.4 at 100. */
export const trustMultiplier = (score: number) => 0.6 + (0.8 * Math.max(0, Math.min(100, score))) / 100;

export async function computeTrust(db: Db, userId: string): Promise<Trust> {
  const [r] = await db<{
    kyc_level: number;
    status: string;
    age_days: number;
    strikes: number;
    upheld_reports: number;
    blocks_received: number;
    noted_posts: number;
  }[]>`
    SELECT u.kyc_level, u.status,
      extract(epoch FROM now() - u.created_at)::int / 86400 AS age_days,
      (SELECT count(*)::int FROM moderation_actions a LEFT JOIN appeals ap ON ap.action_id = a.id
        WHERE a.user_id = u.id AND a.action = ANY(${STRIKE_ACTIONS}) AND a.created_at > now() - interval '1 year'
          AND (ap.status IS NULL OR ap.status <> 'overturned')) AS strikes,
      (SELECT count(*)::int FROM reports rp
        WHERE rp.status = 'actioned' AND rp.resolved_at > now() - interval '90 days'
          AND ((rp.target_type = 'user' AND rp.target_id = u.id)
            OR (rp.target_type = 'post' AND rp.target_id IN (SELECT id FROM posts WHERE author_id = u.id))
            OR (rp.target_type = 'message' AND rp.target_id IN (SELECT id FROM messages WHERE sender_id = u.id)))) AS upheld_reports,
      (SELECT count(DISTINCT b.blocker_id)::int FROM blocks b WHERE b.blocked_id = u.id AND b.created_at > now() - interval '30 days') AS blocks_received,
      ${notedPostsSql(db)} AS noted_posts
    FROM users u WHERE u.id = ${userId}`;
  if (!r) return { score: 0, band: "Limited", factors: [] };

  const f: TrustFactor[] = [{ key: "base", label: "Starting score", points: 50 }];
  if (r.kyc_level >= 1) f.push({ key: "id", label: "Identity verified", points: 15 });
  if (r.kyc_level >= 2) f.push({ key: "org", label: "Verified organisation", points: 5 });
  const months = Math.min(10, Math.floor(r.age_days / 30));
  if (months > 0) f.push({ key: "age", label: `Account age (${months} ${months === 1 ? "month" : "months"})`, points: months });
  if (r.strikes === 0 && r.age_days >= 90) f.push({ key: "clean", label: "No rule violations in 12 months", points: 10 });
  if (r.strikes > 0) f.push({ key: "strikes", label: `${r.strikes} rule ${r.strikes === 1 ? "violation" : "violations"} in 12 months`, points: -15 * r.strikes });
  if (r.upheld_reports > 0) f.push({ key: "reports", label: `${r.upheld_reports} upheld ${r.upheld_reports === 1 ? "report" : "reports"} in 90 days`, points: -Math.min(20, 5 * r.upheld_reports) });
  if (r.blocks_received >= 3) f.push({ key: "blocks", label: `Blocked by ${r.blocks_received} people in 30 days`, points: -Math.min(15, 2 * r.blocks_received) });
  if (r.noted_posts > 0) f.push({ key: "notes", label: `${r.noted_posts} ${r.noted_posts === 1 ? "post" : "posts"} with a Community Note in 90 days`, points: -Math.min(15, 5 * r.noted_posts) });

  let score = Math.max(0, Math.min(100, f.reduce((n, x) => n + x.points, 0)));
  if (r.status === "suspended" || r.status === "frozen") {
    score = Math.min(score, 10);
    f.push({ key: "status", label: r.status === "suspended" ? "Account suspended" : "Account under review", points: 0 });
  }
  return { score, band: band(score), factors: f };
}

/** Posts that carry a Community Note rated helpful (misleading). Zero until Community Notes exist. */
function notedPostsSql(db: Db) {
  return db`(SELECT count(DISTINCT n.post_id)::int FROM community_notes n JOIN posts p ON p.id = n.post_id
             WHERE p.author_id = u.id AND n.status = 'helpful' AND n.classification = 'misleading'
               AND n.status_changed_at > now() - interval '90 days')`;
}

export async function refreshTrust(db: Db, userId: string): Promise<Trust> {
  const t = await computeTrust(db, userId);
  await db`UPDATE users SET trust_score = ${t.score}, trust_updated_at = now() WHERE id = ${userId}`;
  return t;
}

/** Background refresh of stale scores (accounts age, strikes expire). */
export async function refreshStaleTrust(db: Db, limit = 500): Promise<number> {
  const rows = await db<{ id: string }[]>`
    SELECT id FROM users WHERE status <> 'deleted' AND (trust_updated_at IS NULL OR trust_updated_at < now() - interval '24 hours')
    ORDER BY trust_updated_at NULLS FIRST LIMIT ${limit}`;
  for (const r of rows) await refreshTrust(db, r.id);
  return rows.length;
}
