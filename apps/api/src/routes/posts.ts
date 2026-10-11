import type { FastifyPluginAsync } from "fastify";
import {
  createPostSchema,
  detectLanguage,
  editPostSchema,
  eventsSchema,
  extractEntities,
  pollVoteSchema,
  type FeedItem,
  type Page,
  type Post,
} from "@projectfeed/shared";
import type { Db } from "../db";
import { requireUser } from "../lib/auth";
import { badRequest, conflict, forbidden, notFound, parse } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { hydratePosts, orderedSummaries, visiblePosts, type HydrateCtx } from "../services/hydrate";
import { notify, unnotify } from "../services/notify";
import { recordVideoViews } from "../feed/reels";
import { idCursor, pageSize } from "../services/timeline";

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const MAX_EDITS = 5;

/** Load a post the viewer is allowed to see, or 404. */
async function visiblePost(ctx: HydrateCtx, viewerId: string | null, id: string): Promise<Post> {
  if (!isId(id)) throw notFound("Post");
  const post = (await hydratePosts(ctx, viewerId, [id])).get(id);
  if (!post || post.unavailable) throw notFound("Post");
  return post;
}

async function writeEntities(db: Db, postId: string, authorId: string, text: string): Promise<string[]> {
  const entities = extractEntities(text);
  const handles = [...new Set(entities.filter((e) => e.type === "mention").map((e) => e.value.toLowerCase()))].slice(0, 20);
  const tags = entities.filter((e) => e.type === "hashtag" || e.type === "cashtag");
  let mentionedIds: string[] = [];
  if (handles.length > 0) {
    const rows = await db<{ id: string }[]>`
      SELECT id FROM users WHERE lower(handle::text) = ANY(${handles}::text[]) AND status = 'active' AND id <> ${authorId}`;
    mentionedIds = rows.map((r) => r.id);
    for (const uid of mentionedIds) {
      await db`INSERT INTO post_mentions (post_id, user_id) VALUES (${postId}, ${uid}) ON CONFLICT DO NOTHING`;
    }
  }
  for (const t of tags) {
    await db`
      INSERT INTO post_tags (post_id, tag, kind, author_id)
      VALUES (${postId}, ${t.value.toLowerCase()}, ${t.type}, ${authorId}) ON CONFLICT DO NOTHING`;
  }
  return mentionedIds;
}

const postRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified } = app.ctx;
  const hctx: HydrateCtx = { db: sql, storage };

  // ───────────── Create ─────────────
  app.post("/posts", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(createPostSchema, req.body);

    let parent: Post | null = null;
    if (input.replyToId) {
      parent = await visiblePost(hctx, me.id, input.replyToId);
      if (!parent.viewer.canReply) throw forbidden("You can't reply to this post", "REPLY_RESTRICTED");
    }
    if (input.quoteOfId) await visiblePost(hctx, me.id, input.quoteOfId);

    const id = newId();
    await sql.begin(async (tx) => {
      let hasVideo = false;
      if (input.mediaIds.length > 0) {
        const owned = await tx<{ id: string; type: string; status: string }[]>`
          SELECT m.id, m.type, m.status FROM media m
          WHERE m.id = ANY(${input.mediaIds}::bigint[]) AND m.owner_id = ${me.id}
            AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)`;
        if (owned.length !== new Set(input.mediaIds).size) throw badRequest("Invalid or already-used media");
        if (owned.some((m) => m.status === "processing")) throw conflict("Your video is still processing", "MEDIA_PROCESSING");
        if (owned.some((m) => m.status === "failed")) throw badRequest("One of your attachments failed to process");
        hasVideo = owned.some((m) => m.type === "video");
        if (hasVideo && owned.length > 1) throw badRequest("A post can have one video, or up to 4 photos");
      }
      await tx`
        INSERT INTO posts (id, author_id, text, reply_to_id, reply_to_author_id, quote_of_id, conversation_id, reply_audience, has_video, lang)
        VALUES (${id}, ${me.id}, ${input.text}, ${parent?.id ?? null}, ${parent?.author.id ?? null},
                ${input.quoteOfId ?? null}, ${parent?.conversationId ?? id}, ${input.replyAudience}, ${hasVideo},
                ${detectLanguage(input.text)})`;
      for (const [i, mid] of input.mediaIds.entries()) {
        await tx`INSERT INTO post_media (post_id, media_id, position) VALUES (${id}, ${mid}, ${i})`;
      }
      if (input.poll) {
        const endsAt = new Date(Date.now() + input.poll.durationMinutes * 60_000);
        await tx`INSERT INTO polls (post_id, options, ends_at) VALUES (${id}, ${input.poll.options}::text[], ${endsAt})`;
      }
      await tx`UPDATE users SET posts_count = posts_count + 1 WHERE id = ${me.id}`;

      const mentioned = await writeEntities(tx, id, me.id, input.text);
      if (parent) {
        await tx`UPDATE posts SET reply_count = reply_count + 1 WHERE id = ${parent.id}`;
        await notify(tx, { recipientId: parent.author.id, actorId: me.id, type: "reply", postId: id });
      }
      if (input.quoteOfId) {
        const [q] = await tx<{ author_id: string }[]>`
          UPDATE posts SET quote_count = quote_count + 1 WHERE id = ${input.quoteOfId} RETURNING author_id`;
        await notify(tx, { recipientId: q!.author_id, actorId: me.id, type: "quote", postId: id });
      }
      for (const uid of mentioned) {
        if (uid === parent?.author.id) continue; // already notified as a reply
        await notify(tx, { recipientId: uid, actorId: me.id, type: "mention", postId: id });
      }
    });
    reply.status(201);
    return (await hydratePosts(hctx, me.id, [id])).get(id);
  });

  // ───────────── Read ─────────────
  app.get<{ Params: { id: string } }>("/posts/:id", async (req) => {
    const viewer = req.user?.id ?? null;
    const post = await visiblePost(hctx, viewer, req.params.id);
    if (viewer) {
      const r = await sql`INSERT INTO post_views (user_id, post_id) VALUES (${viewer}, ${post.id}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (r.count > 0) {
        await sql`UPDATE posts SET view_count = view_count + 1 WHERE id = ${post.id}`;
        post.counts.views += 1;
      }
    }
    return post;
  });

  /** Thread view: ancestors (oldest first), the focal post, and the first page of replies. */
  app.get<{ Params: { id: string } }>("/posts/:id/thread", async (req) => {
    const viewer = req.user?.id ?? null;
    const focal = await visiblePost(hctx, viewer, req.params.id);
    const chain = await sql<{ id: string }[]>`
      WITH RECURSIVE up AS (
        SELECT reply_to_id AS id, 1 AS depth FROM posts WHERE id = ${focal.id}
        UNION ALL
        SELECT p.reply_to_id, up.depth + 1 FROM posts p JOIN up ON p.id = up.id
        WHERE up.depth < 30 AND p.reply_to_id IS NOT NULL
      )
      SELECT id FROM up WHERE id IS NOT NULL ORDER BY depth DESC`;
    const ancestorsMap = await hydratePosts(hctx, viewer, chain.map((c) => c.id));
    const ancestors = chain.map((c) => ancestorsMap.get(c.id)).filter((p): p is Post => !!p);
    return { ancestors, post: focal, replies: await replies(viewer, focal, null, 20) };
  });

  /**
   * Replies ranked X-style: the author's own replies first, then accounts the viewer follows,
   * then by engagement. Paged by offset because the order is not chronological.
   */
  async function replies(viewer: string | null, parent: Post, cursor: string | null, limit: number): Promise<Page<Post>> {
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw badRequest("Invalid cursor");
    const v = viewer ?? "0";
    const rows = await sql<{ id: string }[]>`
      SELECT p.id FROM posts p
      WHERE p.reply_to_id = ${parent.id} AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM mutes WHERE muter_id = ${v} AND muted_id = p.author_id)
      ORDER BY (p.author_id = ${parent.author.id}) DESC,
               (p.author_id = ${v}) DESC,
               EXISTS (SELECT 1 FROM follows WHERE follower_id = ${v} AND followee_id = p.author_id) DESC,
               (p.like_count + 2 * p.reply_count + p.repost_count) DESC,
               p.id ASC
      OFFSET ${offset} LIMIT ${limit}`;
    const items = await visiblePosts(hctx, viewer, rows.map((r) => r.id));
    return { items, nextCursor: rows.length === limit ? String(offset + limit) : null };
  }

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/posts/:id/replies", async (req) => {
    const viewer = req.user?.id ?? null;
    const parent = await visiblePost(hctx, viewer, req.params.id);
    return replies(viewer, parent, req.query.cursor ?? null, pageSize(req.query.limit));
  });

  app.get<{ Params: { id: string }; Querystring: { cursor?: string; limit?: string } }>("/posts/:id/quotes", async (req) => {
    const viewer = req.user?.id ?? null;
    const post = await visiblePost(hctx, viewer, req.params.id);
    const limit = pageSize(req.query.limit);
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM posts WHERE quote_of_id = ${post.id} AND deleted_at IS NULL AND id < ${idCursor(req.query.cursor)}
      ORDER BY id DESC LIMIT ${limit}`;
    const items: FeedItem[] = (await visiblePosts(hctx, viewer, rows.map((r) => r.id))).map((p) => ({
      post: p,
      repostedBy: null,
      reason: null,
    }));
    return { items, nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null };
  });

  for (const kind of ["likes", "reposts"] as const) {
    app.get<{ Params: { id: string } }>(`/posts/:id/${kind}`, async (req) => {
      const post = await visiblePost(hctx, req.user?.id ?? null, req.params.id);
      const rows =
        kind === "likes"
          ? await sql<{ user_id: string }[]>`SELECT user_id FROM likes WHERE post_id = ${post.id} ORDER BY created_at DESC LIMIT 100`
          : await sql<{ user_id: string }[]>`SELECT user_id FROM reposts WHERE post_id = ${post.id} ORDER BY created_at DESC LIMIT 100`;
      return { items: await orderedSummaries(hctx, rows.map((r) => r.user_id)), nextCursor: null };
    });
  }

  // ───────────── Edit & delete ─────────────
  app.patch<{ Params: { id: string } }>("/posts/:id", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const { text } = parse(editPostSchema, req.body);
    await sql.begin(async (tx) => {
      const [p] = await tx<{ author_id: string; text: string; created_at: Date; edit_count: number; has_media: boolean; has_quote: boolean }[]>`
        SELECT author_id, text, created_at, edit_count,
               EXISTS (SELECT 1 FROM post_media WHERE post_id = posts.id) AS has_media, quote_of_id IS NOT NULL AS has_quote
        FROM posts WHERE id = ${req.params.id} AND deleted_at IS NULL FOR UPDATE`;
      if (!p || p.author_id !== me.id) throw notFound("Post");
      if (Date.now() - p.created_at.getTime() > EDIT_WINDOW_MS) throw forbidden("Posts can only be edited for 30 minutes", "EDIT_WINDOW_CLOSED");
      if (p.edit_count >= MAX_EDITS) throw forbidden("Edit limit reached", "EDIT_LIMIT");
      if (!text.trim() && !p.has_media && !p.has_quote) throw badRequest("Post cannot be empty");
      await tx`INSERT INTO post_edits (post_id, text, edited_at) VALUES (${req.params.id}, ${p.text}, now())`;
      await tx`UPDATE posts SET text = ${text}, lang = ${detectLanguage(text)}, edited_at = now(), edit_count = edit_count + 1
               WHERE id = ${req.params.id}`;
      await tx`DELETE FROM post_tags WHERE post_id = ${req.params.id}`;
      // Mentions only grow on edit: we never retract a notification someone already received.
      await writeEntities(tx, req.params.id, me.id, text);
    });
    return (await hydratePosts(hctx, me.id, [req.params.id])).get(req.params.id);
  });

  app.get<{ Params: { id: string } }>("/posts/:id/edits", async (req) => {
    const post = await visiblePost(hctx, req.user?.id ?? null, req.params.id);
    const rows = await sql<{ text: string; edited_at: Date }[]>`
      SELECT text, edited_at FROM post_edits WHERE post_id = ${post.id} ORDER BY edited_at`;
    return { current: post.text, previous: rows.map((r) => ({ text: r.text, replacedAt: r.edited_at.toISOString() })) };
  });

  app.delete<{ Params: { id: string } }>("/posts/:id", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    await sql.begin(async (tx) => {
      const [p] = await tx<{ reply_to_id: string | null; quote_of_id: string | null }[]>`
        UPDATE posts SET deleted_at = now(), text = ''
        WHERE id = ${req.params.id} AND author_id = ${me.id} AND deleted_at IS NULL
        RETURNING reply_to_id, quote_of_id`;
      if (!p) throw notFound("Post");
      await tx`UPDATE users SET posts_count = greatest(posts_count - 1, 0),
                                pinned_post_id = CASE WHEN pinned_post_id = ${req.params.id} THEN NULL ELSE pinned_post_id END
               WHERE id = ${me.id}`;
      if (p.reply_to_id) await tx`UPDATE posts SET reply_count = greatest(reply_count - 1, 0) WHERE id = ${p.reply_to_id}`;
      if (p.quote_of_id) await tx`UPDATE posts SET quote_count = greatest(quote_count - 1, 0) WHERE id = ${p.quote_of_id}`;
      await tx`DELETE FROM post_tags WHERE post_id = ${req.params.id}`;
      await tx`DELETE FROM post_edits WHERE post_id = ${req.params.id}`;
      await tx`DELETE FROM notifications WHERE post_id = ${req.params.id}`;
      await tx`DELETE FROM post_media WHERE post_id = ${req.params.id}`;
    });
    reply.status(204);
  });

  // ───────────── Engagement ─────────────
  app.post<{ Params: { id: string } }>("/posts/:id/like", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const post = await visiblePost(hctx, me.id, req.params.id);
    await sql.begin(async (tx) => {
      const r = await tx`INSERT INTO likes (user_id, post_id) VALUES (${me.id}, ${post.id}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (r.count > 0) {
        await tx`UPDATE posts SET like_count = like_count + 1 WHERE id = ${post.id}`;
        await notify(tx, { recipientId: post.author.id, actorId: me.id, type: "like", postId: post.id });
      }
    });
    return { liked: true };
  });

  app.delete<{ Params: { id: string } }>("/posts/:id/like", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await sql.begin(async (tx) => {
      const [r] = await tx<{ author_id: string }[]>`
        WITH d AS (DELETE FROM likes WHERE user_id = ${me.id} AND post_id = ${req.params.id} RETURNING post_id)
        UPDATE posts SET like_count = greatest(like_count - 1, 0) FROM d WHERE posts.id = d.post_id RETURNING posts.author_id`;
      if (r) await unnotify(tx, { recipientId: r.author_id, actorId: me.id, type: "like", postId: req.params.id });
    });
    return { liked: false };
  });

  app.post<{ Params: { id: string } }>("/posts/:id/repost", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const post = await visiblePost(hctx, me.id, req.params.id);
    if (post.author.isProtected && post.author.id !== me.id) throw forbidden("Posts from protected accounts can't be reposted", "PROTECTED");
    await sql.begin(async (tx) => {
      const r = await tx`INSERT INTO reposts (id, user_id, post_id) VALUES (${newId()}, ${me.id}, ${post.id}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (r.count > 0) {
        await tx`UPDATE posts SET repost_count = repost_count + 1 WHERE id = ${post.id}`;
        await notify(tx, { recipientId: post.author.id, actorId: me.id, type: "repost", postId: post.id });
      }
    });
    return { reposted: true };
  });

  app.delete<{ Params: { id: string } }>("/posts/:id/repost", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await sql.begin(async (tx) => {
      const [r] = await tx<{ author_id: string }[]>`
        WITH d AS (DELETE FROM reposts WHERE user_id = ${me.id} AND post_id = ${req.params.id} RETURNING post_id)
        UPDATE posts SET repost_count = greatest(repost_count - 1, 0) FROM d WHERE posts.id = d.post_id RETURNING posts.author_id`;
      if (r) await unnotify(tx, { recipientId: r.author_id, actorId: me.id, type: "repost", postId: req.params.id });
    });
    return { reposted: false };
  });

  app.post<{ Params: { id: string } }>("/posts/:id/bookmark", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const post = await visiblePost(hctx, me.id, req.params.id);
    const r = await sql`INSERT INTO bookmarks (user_id, post_id) VALUES (${me.id}, ${post.id}) ON CONFLICT DO NOTHING RETURNING 1`;
    if (r.count > 0) await sql`UPDATE posts SET bookmark_count = bookmark_count + 1 WHERE id = ${post.id}`;
    return { bookmarked: true };
  });

  app.delete<{ Params: { id: string } }>("/posts/:id/bookmark", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    await sql`
      WITH d AS (DELETE FROM bookmarks WHERE user_id = ${me.id} AND post_id = ${req.params.id} RETURNING post_id)
      UPDATE posts SET bookmark_count = greatest(bookmark_count - 1, 0) FROM d WHERE posts.id = d.post_id`;
    return { bookmarked: false };
  });

  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/me/bookmarks", async (req) => {
    const me = requireUser(req);
    const limit = pageSize(req.query.limit);
    const rows = await sql<{ post_id: string; ts: string }[]>`
      SELECT post_id, (extract(epoch FROM created_at) * 1000000)::bigint::text AS ts FROM bookmarks
      WHERE user_id = ${me.id} AND (extract(epoch FROM created_at) * 1000000)::bigint < ${idCursor(req.query.cursor)}::bigint
      ORDER BY created_at DESC LIMIT ${limit}`;
    const items: FeedItem[] = (await visiblePosts(hctx, me.id, rows.map((r) => r.post_id))).map((p) => ({
      post: p,
      repostedBy: null,
      reason: null,
    }));
    return { items, nextCursor: rows.length === limit ? rows[rows.length - 1]!.ts : null };
  });

  app.post<{ Params: { id: string } }>("/posts/:id/vote", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const { optionIndex } = parse(pollVoteSchema, req.body);
    const post = await visiblePost(hctx, me.id, req.params.id);
    if (!post.poll) throw notFound("Poll");
    if (post.poll.closed) throw forbidden("This poll has ended", "POLL_CLOSED");
    if (optionIndex >= post.poll.options.length) throw badRequest("Invalid option");
    const r = await sql`
      INSERT INTO poll_votes (post_id, user_id, option_index) VALUES (${post.id}, ${me.id}, ${optionIndex})
      ON CONFLICT DO NOTHING RETURNING 1`;
    if (r.count === 0) throw forbidden("You have already voted", "ALREADY_VOTED");
    return (await hydratePosts(hctx, me.id, [post.id])).get(post.id);
  });

  app.post<{ Params: { id: string } }>("/posts/:id/not-interested", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const post = await visiblePost(hctx, me.id, req.params.id);
    await sql`
      INSERT INTO feed_negative (user_id, post_id, author_id) VALUES (${me.id}, ${post.id}, ${post.author.id})
      ON CONFLICT DO NOTHING`;
    return { ok: true };
  });

  // ───────────── Client event log (ranking training data) ─────────────
  app.post("/events", async (req, reply) => {
    const me = requireUser(req);
    const { events } = parse(eventsSchema, req.body);
    const rows = events
      .filter((e) => !e.postId || isId(e.postId))
      .map((e) => ({
        user_id: me.id,
        type: e.type,
        post_id: e.postId ?? null,
        surface: e.surface,
        position: e.position ?? null,
        duration_ms: e.durationMs ?? null,
        client_ts: Number.isNaN(Date.parse(e.ts)) ? new Date() : new Date(e.ts),
      }));
    if (rows.length > 0) await sql`INSERT INTO events ${sql(rows)}`;
    const videoViews = events
      .filter((e) => e.type === "video_view" && e.postId && isId(e.postId) && (e.durationMs ?? 0) > 0)
      .map((e) => ({ postId: e.postId!, durationMs: e.durationMs! }));
    if (videoViews.length > 0) await recordVideoViews(sql, videoViews);
    // Impressions and video plays double as view counts (one per user per post).
    const viewed = [
      ...new Set(events.filter((e) => (e.type === "impression" || e.type === "video_view") && e.postId && isId(e.postId)).map((e) => e.postId!)),
    ];
    if (viewed.length > 0) {
      await sql`
        WITH ins AS (
          INSERT INTO post_views (user_id, post_id)
          SELECT ${me.id}, p.id FROM posts p WHERE p.id = ANY(${viewed}::bigint[])
          ON CONFLICT DO NOTHING RETURNING post_id
        )
        UPDATE posts SET view_count = view_count + 1 FROM ins WHERE posts.id = ins.post_id`;
    }
    reply.status(202);
    return { accepted: rows.length };
  });
};

export default postRoutes;
