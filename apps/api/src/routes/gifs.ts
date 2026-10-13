import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireUser } from "../lib/auth";
import { AppError, badRequest, notFound, parse } from "../lib/errors";
import { newId } from "../lib/ids";
import { DemoGifProvider, type GifPage } from "../services/gifs";
import { MEDIA_COLUMNS, toMedia, type MediaRow } from "../services/hydrate";

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 300;

/** GIF search for the composer, proxied so the provider key stays on the server. */
const gifRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified, gifs } = app.ctx;
  const hctx = { db: sql, storage };
  // Small response cache: trending and popular searches repeat a lot, and provider rate limits are tight.
  const cache = new Map<string, { at: number; page: GifPage }>();
  const cached = async (key: string, load: () => Promise<GifPage>) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.page;
    let page: GifPage;
    try {
      page = await load();
    } catch (e) {
      app.log.warn(e);
      throw new AppError(502, "GIFS_UNAVAILABLE", "GIFs aren't available right now. Try again in a moment.");
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), page });
    return page;
  };
  const need = () => {
    if (!gifs) throw new AppError(404, "GIFS_OFF", "GIFs are switched off");
    return gifs;
  };
  const locale = (l?: string) => (l && /^[a-z]{2}(_[A-Z]{2})?$/.test(l) ? l : "en_IN");

  app.get("/gifs/config", async () => ({ enabled: !!gifs, provider: gifs?.name ?? null, attribution: gifs?.attribution ?? null }));

  app.get<{ Querystring: { cursor?: string; locale?: string } }>("/gifs/trending", async (req) => {
    requireUser(req);
    const g = need();
    const loc = locale(req.query.locale);
    return cached(`t:${loc}:${req.query.cursor ?? ""}`, () => g.trending(req.query.cursor ?? null, loc));
  });

  app.get<{ Querystring: { q?: string; cursor?: string; locale?: string } }>("/gifs/search", async (req) => {
    requireUser(req);
    const g = need();
    const q = (req.query.q ?? "").trim().toLowerCase().slice(0, 50);
    if (!q) return { items: [], next: null };
    const loc = locale(req.query.locale);
    return cached(`s:${loc}:${q}:${req.query.cursor ?? ""}`, () => g.search(q, req.query.cursor ?? null, loc));
  });

  /** Attach a GIF from the library: looked up by id on the server, then stored as a ready "gif" media item. */
  app.post("/media/gif", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const g = need();
    const { id: gifId } = parse(z.object({ id: z.string().min(1).max(60) }), req.body);
    const gif = await g.get(gifId);
    if (!gif) throw notFound("GIF");
    // Library GIFs are hotlinked from the provider's CDN (their terms); demo GIFs live in our own storage.
    const keys = g instanceof DemoGifProvider ? g.keys(gifId) : { main: gif.url, still: gif.stillUrl };
    if (!keys.main || !gif.width || !gif.height) throw badRequest("This GIF can't be used");
    const [row] = await sql<MediaRow[]>`
      INSERT INTO media (id, owner_id, type, storage_key, thumb_key, width, height, alt_text, processed_at, gif_provider)
      VALUES (${newId()}, ${me.id}, 'gif', ${keys.main}, ${keys.still}, ${gif.width}, ${gif.height}, ${gif.title.slice(0, 1000)}, now(), ${g.name})
      RETURNING ${sql.unsafe(MEDIA_COLUMNS)}`;
    reply.status(201);
    return toMedia(hctx, row!);
  });
};

export default gifRoutes;
