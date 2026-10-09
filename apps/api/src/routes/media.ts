import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { FastifyPluginAsync } from "fastify";
import sharp, { type OutputInfo } from "sharp";
import { requireUser } from "../lib/auth";
import { AppError, badRequest, notFound } from "../lib/errors";
import { isId, newId } from "../lib/ids";
import { MEDIA_COLUMNS, toMedia, type MediaRow } from "../services/hydrate";
import { MAX_VIDEO_BYTES, VIDEO_TYPES } from "../services/video";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const MAX_DIMENSION = 2048;
const THUMB_DIMENSION = 600;

/** Buffer a stream but give up as soon as it exceeds `max` bytes (images are small; videos stream to disk). */
async function bufferWithLimit(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += (chunk as Buffer).length;
    if (size > max) {
      stream.resume();
      throw new AppError(413, "FILE_TOO_LARGE", `Images must be under ${Math.round(max / 1024 / 1024)}MB`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const mediaRoutes: FastifyPluginAsync = async (app) => {
  const { sql, storage, requireVerified, cfg, video } = app.ctx;
  const hctx = { db: sql, storage };
  fs.mkdirSync(storage.tmpDir(), { recursive: true });

  /**
   * Upload an image, GIF or video.
   * - Images are re-encoded to WebP synchronously, which strips EXIF (including GPS location).
   * - Videos are stored to a private scratch area and transcoded asynchronously: the response is
   *   202 with status "processing"; clients poll GET /media/:id until "ready" before posting.
   */
  app.post("/media", { preHandler: requireVerified }, async (req, reply) => {
    const me = requireUser(req);
    const file = await req.file({ limits: { fileSize: MAX_VIDEO_BYTES, files: 1 } });
    if (!file) throw badRequest("No file uploaded");
    const altField = file.fields.altText as { value?: string } | undefined;
    const altText = (altField?.value ?? "").slice(0, 1000);
    const id = newId();

    if (VIDEO_TYPES.has(file.mimetype)) {
      const source = path.join(storage.tmpDir(), `upload-${id}`);
      try {
        await pipeline(file.file, fs.createWriteStream(source));
      } catch {
        await fs.promises.rm(source, { force: true });
        throw badRequest("Upload failed");
      }
      if (file.file.truncated) {
        await fs.promises.rm(source, { force: true });
        throw new AppError(413, "FILE_TOO_LARGE", "Videos must be under 512MB");
      }
      const [row] = await sql<MediaRow[]>`
        INSERT INTO media (id, owner_id, type, storage_key, thumb_key, width, height, alt_text, status, source_key, size_bytes)
        VALUES (${id}, ${me.id}, 'video', '', '', 0, 0, ${altText}, 'processing', ${source}, ${(await fs.promises.stat(source)).size})
        RETURNING ${sql.unsafe(MEDIA_COLUMNS)}`;
      video.enqueue(id);
      reply.status(202);
      return toMedia(hctx, row!);
    }

    if (!IMAGE_TYPES.has(file.mimetype)) {
      file.file.resume();
      throw badRequest("Unsupported file type. Upload a photo, GIF or video.");
    }
    const input = await bufferWithLimit(file.file, cfg.maxMediaBytes);
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

    const key = `${me.id}/${id}.webp`;
    const thumbKey = `${me.id}/${id}_thumb.webp`;
    await storage.put(key, full.data, "image/webp");
    await storage.put(thumbKey, thumb, "image/webp");
    const height = animated && full.info.pageHeight ? full.info.pageHeight : full.info.height;
    const [row] = await sql<MediaRow[]>`
      INSERT INTO media (id, owner_id, type, storage_key, thumb_key, width, height, alt_text, size_bytes, processed_at)
      VALUES (${id}, ${me.id}, ${animated ? "gif" : "image"}, ${key}, ${thumbKey}, ${full.info.width}, ${height}, ${altText},
              ${full.data.length}, now())
      RETURNING ${sql.unsafe(MEDIA_COLUMNS)}`;
    reply.status(201);
    return toMedia(hctx, row!);
  });

  /** Poll processing status of an upload (owner only). */
  app.get<{ Params: { id: string } }>("/media/:id", async (req) => {
    const me = requireUser(req);
    if (!isId(req.params.id)) throw notFound("Media");
    const [row] = await sql<MediaRow[]>`
      SELECT ${sql.unsafe(MEDIA_COLUMNS)} FROM media WHERE id = ${req.params.id} AND owner_id = ${me.id}`;
    if (!row) throw notFound("Media");
    return toMedia(hctx, row);
  });

  app.patch<{ Params: { id: string } }>("/media/:id", { preHandler: requireVerified }, async (req) => {
    const me = requireUser(req);
    if (!isId(req.params.id)) throw notFound("Media");
    const altText = String((req.body as { altText?: string } | undefined)?.altText ?? "").slice(0, 1000);
    const [row] = await sql<MediaRow[]>`
      UPDATE media SET alt_text = ${altText} WHERE id = ${req.params.id} AND owner_id = ${me.id}
      RETURNING ${sql.unsafe(MEDIA_COLUMNS)}`;
    if (!row) throw notFound("Media");
    return toMedia(hctx, row);
  });
};

export default mediaRoutes;
