// Turns database rows into API objects, applying viewer-specific state and visibility.

import type { Media, Poll, Post, UserProfile, UserSummary, ViewerRelationship } from "@projectfeed/shared";
import type { Db } from "../db";
import type { Storage } from "../lib/storage";

/** Placeholder viewer ID for signed-out requests: no user has ID 0. */
export const ANON = "0";

export interface HydrateCtx {
  db: Db;
  storage: Storage;
}

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_key: string | null;
  kyc_level: number;
  is_protected: boolean;
}

function toSummary(ctx: HydrateCtx, r: UserRow): UserSummary {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    avatarUrl: r.avatar_key ? ctx.storage.url(r.avatar_key) : null,
    kycLevel: r.kyc_level as 0 | 1 | 2,
    isProtected: r.is_protected,
  };
}

export async function userSummaries(ctx: HydrateCtx, ids: string[]): Promise<Map<string, UserSummary>> {
  const out = new Map<string, UserSummary>();
  if (ids.length === 0) return out;
  const rows = await ctx.db<UserRow[]>`
    SELECT u.id, u.handle::text AS handle, u.display_name, am.storage_key AS avatar_key, u.kyc_level, u.is_protected
    FROM users u LEFT JOIN media am ON am.id = u.avatar_media_id
    WHERE u.id = ANY(${ids}::bigint[]) AND u.status <> 'deleted'`;
  for (const r of rows) out.set(r.id, toSummary(ctx, r));
  return out;
}

export async function orderedSummaries(ctx: HydrateCtx, ids: string[]): Promise<UserSummary[]> {
  const map = await userSummaries(ctx, ids);
  return ids.map((id) => map.get(id)).filter((u): u is UserSummary => !!u);
}

export async function relationship(db: Db, viewerId: string, targetId: string): Promise<ViewerRelationship> {
  const [r] = await db<ViewerRelationship[]>`
    SELECT
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ${viewerId} AND followee_id = ${targetId}) AS following,
      EXISTS(SELECT 1 FROM follows WHERE follower_id = ${targetId} AND followee_id = ${viewerId}) AS "followedBy",
      EXISTS(SELECT 1 FROM follow_requests WHERE requester_id = ${viewerId} AND target_id = ${targetId}) AS "followRequested",
      EXISTS(SELECT 1 FROM blocks WHERE blocker_id = ${viewerId} AND blocked_id = ${targetId}) AS blocking,
      EXISTS(SELECT 1 FROM blocks WHERE blocker_id = ${targetId} AND blocked_id = ${viewerId}) AS "blockedBy",
      EXISTS(SELECT 1 FROM mutes WHERE muter_id = ${viewerId} AND muted_id = ${targetId}) AS muting`;
  return r!;
}

export async function userProfile(ctx: HydrateCtx, viewerId: string | null, userId: string): Promise<UserProfile | null> {
  const [r] = await ctx.db<
    (UserRow & {
      bio: string;
      location: string;
      website: string;
      company: string;
      role: string;
      sectors: string[];
      banner_key: string | null;
      created_at: Date;
      followers_count: number;
      following_count: number;
      posts_count: number;
      pinned_post_id: string | null;
    })[]
  >`
    SELECT u.id, u.handle::text AS handle, u.display_name, am.storage_key AS avatar_key, u.kyc_level, u.is_protected,
           u.bio, u.location, u.website, u.company, u.role, u.sectors, bm.storage_key AS banner_key, u.created_at,
           u.followers_count, u.following_count, u.posts_count, u.pinned_post_id
    FROM users u
    LEFT JOIN media am ON am.id = u.avatar_media_id
    LEFT JOIN media bm ON bm.id = u.banner_media_id
    WHERE u.id = ${userId} AND (u.status = 'active' OR u.id = ${viewerId ?? ANON})`;
  if (!r) return null;
  return {
    ...toSummary(ctx, r),
    bio: r.bio,
    location: r.location,
    website: r.website,
    company: r.company,
    role: r.role,
    sectors: r.sectors,
    bannerUrl: r.banner_key ? ctx.storage.url(r.banner_key) : null,
    createdAt: r.created_at.toISOString(),
    followersCount: r.followers_count,
    followingCount: r.following_count,
    postsCount: r.posts_count,
    pinnedPostId: r.pinned_post_id,
    viewer: viewerId && viewerId !== userId ? await relationship(ctx.db, viewerId, userId) : null,
  };
}

// ───────────────────────────── Posts ─────────────────────────────

