// Demo Reels for local development. Generates short synthetic clips with ffmpeg (no external
// downloads), uploads them through the real API pipeline and posts them. Safe to re-run: skips if
// video posts already exist. Requires the base seed (`seed.ts`) to have run first.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../app";
import { config } from "../config";
import { createDb, migrate } from "../db";

const PASSWORD = "projectfeed-demo";
const CLIPS: { handle: string; source: string; seconds: number; size: string; text: string }[] = [
  { handle: "amara_fuel", source: "testsrc2", seconds: 8, size: "720x1280", text: "Loading window update from ARA — EN590 barges lining up #EN590 #reels" },
  { handle: "hk_bullion", source: "mandelbrot", seconds: 8, size: "720x1280", text: "What 400oz good delivery looks like under the vault lights #gold #reels" },
  { handle: "priya_freight", source: "life=s=720x1280:mold=10:r=30:ratio=0.1:death_color=#C8962E:life_color=#00897B", seconds: 7, size: "720x1280", text: "MR tanker berthing timelapse #shipping #reels" },
  { handle: "lme_lena", source: "cellauto=rule=110:s=720x1280", seconds: 6, size: "720x1280", text: "Copper cathode stacks — warrant cancellations explained in 60s #copper" },
  { handle: "lng_omar", source: "smptehdbars", seconds: 6, size: "1280x720", text: "JKM vs TTF in one chart #LNG" },
  { handle: "grainwatch", source: "gradients", seconds: 7, size: "720x1280", text: "Harvest pressure on Black Sea FOB #wheat #reels" },
];

const sql = createDb(config.databaseUrl);
await migrate(sql);
const [existing] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM posts WHERE has_video`;
if (existing!.n > 0) {
  console.log("Video posts already exist; skipping video seed.");
  await sql.end();
  process.exit(0);
}

process.env.RATE_LIMIT_PER_MIN = "100000";
process.env.AUTH_RATE_LIMIT_PER_MIN = "100000";
const app = await buildApp(config, sql);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-seed-video-"));

for (const clip of CLIPS) {
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { identifier: clip.handle, password: PASSWORD } });
  if (login.statusCode !== 200) throw new Error(`Login failed for ${clip.handle}; run the base seed first`);
  const auth = { authorization: `Bearer ${login.json().accessToken}` };

  const file = path.join(tmp, `${clip.handle}.mp4`);
  const src = clip.source.includes("=") ? clip.source : `${clip.source}=size=${clip.size}:rate=30`;
  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", src,
    "-f", "lavfi", "-i", `sine=frequency=${220 + Math.floor(Math.random() * 440)}:duration=${clip.seconds}`,
    "-vf", `scale=${clip.size.replace("x", ":")},format=yuv420p`,
    "-t", String(clip.seconds), "-c:v", "libx264", "-c:a", "aac", file,
  ]);

  const boundary = "----seedvideo";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
    fs.readFileSync(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const up = await app.inject({ method: "POST", url: "/v1/media", payload, headers: { ...auth, "content-type": `multipart/form-data; boundary=${boundary}` } });
  if (up.statusCode !== 202) throw new Error(`Upload failed: ${up.body}`);
  await app.ctx.video.idle();
  const res = await app.inject({ method: "POST", url: "/v1/posts", headers: auth, payload: { text: clip.text, mediaIds: [up.json().id] } });
  if (res.statusCode !== 201) throw new Error(`Post failed: ${res.body}`);
  console.log(`Posted reel for @${clip.handle}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
await app.close();
await sql.end();
