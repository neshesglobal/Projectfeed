// Discover: photo/video-first notes, verified reviews, places and collections.
//
// Places cost nothing to run: a reviewer drops a pin (their phone fills in the city with its own geocoder) and
// either picks a Projectfeed place already near that pin or names a new one. Duplicates nearby are merged.
// Maps are shown with the platform's free map view, and directions open the phone's own Maps app.

import type { FastifyPluginAsync } from "fastify";
import {
  collectionSchema,
  createPhotoNoteSchema,
  createPlaceSchema,
  detectLanguage,
  type Collection,
  type FeedItem,
  type Page,
  type Place,
} from "@projectfeed/shared";
import type { Db } from "../db";
import { requireUser } from "../lib/auth";
import { AppError, badRequest, conflict, forbidden, notFound, parse } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { effectiveBadge } from "../services/badges";
import { visiblePosts, type HydrateCtx } from "../services/hydrate";
import { notify } from "../services/notify";
import { containsMutedWord, idCursor, loadViewerFilters, pageSize } from "../services/timeline";
import { replyRegions, writeEntities } from "./posts";

/** Two pins closer than this with similar names are the same place. */
const DEDUPE_METRES = 75;
/** "Nearby" in Discover. */
const NEARBY_KM = 25;
const PLACES_PER_DAY = 20;

