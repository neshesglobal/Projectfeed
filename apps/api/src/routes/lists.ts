import type { FastifyPluginAsync } from "fastify";
import { createListSchema, type UserList } from "@projectfeed/shared";
import type postgres from "postgres";
import type { Db } from "../db";
import { requireUser } from "../lib/auth";
import { badRequest, notFound, parse } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { orderedSummaries, userSummaries } from "../services/hydrate";
import { hydrateActivity, idCursor, loadViewerFilters, pageSize } from "../services/timeline";

const MAX_PINNED = 5;
const MAX_MEMBERS = 5000;

interface ListRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  is_private: boolean;
  member_count: number;
  follower_count: number;
  viewer_following: boolean;
  viewer_pinned: boolean;
}

async function loadLists(db: Db, viewerId: string, where: postgres.Fragment): Promise<ListRow[]> {
  return db<ListRow[]>`
    SELECT l.id, l.owner_id, l.name, l.description, l.is_private,
      (SELECT count(*)::int FROM list_members WHERE list_id = l.id) AS member_count,
      (SELECT count(*)::int FROM list_follows WHERE list_id = l.id) AS follower_count,
      EXISTS (SELECT 1 FROM list_follows WHERE list_id = l.id AND user_id = ${viewerId}) AS viewer_following,
      coalesce((SELECT pinned FROM list_follows WHERE list_id = l.id AND user_id = ${viewerId}), false) AS viewer_pinned
    FROM lists l
    WHERE ${where} AND (NOT l.is_private OR l.owner_id = ${viewerId})
    ORDER BY l.id DESC`;
}

const listRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified } = app.ctx;
  const hctx = { db: sql, storage };

  async function toLists(viewerId: string, rows: ListRow[]): Promise<UserList[]> {
    const owners = await userSummaries(hctx, rows.map((r) => r.owner_id));
    return rows
      .filter((r) => owners.has(r.owner_id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isPrivate: r.is_private,
        owner: owners.get(r.owner_id)!,
        memberCount: r.member_count,
        followerCount: r.follower_count,
        viewerFollowing: r.viewer_following,
        viewerPinned: r.viewer_pinned,
      }));
  }

  async function ownedList(listId: string, userId: string) {
    if (!isId(listId)) throw notFound("List");
    const [l] = await sql`SELECT 1 FROM lists WHERE id = ${listId} AND owner_id = ${userId}`;
    if (!l) throw notFound("List");
  }

  async function visibleList(viewerId: string, listId: string): Promise<UserList> {
    if (!isId(listId)) throw notFound("List");
    const [list] = await toLists(viewerId, await loadLists(sql, viewerId, sql`l.id = ${listId}`));
    if (!list) throw notFound("List");
    return list;
  }

  /** Lists the viewer owns or follows; pinned ones become swipeable Home tabs. */
  app.get("/me/lists", async (req) => {
    const me = requireUser(req);
    const rows = await loadLists(
      sql,
      me.id,
      sql`(l.owner_id = ${me.id} OR EXISTS (SELECT 1 FROM list_follows lf WHERE lf.list_id = l.id AND lf.user_id = ${me.id}))`,
    );
    return { items: await toLists(me.id, rows), nextCursor: null };
  });

  app.post("/lists", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(createListSchema, req.body);
    const id = newId();
    await sql.begin(async (tx) => {
      await tx`INSERT INTO lists (id, owner_id, name, description, is_private)
               VALUES (${id}, ${me.id}, ${input.name}, ${input.description ?? ""}, ${input.isPrivate})`;
      // Owners implicitly follow their own lists so they can pin them.
      await tx`INSERT INTO list_follows (list_id, user_id) VALUES (${id}, ${me.id})`;
    });
    reply.status(201);
    return visibleList(me.id, id);
  });

  app.get<{ Params: { id: string } }>("/lists/:id", async (req) => visibleList(requireUser(req).id, req.params.id));

  app.patch<{ Params: { id: string } }>("/lists/:id", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await ownedList(req.params.id, me.id);
    const input = parse(createListSchema.partial(), req.body);
    await sql`UPDATE lists SET name = coalesce(${input.name ?? null}, name),
                               description = coalesce(${input.description ?? null}, description),
                               is_private = coalesce(${input.isPrivate ?? null}, is_private)
              WHERE id = ${req.params.id}`;
    return visibleList(me.id, req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/lists/:id", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    await ownedList(req.params.id, me.id);
    await sql`DELETE FROM lists WHERE id = ${req.params.id}`;
    reply.status(204);
  });

  app.get<{ Params: { id: string } }>("/lists/:id/members", async (req) => {
    const me = requireUser(req);
    const list = await visibleList(me.id, req.params.id);
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM list_members WHERE list_id = ${list.id} ORDER BY added_at DESC LIMIT 500`;
    return { items: await orderedSummaries(hctx, rows.map((r) => r.user_id)), nextCursor: null };
  });

  app.put<{ Params: { id: string; userId: string } }>("/lists/:id/members/:userId", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await ownedList(req.params.id, me.id);
    const { userId } = req.params;
    const [u] = await sql`
      SELECT 1 FROM users u WHERE u.id = ${userId} AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ${me.id})
                                                OR (b.blocker_id = ${me.id} AND b.blocked_id = u.id))`;
    if (!u) throw notFound("User");
    const n = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM list_members WHERE list_id = ${req.params.id}`)[0]!.n;
    if (n >= MAX_MEMBERS) throw badRequest("List is full");
    await sql`INSERT INTO list_members (list_id, user_id) VALUES (${req.params.id}, ${userId}) ON CONFLICT DO NOTHING`;
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>("/lists/:id/members/:userId", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await ownedList(req.params.id, me.id);
    await sql`DELETE FROM list_members WHERE list_id = ${req.params.id} AND user_id = ${req.params.userId}`;
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/lists/:id/follow", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const list = await visibleList(me.id, req.params.id);
    await sql`INSERT INTO list_follows (list_id, user_id) VALUES (${list.id}, ${me.id}) ON CONFLICT DO NOTHING`;
    return { following: true };
  });

  app.delete<{ Params: { id: string } }>("/lists/:id/follow", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await sql`DELETE FROM list_follows WHERE list_id = ${req.params.id} AND user_id = ${me.id}`;
    return { following: false };
  });

  app.put<{ Params: { id: string } }>("/lists/:id/pin", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const pinned = Boolean((req.body as { pinned?: boolean } | undefined)?.pinned);
    const list = await visibleList(me.id, req.params.id);
    if (pinned) {
      const n = (await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM list_follows WHERE user_id = ${me.id} AND pinned AND list_id <> ${list.id}`)[0]!.n;
      if (n >= MAX_PINNED) throw badRequest(`You can pin up to ${MAX_PINNED} lists`);
    }
    await sql`
      INSERT INTO list_follows (list_id, user_id, pinned) VALUES (${list.id}, ${me.id}, ${pinned})
      ON CONFLICT (list_id, user_id) DO UPDATE SET pinned = excluded.pinned`;
    return { pinned };
  });

  /** List timeline: chronological posts and reposts from list members. */
  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/lists/:id/timeline", async (req) => {
    const me = requireUser(req);
    const list = await visibleList(me.id, req.params.id);
    const limit = pageSize(req.query.limit);
    const cursor = idCursor(req.query.cursor);
    const rows = await sql<{ sort_id: string; post_id: string; reposter_id: string | null }[]>`
      SELECT * FROM (
        SELECT p.id AS sort_id, p.id AS post_id, NULL::bigint AS reposter_id FROM posts p
        WHERE p.author_id IN (SELECT user_id FROM list_members WHERE list_id = ${list.id})
          AND p.reply_to_id IS NULL AND p.deleted_at IS NULL AND p.id < ${cursor}
        UNION ALL
        SELECT r.id, r.post_id, r.user_id FROM reposts r JOIN posts p ON p.id = r.post_id
        WHERE r.user_id IN (SELECT user_id FROM list_members WHERE list_id = ${list.id})
          AND p.deleted_at IS NULL AND r.id < ${cursor}
      ) t ORDER BY sort_id DESC LIMIT ${limit}`;
    return hydrateActivity(hctx, me.id, rows, limit, await loadViewerFilters(sql, me.id));
  });
};

export default listRoutes;
