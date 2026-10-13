// Video processing: probe → transcode to H.264/AAC MP4 (faststart) → poster frame.
// Runs in-process with bounded concurrency. In production this stage moves to a managed
// transcoder (Mux / Cloudflare Stream) for HLS adaptive bitrate; the media row contract stays the same.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Sql } from "../db";
import type { Storage } from "../lib/storage";
import { fileDigests, recordScan, type MediaScanner } from "./screening";

export const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/3gpp", "video/x-matroska"]);
export const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
export const MAX_VIDEO_MS = 10 * 60 * 1000;
const MAX_LONG_SIDE = 1280; // 720p-class output; adaptive renditions come with the managed transcoder

interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

function run(cmd: string, args: string[], timeoutMs = 15 * 60_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.split("\n").slice(-3).join(" ")}`));
    });
  });
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], 60_000);
  const info = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
    format?: { duration?: string };
  };
  const video = info.streams?.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("No video stream");
  const rotation = Math.abs(Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0));
  const swap = rotation === 90 || rotation === 270;
  return {
    durationMs: Math.round(Number(info.format?.duration ?? 0) * 1000),
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    hasAudio: !!info.streams?.some((s) => s.codec_type === "audio"),
  };
}

/** Transcode for universal mobile playback and strip all metadata (GPS location, device, creation time). */
export async function transcode(input: string, output: string, p: ProbeResult): Promise<void> {
  const landscape = p.width >= p.height;
  const scale = landscape ? `scale='min(${MAX_LONG_SIDE},iw)':-2` : `scale=-2:'min(${MAX_LONG_SIDE},ih)'`;
  const args = [
    "-y", "-v", "error", "-i", input,
    "-map", "0:v:0", ...(p.hasAudio ? ["-map", "0:a:0"] : []),
    "-vf", `${scale},fps=fps='min(source_fps,30)'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "high", "-pix_fmt", "yuv420p",
    ...(p.hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : []),
    "-map_metadata", "-1", "-map_chapters", "-1",
    "-movflags", "+faststart",
    output,
  ];
  await run("ffmpeg", args);
}

export async function posterFrame(video: string, output: string, durationMs: number): Promise<void> {
  const at = Math.min(1, durationMs / 2000).toFixed(2);
  await run("ffmpeg", ["-y", "-v", "error", "-ss", at, "-i", video, "-frames:v", "1", "-q:v", "3", output], 60_000);
}

/** Keyframes at 10%, 50% and 90% of the video, as JPEG buffers, for hash screening. */
async function sampleFrames(video: string, durationMs: number, work: string): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const [i, f] of [0.1, 0.5, 0.9].entries()) {
    const file = path.join(work, `frame-${i}.jpg`);
    await run("ffmpeg", ["-y", "-v", "error", "-ss", ((durationMs * f) / 1000).toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "3", file], 60_000);
    out.push(await fs.readFile(file).catch(() => Buffer.alloc(0)));
  }
  return out.filter((b) => b.length > 0);
}

/** Bounded in-process job queue for video processing. */
export class VideoProcessor {
  private queue: string[] = [];
  private running = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private sql: Sql,
    private storage: Storage,
    private scanner: MediaScanner,
    private concurrency = Number(process.env.VIDEO_CONCURRENCY ?? 1),
  ) {}

  enqueue(mediaId: string): void {
    this.queue.push(mediaId);
    this.pump();
  }

  /** Re-queue uploads interrupted by a restart; fail ones whose source file is gone. */
  async recover(): Promise<void> {
    const rows = await this.sql<{ id: string; source_key: string | null }[]>`
      SELECT id, source_key FROM media WHERE status = 'processing'`;
    for (const r of rows) {
      const exists = r.source_key ? await fs.stat(r.source_key).then(() => true, () => false) : false;
      if (exists) this.enqueue(r.id);
      else await this.sql`UPDATE media SET status = 'failed', error = 'Upload interrupted' WHERE id = ${r.id}`;
    }
  }

  /** Resolves when no jobs are queued or running (used by tests and graceful shutdown). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.running++;
      void this.process(id).finally(() => {
        this.running--;
        if (this.running === 0 && this.queue.length === 0) this.idleWaiters.splice(0).forEach((r) => r());
        this.pump();
      });
    }
  }

  private async process(id: string): Promise<void> {
    const [m] = await this.sql<{ owner_id: string; source_key: string | null }[]>`
      SELECT owner_id, source_key FROM media WHERE id = ${id} AND status = 'processing'`;
    if (!m?.source_key) return;
    const work = path.join(this.storage.tmpDir(), `work-${id}`);
    await fs.mkdir(work, { recursive: true });
    const out = path.join(work, "video.mp4");
    const posterJpg = path.join(work, "poster.jpg");
    try {
      const p = await probe(m.source_key);
      if (p.durationMs <= 0) throw new Error("Video has no duration");
      if (p.durationMs > MAX_VIDEO_MS) throw new Error("Video is longer than 10 minutes");
      await transcode(m.source_key, out, p);
      const final = await probe(out);
      await posterFrame(out, posterJpg, final.durationMs);
      const poster = await sharp(posterJpg).webp({ quality: 80 }).toBuffer();
      // Screen the original file and sampled keyframes before anything is published.
      const frames = await sampleFrames(out, final.durationMs, work);
      const scan = await this.scanner.scan({ digests: await fileDigests(m.source_key), frames: [await fs.readFile(posterJpg), ...frames] });
      if ((await recordScan(this.sql, { id, ownerId: m.owner_id }, scan)) === "quarantined") return;

      const key = `${m.owner_id}/${id}.mp4`;
      const thumbKey = `${m.owner_id}/${id}_poster.webp`;
      const size = (await fs.stat(out)).size;
      await this.storage.putFile(key, out, "video/mp4");
      await this.storage.put(thumbKey, poster, "image/webp");
      await this.sql`
        UPDATE media SET status = 'ready', storage_key = ${key}, thumb_key = ${thumbKey},
          width = ${final.width}, height = ${final.height}, duration_ms = ${final.durationMs},
          size_bytes = ${size}, source_key = NULL, processed_at = now()
        WHERE id = ${id}`;
    } catch (e) {
      // The user sees a generic message; the real cause (usually ffmpeg's stderr) goes to the server log.
      console.error(`[video] processing failed for media ${id}:`, e instanceof Error ? e.message : e);
      const msg = e instanceof Error && /longer than|no duration|No video stream/.test(e.message) ? e.message : "Could not process this video";
      await this.sql`UPDATE media SET status = 'failed', error = ${msg}, source_key = NULL WHERE id = ${id}`;
    } finally {
      await fs.rm(m.source_key, { force: true });
      await fs.rm(work, { recursive: true, force: true });
    }
  }
}
