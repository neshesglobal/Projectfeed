// Chronological timelines (Following, profiles, lists) and the viewer filters shared with For You.

import type { FeedItem, Page } from "@projectfeed/shared";
import type { Db } from "../db";
import { badRequest } from "../lib/errors";
import { isId } from "../lib/ids";
import { hydratePosts, userSummaries, type HydrateCtx } from "./hydrate";

export const MAX_ID = "9223372036854775807";

export function pageSize(raw: unknown, def = 20, max = 50): number {
  const n = Number(raw ?? def);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), max) : def;
}

export function idCursor(raw: unknown): string {
  if (raw === undefined || raw === "") return MAX_ID;
  if (!isId(raw)) throw badRequest("Invalid cursor");
  return raw;
}

export interface ViewerFilters {
  mutedUsers: Set<string>;
  blockedUsers: Set<string>; // either direction
  mutedWords: string[];
  notInterestedPosts: Set<string>;
}

export async function loadViewerFilters(db: Db, viewerId: string): Promise<ViewerFilters> {
  const [mutes, blocks, words, negs] = await Promise.all([
    db<{ id: string }[]>`SELECT muted_id AS id FROM mutes WHERE muter_id = ${viewerId}`,
    db<{ id: string }[]>`
      SELECT blocked_id AS id FROM blocks WHERE blocker_id = ${viewerId}
      UNION SELECT blocker_id FROM blocks WHERE blocked_id = ${viewerId}`,
    db<{ word: string }[]>`SELECT word FROM muted_words WHERE user_id = ${viewerId}`,
    db<{ post_id: string }[]>`SELECT post_id FROM feed_negative WHERE user_id = ${viewerId} ORDER BY created_at DESC LIMIT 1000`,
  ]);
  return {
    mutedUsers: new Set(mutes.map((r) => r.id)),
    blockedUsers: new Set(blocks.map((r) => r.id)),
    mutedWords: words.map((w) => w.word.toLowerCase()),
    notInterestedPosts: new Set(negs.map((r) => r.post_id)),
  };
}

export function containsMutedWord(text: string, words: string[]): boolean {
  if (words.length === 0) return false;
  const lower = text.toLowerCase();
  return words.some((w) => {
    if (w.startsWith("#") || w.startsWith("$")) return lower.includes(w);
    // Whole-word match so muting "oil" does not hide "spoiler".
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "u").test(lower);
  });
}

interface ActivityRow {
  sort_id: string;
  post_id: string;
  reposter_id: string | null;
}

/**
 * Hydrate (post, reposter) rows into feed items, applying visibility and optional home-feed filters.
 * A post reposted by several followed accounts appears once.
 */
export async function hydrateActivity(
  ctx: HydrateCtx,
  viewerId: string | null,
  rows: ActivityRow[],
  limit: number,
  filters: ViewerFilters | null,
): Promise<Page<FeedItem>> {
  const posts = await hydratePosts(ctx, viewerId, rows.map((r) => r.post_id));
  const reposters = await userSummaries(ctx, rows.map((r) => r.reposter_id).filter((x): x is string => !!x));
  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const r of rows) {
    const post = posts.get(r.post_id);
    if (!post || post.unavailable || seen.has(post.id)) continue;
    if (filters) {
      if (filters.mutedUsers.has(post.author.id) || filters.blockedUsers.has(post.author.id)) continue;
      if (r.reposter_id && (filters.mutedUsers.has(r.reposter_id) || filters.blockedUsers.has(r.reposter_id))) continue;
      if (filters.notInterestedPosts.has(post.id)) continue;
      if (containsMutedWord(post.text, filters.mutedWords)) continue;
    }
    seen.add(post.id);
    items.push({ post, repostedBy: r.reposter_id ? (reposters.get(r.reposter_id) ?? null) : null, reason: null });
  }
  return { items, nextCursor: rows.length >= limit ? rows[rows.length - 1]!.sort_id : null };
}

/** Following tab: posts and reposts from followed accounts (and self), newest first. */
export async function followingTimeline(ctx: HydrateCtx, viewerId: string, cursor: string, limit: number) {
  const rows = await ctx.db<ActivityRow[]>`
    WITH authors AS (
      SELECT followee_id AS id FROM follows WHERE follower_id = ${viewerId}
      UNION SELECT ${viewerId}::bigint
    )
    SELECT * FROM (
      SELECT p.id AS sort_id, p.id AS post_id, NULL::bigint AS reposter_id
      FROM posts p
      WHERE p.author_id IN (SELECT id FROM authors) AND p.deleted_at IS NULL AND p.id < ${cursor}
        AND (p.reply_to_id IS NULL OR p.reply_to_author_id IN (SELECT id FROM authors))
      UNION ALL
      SELECT r.id, r.post_id, r.user_id
      FROM reposts r JOIN posts p ON p.id = r.post_id
      WHERE r.user_id IN (SELECT id FROM authors) AND r.user_id <> p.author_id AND p.deleted_at IS NULL AND r.id < ${cursor}
    ) t
    ORDER BY sort_id DESC LIMIT ${limit}`;
  const filters = await loadViewerFilters(ctx.db, viewerId);
  return hydrateActivity(ctx, viewerId, rows, limit, filters);
}

export type ProfileTab = "posts" | "replies" | "media" | "likes";

export async function profileTimeline(
  ctx: HydrateCtx,
  viewerId: string | null,
  userId: string,
  tab: ProfileTab,
  cursor: string,
  limit: number,
): Promise<Page<FeedItem>> {
  let rows: ActivityRow[];
  if (tab === "posts") {
    rows = await ctx.db<ActivityRow[]>`
      SELECT * FROM (
        SELECT p.id AS sort_id, p.id AS post_id, NULL::bigint AS reposter_id FROM posts p
        WHERE p.author_id = ${userId} AND p.reply_to_id IS NULL AND p.deleted_at IS NULL AND p.id < ${cursor}
        UNION ALL
        SELECT r.id, r.post_id, r.user_id FROM reposts r JOIN posts p ON p.id = r.post_id
        WHERE r.user_id = ${userId} AND p.deleted_at IS NULL AND r.id < ${cursor}
      ) t ORDER BY sort_id DESC LIMIT ${limit}`;
  } else if (tab === "replies") {
    rows = await ctx.db<ActivityRow[]>`
      SELECT p.id AS sort_id, p.id AS post_id, NULL::bigint AS reposter_id FROM posts p
      WHERE p.author_id = ${userId} AND p.deleted_at IS NULL AND p.id < ${cursor}
      ORDER BY p.id DESC LIMIT ${limit}`;
  } else if (tab === "media") {
    rows = await ctx.db<ActivityRow[]>`
      SELECT p.id AS sort_id, p.id AS post_id, NULL::bigint AS reposter_id FROM posts p
      WHERE p.author_id = ${userId} AND p.deleted_at IS NULL AND p.id < ${cursor}
        AND EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)
      ORDER BY p.id DESC LIMIT ${limit}`;
  } else {
    // Likes are private to their owner (as on X since 2024). Cursor is the like time in epoch micros.
    const likeRows = await ctx.db<{ post_id: string; ts: string }[]>`
      SELECT post_id, (extract(epoch FROM created_at) * 1000000)::bigint::text AS ts
      FROM likes WHERE user_id = ${userId} AND (extract(epoch FROM created_at) * 1000000)::bigint < ${cursor}::bigint
      ORDER BY created_at DESC LIMIT ${limit}`;
    rows = likeRows.map((r) => ({ sort_id: r.ts, post_id: r.post_id, reposter_id: null }));
  }
  return hydrateActivity(ctx, viewerId, rows, limit, null);
}
