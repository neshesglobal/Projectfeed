// Community Notes: contributors add context to posts; a note is shown only when raters who usually disagree
// both find it helpful (see services/notes-scorer.ts).

import type { FastifyPluginAsync } from "fastify";
import { noteCreateSchema, noteRateSchema, type CommunityNote, type NotesForPost } from "@projectfeed/shared";
import type { Db } from "../db";
import { requireUser, type AuthUser } from "../lib/auth";
import { AppError, badRequest, forbidden, notFound, parse } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { hydratePosts } from "../services/hydrate";

/** Contributor requirements. Writing needs more standing than rating. */
const MIN_AGE_DAYS = Number(process.env.NOTES_MIN_ACCOUNT_AGE_DAYS ?? 30);
const WRITE_MIN_TRUST = 60;
const RATE_MIN_TRUST = 40;
const NOTES_PER_DAY = 10;
const RATING_VALUE = { yes: 1, somewhat: 0.5, no: 0 } as const;
const RATING_NAME = new Map<number, CommunityNote["myRating"]>([[1, "yes"], [0.5, "somewhat"], [0, "no"]]);

async function eligibility(db: Db, me: AuthUser): Promise<{ canWrite: boolean; canRate: boolean; reason: string | null }> {
  const [u] = await db<{ trust_score: number; age_days: number; kyc_level: number }[]>`
    SELECT trust_score, extract(epoch FROM now() - created_at)::int / 86400 AS age_days, kyc_level FROM users WHERE id = ${me.id}`;
  if (!u) return { canWrite: false, canRate: false, reason: "Account not found" };
  if (u.kyc_level < 1) return { canWrite: false, canRate: false, reason: "Verify your identity to contribute to Community Notes." };
  if (u.age_days < MIN_AGE_DAYS) return { canWrite: false, canRate: false, reason: `Accounts can contribute after ${MIN_AGE_DAYS} days.` };
  const canRate = u.trust_score >= RATE_MIN_TRUST;
  const canWrite = u.trust_score >= WRITE_MIN_TRUST;
  return { canWrite, canRate, reason: canRate ? (canWrite ? null : "Keep a good record to start writing notes.") : "Your account standing doesn't allow contributing right now." };
}

const notesRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, notes: scheduler } = app.ctx;

  async function visiblePostOrThrow(viewer: string, id: string) {
    if (!isId(id)) throw notFound("Post");
    const p = (await hydratePosts({ db: sql, storage }, viewer, [id])).get(id);
    if (!p || p.unavailable) throw notFound("Post");
    return p;
  }

  async function notesFor(viewerId: string, postId: string, includeAll: boolean): Promise<CommunityNote[]> {
    const rows = await sql<{ id: string; post_id: string; author_id: string; classification: CommunityNote["classification"]; text: string; sources: string[]; status: CommunityNote["status"]; rating_count: number; created_at: Date; mine: number | null }[]>`
      SELECT n.id, n.post_id, n.author_id, n.classification, n.text, n.sources, n.status, n.rating_count, n.created_at,
             (SELECT helpful FROM note_ratings r WHERE r.note_id = n.id AND r.rater_id = ${viewerId}) AS mine
      FROM community_notes n
      WHERE n.post_id = ${postId} ${includeAll ? sql`` : sql`AND n.status = 'helpful'`}
      ORDER BY (n.status = 'helpful') DESC, n.intercept DESC NULLS LAST, n.id`;
    return rows.map((r) => ({
      id: r.id,
      postId: r.post_id,
      classification: r.classification,
      text: r.text,
      sources: r.sources,
      status: r.status,
      ratingCount: r.rating_count,
      createdAt: r.created_at.toISOString(),
      myRating: r.mine == null ? null : (RATING_NAME.get(r.mine) ?? null),
      isMine: r.author_id === viewerId,
    }));
  }

  /** Notes on a post. Contributors see notes still needing ratings; everyone else sees only shown notes. */
  app.get<{ Params: { id: string } }>("/posts/:id/notes", async (req): Promise<NotesForPost> => {
    const me = requireUser(req);
    const post = await visiblePostOrThrow(me.id, req.params.id);
    const e = await eligibility(sql, me);
    const own = post.author.id === me.id;
    return {
      notes: await notesFor(me.id, post.id, e.canRate),
      canWrite: e.canWrite && !own,
      canRate: e.canRate && !own,
      eligibility: own ? "You can't write or rate notes on your own posts." : e.reason,
    };
  });

  app.post<{ Params: { id: string } }>("/posts/:id/notes", async (req, reply) => {
    const me = requireUser(req);
    const post = await visiblePostOrThrow(me.id, req.params.id);
    if (post.author.id === me.id) throw forbidden("You can't write a note on your own post", "OWN_POST");
    const e = await eligibility(sql, me);
    if (!e.canWrite) throw forbidden(e.reason ?? "Not eligible", "NOT_ELIGIBLE");
    const input = parse(noteCreateSchema, req.body);
    const [{ n }] = (await sql`SELECT count(*)::int AS n FROM community_notes WHERE author_id = ${me.id} AND created_at > now() - interval '24 hours'`) as unknown as [{ n: number }];
    if (n >= NOTES_PER_DAY) throw new AppError(429, "NOTE_LIMIT", `You can write up to ${NOTES_PER_DAY} notes a day`);
    const id = newId();
    try {
      await sql`INSERT INTO community_notes (id, post_id, author_id, classification, text, sources)
                VALUES (${id}, ${post.id}, ${me.id}, ${input.classification}, ${input.text}, ${input.sources})`;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new AppError(409, "NOTE_EXISTS", "You've already written a note on this post");
      throw err;
    }
    reply.status(201);
    return { id, status: "needs_ratings" };
  });

  app.post<{ Params: { id: string } }>("/notes/:id/rate", async (req) => {
    const me = requireUser(req);
    if (!isId(req.params.id)) throw notFound("Note");
    const { helpful } = parse(noteRateSchema, req.body);
    const [n] = await sql<{ author_id: string; post_author: string }[]>`
      SELECT n.author_id, p.author_id AS post_author FROM community_notes n JOIN posts p ON p.id = n.post_id WHERE n.id = ${req.params.id}`;
    if (!n) throw notFound("Note");
    if (n.author_id === me.id) throw badRequest("You can't rate your own note");
    if (n.post_author === me.id) throw forbidden("You can't rate notes on your own post", "OWN_POST");
    const e = await eligibility(sql, me);
    if (!e.canRate) throw forbidden(e.reason ?? "Not eligible", "NOT_ELIGIBLE");
    await sql`
      INSERT INTO note_ratings (note_id, rater_id, helpful) VALUES (${req.params.id}, ${me.id}, ${RATING_VALUE[helpful]})
      ON CONFLICT (note_id, rater_id) DO UPDATE SET helpful = excluded.helpful, created_at = now()`;
    scheduler.schedule();
    return { ok: true };
  });

  /** "Rate notes" queue: notes still needing ratings that the viewer hasn't rated, with their posts. */
  app.get("/notes/needs-ratings", async (req) => {
    const me = requireUser(req);
    const e = await eligibility(sql, me);
    if (!e.canRate) return { items: [], eligibility: e.reason };
    const rows = await sql<{ id: string; post_id: string }[]>`
      SELECT n.id, n.post_id FROM community_notes n JOIN posts p ON p.id = n.post_id
      WHERE n.status = 'needs_ratings' AND n.author_id <> ${me.id} AND p.author_id <> ${me.id} AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM note_ratings r WHERE r.note_id = n.id AND r.rater_id = ${me.id})
      ORDER BY n.rating_count, n.id DESC LIMIT 20`;
    const posts = await hydratePosts({ db: sql, storage }, me.id, [...new Set(rows.map((r) => r.post_id))]);
    const items = [];
    for (const r of rows) {
      const post = posts.get(r.post_id);
      if (!post || post.unavailable) continue;
      const note = (await notesFor(me.id, r.post_id, true)).find((x) => x.id === r.id);
      if (note) items.push({ post, note });
    }
    return { items, eligibility: null };
  });
};

export default notesRoutes;
