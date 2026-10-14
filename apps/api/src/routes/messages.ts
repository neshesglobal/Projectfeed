import type { FastifyPluginAsync } from "fastify";
import { createConversationSchema, sendMessageSchema, type Conversation, type Message } from "@projectfeed/shared";
import type { Db } from "../db";
import { requireUser } from "../lib/auth";
import { AppError, badRequest, forbidden, notFound, parse } from "../lib/errors";
import { DM_DAILY_LIMIT, band } from "../services/trust";
import { isId, newId } from "../lib/ids";
import { hydratePosts, mediaFor, userSummaries, type HydrateCtx } from "../services/hydrate";
import { idCursor, pageSize } from "../services/timeline";

const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

interface MemberRow {
  status: "accepted" | "request" | "left";
  is_group: boolean;
}

async function membership(db: Db, conversationId: string, userId: string): Promise<MemberRow> {
  if (!isId(conversationId)) throw notFound("Conversation");
  const [m] = await db<MemberRow[]>`
    SELECT cm.status, c.is_group FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.conversation_id = ${conversationId} AND cm.user_id = ${userId}`;
  if (!m || m.status === "left") throw notFound("Conversation");
  return m;
}

/** In a 1:1 chat, a block in either direction stops new messages. */
async function assertNotBlocked(db: Db, conversationId: string, userId: string): Promise<void> {
  const [b] = await db`
    SELECT 1 FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id AND NOT c.is_group
    JOIN blocks b ON (b.blocker_id = cm.user_id AND b.blocked_id = ${userId}) OR (b.blocker_id = ${userId} AND b.blocked_id = cm.user_id)
    WHERE cm.conversation_id = ${conversationId} AND cm.user_id <> ${userId}`;
  if (b) throw forbidden("You can't message this account", "BLOCKED");
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  shared_post_id: string | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_at: Date | null;
}

async function hydrateMessages(ctx: HydrateCtx, viewerId: string, rows: MessageRow[]): Promise<Message[]> {
  const [senders, media, posts] = await Promise.all([
    userSummaries(ctx, rows.map((r) => r.sender_id)),
    mediaFor(ctx, "message_media", rows.filter((r) => !r.deleted_at).map((r) => r.id)),
    hydratePosts(ctx, viewerId, rows.map((r) => r.shared_post_id).filter((p): p is string => !!p)),
  ]);
  return rows
    .filter((r) => senders.has(r.sender_id))
    .map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      sender: senders.get(r.sender_id)!,
      text: r.deleted_at ? "" : r.text,
      media: r.deleted_at ? [] : (media.get(r.id) ?? []),
      sharedPost: !r.deleted_at && r.shared_post_id ? (posts.get(r.shared_post_id) ?? null) : null,
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
      deleted: !!r.deleted_at,
    }));
}

const messageRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified } = app.ctx;
  const hctx: HydrateCtx = { db: sql, storage };

  async function conversations(viewerId: string, ids: string[]): Promise<Conversation[]> {
    if (ids.length === 0) return [];
    const convs = await sql<{ id: string; title: string | null; is_group: boolean; updated_at: Date; status: string; last_read_id: string }[]>`
      SELECT c.id, c.title, c.is_group, c.updated_at, cm.status, cm.last_read_id
      FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ${viewerId}
      WHERE c.id = ANY(${ids}::bigint[])`;
    const members = await sql<{ conversation_id: string; user_id: string }[]>`
      SELECT conversation_id, user_id FROM conversation_members
      WHERE conversation_id = ANY(${ids}::bigint[]) AND status <> 'left' ORDER BY joined_at`;
    const lastRows = await sql<MessageRow[]>`
      SELECT DISTINCT ON (conversation_id) id, conversation_id, sender_id, text, shared_post_id, created_at, edited_at, deleted_at
      FROM messages WHERE conversation_id = ANY(${ids}::bigint[]) ORDER BY conversation_id, id DESC`;
    const unread = await sql<{ conversation_id: string; n: number }[]>`
      SELECT m.conversation_id, count(*)::int AS n FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${viewerId}
      WHERE m.conversation_id = ANY(${ids}::bigint[]) AND m.id > cm.last_read_id AND m.sender_id <> ${viewerId} AND m.deleted_at IS NULL
      GROUP BY m.conversation_id`;
    const users = await userSummaries(hctx, members.map((m) => m.user_id));
    const last = new Map((await hydrateMessages(hctx, viewerId, lastRows)).map((m) => [m.conversationId, m]));
    const byId = new Map(convs.map((c) => [c.id, c]));
    return ids
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({
        id: c.id,
        title: c.title,
        isGroup: c.is_group,
        participants: members
          .filter((m) => m.conversation_id === c.id && m.user_id !== viewerId)
          .map((m) => users.get(m.user_id))
          .filter((u): u is NonNullable<typeof u> => !!u),
        lastMessage: last.get(c.id) ?? null,
        unreadCount: unread.find((u) => u.conversation_id === c.id)?.n ?? 0,
        isRequest: c.status === "request",
        updatedAt: c.updated_at.toISOString(),
      }));
  }

  app.get<{ Querystring: { tab?: string } }>("/conversations", async (req) => {
    const me = requireUser(req);
    const status = req.query.tab === "requests" ? "request" : "accepted";
    const rows = await sql<{ id: string }[]>`
      SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = ${me.id} AND cm.status = ${status}
        AND (c.is_group OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id))
      ORDER BY c.updated_at DESC LIMIT 100`;
    return { items: await conversations(me.id, rows.map((r) => r.id)), nextCursor: null };
  });

  app.post("/conversations", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(createConversationSchema, req.body);
    const others = [...new Set(input.participantIds)].filter((id) => id !== me.id);
    if (others.length === 0) throw badRequest("Add at least one other person");
    if (!others.every(isId)) throw badRequest("Invalid participant");
    const valid = await sql<{ id: string; follows_me: boolean; blocked: boolean }[]>`
      SELECT u.id,
        EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = ${me.id}) AS follows_me,
        EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = ${me.id})
                                       OR (b.blocker_id = ${me.id} AND b.blocked_id = u.id)) AS blocked
      FROM users u WHERE u.id = ANY(${others}::bigint[]) AND u.status = 'active'`;
    if (valid.length !== others.length) throw badRequest("Unknown participant");
    if (valid.some((v) => v.blocked)) throw forbidden("You can't message one of these accounts", "BLOCKED");

    const isGroup = others.length > 1;
    const dmKey = isGroup ? null : [me.id, others[0]!].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).join(":");
    const id = await sql.begin(async (tx) => {
      if (dmKey) {
        const [existing] = await tx<{ id: string }[]>`SELECT id FROM conversations WHERE dm_key = ${dmKey}`;
        if (existing) {
          await tx`UPDATE conversation_members SET status = 'accepted' WHERE conversation_id = ${existing.id} AND user_id = ${me.id} AND status = 'left'`;
          return existing.id;
        }
      }
      // Daily cap on new conversations, by trust band: stops mass unsolicited messaging.
      const [mine] = await tx<{ trust_score: number; today: number }[]>`
        SELECT trust_score, (SELECT count(*)::int FROM conversations WHERE created_by = ${me.id} AND created_at > now() - interval '24 hours') AS today
        FROM users WHERE id = ${me.id}`;
      const limit = DM_DAILY_LIMIT[band(mine!.trust_score)];
      if (mine!.today >= limit) throw new AppError(429, "DM_LIMIT", `You can start up to ${limit} new conversations a day`);
      const cid = newId();
      await tx`INSERT INTO conversations (id, title, is_group, dm_key, created_by)
               VALUES (${cid}, ${isGroup ? (input.title ?? null) : null}, ${isGroup}, ${dmKey}, ${me.id})`;
      await tx`INSERT INTO conversation_members (conversation_id, user_id, status) VALUES (${cid}, ${me.id}, 'accepted')`;
      for (const v of valid) {
        // People who don't follow you get a message request instead of an inbox entry.
        await tx`INSERT INTO conversation_members (conversation_id, user_id, status)
                 VALUES (${cid}, ${v.id}, ${v.follows_me ? "accepted" : "request"})`;
      }
      return cid;
    });
    reply.status(201);
    return (await conversations(me.id, [id]))[0];
  });

  app.get<{ Params: { id: string } }>("/conversations/:id", async (req) => {
    const me = requireUser(req);
    await membership(sql, req.params.id, me.id);
    return (await conversations(me.id, [req.params.id]))[0];
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/conversations/:id/messages", async (req) => {
    const me = requireUser(req);
    await membership(sql, req.params.id, me.id);
    const limit = pageSize(req.query.limit, 30, 100);
    const rows = await sql<MessageRow[]>`
      SELECT id, conversation_id, sender_id, text, shared_post_id, created_at, edited_at, deleted_at FROM messages
      WHERE conversation_id = ${req.params.id} AND id < ${idCursor(req.query.cursor)}
      ORDER BY id DESC LIMIT ${limit}`;
    return { items: await hydrateMessages(hctx, me.id, rows), nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null };
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/messages", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(sendMessageSchema, req.body);
    const cid = req.params.id;
    await membership(sql, cid, me.id);
    await assertNotBlocked(sql, cid, me.id);
    if (input.sharedPostId) {
      const p = (await hydratePosts(hctx, me.id, [input.sharedPostId])).get(input.sharedPostId);
      if (!p || p.unavailable) throw notFound("Post");
    }
    const id = newId();
    await sql.begin(async (tx) => {
      if (input.mediaIds.length > 0) {
        const owned = await tx`SELECT 1 FROM media WHERE id = ANY(${input.mediaIds}::bigint[]) AND owner_id = ${me.id} AND status = 'ready'`;
        if (owned.length !== new Set(input.mediaIds).size) throw badRequest("Invalid media");
      }
      await tx`INSERT INTO messages (id, conversation_id, sender_id, text, shared_post_id)
               VALUES (${id}, ${cid}, ${me.id}, ${input.text}, ${input.sharedPostId ?? null})`;
      for (const [i, mid] of input.mediaIds.entries()) {
        await tx`INSERT INTO message_media (message_id, media_id, position) VALUES (${id}, ${mid}, ${i})`;
      }
      await tx`UPDATE conversations SET updated_at = now() WHERE id = ${cid}`;
      // Queue a push for each other member with a device registered (see services/push.ts).
      await tx`INSERT INTO push_outbox (user_id, message_id)
               SELECT cm.user_id, ${id} FROM conversation_members cm
               WHERE cm.conversation_id = ${cid} AND cm.user_id <> ${me.id} AND cm.status <> 'left'
                 AND EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = cm.user_id)`;
      // Replying to a request accepts it; your own messages count as read.
      await tx`UPDATE conversation_members SET status = 'accepted', last_read_id = ${id}
               WHERE conversation_id = ${cid} AND user_id = ${me.id}`;
    });
    const [row] = await sql<MessageRow[]>`
      SELECT id, conversation_id, sender_id, text, shared_post_id, created_at, edited_at, deleted_at FROM messages WHERE id = ${id}`;
    reply.status(201);
    return (await hydrateMessages(hctx, me.id, [row!]))[0];
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/read", async (req) => {
    const me = requireUser(req);
    await membership(sql, req.params.id, me.id);
    await sql`
      UPDATE conversation_members SET last_read_id = greatest(last_read_id,
        coalesce((SELECT max(id) FROM messages WHERE conversation_id = ${req.params.id}), 0))
      WHERE conversation_id = ${req.params.id} AND user_id = ${me.id}`;
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/conversations/:id/accept", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await membership(sql, req.params.id, me.id);
    await sql`UPDATE conversation_members SET status = 'accepted' WHERE conversation_id = ${req.params.id} AND user_id = ${me.id}`;
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/conversations/:id", async (req, reply) => {
    const me = requireUser(req);
    await membership(sql, req.params.id, me.id);
    await sql`UPDATE conversation_members SET status = 'left' WHERE conversation_id = ${req.params.id} AND user_id = ${me.id}`;
    reply.status(204);
  });

  app.patch<{ Params: { id: string } }>("/messages/:id", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const text = String((req.body as { text?: string } | undefined)?.text ?? "").trim();
    if (!text || text.length > 10_000) throw badRequest("Invalid message text");
    const [m] = await sql<MessageRow[]>`
      UPDATE messages SET text = ${text}, edited_at = now()
      WHERE id = ${req.params.id} AND sender_id = ${me.id} AND deleted_at IS NULL
        AND created_at > now() - ${`${MESSAGE_EDIT_WINDOW_MS / 1000} seconds`}::interval
      RETURNING id, conversation_id, sender_id, text, shared_post_id, created_at, edited_at, deleted_at`;
    if (!m) throw forbidden("Message can no longer be edited", "EDIT_WINDOW_CLOSED");
    return (await hydrateMessages(hctx, me.id, [m]))[0];
  });

  app.delete<{ Params: { id: string } }>("/messages/:id", async (req, reply) => {
    const me = requireUser(req);
    const r = await sql`
      UPDATE messages SET deleted_at = now(), text = '' WHERE id = ${req.params.id} AND sender_id = ${me.id} AND deleted_at IS NULL`;
    if (r.count === 0) throw notFound("Message");
    await sql`DELETE FROM message_media WHERE message_id = ${req.params.id}`;
    reply.status(204);
  });
};

export default messageRoutes;