/** Bounding box (degrees) around a point, for an index-friendly prefilter before the exact distance. */
function box(lat: number, lng: number, metres: number) {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** Haversine distance in metres as SQL, from columns lat/lng of `alias` to a point. */
const distanceSql = (db: Db, alias: string, lat: number, lng: number) => db`
  (2 * 6371000 * asin(sqrt(
     power(sin(radians(${db.unsafe(alias)}.lat - ${lat}) / 2), 2) +
     cos(radians(${lat})) * cos(radians(${db.unsafe(alias)}.lat)) * power(sin(radians(${db.unsafe(alias)}.lng - ${lng}) / 2), 2))))`;

const num = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const discoverRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified } = app.ctx;
  const hctx: HydrateCtx = { db: sql, storage };

  async function placeStats(ids: string[]): Promise<Map<string, { reviews: number; rating: number | null; notes: number }>> {
    const out = new Map<string, { reviews: number; rating: number | null; notes: number }>();
    if (ids.length === 0) return out;
    // Computed live so removed reviews and suspended reviewers drop out of a place's rating automatically.
    const rows = await sql<{ place_id: string; reviews: number; rating: number | null; notes: number }[]>`
      SELECT p.place_id, count(*) FILTER (WHERE p.is_review)::int AS reviews,
             round(avg(p.rating) FILTER (WHERE p.is_review)::numeric, 1)::float AS rating, count(*)::int AS notes
      FROM posts p JOIN users u ON u.id = p.author_id AND u.status = 'active'
      WHERE p.place_id = ANY(${ids}::bigint[]) AND p.deleted_at IS NULL AND p.removed_at IS NULL
      GROUP BY p.place_id`;
    for (const r of rows) out.set(r.place_id, { reviews: r.reviews, rating: r.rating, notes: r.notes });
    return out;
  }

  type PlaceRow = { id: string; name: string; category: string; lat: number; lng: number; address: string; city: string; country: string | null; distance?: number };
  async function toPlaces(rows: PlaceRow[]): Promise<Place[]> {
    const stats = await placeStats(rows.map((r) => r.id));
    return rows.map((r) => {
      const s = stats.get(r.id);
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        lat: r.lat,
        lng: r.lng,
        address: r.address,
        city: r.city,
        country: r.country?.trim() ?? null,
        reviewCount: s?.reviews ?? 0,
        rating: s?.reviews ? s.rating : null,
        noteCount: s?.notes ?? 0,
        ...(r.distance !== undefined ? { distanceM: Math.round(r.distance) } : {}),
      };
    });
  }

  /** Hydrate note ids for a viewer, drop hidden ones, apply mutes. */
  async function noteItems(viewer: string, ids: string[]): Promise<FeedItem[]> {
    let posts = await visiblePosts(hctx, viewer, ids);
    const f = await loadViewerFilters(sql, viewer);
    posts = posts.filter((p) => !f.mutedUsers.has(p.author.id) && !containsMutedWord(`${p.title ?? ""} ${p.text}`, f.mutedWords));
    return posts.map((post) => ({ post, repostedBy: null, reason: null }));
  }

  // ───────────────────────────── Notes ─────────────────────────────

  app.post("/notes", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(createPhotoNoteSchema, req.body);
    if (input.placeId && !isId(input.placeId)) throw badRequest("Invalid place");
    if (input.review?.visitedOn && new Date(input.review.visitedOn) > new Date()) throw badRequest("The visit date can't be in the future");
    if (input.paidPartnership) {
      const badge = await effectiveBadge(sql, me.id);
      if (badge !== "business" && badge !== "creator") throw forbidden("Paid partnership labels are for verified businesses and creators", "BADGE_REQUIRED");
    }
    const id = newId();
    await sql.begin(async (tx) => {
      const owned = await tx<{ id: string; type: string; status: string }[]>`
        SELECT m.id, m.type, m.status FROM media m
        WHERE m.id = ANY(${input.mediaIds}::bigint[]) AND m.owner_id = ${me.id}
          AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)`;
      if (owned.length !== new Set(input.mediaIds).size) throw badRequest("Invalid or already-used media");
      if (owned.some((m) => m.status === "processing")) throw conflict("Your video is still processing", "MEDIA_PROCESSING");
      if (owned.some((m) => m.status !== "ready")) throw badRequest("One of your attachments failed to process");
      const hasVideo = owned.some((m) => m.type === "video");
      if (hasVideo && owned.length > 1) throw badRequest("A note can have one video, or up to 10 photos");
      if (input.placeId) {
        const [pl] = await tx`SELECT 1 FROM places WHERE id = ${input.placeId}`;
        if (!pl) throw badRequest("Unknown place");
      }
      await tx`
        INSERT INTO posts (id, author_id, kind, title, text, conversation_id, reply_audience, has_video, lang, paid_partnership,
                           place_id, is_review, rating, visited_on, reply_regions)
        VALUES (${id}, ${me.id}, 'note', ${input.title}, ${input.text}, ${id}, ${input.replyAudience}, ${hasVideo},
                ${detectLanguage(`${input.title} ${input.text}`)}, ${input.paidPartnership}, ${input.placeId ?? null},
                ${!!input.review}, ${input.review?.rating ?? null}, ${input.review?.visitedOn ?? null}, ${replyRegions(input.replyRegions)})`;
      for (const [i, mid] of input.mediaIds.entries()) {
        await tx`INSERT INTO post_media (post_id, media_id, position) VALUES (${id}, ${mid}, ${i})`;
      }
      await tx`UPDATE users SET posts_count = posts_count + 1 WHERE id = ${me.id}`;
      const mentioned = await writeEntities(tx, id, me.id, `${input.title}\n${input.text}`);
      for (const uid of mentioned) await notify(tx, { recipientId: uid, actorId: me.id, type: "mention", postId: id });
    });
    const [post] = await visiblePosts(hctx, me.id, [id]);
    reply.status(201);
    return post;
  });

  /**
   * Discover feed. Topics: "for-you" (default), "nearby" (needs lat/lng), "reviews", or a hashtag ("food").
   * Ranking: saves count double and comments triple, decaying over two days, weighted by the author's trust.
   * Reach-limited, removed and sensitive notes are never recommended here.
   */
  app.get<{ Querystring: { topic?: string; lat?: string; lng?: string; cursor?: string; limit?: string } }>("/feed/discover", async (req): Promise<Page<FeedItem>> => {
    const me = requireUser(req);
    const limit = pageSize(req.query.limit, 20, 40);
    const offset = Number(req.query.cursor ?? 0);
    if (!Number.isInteger(offset) || offset < 0) throw badRequest("Invalid cursor");
    const topic = (req.query.topic ?? "for-you").toLowerCase().replace(/^#/, "");
    const conds = [
      sql`p.kind = 'note'`,
      sql`p.deleted_at IS NULL`,
      sql`p.removed_at IS NULL`,
      sql`NOT p.limited`,
      sql`NOT p.sensitive`,
    ];
    // Float maths throughout: `extract(epoch …)` is numeric, and numeric power() made this 6× slower at scale.
    // exp(-ln2 · age / 48 h) is the same two-day half-life.
    let order = sql`ln(2 + p.like_count + 2 * p.bookmark_count + 3 * p.reply_count)
                    * exp(-0.6931471805599453 * extract(epoch FROM now() - p.created_at)::float8 / 172800)
                    * (0.6 + 0.008 * u.trust_score::float8) DESC, p.id DESC`;
    if (topic === "nearby") {
      const lat = num(req.query.lat, -90, 90);
      const lng = num(req.query.lng, -180, 180);
      if (lat === null || lng === null) throw badRequest("Nearby needs your location");
      const b = box(lat, lng, NEARBY_KM * 1000);
      conds.push(sql`pl.lat BETWEEN ${b.minLat} AND ${b.maxLat} AND pl.lng BETWEEN ${b.minLng} AND ${b.maxLng}`);
      order = sql`${distanceSql(sql, "pl", lat, lng)} ASC, p.id DESC`;
    } else if (topic === "reviews") {
      conds.push(sql`p.is_review`);
    } else if (topic !== "for-you") {
      conds.push(sql`EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ${topic} AND pt.kind = 'hashtag')`);
    }
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);
    const rows = await sql<{ id: string }[]>`
      SELECT p.id FROM posts p
      JOIN users u ON u.id = p.author_id AND u.status = 'active' AND NOT u.is_protected
      LEFT JOIN places pl ON pl.id = p.place_id
      WHERE ${where}
      ORDER BY ${order}
      OFFSET ${offset} LIMIT ${limit}`;
    return { items: await noteItems(me.id, rows.map((r) => r.id)), nextCursor: rows.length === limit ? String(offset + limit) : null };
  });

  /** Search notes by words in the title or text, or by hashtag; plus related hashtags from the results. */
  app.get<{ Querystring: { q?: string; cursor?: string } }>("/search/notes", async (req) => {
    const me = requireUser(req);
    const q = (req.query.q ?? "").trim().slice(0, 200);
    if (!q) return { items: [], related: [], nextCursor: null };
    const offset = Number(req.query.cursor ?? 0);
    if (!Number.isInteger(offset) || offset < 0) throw badRequest("Invalid cursor");
    const tag = q.startsWith("#") ? q.slice(1) : null;
    const match = tag
      ? sql`EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag = ${tag})`
      : sql`(p.search @@ websearch_to_tsquery('simple', ${q}) OR p.title ILIKE ${"%" + q + "%"})`;
    const rows = await sql<{ id: string }[]>`
      SELECT p.id FROM posts p JOIN users u ON u.id = p.author_id AND u.status = 'active' AND NOT u.is_protected
      WHERE p.kind = 'note' AND p.deleted_at IS NULL AND p.removed_at IS NULL AND NOT p.limited AND ${match}
      ORDER BY ln(2 + p.like_count + 2 * p.bookmark_count) DESC, p.id DESC OFFSET ${offset} LIMIT 20`;
    const related = await sql<{ tag: string }[]>`
      SELECT pt.tag::text AS tag, count(*) AS n FROM post_tags pt
      WHERE pt.post_id = ANY(${rows.map((r) => r.id)}::bigint[]) AND pt.kind = 'hashtag' AND (${tag}::text IS NULL OR pt.tag <> ${tag ?? ""})
      GROUP BY pt.tag ORDER BY n DESC LIMIT 6`;
    return { items: await noteItems(me.id, rows.map((r) => r.id)), related: related.map((r) => `#${r.tag}`), nextCursor: rows.length === 20 ? String(offset + 20) : null };
  });

  // ───────────────────────────── Places ─────────────────────────────

  /** Places already on Projectfeed near a pin (for the location picker), optionally filtered by name. */
  app.get<{ Querystring: { lat?: string; lng?: string; q?: string; radius?: string } }>("/places/nearby", async (req): Promise<{ items: Place[] }> => {
    requireUser(req);
    const lat = num(req.query.lat, -90, 90);
    const lng = num(req.query.lng, -180, 180);
    if (lat === null || lng === null) throw badRequest("lat and lng are required");
    const radius = num(req.query.radius, 50, 5000) ?? 800;
    const b = box(lat, lng, radius);
    const q = (req.query.q ?? "").trim().slice(0, 80);
    const rows = await sql<PlaceRow[]>`
      SELECT id, name, category, lat, lng, address, city, country, ${distanceSql(sql, "places", lat, lng)} AS distance
      FROM places
      WHERE lat BETWEEN ${b.minLat} AND ${b.maxLat} AND lng BETWEEN ${b.minLng} AND ${b.maxLng}
        ${q ? sql`AND (name ILIKE ${"%" + q + "%"} OR similarity(name, ${q}) > 0.3)` : sql``}
      ORDER BY distance LIMIT 20`;
    return { items: await toPlaces(rows.filter((r) => (r.distance ?? 0) <= radius)) };
  });

  /** Add a place. If the same place already exists within 75 m, that one is returned instead. */
  app.post("/places", { preHandler: requireVerified }, async (req, reply): Promise<{ place: Place; existing: boolean }> => {
    const me = requireUser(req);
    const input = parse(createPlaceSchema, req.body);
    const b = box(input.lat, input.lng, DEDUPE_METRES);
    const [dupe] = await sql<PlaceRow[]>`
      SELECT id, name, category, lat, lng, address, city, country FROM places
      WHERE lat BETWEEN ${b.minLat} AND ${b.maxLat} AND lng BETWEEN ${b.minLng} AND ${b.maxLng}
        AND (lower(name) = lower(${input.name}) OR similarity(name, ${input.name}) > 0.5)
      ORDER BY similarity(name, ${input.name}) DESC LIMIT 1`;
    if (dupe) return { place: (await toPlaces([dupe]))[0]!, existing: true };
    const [{ n }] = (await sql`SELECT count(*)::int AS n FROM places WHERE created_by = ${me.id} AND created_at > now() - interval '24 hours'`) as unknown as [{ n: number }];
    if (n >= PLACES_PER_DAY) throw new AppError(429, "PLACE_LIMIT", `You can add up to ${PLACES_PER_DAY} places a day`);
    const [row] = await sql<PlaceRow[]>`
      INSERT INTO places (id, name, category, lat, lng, address, city, country, created_by)
      VALUES (${newId()}, ${input.name}, ${input.category}, ${input.lat}, ${input.lng}, ${input.address}, ${input.city},
              ${input.country?.toUpperCase() ?? null}, ${me.id})
      RETURNING id, name, category, lat, lng, address, city, country`;
    reply.status(201);
    return { place: (await toPlaces([row!]))[0]!, existing: false };
  });

  app.get<{ Params: { id: string } }>("/places/:id", async (req): Promise<Place> => {
    requireUser(req);
    if (!isId(req.params.id)) throw notFound("Place");
    const [row] = await sql<PlaceRow[]>`SELECT id, name, category, lat, lng, address, city, country FROM places WHERE id = ${req.params.id}`;
    if (!row) throw notFound("Place");
    return (await toPlaces([row]))[0]!;
  });

  /** Notes and reviews at a place, newest first. `?reviews=1` for reviews only. */
  app.get<{ Params: { id: string }; Querystring: { reviews?: string; cursor?: string } }>("/places/:id/notes", async (req): Promise<Page<FeedItem>> => {
    const me = requireUser(req);
    if (!isId(req.params.id)) throw notFound("Place");
    const rows = await sql<{ id: string }[]>`
      SELECT p.id FROM posts p
      WHERE p.place_id = ${req.params.id} AND p.deleted_at IS NULL AND p.removed_at IS NULL
        ${req.query.reviews === "1" ? sql`AND p.is_review` : sql``} AND p.id < ${idCursor(req.query.cursor)}
      ORDER BY p.id DESC LIMIT 20`;
    return { items: await noteItems(me.id, rows.map((r) => r.id)), nextCursor: rows.length === 20 ? rows[rows.length - 1]!.id : null };
  });

  // ───────────────────────────── Collections ─────────────────────────────

  async function collectionsFor(ownerId: string, includePrivate: boolean): Promise<Collection[]> {
    const rows = await sql<{ id: string; name: string; is_private: boolean; updated_at: Date; n: number }[]>`
      SELECT c.id, c.name, c.is_private, c.updated_at, (SELECT count(*)::int FROM collection_items ci WHERE ci.collection_id = c.id) AS n
      FROM collections c WHERE c.owner_id = ${ownerId} ${includePrivate ? sql`` : sql`AND NOT c.is_private`}
      ORDER BY c.updated_at DESC`;
    const covers = await sql<{ collection_id: string; thumb_key: string }[]>`
      SELECT x.collection_id, x.thumb_key FROM (
        SELECT ci.collection_id, m.thumb_key, row_number() OVER (PARTITION BY ci.collection_id ORDER BY ci.added_at DESC) AS rn
        FROM collection_items ci
        JOIN posts p ON p.id = ci.post_id AND p.deleted_at IS NULL AND p.removed_at IS NULL
        JOIN post_media pm ON pm.post_id = p.id AND pm.position = 0
        JOIN media m ON m.id = pm.media_id AND m.status = 'ready'
        WHERE ci.collection_id = ANY(${rows.map((r) => r.id)}::bigint[])
      ) x WHERE x.rn <= 4`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      isPrivate: r.is_private,
      itemCount: r.n,
      covers: covers.filter((c) => c.collection_id === r.id).map((c) => storage.url(c.thumb_key)),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async function ownCollection(userId: string, id: string) {
    if (!isId(id)) throw notFound("Collection");
    const [c] = await sql`SELECT 1 FROM collections WHERE id = ${id} AND owner_id = ${userId}`;
    if (!c) throw notFound("Collection");
  }

  app.get("/me/collections", async (req) => ({ items: await collectionsFor(requireUser(req).id, true) }));

  app.get<{ Params: { id: string } }>("/users/:id/collections", async (req) => {
    requireUser(req);
    if (!isId(req.params.id)) throw notFound("User");
    return { items: await collectionsFor(req.params.id, false) };
  });

  app.post("/me/collections", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(collectionSchema, req.body);
    const id = newId();
    try {
      await sql`INSERT INTO collections (id, owner_id, name, is_private) VALUES (${id}, ${me.id}, ${input.name}, ${input.isPrivate})`;
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw conflict("You already have a collection with that name", "COLLECTION_EXISTS");
      throw e;
    }
    reply.status(201);
    return (await collectionsFor(me.id, true)).find((c) => c.id === id);
  });

  app.patch<{ Params: { id: string } }>("/me/collections/:id", async (req) => {
    const me = requireUser(req);
    await ownCollection(me.id, req.params.id);
    const input = parse(collectionSchema.partial(), req.body);
    await sql`UPDATE collections SET name = coalesce(${input.name ?? null}, name), is_private = coalesce(${input.isPrivate ?? null}, is_private),
              updated_at = now() WHERE id = ${req.params.id}`;
    return (await collectionsFor(me.id, true)).find((c) => c.id === req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/me/collections/:id", async (req, reply) => {
    const me = requireUser(req);
    await ownCollection(me.id, req.params.id);
    await sql`DELETE FROM collections WHERE id = ${req.params.id}`;
    reply.status(204);
  });

  /** Save a post into a collection (also bookmarks it, so it appears in All saves). */
  app.post<{ Params: { id: string } }>("/me/collections/:id/items", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    await ownCollection(me.id, req.params.id);
    const postId = String((req.body as { postId?: string } | undefined)?.postId ?? "");
    const [post] = await visiblePosts(hctx, me.id, isId(postId) ? [postId] : []);
    if (!post) throw notFound("Post");
    await sql.begin(async (tx) => {
      await tx`INSERT INTO collection_items (collection_id, post_id) VALUES (${req.params.id}, ${post.id}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE collections SET updated_at = now() WHERE id = ${req.params.id}`;
      const b = await tx`INSERT INTO bookmarks (user_id, post_id) VALUES (${me.id}, ${post.id}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (b.count > 0) await tx`UPDATE posts SET bookmark_count = bookmark_count + 1 WHERE id = ${post.id}`;
    });
    reply.status(201);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; postId: string } }>("/me/collections/:id/items/:postId", async (req, reply) => {
    const me = requireUser(req);
    await ownCollection(me.id, req.params.id);
    await sql`DELETE FROM collection_items WHERE collection_id = ${req.params.id} AND post_id = ${req.params.postId}`;
    reply.status(204);
  });

  /** Which of my collections contain this post (for the Save sheet). */
  app.get<{ Params: { id: string } }>("/posts/:id/saved-in", async (req) => {
    const me = requireUser(req);
    if (!isId(req.params.id)) throw notFound("Post");
    const rows = await sql<{ id: string }[]>`
      SELECT c.id FROM collections c JOIN collection_items ci ON ci.collection_id = c.id
      WHERE c.owner_id = ${me.id} AND ci.post_id = ${req.params.id}`;
    return { collectionIds: rows.map((r) => r.id) };
  });

  /** A collection's posts: the owner's, or anyone's if public. */
  app.get<{ Params: { id: string }; Querystring: { cursor?: string } }>("/collections/:id", async (req) => {
    const me = requireUser(req);
    if (!isId(req.params.id)) throw notFound("Collection");
    const [c] = await sql<{ owner_id: string; is_private: boolean }[]>`SELECT owner_id, is_private FROM collections WHERE id = ${req.params.id}`;
    if (!c || (c.is_private && c.owner_id !== me.id)) throw notFound("Collection");
    const rows = await sql<{ post_id: string; ts: string }[]>`
      SELECT post_id, (extract(epoch FROM added_at) * 1000000)::bigint::text AS ts FROM collection_items
      WHERE collection_id = ${req.params.id} AND (extract(epoch FROM added_at) * 1000000)::bigint < ${idCursor(req.query.cursor)}::bigint
      ORDER BY added_at DESC LIMIT 30`;
    const collection = (await collectionsFor(c.owner_id, c.owner_id === me.id)).find((x) => x.id === req.params.id)!;
    return {
      collection,
      ownerId: c.owner_id,
      items: await noteItems(me.id, rows.map((r) => r.post_id)),
      nextCursor: rows.length === 30 ? rows[rows.length - 1]!.ts : null,
    };
  });
};

export default discoverRoutes;
