import type { FastifyPluginAsync } from "fastify";
import type { NotificationItem, NotificationType, Page } from "@projectfeed/shared";
import { requireUser } from "../lib/auth";
import { hydratePosts, userSummaries } from "../services/hydrate";
import { idCursor, pageSize } from "../services/timeline";

const GROUPABLE = new Set<NotificationType>(["like", "repost", "follow"]);
const MENTION_TYPES = ["mention", "reply", "quote"];

interface Row {
  id: string;
  type: NotificationType;
  actor_id: string;
  post_id: string | null;
  created_at: Date;
  read_at: Date | null;
}

const notificationRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage } = app.ctx;
  const hctx = { db: sql, storage };

  app.get<{ Querystring: { tab?: string; cursor?: string; limit?: string } }>("/notifications", async (req): Promise<Page<NotificationItem>> => {
    const me = requireUser(req);
    const limit = pageSize(req.query.limit, 40, 100);
    const tab = req.query.tab ?? "all";
    const rows = await sql<Row[]>`
      SELECT n.id, n.type, n.actor_id, n.post_id, n.created_at, n.read_at
      FROM notifications n JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = ${me.id} AND n.id < ${idCursor(req.query.cursor)} AND a.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = ${me.id} AND m.muted_id = n.actor_id)
        ${tab === "mentions" ? sql`AND n.type = ANY(${MENTION_TYPES})` : sql``}
        ${tab === "verified" ? sql`AND a.kyc_level >= 1` : sql``}
      ORDER BY n.id DESC LIMIT ${limit}`;

    // Group likes/reposts on the same post (and follows) within this page: "@a and 12 others liked your post".
    const groups: { key: string; rows: Row[] }[] = [];
    const byKey = new Map<string, { key: string; rows: Row[] }>();
    for (const r of rows) {
      const key = GROUPABLE.has(r.type) ? `${r.type}:${r.post_id ?? ""}` : `single:${r.id}`;
      let g = byKey.get(key);
      if (!g) {
        g = { key, rows: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.rows.push(r);
    }

    const actorIds = groups.flatMap((g) => g.rows.slice(0, 3).map((r) => r.actor_id));
    const [actors, posts] = await Promise.all([
      userSummaries(hctx, actorIds),
      hydratePosts(hctx, me.id, rows.map((r) => r.post_id).filter((p): p is string => !!p)),
    ]);

    const items: NotificationItem[] = [];
    for (const g of groups) {
      const first = g.rows[0]!;
      const post = first.post_id ? (posts.get(first.post_id) ?? null) : null;
      if (first.post_id && (!post || post.unavailable)) continue;
      items.push({
        id: first.id,
        type: first.type,
        actors: g.rows.slice(0, 3).map((r) => actors.get(r.actor_id)).filter((a) => !!a) as NotificationItem["actors"],
        actorCount: new Set(g.rows.map((r) => r.actor_id)).size,
        post,
        createdAt: first.created_at.toISOString(),
        read: g.rows.every((r) => r.read_at !== null),
      });
    }
    return { items, nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null };
  });

  app.get("/notifications/unread-count", async (req) => {
    const me = requireUser(req);
    const [r] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM notifications WHERE user_id = ${me.id} AND read_at IS NULL`;
    const [d] = await sql<{ n: number }[]>`
      SELECT count(DISTINCT cm.conversation_id)::int AS n
      FROM conversation_members cm JOIN messages m ON m.conversation_id = cm.conversation_id
      WHERE cm.user_id = ${me.id} AND cm.status = 'accepted' AND m.id > cm.last_read_id
        AND m.sender_id <> ${me.id} AND m.deleted_at IS NULL`;
    return { notifications: r!.n, messages: d!.n };
  });

  app.post("/notifications/read", async (req) => {
    const me = requireUser(req);
    await sql`UPDATE notifications SET read_at = now() WHERE user_id = ${me.id} AND read_at IS NULL`;
    return { ok: true };
  });
};

export default notificationRoutes;
