import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reelScore, type ReelCandidate } from "../src/feed/reels";
import { call, post, register, setup, upload, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pf-video-"));

/** Make a short H.264 clip with audio and a GPS location tag (which processing must strip). */
function makeVideo(name: string, width: number, height: number, seconds: number): Buffer {
  const out = path.join(tmp, name);
  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-metadata", "location=+51.5074-000.1278/", "-metadata", "title=secret",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out,
  ]);
  return fs.readFileSync(out);
}

async function uploadReady(user: TestUser, data: Buffer) {
  const up = await upload(env.app, user, data, "video/mp4", "clip.mp4");
  expect(up.status).toBe(202);
  expect(up.body.status).toBe("processing");
  await env.app.ctx.video.idle();
  return (await call(env.app, user, "GET", `/v1/media/${up.body.id}`)).body;
}

beforeAll(async () => {
  env = await setup();
  [alice, bob, carol] = (await Promise.all(["alice", "bob", "carol"].map((h) => register(env.app, h)))) as [TestUser, TestUser, TestUser];
});
afterAll(async () => {
  await env.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("video upload & processing", () => {
  it("transcodes to MP4 with a poster, records duration and strips metadata", async () => {
    const media = await uploadReady(alice, makeVideo("portrait.mp4", 360, 640, 3));
    expect(media).toMatchObject({ type: "video", status: "ready", width: 360, height: 640 });
    expect(media.durationMs).toBeGreaterThan(2500);
    expect(media.durationMs).toBeLessThan(3500);

    const file = await env.app.inject({ method: "GET", url: new URL(media.url).pathname });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toContain("video/mp4");
    const local = path.join(tmp, "served.mp4");
    fs.writeFileSync(local, file.rawPayload);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", local]).toString());
    expect(probe.streams.find((s: any) => s.codec_type === "video").codec_name).toBe("h264");
    expect(probe.streams.find((s: any) => s.codec_type === "audio").codec_name).toBe("aac");
    const tags = JSON.stringify(probe.format.tags ?? {});
    expect(tags).not.toContain("51.5074");
    expect(tags).not.toContain("secret");

    // Range requests are required for mobile video players to seek.
    const range = await env.app.inject({ method: "GET", url: new URL(media.url).pathname, headers: { range: "bytes=0-99" } });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(100);

    const poster = await env.app.inject({ method: "GET", url: new URL(media.thumbUrl).pathname });
    expect(poster.statusCode).toBe(200);
  });

  it("scales large landscape video down to 720p-class", async () => {
    const media = await uploadReady(alice, makeVideo("wide.mp4", 1920, 1080, 1));
    expect(media).toMatchObject({ status: "ready", width: 1280, height: 720 });
  });

  it("marks corrupt uploads as failed and never exposes them", async () => {
    const up = await upload(env.app, alice, Buffer.from("this is not a video"), "video/mp4", "bad.mp4");
    expect(up.status).toBe(202);
    await env.app.ctx.video.idle();
    const m = await call(env.app, alice, "GET", `/v1/media/${up.body.id}`);
    expect(m.body).toMatchObject({ status: "failed", url: "" });
    expect((await call(env.app, alice, "POST", "/v1/posts", { text: "x", mediaIds: [up.body.id] })).status).toBe(400);
  });

  it("refuses to attach video that is still processing, or mixed with photos", async () => {
    const up = await upload(env.app, alice, makeVideo("slow.mp4", 320, 240, 1), "video/mp4");
    const early = await call(env.app, alice, "POST", "/v1/posts", { text: "too soon", mediaIds: [up.body.id] });
    // Processing may already have finished on a fast machine; if not, the API must say so.
    if (early.status !== 201) expect(early.body.error.code).toBe("MEDIA_PROCESSING");
    await env.app.ctx.video.idle();
    expect((await call(env.app, bob, "GET", `/v1/media/${up.body.id}`)).status).toBe(404); // owner only

    const vid = await uploadReady(alice, makeVideo("mix.mp4", 320, 240, 1));
    const img = await upload(env.app, alice, await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer(), "image/png");
    const mixed = await call(env.app, alice, "POST", "/v1/posts", { text: "mixed", mediaIds: [vid.id, img.body.id] });
    expect(mixed.status).toBe(400);
  });

  it("rejects unsupported file types", async () => {
    expect((await upload(env.app, alice, Buffer.from("%PDF-1.4"), "application/pdf", "a.pdf")).status).toBe(400);
  });
});

describe("Reels", () => {
  it("ranks video posts by watch behaviour, pins the tapped reel first, and pages without duplicates", async () => {
    const v1 = await uploadReady(alice, makeVideo("a.mp4", 360, 640, 2));
    const v2 = await uploadReady(bob, makeVideo("b.mp4", 360, 640, 2));
    const v3 = await uploadReady(bob, makeVideo("c.mp4", 640, 360, 2));
    const p1 = await post(env.app, alice, "Loading EN590 at Rotterdam #reels", { mediaIds: [v1.id] });
    const p2 = await post(env.app, bob, "Gold bar inspection", { mediaIds: [v2.id] });
    const p3 = await post(env.app, bob, "Tanker timelapse", { mediaIds: [v3.id] });
    await post(env.app, bob, "text only, not a reel");
    expect(p1.media[0]).toMatchObject({ type: "video", status: "ready" });

    // Bob's first reel gets watched to the end repeatedly: it should lead the feed.
    const ts = new Date().toISOString();
    for (const u of [alice, carol]) {
      await call(env.app, u, "POST", "/v1/events", {
        events: [
          { type: "video_view", postId: p2.id, surface: "reels", durationMs: 2000, ts },
          { type: "video_view", postId: p2.id, surface: "reels", durationMs: 2000, ts },
          { type: "video_view", postId: p3.id, surface: "reels", durationMs: 200, ts },
        ],
      });
    }
    const [stats] = await env.sql<{ plays: number; completions: number; watch_ms: string }[]>`
      SELECT plays, completions, watch_ms::text FROM video_stats WHERE post_id = ${p2.id}`;
    expect(stats).toMatchObject({ plays: 4, completions: 4 });
    expect((await call(env.app, alice, "GET", `/v1/posts/${p2.id}`)).body.counts.views).toBeGreaterThanOrEqual(2);

    const viewer = await register(env.app, "viewer");
    const reels = await call(env.app, viewer, "GET", "/v1/feed/reels");
    const order = reels.body.items.map((i: any) => i.post.id);
    expect(order).toHaveLength(3);
    expect(order[0]).toBe(p2.id);
    expect(order).not.toContain(undefined);

    const pinned = await call(env.app, viewer, "GET", `/v1/feed/reels?startId=${p3.id}`);
    expect(pinned.body.items[0].post.id).toBe(p3.id);
    expect(new Set(pinned.body.items.map((i: any) => i.post.id)).size).toBe(3);

    const seen: string[] = [];
    let cursor: string | null = "";
    while (cursor !== null) {
      const r: any = await call(env.app, viewer, "GET", `/v1/feed/reels?limit=1&cursor=${cursor}`);
      seen.push(...r.body.items.map((i: any) => i.post.id));
      cursor = r.body.nextCursor;
    }
    expect(seen.sort()).toEqual([p1.id, p2.id, p3.id].sort());

    // Blocking an author removes their reels.
    await call(env.app, viewer, "POST", `/v1/users/${bob.id}/block`);
    const afterBlock = await call(env.app, viewer, "GET", "/v1/feed/reels");
    expect(afterBlock.body.items.map((i: any) => i.post.id)).toEqual([p1.id]);
  });

  it("scores completion over raw engagement and sinks seen reels", () => {
    const base: ReelCandidate = {
      postId: "1", authorId: "a", text: "", createdAt: new Date(), likes: 0, replies: 0, reposts: 0, bookmarks: 0,
      plays: 0, watchMs: 0, completions: 0, durationMs: 10_000, width: 720, height: 1280, followed: false, seen: false,
    };
    const finished = reelScore({ ...base, plays: 100, completions: 80, watchMs: 900_000 });
    const skipped = reelScore({ ...base, plays: 100, completions: 2, watchMs: 100_000 });
    expect(finished).toBeGreaterThan(skipped);
    expect(reelScore({ ...base, seen: true })).toBeLessThan(reelScore(base));
    expect(reelScore(base)).toBeGreaterThan(reelScore({ ...base, width: 1280, height: 720 }));
  });
});
