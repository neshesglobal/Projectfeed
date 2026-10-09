import type { FastifyPluginAsync } from "fastify";
import { mutedWordSchema, passwordSchema } from "@projectfeed/shared";
import { z } from "zod";
import { hashPassword, requireUser, verifyPassword } from "../lib/auth";
import { forbidden, notFound, parse, unauthorized } from "../lib/errors";
import { newId } from "../lib/ids";
import { orderedSummaries } from "../services/hydrate";

const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
const deleteAccountSchema = z.object({ password: z.string().min(1) });

const settingsRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, tokens } = app.ctx;
  const hctx = { db: sql, storage };

  // ───────────── Muted words ─────────────
  app.get("/me/muted-words", async (req) => {
    const me = requireUser(req);
    const rows = await sql<{ id: string; word: string }[]>`
      SELECT id, word FROM muted_words WHERE user_id = ${me.id} ORDER BY created_at DESC`;
    return { items: rows };
  });

  app.post("/me/muted-words", async (req, reply) => {
    const me = requireUser(req);
    const { word } = parse(mutedWordSchema, req.body);
    const n = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM muted_words WHERE user_id = ${me.id}`)[0]!.n;
    if (n >= 500) throw forbidden("Muted word limit reached");
    const [row] = await sql<{ id: string; word: string }[]>`
      INSERT INTO muted_words (id, user_id, word) VALUES (${newId()}, ${me.id}, ${word.toLowerCase()})
      ON CONFLICT (user_id, word) DO UPDATE SET word = excluded.word RETURNING id, word`;
    reply.status(201);
    return row;
  });

  app.delete<{ Params: { id: string } }>("/me/muted-words/:id", async (req, reply) => {
    const me = requireUser(req);
    await sql`DELETE FROM muted_words WHERE id = ${req.params.id} AND user_id = ${me.id}`;
    reply.status(204);
  });

  // ───────────── Blocked & muted accounts ─────────────
  app.get("/me/blocked", async (req) => {
    const me = requireUser(req);
    const rows = await sql<{ id: string }[]>`SELECT blocked_id AS id FROM blocks WHERE blocker_id = ${me.id} ORDER BY created_at DESC`;
    return { items: await orderedSummaries(hctx, rows.map((r) => r.id)), nextCursor: null };
  });

  app.get("/me/muted", async (req) => {
    const me = requireUser(req);
    const rows = await sql<{ id: string }[]>`SELECT muted_id AS id FROM mutes WHERE muter_id = ${me.id} ORDER BY created_at DESC`;
    return { items: await orderedSummaries(hctx, rows.map((r) => r.id)), nextCursor: null };
  });

  // ───────────── Security ─────────────
  app.post("/me/password", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const me = requireUser(req);
    const input = parse(changePasswordSchema, req.body);
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${me.id}`;
    if (!u || !(await verifyPassword(u.password_hash, input.currentPassword))) throw unauthorized("Current password is incorrect");
    await sql`UPDATE users SET password_hash = ${await hashPassword(input.newPassword)} WHERE id = ${me.id}`;
    await tokens.revokeAll(sql, me.id); // sign out every other device
    return { ok: true };
  });

  app.post("/me/sessions/revoke-all", async (req) => {
    const me = requireUser(req);
    await tokens.revokeAll(sql, me.id);
    return { ok: true };
  });

  // ───────────── GDPR: export & deletion ─────────────
  /** Right of access (UK GDPR Art. 15). Synchronous for now; becomes an emailed async job at scale. */
  app.get("/me/export", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req) => {
    const me = requireUser(req);
    const [profile] = await sql`
      SELECT id, email::text, handle::text, display_name, bio, location, website, company, role, sectors,
             is_protected, kyc_level, created_at FROM users WHERE id = ${me.id}`;
    const [posts, likes, bookmarks, following, followers, blocks, mutes, mutedWords, messages, lists] = await Promise.all([
      sql`SELECT id, text, reply_to_id, quote_of_id, created_at, edited_at FROM posts WHERE author_id = ${me.id} AND deleted_at IS NULL ORDER BY id`,
      sql`SELECT post_id, created_at FROM likes WHERE user_id = ${me.id} ORDER BY created_at`,
      sql`SELECT post_id, created_at FROM bookmarks WHERE user_id = ${me.id} ORDER BY created_at`,
      sql`SELECT f.followee_id AS user_id, u.handle::text, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ${me.id}`,
      sql`SELECT f.follower_id AS user_id, u.handle::text, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ${me.id}`,
      sql`SELECT blocked_id AS user_id, created_at FROM blocks WHERE blocker_id = ${me.id}`,
      sql`SELECT muted_id AS user_id, created_at FROM mutes WHERE muter_id = ${me.id}`,
      sql`SELECT word, created_at FROM muted_words WHERE user_id = ${me.id}`,
      sql`SELECT id, conversation_id, text, created_at FROM messages WHERE sender_id = ${me.id} AND deleted_at IS NULL ORDER BY id`,
      sql`SELECT id, name, description, is_private, created_at FROM lists WHERE owner_id = ${me.id}`,
    ]);
    return { exportedAt: new Date().toISOString(), profile, posts, likes, bookmarks, following, followers, blocks, mutes, mutedWords, messages, lists };
  });

  /**
   * Account deletion (required in-app by Apple). The account disappears immediately; personal data is
   * erased now except posts, which are soft-deleted so threads keep their structure.
   */
  app.post("/me/delete", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const me = requireUser(req);
    const { password } = parse(deleteAccountSchema, req.body);
    const [u] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${me.id}`;
    if (!u) throw notFound("User");
    if (!(await verifyPassword(u.password_hash, password))) throw unauthorized("Password is incorrect");
    await sql.begin(async (tx) => {
      const following = await tx<{ id: string }[]>`DELETE FROM follows WHERE follower_id = ${me.id} RETURNING followee_id AS id`;
      const followers = await tx<{ id: string }[]>`DELETE FROM follows WHERE followee_id = ${me.id} RETURNING follower_id AS id`;
      if (following.length) await tx`UPDATE users SET followers_count = greatest(followers_count - 1, 0) WHERE id = ANY(${following.map((f) => f.id)}::bigint[])`;
      if (followers.length) await tx`UPDATE users SET following_count = greatest(following_count - 1, 0) WHERE id = ANY(${followers.map((f) => f.id)}::bigint[])`;
      await tx`UPDATE posts SET deleted_at = now(), text = '' WHERE author_id = ${me.id} AND deleted_at IS NULL`;
      await tx`DELETE FROM post_media WHERE post_id IN (SELECT id FROM posts WHERE author_id = ${me.id})`;
      await tx`DELETE FROM post_tags WHERE author_id = ${me.id}`;
      for (const t of ["likes", "reposts", "bookmarks"] as const) {
        const col = t === "likes" ? "like_count" : t === "reposts" ? "repost_count" : "bookmark_count";
        await tx`
          WITH d AS (DELETE FROM ${tx(t)} WHERE user_id = ${me.id} RETURNING post_id)
          UPDATE posts SET ${tx(col)} = greatest(${tx(col)} - 1, 0) FROM d WHERE posts.id = d.post_id`;
      }
      await tx`UPDATE messages SET deleted_at = now(), text = '' WHERE sender_id = ${me.id}`;
      await tx`DELETE FROM media WHERE owner_id = ${me.id}`;
      await tx`DELETE FROM notifications WHERE actor_id = ${me.id} OR user_id = ${me.id}`;
      await tx`DELETE FROM follow_requests WHERE requester_id = ${me.id} OR target_id = ${me.id}`;
      await tx`DELETE FROM lists WHERE owner_id = ${me.id}`;
      await tx`DELETE FROM refresh_tokens WHERE user_id = ${me.id}`;
      // Free the handle and email for reuse; keep the row so foreign keys and audit trails stay valid.
      await tx`
        UPDATE users SET status = 'deleted', deleted_at = now(),
          email = ${`deleted+${me.id}@invalid`}, handle = ${`deleted_${me.id}`}, password_hash = '',
          display_name = 'Deleted account', bio = '', location = '', website = '', company = '', role = '',
          sectors = '{}', avatar_media_id = NULL, banner_media_id = NULL, pinned_post_id = NULL,
          followers_count = 0, following_count = 0, posts_count = 0
        WHERE id = ${me.id}`;
    });
    // Media files are removed from storage by a background sweeper (not yet built) once rows are gone.
    reply.status(204);
  });
};

export default settingsRoutes;
