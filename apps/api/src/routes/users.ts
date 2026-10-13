import type { FastifyPluginAsync } from "fastify";
import { updateProfileSchema, type Page, type UserSummary } from "@projectfeed/shared";
import type { Db } from "../db";
import { refreshTrust } from "../services/trust";
import { requireUser } from "../lib/auth";
import { badRequest, forbidden, notFound, parse } from "../lib/errors";
import { isId } from "../lib/ids";
import { orderedSummaries, userProfile } from "../services/hydrate";
import { notify, unnotify } from "../services/notify";
import { idCursor, pageSize, profileTimeline, type ProfileTab } from "../services/timeline";

async function userIdByHandle(db: Db, handle: string): Promise<string> {
  const [u] = await db<{ id: string }[]>`SELECT id FROM users WHERE handle = ${handle.replace(/^@/, "")} AND status = 'active'`;
  if (!u) throw notFound("User");
  return u.id;
}

async function assertUser(db: Db, id: string): Promise<void> {
  if (!isId(id)) throw notFound("User");
  const [u] = await db`SELECT 1 FROM users WHERE id = ${id} AND status = 'active'`;
  if (!u) throw notFound("User");
}

/** Can the viewer see this user's posts? (public, self, or an approved follower) */
export async function canViewPostsOf(db: Db, viewerId: string | null, userId: string): Promise<boolean> {
  const [r] = await db<{ ok: boolean }[]>`
    SELECT (NOT u.is_protected OR u.id = ${viewerId ?? "0"}
            OR EXISTS (SELECT 1 FROM follows WHERE follower_id = ${viewerId ?? "0"} AND followee_id = u.id))
       AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = u.id AND blocked_id = ${viewerId ?? "0"})
                                               OR (blocker_id = ${viewerId ?? "0"} AND blocked_id = u.id)) AS ok
    FROM users u WHERE u.id = ${userId}`;
  return !!r?.ok;
}

export async function follow(db: Db, followerId: string, followeeId: string): Promise<boolean> {
  const inserted = await db`
    INSERT INTO follows (follower_id, followee_id) VALUES (${followerId}, ${followeeId})
    ON CONFLICT DO NOTHING RETURNING 1`;
  if (inserted.count === 0) return false;
  await db`UPDATE users SET following_count = following_count + 1 WHERE id = ${followerId}`;
  await db`UPDATE users SET followers_count = followers_count + 1 WHERE id = ${followeeId}`;
  return true;
}

export async function unfollow(db: Db, followerId: string, followeeId: string): Promise<boolean> {
  const deleted = await db`DELETE FROM follows WHERE follower_id = ${followerId} AND followee_id = ${followeeId} RETURNING 1`;
  if (deleted.count === 0) return false;
  await db`UPDATE users SET following_count = greatest(following_count - 1, 0) WHERE id = ${followerId}`;
  await db`UPDATE users SET followers_count = greatest(followers_count - 1, 0) WHERE id = ${followeeId}`;
  return true;
}

const userRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified } = app.ctx;
  const hctx = { db: sql, storage };
  const MICROS = () => sql`(extract(epoch FROM created_at) * 1000000)::bigint`;

  // ───────────── Own account ─────────────
  app.get("/me", async (req) => {
    const me = requireUser(req);
    return userProfile(hctx, me.id, me.id);
  });

  app.patch("/me", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const input = parse(updateProfileSchema, req.body);
    for (const key of ["avatarMediaId", "bannerMediaId"] as const) {
      const mid = input[key];
      if (mid) {
        const [m] = await sql`SELECT 1 FROM media WHERE id = ${mid} AND owner_id = ${me.id} AND type = 'image'`;
        if (!m) throw badRequest(`Unknown ${key}`);
      }
    }
    const wasProtected = (await sql<{ p: boolean }[]>`SELECT is_protected AS p FROM users WHERE id = ${me.id}`)[0]!.p;
    await sql`
      UPDATE users SET
        display_name    = coalesce(${input.displayName ?? null}, display_name),
        bio             = coalesce(${input.bio ?? null}, bio),
        location        = coalesce(${input.location ?? null}, location),
        website         = coalesce(${input.website ?? null}, website),
        company         = coalesce(${input.company ?? null}, company),
        role            = coalesce(${input.role ?? null}, role),
        sectors         = coalesce(${input.sectors ?? null}::text[], sectors),
        avatar_media_id = ${input.avatarMediaId === undefined ? sql`avatar_media_id` : input.avatarMediaId},
        banner_media_id = ${input.bannerMediaId === undefined ? sql`banner_media_id` : input.bannerMediaId},
        is_protected    = coalesce(${input.isProtected ?? null}, is_protected)
      WHERE id = ${me.id}`;
    // Going public approves everyone who was waiting.
    if (wasProtected && input.isProtected === false) {
      await sql.begin(async (tx) => {
        const reqs = await tx<{ requester_id: string }[]>`DELETE FROM follow_requests WHERE target_id = ${me.id} RETURNING requester_id`;
        for (const r of reqs) await follow(tx, r.requester_id, me.id);
      });
    }
    return userProfile(hctx, me.id, me.id);
  });

  app.put("/me/pinned-post", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const { postId } = (req.body ?? {}) as { postId?: string | null };
    if (postId) {
      const [p] = await sql`SELECT 1 FROM posts WHERE id = ${postId} AND author_id = ${me.id} AND deleted_at IS NULL`;
      if (!p) throw notFound("Post");
    }
    await sql`UPDATE users SET pinned_post_id = ${postId ?? null} WHERE id = ${me.id}`;
    return { pinnedPostId: postId ?? null };
  });

  // ───────────── Profiles ─────────────
  app.get<{ Params: { handle: string } }>("/users/by-handle/:handle", async (req) => {
    const id = await userIdByHandle(sql, req.params.handle);
    return userProfile(hctx, req.user?.id ?? null, id);
  });

  app.get<{ Params: { id: string } }>("/users/:id", async (req) => {
    await assertUser(sql, req.params.id);
    return userProfile(hctx, req.user?.id ?? null, req.params.id);
  });

  app.get<{ Params: { id: string }; Querystring: { tab?: string; cursor?: string; limit?: string } }>(
    "/users/:id/posts",
    async (req) => {
      const { id } = req.params;
      await assertUser(sql, id);
      const viewer = req.user?.id ?? null;
      const tab = (req.query.tab ?? "posts") as ProfileTab;
      if (!["posts", "replies", "media", "likes"].includes(tab)) throw badRequest("Invalid tab");
      if (tab === "likes" && viewer !== id) throw forbidden("Likes are private", "LIKES_PRIVATE");
      if (!(await canViewPostsOf(sql, viewer, id))) throw forbidden("These posts are protected", "PROTECTED");
      return profileTimeline(hctx, viewer, id, tab, idCursor(req.query.cursor), pageSize(req.query.limit));
    },
  );

  async function graphPage(
    viewerId: string | null,
    userId: string,
    direction: "followers" | "following",
    cursorRaw: string | undefined,
    limit: number,
  ): Promise<Page<UserSummary>> {
    if (!(await canViewPostsOf(sql, viewerId, userId))) throw forbidden("This account is protected", "PROTECTED");
    const cursor = idCursor(cursorRaw); // epoch microseconds of the follow
    const rows =
      direction === "followers"
        ? await sql<{ id: string; ts: string }[]>`
            SELECT follower_id AS id, ${MICROS()} AS ts FROM follows
            WHERE followee_id = ${userId} AND ${MICROS()} < ${cursor}::bigint ORDER BY created_at DESC LIMIT ${limit}`
        : await sql<{ id: string; ts: string }[]>`
            SELECT followee_id AS id, ${MICROS()} AS ts FROM follows
            WHERE follower_id = ${userId} AND ${MICROS()} < ${cursor}::bigint ORDER BY created_at DESC LIMIT ${limit}`;
    return {
      items: await orderedSummaries(hctx, rows.map((r) => r.id)),
      nextCursor: rows.length === limit ? rows[rows.length - 1]!.ts : null,
    };
  }

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/users/:id/followers", async (req) => {
    await assertUser(sql, req.params.id);
    return graphPage(req.user?.id ?? null, req.params.id, "followers", req.query.cursor, pageSize(req.query.limit, 30, 100));
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/users/:id/following", async (req) => {
    await assertUser(sql, req.params.id);
    return graphPage(req.user?.id ?? null, req.params.id, "following", req.query.cursor, pageSize(req.query.limit, 30, 100));
  });

  // ───────────── Follow graph ─────────────
  app.post<{ Params: { id: string } }>("/users/:id/follow", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const target = req.params.id;
    if (target === me.id) throw badRequest("You cannot follow yourself");
    await assertUser(sql, target);
    return sql.begin(async (tx) => {
      const [b] = await tx`
        SELECT 1 FROM blocks WHERE (blocker_id = ${me.id} AND blocked_id = ${target})
                                OR (blocker_id = ${target} AND blocked_id = ${me.id})`;
      if (b) throw forbidden("You cannot follow this account", "BLOCKED");
      const [t] = await tx<{ is_protected: boolean }[]>`SELECT is_protected FROM users WHERE id = ${target}`;
      const [already] = await tx`SELECT 1 FROM follows WHERE follower_id = ${me.id} AND followee_id = ${target}`;
      if (already) return { state: "following" as const };
      if (t!.is_protected) {
        await tx`INSERT INTO follow_requests (requester_id, target_id) VALUES (${me.id}, ${target}) ON CONFLICT DO NOTHING`;
        await notify(tx, { recipientId: target, actorId: me.id, type: "follow_request" });
        return { state: "requested" as const };
      }
      if (await follow(tx, me.id, target)) await notify(tx, { recipientId: target, actorId: me.id, type: "follow" });
      return { state: "following" as const };
    });
  });

  app.delete<{ Params: { id: string } }>("/users/:id/follow", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const target = req.params.id;
    await sql.begin(async (tx) => {
      await unfollow(tx, me.id, target);
      await tx`DELETE FROM follow_requests WHERE requester_id = ${me.id} AND target_id = ${target}`;
      await unnotify(tx, { recipientId: target, actorId: me.id, type: "follow" });
      await unnotify(tx, { recipientId: target, actorId: me.id, type: "follow_request" });
    });
    return { state: "none" };
  });

  app.delete<{ Params: { id: string } }>("/me/followers/:id", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await sql.begin((tx) => unfollow(tx, req.params.id, me.id));
    return { ok: true };
  });

  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/me/follow-requests", async (req) => {
    const me = requireUser(req);
    const rows = await sql<{ requester_id: string }[]>`
      SELECT requester_id FROM follow_requests WHERE target_id = ${me.id} ORDER BY created_at DESC LIMIT 100`;
    return { items: await orderedSummaries(hctx, rows.map((r) => r.requester_id)), nextCursor: null };
  });

  app.post<{ Params: { id: string; action: string } }>(
    "/me/follow-requests/:id/:action",
    { preHandler: requireVerified },
    async (req) => {
      const me = requireUser(req);
      const { id, action } = req.params;
      if (action !== "accept" && action !== "deny") throw notFound("Action");
      await sql.begin(async (tx) => {
        const del = await tx`DELETE FROM follow_requests WHERE requester_id = ${id} AND target_id = ${me.id} RETURNING 1`;
        if (del.count === 0) throw notFound("Follow request");
        await unnotify(tx, { recipientId: me.id, actorId: id, type: "follow_request" });
        if (action === "accept") await follow(tx, id, me.id);
      });
      return { ok: true };
    },
  );

  // ───────────── Block & mute ─────────────
  app.post<{ Params: { id: string } }>("/users/:id/block", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const target = req.params.id;
    if (target === me.id) throw badRequest("You cannot block yourself");
    await assertUser(sql, target);
    await sql.begin(async (tx) => {
      await tx`INSERT INTO blocks (blocker_id, blocked_id) VALUES (${me.id}, ${target}) ON CONFLICT DO NOTHING`;
      await refreshTrust(tx, target);
      // A block severs the relationship in both directions.
      await unfollow(tx, me.id, target);
      await unfollow(tx, target, me.id);
      await tx`DELETE FROM follow_requests WHERE (requester_id = ${me.id} AND target_id = ${target})
                                              OR (requester_id = ${target} AND target_id = ${me.id})`;
      await tx`DELETE FROM notifications WHERE user_id = ${me.id} AND actor_id = ${target}`;
      await tx`DELETE FROM list_members lm USING lists l
               WHERE lm.list_id = l.id AND l.owner_id = ${me.id} AND lm.user_id = ${target}`;
    });
    return { blocking: true };
  });

  app.delete<{ Params: { id: string } }>("/users/:id/block", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await sql`DELETE FROM blocks WHERE blocker_id = ${me.id} AND blocked_id = ${req.params.id}`;
    return { blocking: false };
  });

  app.post<{ Params: { id: string } }>("/users/:id/mute", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    if (req.params.id === me.id) throw badRequest("You cannot mute yourself");
    await assertUser(sql, req.params.id);
    await sql`INSERT INTO mutes (muter_id, muted_id) VALUES (${me.id}, ${req.params.id}) ON CONFLICT DO NOTHING`;
    return { muting: true };
  });

  app.delete<{ Params: { id: string } }>("/users/:id/mute", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await sql`DELETE FROM mutes WHERE muter_id = ${me.id} AND muted_id = ${req.params.id}`;
    return { muting: false };
  });

  // ───────────── Who to follow (rule-based) ─────────────
  app.get<{ Querystring: { limit?: string } }>("/users/suggestions", async (req) => {
    const me = requireUser(req);
    const limit = pageSize(req.query.limit, 10, 30);
    // Friends-of-friends ranked by mutual count, then same-sector accounts, then popular accounts.
    const rows = await sql<{ id: string }[]>`
      WITH mine AS (SELECT followee_id FROM follows WHERE follower_id = ${me.id}),
      excluded AS (
        SELECT followee_id AS id FROM mine
        UNION SELECT ${me.id}::bigint
        UNION SELECT blocked_id FROM blocks WHERE blocker_id = ${me.id}
        UNION SELECT blocker_id FROM blocks WHERE blocked_id = ${me.id}
        UNION SELECT muted_id FROM mutes WHERE muter_id = ${me.id}
        UNION SELECT target_id FROM follow_requests WHERE requester_id = ${me.id}
      ),
      fof AS (
        SELECT f.followee_id AS id, count(*) * 100 AS score FROM follows f
        WHERE f.follower_id IN (SELECT followee_id FROM mine) GROUP BY f.followee_id
      ),
      sector AS (
        SELECT u.id, 50 AS score FROM users u, users me
        WHERE me.id = ${me.id} AND u.sectors && me.sectors
      ),
      popular AS (SELECT id, least(followers_count, 49) AS score FROM users ORDER BY followers_count DESC LIMIT 200),
      scored AS (
        SELECT id, sum(score) AS score FROM (SELECT * FROM fof UNION ALL SELECT * FROM sector UNION ALL SELECT * FROM popular) s
        GROUP BY id
      )
      SELECT s.id FROM scored s JOIN users u ON u.id = s.id
      WHERE u.status = 'active' AND s.id NOT IN (SELECT id FROM excluded)
      ORDER BY s.score DESC, u.followers_count DESC LIMIT ${limit}`;
    return { items: await orderedSummaries(hctx, rows.map((r) => r.id)), nextCursor: null };
  });
};

export default userRoutes;
