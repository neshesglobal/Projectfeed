import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { FeedItem, Page } from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { badRequest } from "../lib/errors";
import { rankForYou, type RankedItem } from "../feed/mixer";
import { rankReels } from "../feed/reels";
import { isId } from "../lib/ids";
import { hydratePosts, orderedSummaries } from "../services/hydrate";
import { followingTimeline, idCursor, loadViewerFilters, pageSize } from "../services/timeline";

/**
 * A ranked feed is computed once and paged from a snapshot, so scrolling never shows duplicates
 * even as scores change. In-process for now; move to Redis when running more than one API instance.
 */
class FeedSessions {
  private map = new Map<string, { userId: string; items: RankedItem[]; at: number }>();
  constructor(
    private ttlMs = 30 * 60_000,
    private max = 5000,
  ) {}
  create(userId: string, items: RankedItem[]): string {
    const key = crypto.randomBytes(9).toString("base64url");
    this.map.set(key, { userId, items, at: Date.now() });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
    return key;
  }
  get(key: string, userId: string): RankedItem[] | null {
    const s = this.map.get(key);
    if (!s || s.userId !== userId || Date.now() - s.at > this.ttlMs) return null;
    return s.items;
  }
}

const SUGGESTION_SLOT = 5;

const feedRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage } = app.ctx;
  const hctx = { db: sql, storage };
  const sessions = new FeedSessions();

  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/feed/following", async (req) => {
    const me = requireUser(req);
    return followingTimeline(hctx, me.id, idCursor(req.query.cursor), pageSize(req.query.limit));
  });

  app.get<{ Querystring: { cursor?: string; limit?: string } }>(
    "/feed/for-you",
    async (req): Promise<Page<FeedItem> & { suggestions?: unknown }> => {
      const me = requireUser(req);
      const limit = pageSize(req.query.limit);
      let key: string;
      let offset = 0;
      let ranked: RankedItem[] | null = null;
      if (req.query.cursor) {
        const [k, o] = req.query.cursor.split(":");
        offset = Number(o);
        if (!k || !Number.isInteger(offset) || offset < 0) throw badRequest("Invalid cursor");
        key = k;
        ranked = sessions.get(k, me.id);
        if (!ranked) return { items: [], nextCursor: null }; // expired: client refreshes from the top
      } else {
        ranked = await rankForYou(sql, me.id, await loadViewerFilters(sql, me.id));
        key = sessions.create(me.id, ranked);
      }
      const slice = ranked.slice(offset, offset + limit);
      const posts = await hydratePosts(hctx, me.id, slice.map((r) => r.postId));
      const items: FeedItem[] = slice
        .map((r) => {
          const post = posts.get(r.postId);
          return post && !post.unavailable ? ({ post, repostedBy: null, reason: r.reason } as FeedItem) : null;
        })
        .filter((x): x is FeedItem => x !== null);
      const nextOffset = offset + limit;
      const page: Page<FeedItem> & { suggestions?: unknown } = {
        items,
        nextCursor: nextOffset < ranked.length ? `${key}:${nextOffset}` : null,
      };
      // "Who to follow" module blended into the first page, as X does.
      if (offset === 0 && items.length > SUGGESTION_SLOT) {
        const rows = await sql<{ id: string }[]>`
          SELECT u.id FROM users u
          WHERE u.status = 'active' AND u.id <> ${me.id}
            AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ${me.id})
            AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ${me.id}
                             UNION SELECT blocker_id FROM blocks WHERE blocked_id = ${me.id})
          ORDER BY u.followers_count DESC LIMIT 3`;
        page.suggestions = { position: SUGGESTION_SLOT, users: await orderedSummaries(hctx, rows.map((r) => r.id)) };
      }
      return page;
    },
  );

  /**
   * Reels: ranked video posts for the full-screen vertical player. `startId` pins the reel the user
   * tapped in a timeline to the front, followed by the ranked feed.
   */
  app.get<{ Querystring: { cursor?: string; limit?: string; startId?: string } }>("/feed/reels", async (req): Promise<Page<FeedItem>> => {
    const me = requireUser(req);
    const limit = pageSize(req.query.limit, 10, 30);
    let key: string;
    let offset = 0;
    let ranked: RankedItem[] | null;
    if (req.query.cursor) {
      const [k, o] = req.query.cursor.split(":");
      offset = Number(o);
      if (!k || !Number.isInteger(offset) || offset < 0) throw badRequest("Invalid cursor");
      key = k;
      ranked = sessions.get(k, me.id);
      if (!ranked) return { items: [], nextCursor: null };
    } else {
      const ids = await rankReels(sql, me.id, await loadViewerFilters(sql, me.id));
      const start = req.query.startId && isId(req.query.startId) ? req.query.startId : null;
      const ordered = start ? [start, ...ids.filter((id) => id !== start)] : ids;
      ranked = ordered.map((postId) => ({ postId, reason: null }));
      key = sessions.create(me.id, ranked);
    }
    const slice = ranked.slice(offset, offset + limit);
    const posts = await hydratePosts(hctx, me.id, slice.map((r) => r.postId));
    const items: FeedItem[] = [];
    for (const r of slice) {
      const post = posts.get(r.postId);
      // The pinned start post may be any video post (e.g. a reply); still require that it is visible and has video.
      if (post && !post.unavailable && post.media.some((m) => m.type === "video")) items.push({ post, repostedBy: null, reason: null });
    }
    return { items, nextCursor: offset + limit < ranked.length ? `${key}:${offset + limit}` : null };
  });
};

export default feedRoutes;
