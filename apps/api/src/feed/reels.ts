// Reels: a full-screen, vertically-swiped video feed.
// Short-video ranking is dominated by watch behaviour rather than likes: did people finish it,
// how much of it did they watch, and did they re-watch. Rule-based for now, using the same
// candidate → filter → score → diversify shape as the Home Feed Mixer.

import type { Db } from "../db";
import { idAtTime } from "../lib/ids";
import { containsMutedWord, type ViewerFilters } from "../services/timeline";

export const REELS_WEIGHTS = {
  lookbackDays: 30,
  freshnessHalfLifeHours: 72,
  verticalBoost: 1.25, // portrait video fills the screen
  followedBoost: 1.2,
  seenFactor: 0.15, // already-watched reels sink but are not removed (small networks run out of video)
  authorRepeatDecay: 0.5,
  priorPlays: 3, // Bayesian smoothing so one lucky view doesn't top the chart
  priorCompletionRate: 0.33,
};

export interface ReelCandidate {
  postId: string;
  authorId: string;
  text: string;
  createdAt: Date;
  likes: number;
  replies: number;
  reposts: number;
  bookmarks: number;
  plays: number;
  watchMs: number;
  completions: number;
  durationMs: number;
  width: number;
  height: number;
  followed: boolean;
  seen: boolean;
}

export function reelScore(c: ReelCandidate, now = Date.now()): number {
  const W = REELS_WEIGHTS;
  const completionRate = (c.completions + W.priorCompletionRate * W.priorPlays) / (c.plays + W.priorPlays);
  const avgWatchFraction =
    c.durationMs > 0 ? Math.min(1.5, (c.watchMs + 0.4 * c.durationMs * W.priorPlays) / ((c.plays + W.priorPlays) * c.durationMs)) : 0.4;
  const quality = 0.6 * completionRate + 0.4 * avgWatchFraction;
  const engagement = Math.log1p(c.likes + 2 * c.reposts + 3 * c.replies + 2 * c.bookmarks);
  const ageHours = Math.max(0, (now - c.createdAt.getTime()) / 3600_000);
  const freshness = Math.pow(0.5, ageHours / W.freshnessHalfLifeHours);
  let s = (0.5 + 2 * quality) * (1 + engagement) * (0.2 + freshness);
  if (c.height > c.width) s *= W.verticalBoost;
  if (c.followed) s *= W.followedBoost;
  if (c.seen) s *= W.seenFactor;
  return s;
}

export async function rankReels(db: Db, viewerId: string, filters: ViewerFilters): Promise<string[]> {
  const since = idAtTime(new Date(Date.now() - REELS_WEIGHTS.lookbackDays * 86400_000));
  const rows = await db<ReelCandidate[]>`
    SELECT p.id AS "postId", p.author_id AS "authorId", p.text, p.created_at AS "createdAt",
           p.like_count AS likes, p.reply_count AS replies, p.repost_count AS reposts, p.bookmark_count AS bookmarks,
           coalesce(vs.plays, 0) AS plays, coalesce(vs.watch_ms, 0)::float AS "watchMs", coalesce(vs.completions, 0) AS completions,
           coalesce(m.duration_ms, 0) AS "durationMs", m.width, m.height,
           EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewerId} AND f.followee_id = p.author_id) AS followed,
           EXISTS (SELECT 1 FROM post_views v WHERE v.user_id = ${viewerId} AND v.post_id = p.id) AS seen
    FROM posts p
    JOIN users u ON u.id = p.author_id AND u.status = 'active'
    JOIN post_media pm ON pm.post_id = p.id
    JOIN media m ON m.id = pm.media_id AND m.type = 'video' AND m.status = 'ready'
    LEFT JOIN video_stats vs ON vs.post_id = p.id
    WHERE p.has_video AND p.deleted_at IS NULL AND p.reply_to_id IS NULL AND p.id > ${since}
    ORDER BY p.id DESC LIMIT 1000`;

  const now = Date.now();
  const kept = rows
    .filter(
      (c) =>
        !filters.blockedUsers.has(c.authorId) &&
        !filters.mutedUsers.has(c.authorId) &&
        !filters.notInterestedPosts.has(c.postId) &&
        !containsMutedWord(c.text, filters.mutedWords),
    )
    .map((c) => ({ id: c.postId, authorId: c.authorId, score: reelScore(c, now) }))
    .sort((a, b) => b.score - a.score);

  // Author diversity: avoid five reels in a row from one account.
  const perAuthor = new Map<string, number>();
  return kept
    .map((c) => {
      const n = perAuthor.get(c.authorId) ?? 0;
      perAuthor.set(c.authorId, n + 1);
      return { ...c, score: c.score * Math.pow(REELS_WEIGHTS.authorRepeatDecay, n) };
    })
    .sort((a, b) => b.score - a.score)
    .map((c) => c.id);
}

/**
 * Fold client `video_view` events into per-post stats. Watch time is capped at 3× the video length
 * per event so a looping or tampered client can't inflate a reel indefinitely.
 */
export async function recordVideoViews(db: Db, views: { postId: string; durationMs: number }[]): Promise<void> {
  for (const v of views) {
    await db`
      INSERT INTO video_stats (post_id, plays, watch_ms, completions)
      SELECT p.id, 1, least(${v.durationMs}, m.duration_ms * 3), CASE WHEN ${v.durationMs} >= 0.9 * m.duration_ms THEN 1 ELSE 0 END
      FROM posts p
      JOIN post_media pm ON pm.post_id = p.id
      JOIN media m ON m.id = pm.media_id AND m.type = 'video' AND m.status = 'ready' AND m.duration_ms > 0
      WHERE p.id = ${v.postId} AND p.deleted_at IS NULL
      ON CONFLICT (post_id) DO UPDATE SET
        plays = video_stats.plays + 1,
        watch_ms = video_stats.watch_ms + excluded.watch_ms,
        completions = video_stats.completions + excluded.completions,
        updated_at = now()`;
  }
}
