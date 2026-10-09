import type { FastifyPluginAsync } from "fastify";
import sharp, { type OutputInfo } from "sharp";
import { requireUser } from "../lib/auth";
import { badRequest, notFound } from "../lib/errors";
import { newId } from "../lib/ids";
import { toMedia, type MediaRow } from "../services/hydrate";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const MAX_DIMENSION = 2048;
const THUMB_DIMENSION = 600;

const mediaRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified } = app.ctx;
  const hctx = { db: sql, storage };

  /**
   * Upload an image or GIF. Images are re-encoded to WebP, which strips EXIF (including GPS location).
   * Video goes through a managed transcoder (Mux) in a later phase.
   */
  app.post("/media", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const file = await req.file();
    if (!file) throw badRequest("No file uploaded");
    if (!IMAGE_TYPES.has(file.mimetype)) throw badRequest("Unsupported file type");
    const input = await file.toBuffer();
    if (file.file.truncated) throw badRequest("File too large");
    const altField = file.fields.altText as { value?: string } | undefined;
    const altText = (altField?.value ?? "").slice(0, 1000);

    const animated = file.mimetype === "image/gif";
    let full: { data: Buffer; info: OutputInfo };
    let thumb: Buffer;
    try {
      const img = sharp(input, { animated, limitInputPixels: 50_000_000 }).rotate();
      full = await img
        .clone()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      thumb = await sharp(input, { limitInputPixels: 50_000_000 })
        .rotate()
        .resize({ width: THUMB_DIMENSION, height: THUMB_DIMENSION, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 75 })
        .toBuffer();
    } catch {
      throw badRequest("Could not process image");
    }
    // Hook: CSAM hash-matching (PhotoDNA / IWF list) must run here before anything is stored. See DEV_PLAN §M6.

    const id = newId();
    const key = `${me.id}/${id}.webp`;
    const thumbKey = `${me.id}/${id}_thumb.webp`;
    await storage.put(key, full.data, "image/webp");
    await storage.put(thumbKey, thumb, "image/webp");
    const height = animated && full.info.pageHeight ? full.info.pageHeight : full.info.height;
    const [row] = await sql<MediaRow[]>`
      INSERT INTO media (id, owner_id, type, storage_key, thumb_key, width, height, alt_text)
      VALUES (${id}, ${me.id}, ${animated ? "gif" : "image"}, ${key}, ${thumbKey}, ${full.info.width}, ${height}, ${altText})
      RETURNING id, type, storage_key, thumb_key, width, height, alt_text`;
    reply.status(201);
    return toMedia(hctx, row!);
  });

  app.patch<{ Params: { id: string } }>("/media/:id", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    const altText = String((req.body as { altText?: string } | undefined)?.altText ?? "").slice(0, 1000);
    const [row] = await sql<MediaRow[]>`
      UPDATE media SET alt_text = ${altText} WHERE id = ${req.params.id} AND owner_id = ${me.id}
      RETURNING id, type, storage_key, thumb_key, width, height, alt_text`;
    if (!row) throw notFound("Media");
    return toMedia(hctx, row);
  });
};

export default mediaRoutes;