interface PostRow extends UserRow {
  post_id: string;
  author_id: string;
  author_status: string;
  text: string;
  created_at: Date;
  edited_at: Date | null;
  edit_count: number;
  deleted_at: Date | null;
  removed_at: Date | null;
  sensitive: boolean;
  conversation_id: string;
  reply_to_id: string | null;
  reply_to_handle: string | null;
  quote_of_id: string | null;
  reply_audience: Post["replyAudience"];
  reply_count: number;
  repost_count: number;
  quote_count: number;
  like_count: number;
  bookmark_count: number;
  view_count: number;
  liked: boolean;
  reposted: boolean;
  bookmarked: boolean;
  blocked: boolean;
  viewer_follows_author: boolean;
  author_follows_viewer: boolean;
  viewer_mentioned: boolean;
}

export async function mediaFor(ctx: HydrateCtx, table: "post_media" | "message_media", ids: string[]) {
  const out = new Map<string, Media[]>();
  if (ids.length === 0) return out;
  const rows =
    table === "post_media"
      ? await ctx.db<(MediaRow & { owner: string })[]>`
          SELECT pm.post_id AS owner, m.id, m.type, m.storage_key, m.thumb_key, m.width, m.height, m.alt_text, m.status, m.duration_ms, m.error
          FROM post_media pm JOIN media m ON m.id = pm.media_id
          WHERE pm.post_id = ANY(${ids}::bigint[]) ORDER BY pm.position`
      : await ctx.db<(MediaRow & { owner: string })[]>`
          SELECT mm.message_id AS owner, m.id, m.type, m.storage_key, m.thumb_key, m.width, m.height, m.alt_text, m.status, m.duration_ms, m.error
          FROM message_media mm JOIN media m ON m.id = mm.media_id
          WHERE mm.message_id = ANY(${ids}::bigint[]) ORDER BY mm.position`;
  for (const r of rows) {
    const list = out.get(r.owner) ?? [];
    list.push(toMedia(ctx, r));
    out.set(r.owner, list);
  }
  return out;
}

export interface MediaRow {
  id: string;
  type: Media["type"];
  storage_key: string;
  thumb_key: string;
  width: number;
  height: number;
  alt_text: string;
  status: Media["status"];
  duration_ms: number | null;
  error: string | null;
}

export const MEDIA_COLUMNS = "id, type, storage_key, thumb_key, width, height, alt_text, status, duration_ms, error";

export function toMedia(ctx: HydrateCtx, r: MediaRow): Media {
  const ready = r.status === "ready";
  return {
    id: r.id,
    type: r.type,
    url: ready ? ctx.storage.url(r.storage_key) : "",
    thumbUrl: ready ? ctx.storage.url(r.thumb_key) : "",
    width: r.width,
    height: r.height,
    altText: r.alt_text,
    status: r.status,
    durationMs: r.duration_ms,
    ...(r.error ? { error: r.error } : {}),
  };
}

async function pollsFor(ctx: HydrateCtx, viewerId: string, ids: string[]): Promise<Map<string, Poll>> {
  const out = new Map<string, Poll>();
  if (ids.length === 0) return out;
  const polls = await ctx.db<{ post_id: string; options: string[]; ends_at: Date }[]>`
    SELECT post_id, options, ends_at FROM polls WHERE post_id = ANY(${ids}::bigint[])`;
  if (polls.length === 0) return out;
  const pollIds = polls.map((p) => p.post_id);
  const votes = await ctx.db<{ post_id: string; option_index: number; n: number }[]>`
    SELECT post_id, option_index, count(*)::int AS n FROM poll_votes
    WHERE post_id = ANY(${pollIds}::bigint[]) GROUP BY post_id, option_index`;
  const mine = await ctx.db<{ post_id: string; option_index: number }[]>`
    SELECT post_id, option_index FROM poll_votes WHERE user_id = ${viewerId} AND post_id = ANY(${pollIds}::bigint[])`;
  const now = new Date();
  for (const p of polls) {
    const counts = p.options.map((_, i) => votes.find((v) => v.post_id === p.post_id && v.option_index === i)?.n ?? 0);
    out.set(p.post_id, {
      options: p.options.map((label, i) => ({ label, votes: counts[i]! })),
      totalVotes: counts.reduce((a, b) => a + b, 0),
      endsAt: p.ends_at.toISOString(),
      closed: p.ends_at <= now,
      viewerVote: mine.find((m) => m.post_id === p.post_id)?.option_index ?? null,
    });
  }
  return out;
}

/**
 * Hydrate posts for a viewer. Posts the viewer may not see (deleted, removed by moderation, suspended author,
 * blocked, protected)
 * come back as placeholders with `unavailable` set, so threads and quotes can render a tombstone.
 * Quotes are hydrated one level deep.
 */
