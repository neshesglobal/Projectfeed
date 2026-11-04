import { sharedCacheMs } from "../feed/mixer";
import type { FastifyPluginAsync } from "fastify";
import { isLanguageCode, NEAR_RADIUS_KM, SEARCH_SINCE, type FeedItem, type Trend } from "@projectfeed/shared";
import { badRequest } from "../lib/errors";
import { idAtTime } from "../lib/ids";
import { orderedSummaries, visiblePosts } from "../services/hydrate";
import { idCursor, loadViewerFilters, containsMutedWord, pageSize } from "../services/timeline";

interface ParsedQuery {
  terms: string;
  from: string | null;
  tags: { tag: string; kind: "hashtag" | "cashtag" }[];
  mediaOnly: boolean;
  minLikes: number;
}

/** Supports a subset of X's operators: from:handle, filter:media, min_faves:N, #tag, $TAG. */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = { terms: "", from: null, tags: [], mediaOnly: false, minLikes: 0 };
  const rest: string[] = [];
  for (const tok of q.trim().split(/\s+/)) {
    const lower = tok.toLowerCase();
    if (lower.startsWith("from:")) out.from = tok.slice(5).replace(/^@/, "") || null;
    else if (lower === "filter:media") out.mediaOnly = true;
    else if (lower.startsWith("min_faves:")) out.minLikes = Math.max(0, Number(tok.slice(10)) || 0);
    else if (/^#[\p{L}\p{N}_]+$/u.test(tok)) out.tags.push({ tag: lower.slice(1), kind: "hashtag" });
    else if (/^\$[A-Za-z]{1,6}([._][A-Za-z]{1,2})?$/.test(tok)) out.tags.push({ tag: lower.slice(1), kind: "cashtag" });
    else if (tok) rest.push(tok);
  }
  out.terms = rest.join(" ");
  return out;
}

interface SearchPostsQuery {
  q?: string;
  mode?: string;
  cursor?: string;
  limit?: string;
  from?: string;
  since?: string;
  lang?: string;
  minLikes?: string;
  minReplies?: string;
  minReposts?: string;
  near?: string;
  replies?: string;
  muted?: string;
}

const count = (v: string | undefined, name: string) => {
  if (v === undefined || v === "") return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw badRequest(`Invalid ${name}`);
  return n;
};

/** The Filters panel's options (see SearchFilters in @projectfeed/shared). */
export function parseFilters(qs: SearchPostsQuery) {
  if (qs.from !== undefined && qs.from !== "anyone" && qs.from !== "following") throw badRequest("Invalid from");
  const since = SEARCH_SINCE.find((s) => s.key === (qs.since ?? "all"));
  if (!since) throw badRequest("Invalid since");
  if (qs.lang !== undefined && !isLanguageCode(qs.lang)) throw badRequest("Invalid lang");
  let near: { lat: number; lng: number } | null = null;
  if (qs.near !== undefined) {
    const [lat, lng] = qs.near.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat!) > 90 || Math.abs(lng!) > 180) throw badRequest("Invalid near");
    near = { lat: lat!, lng: lng! };
  }
  if (qs.replies !== undefined && qs.replies !== "include" && qs.replies !== "exclude") throw badRequest("Invalid replies");
  if (qs.muted !== undefined && qs.muted !== "hide" && qs.muted !== "show") throw badRequest("Invalid muted");
  return {
    following: qs.from === "following",
    sinceHours: since.hours,
    lang: qs.lang ?? null,
    minLikes: count(qs.minLikes, "minLikes"),
    minReplies: count(qs.minReplies, "minReplies"),
    minReposts: count(qs.minReposts, "minReposts"),
    near,
    excludeReplies: qs.replies === "exclude",
    hideMuted: qs.muted !== "show",
  };
}

/** Most recent matches ranked for "Top" search. */
const TOP_CANDIDATES = 1000;

const searchRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage } = app.ctx;
  const hctx = { db: sql, storage };

  app.get<{ Querystring: { q?: string; limit?: string } }>("/search/users", async (req) => {
    const q = (req.query.q ?? "").trim().replace(/^@/, "");
    if (!q) return { items: [], nextCursor: null };
    const limit = pageSize(req.query.limit, 20, 50);
    const viewer = req.user?.id ?? "0";
    const rows = await sql<{ id: string }[]>`
      SELECT u.id FROM users u
      WHERE u.status = 'active'
        AND (u.handle ILIKE ${q + "%"} OR u.display_name ILIKE ${"%" + q + "%"} OR u.company ILIKE ${"%" + q + "%"}
             OR similarity(u.display_name, ${q}) > 0.3)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = ${viewer})
      ORDER BY (lower(u.handle::text) = lower(${q})) DESC,
               EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${viewer} AND f.followee_id = u.id) DESC,
               u.followers_count DESC
      LIMIT ${limit}`;
    return { items: await orderedSummaries(hctx, rows.map((r) => r.id)), nextCursor: null };
  });

  app.get<{ Querystring: { q?: string } }>("/search/typeahead", async (req) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return { users: [], tags: [] };
    const bare = q.replace(/^[@#$]/, "");
    const users = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE status = 'active' AND (handle ILIKE ${bare + "%"} OR display_name ILIKE ${bare + "%"})
      ORDER BY followers_count DESC LIMIT 6`;
    const tags = await sql<{ tag: string; kind: string; n: number }[]>`
      SELECT tag::text, kind, count(*)::int AS n FROM post_tags
      WHERE tag ILIKE ${bare + "%"} AND created_at > now() - interval '30 days'
      GROUP BY tag, kind ORDER BY n DESC LIMIT 4`;
    return {
      users: await orderedSummaries(hctx, users.map((u) => u.id)),
      tags: tags.map((t) => ({ tag: t.tag, kind: t.kind, postCount: t.n })),
    };
  });

  app.get<{ Querystring: SearchPostsQuery }>("/search/posts", async (req) => {
    const raw = (req.query.q ?? "").trim();
    if (!raw) return { items: [], nextCursor: null };
    if (raw.length > 200) throw badRequest("Query too long");
    const mode = req.query.mode ?? "top";
    if (!["top", "latest", "media", "videos", "photos"].includes(mode)) throw badRequest("Invalid mode");
    const q = parseQuery(raw);
    if (mode === "media") q.mediaOnly = true;
    const limit = pageSize(req.query.limit);
    const viewer = req.user?.id ?? null;
    const f = parseFilters(req.query);
    if (f.following && !viewer) throw badRequest("Sign in to search people you follow");

    const conditions = [sql`p.deleted_at IS NULL`, sql`p.removed_at IS NULL`, sql`NOT p.limited`, sql`u.status = 'active'`];
    if (q.terms) conditions.push(sql`p.search @@ websearch_to_tsquery('simple', ${q.terms})`);
    if (q.from) conditions.push(sql`u.handle = ${q.from}`);
    if (q.mediaOnly) conditions.push(sql`EXISTS (SELECT 1 FROM post_media pm WHERE pm.post_id = p.id)`);
    if (mode === "videos") conditions.push(sql`EXISTS (SELECT 1 FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id AND m.type = 'video')`);
    if (mode === "photos") conditions.push(sql`EXISTS (SELECT 1 FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id AND m.type = 'image')`);
    const minLikes = Math.max(q.minLikes, f.minLikes);
    if (minLikes > 0) conditions.push(sql`p.like_count >= ${minLikes}`);
    if (f.minReplies > 0) conditions.push(sql`p.reply_count >= ${f.minReplies}`);
    if (f.minReposts > 0) conditions.push(sql`p.repost_count >= ${f.minReposts}`);
    if (f.following) conditions.push(sql`(p.author_id = ${viewer} OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewer}))`);
    if (f.sinceHours) conditions.push(sql`p.id > ${idAtTime(new Date(Date.now() - f.sinceHours * 3600_000))}`);
    if (f.lang) conditions.push(sql`p.lang = ${f.lang}`);
    if (f.excludeReplies) conditions.push(sql`p.reply_to_id IS NULL`);
    if (f.near) {
      // Only posts tagged with a place (notes and reviews) have a location; a box of ±NEAR_RADIUS_KM is close enough.
      const dLat = NEAR_RADIUS_KM / 111.32;
      const dLng = NEAR_RADIUS_KM / (111.32 * Math.max(0.1, Math.cos((f.near.lat * Math.PI) / 180)));
      conditions.push(sql`EXISTS (SELECT 1 FROM places pl WHERE pl.id = p.place_id
        AND pl.lat BETWEEN ${f.near.lat - dLat} AND ${f.near.lat + dLat} AND pl.lng BETWEEN ${f.near.lng - dLng} AND ${f.near.lng + dLng})`);
    }
    for (const t of q.tags) {
      conditions.push(sql`EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ${t.tag} AND pt.kind = ${t.kind})`);
    }
    if (!q.terms && !q.from && q.tags.length === 0) return { items: [], nextCursor: null };
    const where = conditions.reduce((acc, c) => sql`${acc} AND ${c}`);

    let ids: string[];
    let nextCursor: string | null;
    if (mode === "top") {
      const offset = Number(req.query.cursor ?? 0);
      if (!Number.isInteger(offset) || offset < 0) throw badRequest("Invalid cursor");
      // Top: engagement with a recency decay (days), restricted to the last 30 days. Ranks the most recent
      // TOP_CANDIDATES matches rather than every match: a common word can match hundreds of thousands of posts,
      // and scoring them all took ~230 ms at 400k posts (≈10 ms bounded).
      const rows = await sql<{ id: string }[]>`
        SELECT c.id FROM (
          SELECT p.id, p.like_count, p.repost_count, p.reply_count, p.created_at
          FROM posts p JOIN users u ON u.id = p.author_id
          WHERE ${where} AND p.id > ${idAtTime(new Date(Date.now() - 30 * 86400_000))}
          ORDER BY p.id DESC LIMIT ${TOP_CANDIDATES}
        ) c
        ORDER BY ln(2 + c.like_count + 2 * c.repost_count + 3 * c.reply_count)
                 / (1 + extract(epoch FROM now() - c.created_at)::float8 / 86400) DESC, c.id DESC
        OFFSET ${offset} LIMIT ${limit}`;
      ids = rows.map((r) => r.id);
      nextCursor = rows.length === limit ? String(offset + limit) : null;
    } else {
      const rows = await sql<{ id: string }[]>`
        SELECT p.id FROM posts p JOIN users u ON u.id = p.author_id
        WHERE ${where} AND p.id < ${idCursor(req.query.cursor)}
        ORDER BY p.id DESC LIMIT ${limit}`;
      ids = rows.map((r) => r.id);
      nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    }

    let posts = await visiblePosts(hctx, viewer, ids);
    if (viewer) {
      // Blocked accounts are already unavailable after hydration; muted ones can be shown on request.
      const vf = await loadViewerFilters(sql, viewer);
      posts = posts.filter((p) => (!f.hideMuted || !vf.mutedUsers.has(p.author.id)) && !containsMutedWord(p.text, vf.mutedWords));
    }
    const items: FeedItem[] = posts.map((post) => ({ post, repostedBy: null, reason: null }));
    return { items, nextCursor };
  });

  /**
   * Trends: tags whose last-24h volume is well above their 7-day hourly baseline,
   * counted by distinct authors so one account cannot manufacture a trend.
   */
  // Trends are the same for everyone, so they are computed at most once a minute per server.
  let trendsCache: { at: number; value: { items: Trend[] } } | null = null;
  app.get<{ Querystring: { sector?: string } }>("/trends", async (): Promise<{ items: Trend[] }> => {
    if (trendsCache && Date.now() - trendsCache.at < sharedCacheMs()) return trendsCache.value;
    const rows = await sql<{ tag: string; kind: "hashtag" | "cashtag"; authors: number; posts: number; baseline: number }[]>`
      WITH recent AS (
        SELECT pt.tag, pt.kind, count(DISTINCT pt.author_id)::int AS authors, count(*)::int AS posts
        FROM post_tags pt JOIN posts p ON p.id = pt.post_id AND NOT p.limited AND p.removed_at IS NULL
        WHERE pt.created_at > now() - interval '24 hours' GROUP BY pt.tag, pt.kind
      ),
      base AS (
        SELECT tag, kind, count(DISTINCT author_id)::float / 7 AS baseline
        FROM post_tags WHERE created_at BETWEEN now() - interval '8 days' AND now() - interval '24 hours'
        GROUP BY tag, kind
      )
      SELECT r.tag::text, r.kind, r.authors, r.posts, coalesce(b.baseline, 0) AS baseline
      FROM recent r LEFT JOIN base b USING (tag, kind)
      WHERE r.authors >= 2
      ORDER BY r.authors / (1 + coalesce(b.baseline, 0)) DESC, r.posts DESC
      LIMIT 20`;
    const value = {
      items: rows.map((r) => ({
        tag: r.tag,
        kind: r.kind,
        postCount: r.posts,
        context: r.authors > 3 * (r.baseline + 1) ? "Trending now" : "Trending",
      })),
    };
    trendsCache = { at: Date.now(), value };
    return value;
  });
};

export default searchRoutes;