export async function hydratePosts(
  ctx: HydrateCtx,
  viewerId: string | null,
  ids: string[],
  depth = 0,
): Promise<Map<string, Post>> {
  const out = new Map<string, Post>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const v = viewerId ?? ANON;

  const rows = await ctx.db<PostRow[]>`
    SELECT p.id AS post_id, p.author_id, p.text, p.created_at, p.edited_at, p.edit_count, p.deleted_at, p.removed_at, p.sensitive,
           p.conversation_id, p.reply_to_id, ru.handle::text AS reply_to_handle, p.quote_of_id, p.reply_audience,
           p.reply_count, p.repost_count, p.quote_count, p.like_count, p.bookmark_count, p.view_count,
           u.id, u.handle::text AS handle, u.display_name, am.storage_key AS avatar_key, u.kyc_level, u.is_protected,
           u.status AS author_status,
           EXISTS(SELECT 1 FROM likes l WHERE l.user_id = ${v} AND l.post_id = p.id) AS liked,
           EXISTS(SELECT 1 FROM reposts r WHERE r.user_id = ${v} AND r.post_id = p.id) AS reposted,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.user_id = ${v} AND b.post_id = p.id) AS bookmarked,
           EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id = ${v} AND b.blocked_id = p.author_id)
                                            OR (b.blocker_id = p.author_id AND b.blocked_id = ${v})) AS blocked,
           EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ${v} AND f.followee_id = p.author_id) AS viewer_follows_author,
           EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = p.author_id AND f.followee_id = ${v}) AS author_follows_viewer,
           EXISTS(SELECT 1 FROM post_mentions pm WHERE pm.post_id = p.id AND pm.user_id = ${v}) AS viewer_mentioned
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN media am ON am.id = u.avatar_media_id
    LEFT JOIN users ru ON ru.id = p.reply_to_author_id
    WHERE p.id = ANY(${unique}::bigint[])`;

  const visibleIds = rows.filter((r) => !r.deleted_at && !r.removed_at).map((r) => r.post_id);
  const quoteIds = rows.map((r) => r.quote_of_id).filter((q): q is string => !!q);
  const [media, polls, quotes] = await Promise.all([
    mediaFor(ctx, "post_media", visibleIds),
    pollsFor(ctx, v, visibleIds),
    depth === 0 ? hydratePosts(ctx, viewerId, quoteIds, 1) : Promise.resolve(new Map<string, Post>()),
  ]);

  for (const r of rows) {
    const isOwn = r.author_id === v;
    let unavailable: Post["unavailable"];
    if (r.deleted_at || r.author_status === "deleted") unavailable = "deleted";
    else if (r.removed_at) unavailable = "removed";
    else if (!isOwn && (r.author_status === "suspended" || r.author_status === "banned")) unavailable = "suspended";
    else if (!isOwn && r.author_status !== "active") unavailable = "deleted"; // frozen: don't reveal a review
    else if (r.blocked) unavailable = "blocked";
    else if (r.is_protected && !isOwn && !r.viewer_follows_author) unavailable = "protected";

    const canReply =
      !unavailable &&
      viewerId !== null &&
      (r.reply_audience === "everyone" ||
        isOwn ||
        (r.reply_audience === "following" && r.author_follows_viewer) ||
        (r.reply_audience === "mentioned" && r.viewer_mentioned));

    out.set(r.post_id, {
      id: r.post_id,
      author: toSummary(ctx, r),
      text: unavailable ? "" : r.text,
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      editCount: r.edit_count,
      conversationId: r.conversation_id,
      replyTo: r.reply_to_id ? { postId: r.reply_to_id, handle: r.reply_to_handle ?? "" } : null,
      quote: !unavailable && r.quote_of_id ? (quotes.get(r.quote_of_id) ?? null) : null,
      media: unavailable ? [] : (media.get(r.post_id) ?? []),
      poll: unavailable ? null : (polls.get(r.post_id) ?? null),
      replyAudience: r.reply_audience,
      counts: {
        replies: r.reply_count,
        reposts: r.repost_count,
        quotes: r.quote_count,
        likes: r.like_count,
        bookmarks: r.bookmark_count,
        views: r.view_count,
      },
      viewer: { liked: r.liked, reposted: r.reposted, bookmarked: r.bookmarked, canReply },
      deleted: !!r.deleted_at,
      ...(r.sensitive && !unavailable ? { sensitive: true } : {}),
      ...(unavailable ? { unavailable } : {}),
    });
  }
  return out;
}

/** Hydrate and keep order, dropping posts the viewer cannot see. */
export async function visiblePosts(ctx: HydrateCtx, viewerId: string | null, ids: string[]): Promise<Post[]> {
  const map = await hydratePosts(ctx, viewerId, ids);
  return ids.map((id) => map.get(id)).filter((p): p is Post => !!p && !p.unavailable);
}
