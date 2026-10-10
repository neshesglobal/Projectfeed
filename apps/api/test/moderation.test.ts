import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HashListScanner, dHash } from "../src/services/screening";
import { admin, call, createStaff, post, register, setup, upload, type TestEnv, type TestStaff, type TestUser } from "./helpers";

// Screening tests use BENIGN synthetic images whose hashes are placed in a test hash list.
// Never use real abuse material in tests or anywhere on disk.
async function pattern(kind: "blocks" | "stripes", size = 256): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = kind === "blocks" ? (((x >> 5) + (y >> 6)) % 2 ? 230 : 25) : y % 64 < 32 ? 200 : (x * 255) / size;
      const i = (y * size + x) * 3;
      px[i] = v;
      px[i + 1] = kind === "blocks" ? 120 : v;
      px[i + 2] = 255 - v;
    }
  }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

let env: TestEnv;
let support: TestStaff;
let mod: TestStaff;
let mod2: TestStaff;
let senior: TestStaff;
let compliance: TestStaff;
let adminStaff: TestStaff;
let alice: TestUser;
let bob: TestUser;
let flagged: Buffer;
let flaggedVideo: Buffer;

beforeAll(async () => {
  flagged = await pattern("blocks");
  const sha = crypto.createHash("sha256").update(flagged).digest("hex");
  const vid = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pf-scan-")), "v.mp4");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", vid]);
  flaggedVideo = fs.readFileSync(vid);
  const vsha = crypto.createHash("sha256").update(flaggedVideo).digest("hex");
  const dh = (await dHash(flagged)).toString(16).padStart(16, "0");
  const list = `# test list: benign synthetic images only\nsha256:${sha} TEST-0001\ndhash:${dh} TEST-0001-P\nsha256:${vsha} TEST-VIDEO\n`;
  env = await setup({}, { scanner: new HashListScanner("test-list", list) });
  [support, mod, mod2, senior, compliance, adminStaff] = (await Promise.all(
    (["support", "moderator", "moderator", "senior_moderator", "compliance", "admin"] as const).map((r) => createStaff(env, r)),
  )) as [TestStaff, TestStaff, TestStaff, TestStaff, TestStaff, TestStaff];
  alice = await register(env.app, "mod_alice");
  bob = await register(env.app, "mod_bob");
});
afterAll(() => env.close());

async function report(user: TestUser, targetType: string, targetId: string, reason = "harassment") {
  const r = await call(env.app, user, "POST", "/v1/reports", { targetType, targetId, reason, details: "test" });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

describe("staff authentication and roles", () => {
  it("keeps staff and user tokens separate", async () => {
    expect((await admin(env.app, null, "GET", "/me")).status).toBe(401);
    const asUser = await env.app.inject({ method: "GET", url: "/admin/v1/me", headers: alice.auth });
    expect(asUser.statusCode).toBe(401);
    const asStaff = await env.app.inject({ method: "GET", url: "/v1/me", headers: mod.auth });
    expect(asStaff.statusCode).toBe(401);
    const me = await admin(env.app, senior, "GET", "/me");
    expect(me.body.role).toBe("senior_moderator");
    expect(me.body.permissions).toContain("viewProtected");
    expect(me.body.permissions).not.toContain("viewDms");
  });

  it("rejects wrong passwords and disabled staff", async () => {
    const bad = await env.app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email: "moderator2@staff.test", password: "nope" } });
    expect(bad.statusCode).toBe(401);
    const temp = await createStaff(env, "support");
    expect((await admin(env.app, adminStaff, "PATCH", `/staff/${temp.id}`, { status: "disabled" })).status).toBe(200);
    expect((await admin(env.app, temp, "GET", "/me")).status).toBe(401);
  });

  it("only admins manage staff, and not themselves", async () => {
    expect((await admin(env.app, compliance, "GET", "/staff")).status).toBe(403);
    const created = await admin(env.app, adminStaff, "POST", "/staff", { email: "new@staff.test", displayName: "New", role: "support", password: "a-long-password-1" });
    expect(created.status).toBe(201);
    expect((await admin(env.app, adminStaff, "PATCH", `/staff/${adminStaff.id}`, { role: "support" })).status).toBe(403);
  });
});

describe("reports queue and actions", () => {
  it("lets moderators remove a reported post, closes the reports and tells the author why", async () => {
    const p = await post(env.app, alice, "something nasty");
    const r1 = await report(bob, "post", p.id);
    const carol = await register(env.app, "mod_carol");
    await report(carol, "post", p.id, "hate");

    const queue = await admin(env.app, support, "GET", "/reports");
    const item = queue.body.items.find((i: any) => i.id === r1);
    expect(item.target.kind).toBe("post");
    expect(item.target.post.text).toBe("something nasty");
    expect(item.openReportsOnTarget).toBe(2);

    // Support staff can look but not act.
    const denied = await admin(env.app, support, "POST", "/actions", { action: "remove_post", targetId: p.id, reasonCode: "harassment", statement: "Removed for harassment." });
    expect(denied.status).toBe(403);

    const done = await admin(env.app, mod, "POST", "/actions", { action: "remove_post", targetId: p.id, reasonCode: "harassment", statement: "This post broke our harassment rules.", reportId: r1 });
    expect(done.status).toBe(201);

    expect((await admin(env.app, mod, "GET", "/reports")).body.items.some((i: any) => i.targetId === p.id)).toBe(false);
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}`)).status).toBe(404);
    const feed = await call(env.app, alice, "GET", `/v1/users/${alice.id}/posts`);
    expect(feed.body.items.some((i: any) => i.post.id === p.id)).toBe(false);

    const standing = await call(env.app, alice, "GET", "/v1/me/standing");
    expect(standing.body.strikes).toBe(1);
    const notice = standing.body.notices[0];
    expect(notice.action).toBe("remove_post");
    expect(notice.statement).toBe("This post broke our harassment rules.");
    expect(notice.postExcerpt).toBe("something nasty");
    expect(notice.canAppeal).toBe(true);
    expect(standing.body.unread).toBe(1);
    expect((await call(env.app, alice, "POST", "/v1/me/moderation-notices/read")).status).toBe(204);
    expect((await call(env.app, alice, "GET", "/v1/me/standing")).body.unread).toBe(0);
  });

  it("requires a statement of reasons", async () => {
    const p = await post(env.app, alice, "meh");
    const r = await admin(env.app, mod, "POST", "/actions", { action: "remove_post", targetId: p.id, reasonCode: "spam", statement: "" });
    expect(r.status).toBe(400);
  });

  it("labels sensitive media and limits reach out of network", async () => {
    const p = await post(env.app, alice, "edgy #limitedtag");
    await admin(env.app, mod, "POST", "/actions", { action: "label_sensitive", targetId: p.id, reasonCode: "graphic_content", statement: "Labelled as sensitive media." });
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}`)).body.sensitive).toBe(true);
    expect((await call(env.app, bob, "GET", "/v1/search/posts?q=%23limitedtag&mode=latest")).body.items).toHaveLength(1);
    await admin(env.app, mod, "POST", "/actions", { action: "limit_reach", targetId: p.id, reasonCode: "misleading", statement: "Reach limited: misleading." });
    expect((await call(env.app, bob, "GET", "/v1/search/posts?q=%23limitedtag&mode=latest")).body.items).toHaveLength(0);
    // Still visible directly.
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}`)).status).toBe(200);
  });

  it("caps moderator suspensions at 7 days and makes suspended accounts read-only", async () => {
    const dave = await register(env.app, "mod_dave");
    const long = await admin(env.app, mod, "POST", "/actions", { action: "suspend", targetId: dave.id, reasonCode: "spam", statement: "Suspended for spam.", durationDays: 30 });
    expect(long.status).toBe(403);
    const indefinite = await admin(env.app, mod, "POST", "/actions", { action: "suspend", targetId: dave.id, reasonCode: "spam", statement: "Suspended for spam." });
    expect(indefinite.status).toBe(403);
    expect((await admin(env.app, mod, "POST", "/actions", { action: "suspend", targetId: dave.id, reasonCode: "spam", statement: "Suspended for spam.", durationDays: 3 })).status).toBe(201);

    expect((await call(env.app, dave, "GET", "/v1/feed/following")).status).toBe(200);
    expect((await call(env.app, dave, "POST", "/v1/posts", { text: "hi" })).body.error.code).toBe("ACCOUNT_SUSPENDED");
    const standing = (await call(env.app, dave, "GET", "/v1/me/standing")).body;
    expect(standing.status).toBe("suspended");
    expect(standing.suspendedUntil).toBeTruthy();

    // Lapsed suspensions reinstate on the next request.
    await env.sql`UPDATE users SET suspended_until = now() - interval '1 minute' WHERE id = ${dave.id}`;
    expect((await call(env.app, dave, "POST", "/v1/posts", { text: "back" })).status).toBe(201);

    expect((await admin(env.app, senior, "POST", "/actions", { action: "suspend", targetId: dave.id, reasonCode: "spam", statement: "Suspended for spam, again." })).status).toBe(201);
    expect((await admin(env.app, mod, "POST", "/actions", { action: "ban", targetId: dave.id, reasonCode: "spam", statement: "Banned for repeat spam." })).status).toBe(403);
    expect((await admin(env.app, senior, "POST", "/actions", { action: "ban", targetId: dave.id, reasonCode: "spam", statement: "Banned for repeat spam." })).status).toBe(201);
    expect((await call(env.app, dave, "GET", "/v1/me")).status).toBe(401);
    expect((await call(env.app, null, "POST", "/v1/auth/refresh", { refreshToken: dave.refreshToken })).status).toBe(401);
  });
});

describe("appeals", () => {
  it("is decided by a different senior moderator and reverses the decision when overturned", async () => {
    const erin = await register(env.app, "mod_erin");
    const p = await post(env.app, erin, "a perfectly fine post");
    const act = await admin(env.app, senior, "POST", "/actions", { action: "remove_post", targetId: p.id, reasonCode: "spam", statement: "Removed as spam." });
    const actionId = act.body.actionId;

    expect((await call(env.app, erin, "POST", "/v1/me/appeals", { actionId, text: "short" })).status).toBe(400);
    expect((await call(env.app, bob, "POST", "/v1/me/appeals", { actionId, text: "not my decision but appealing anyway" })).status).toBe(404);
    const ap = await call(env.app, erin, "POST", "/v1/me/appeals", { actionId, text: "This was not spam, it was a genuine update." });
    expect(ap.status).toBe(201);
    expect((await call(env.app, erin, "POST", "/v1/me/appeals", { actionId, text: "Appealing a second time please." })).status).toBe(409);

    const list = await admin(env.app, senior, "GET", "/appeals");
    const item = list.body.items.find((i: any) => i.id === ap.body.id);
    expect(item.canDecide).toBe(false); // senior made the original decision
    expect((await admin(env.app, senior, "POST", `/appeals/${ap.body.id}/decide`, { decision: "overturned", note: "Reviewing my own call." })).status).toBe(403);
    expect((await admin(env.app, mod, "POST", `/appeals/${ap.body.id}/decide`, { decision: "overturned", note: "Moderators cannot decide." })).status).toBe(403);

    const decided = await admin(env.app, compliance, "POST", `/appeals/${ap.body.id}/decide`, { decision: "overturned", note: "Not spam: restored with apologies." });
    expect(decided.status).toBe(200);
    expect(decided.body.reversal).toBe("restore_post");
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}`)).status).toBe(200);
    const standing = (await call(env.app, erin, "GET", "/v1/me/standing")).body;
    expect(standing.strikes).toBe(0);
    expect(standing.notices.find((n: any) => n.actionId === actionId).appeal.status).toBe("overturned");
    expect(standing.notices[0].action).toBe("restore_post");
  });

  it("lets suspended users appeal", async () => {
    const fay = await register(env.app, "mod_fay");
    const act = await admin(env.app, mod, "POST", "/actions", { action: "suspend", targetId: fay.id, reasonCode: "harassment", statement: "Suspended for harassment.", durationDays: 7 });
    const ap = await call(env.app, fay, "POST", "/v1/me/appeals", { actionId: act.body.actionId, text: "I was defending myself, please review." });
    expect(ap.status).toBe(201);
    const decided = await admin(env.app, senior, "POST", `/appeals/${ap.body.id}/decide`, { decision: "upheld", note: "Upheld after review of the thread." });
    expect(decided.body.reversal).toBeNull();
  });
});

describe("tiered access to private content", () => {
  it("excludes protected accounts from browsing and gates reported protected posts behind senior + justification", async () => {
    const priv = await register(env.app, "mod_private");
    await call(env.app, priv, "PATCH", "/v1/me", { isProtected: true });
    const pp = await post(env.app, priv, "private words");
    await post(env.app, alice, "public words");

    const browse = await admin(env.app, support, "GET", "/content/posts?q=words");
    expect(browse.body.items.map((i: any) => i.text)).toEqual(["public words"]);
    const user = await admin(env.app, support, "GET", `/users/${priv.id}`);
    expect(user.body.recentPosts).toBeNull();
    expect(user.body.postsRestricted).toBe(true);

    await call(env.app, bob, "POST", `/v1/users/${priv.id}/follow`);
    await call(env.app, priv, "POST", `/v1/me/follow-requests/${bob.id}/accept`);
    const rid = await report(bob, "post", pp.id);
    const queued = (await admin(env.app, mod, "GET", "/reports")).body.items.find((i: any) => i.id === rid);
    expect(queued.target.restricted).toBe("protected");
    expect(queued.target.post).toBeUndefined();
    expect(JSON.stringify(queued)).not.toContain("private words");

    expect((await admin(env.app, mod, "POST", `/reports/${rid}/reveal`, { justification: "Need to review the reported post." })).status).toBe(403);
    expect((await admin(env.app, senior, "POST", `/reports/${rid}/reveal`, { justification: "short" })).status).toBe(400);
    const shown = await admin(env.app, senior, "POST", `/reports/${rid}/reveal`, { justification: "Reviewing reported harassment in a protected post." });
    expect(shown.body.post.text).toBe("private words");
    const [log] = await env.sql`SELECT * FROM access_log WHERE action = 'view_protected_post' AND target_id = ${pp.id}`;
    expect(log!.staff_id).toBe(senior.id);
    expect(log!.justification).toContain("protected post");
  });

  it("restricts DMs to compliance, only for reported messages, with a logged justification", async () => {
    const conv = await call(env.app, alice, "POST", "/v1/conversations", { participantIds: [bob.id] });
    const cid = conv.body.id;
    await call(env.app, alice, "POST", `/v1/conversations/${cid}/messages`, { text: "hello bob" });
    const bad = await call(env.app, alice, "POST", `/v1/conversations/${cid}/messages`, { text: "threatening message" });
    await call(env.app, alice, "POST", `/v1/conversations/${cid}/messages`, { text: "after the report" });
    const rid = await report(bob, "message", bad.body.id);

    const queued = (await admin(env.app, senior, "GET", "/reports")).body.items.find((i: any) => i.id === rid);
    expect(queued.target).toMatchObject({ kind: "message", restricted: "dm", requires: "compliance" });
    expect(JSON.stringify(queued)).not.toContain("threatening");
    expect((await admin(env.app, senior, "POST", `/reports/${rid}/reveal`, { justification: "Senior trying to read the DM." })).status).toBe(403);
    expect((await admin(env.app, compliance, "POST", `/reports/${rid}/reveal`, {})).status).toBe(400);

    const shown = await admin(env.app, compliance, "POST", `/reports/${rid}/reveal`, { justification: "Reported threat; reviewing for police referral." });
    expect(shown.status).toBe(200);
    const texts = shown.body.messages.map((m: any) => m.text);
    expect(texts).toEqual(["hello bob", "threatening message"]); // context before, nothing after
    const logs = await env.sql`SELECT * FROM access_log WHERE action = 'view_dm_evidence'`;
    expect(logs).toHaveLength(1);
    // There is no endpoint to list or read conversations.
    expect((await admin(env.app, adminStaff, "GET", `/conversations/${cid}`)).status).toBe(404);
  });

  it("keeps PII behind compliance with a logged justification", async () => {
    expect((await admin(env.app, mod, "GET", `/users/${alice.id}`)).body.email).toBeNull();
    expect((await admin(env.app, mod, "POST", `/users/${alice.id}/reveal-pii`, { justification: "Need email for a legal request." })).status).toBe(403);
    expect((await admin(env.app, mod, "GET", "/users?q=mod_alice@example.com")).status).toBe(403);
    const pii = await admin(env.app, compliance, "POST", `/users/${alice.id}/reveal-pii`, { justification: "Legal request ref LR-2026-001." });
    expect(pii.body.email).toBe("mod_alice@example.com");
  });

  it("makes the access log append-only and admin-readable only", async () => {
    await expect(env.sql`UPDATE access_log SET justification = 'edited'`).rejects.toThrow(/append-only/);
    await expect(env.sql`DELETE FROM access_log`).rejects.toThrow(/append-only/);
    expect((await admin(env.app, compliance, "GET", "/access-log")).status).toBe(403);
    const log = await admin(env.app, adminStaff, "GET", "/access-log?action=view_");
    expect(log.body.items.length).toBeGreaterThanOrEqual(2);
  });
});

describe("upload screening", () => {
  it("rejects hash-listed uploads before storage, freezes the account silently and queues a priority-0 report", async () => {
    const gus = await register(env.app, "mod_gus");
    const res = await upload(env.app, gus, flagged, "image/png", "a.png");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UPLOAD_REJECTED");
    const dir = path.join(env.app.ctx.cfg.uploadDir, gus.id);
    expect(fs.existsSync(dir)).toBe(false);

    const [m] = await env.sql`SELECT status, storage_key FROM media WHERE owner_id = ${gus.id}`;
    expect(m).toMatchObject({ status: "quarantined", storage_key: "" });
    expect((await call(env.app, gus, "POST", "/v1/posts", { text: "x" })).body.error.code).toBe("ACCOUNT_UNDER_REVIEW");
    const standing = (await call(env.app, gus, "GET", "/v1/me/standing")).body;
    expect(standing.status).toBe("frozen");
    expect(standing.notices).toHaveLength(0); // no tipping off

    const queue = await admin(env.app, mod, "GET", "/reports");
    const r = queue.body.items[0];
    expect(r).toMatchObject({ priority: 0, source: "screening", targetType: "media" });
    expect(r.target).toMatchObject({ kind: "media", restricted: "quarantine" });

    expect((await admin(env.app, senior, "GET", "/quarantine")).status).toBe(403);
    const q = await admin(env.app, compliance, "GET", "/quarantine");
    expect(q.body.items[0]).toMatchObject({ list: "test-list", ref: "TEST-0001" });
  });

  it("catches re-encoded and resized copies with the perceptual hash", async () => {
    const hal = await register(env.app, "mod_hal");
    const altered = await sharp(flagged).resize(200, 200).jpeg({ quality: 70 }).toBuffer();
    expect((await upload(env.app, hal, altered, "image/jpeg", "b.jpg")).status).toBe(422);
  });

  it("lets other images through and records a clear scan", async () => {
    const ivy = await register(env.app, "mod_ivy");
    const ok = await upload(env.app, ivy, await pattern("stripes"), "image/png", "c.png");
    expect(ok.status).toBe(201);
    const [scan] = await env.sql`SELECT result FROM media_scans WHERE media_id = ${ok.body.id}`;
    expect(scan!.result).toBe("clear");
  });

  it("screens videos before publishing", async () => {
    const jo = await register(env.app, "mod_jo");
    const up = await upload(env.app, jo, flaggedVideo, "video/mp4", "v.mp4");
    expect(up.status).toBe(202);
    await env.app.ctx.video.idle();
    const [m] = await env.sql`SELECT status, storage_key FROM media WHERE id = ${up.body.id}`;
    expect(m).toMatchObject({ status: "quarantined", storage_key: "" });
    expect(fs.existsSync(path.join(env.app.ctx.cfg.uploadDir, jo.id))).toBe(false);
    expect((await call(env.app, jo, "GET", "/v1/me/standing")).body.status).toBe("frozen");
  });

  it("lets compliance release a false positive, unfreezing the account", async () => {
    const [row] = await env.sql<{ media_id: string; owner_id: string }[]>`
      SELECT s.media_id, m.owner_id FROM media_scans s JOIN media m ON m.id = s.media_id
      JOIN users u ON u.id = m.owner_id WHERE s.result = 'match' AND u.handle = 'mod_hal'`;
    expect((await admin(env.app, compliance, "POST", `/quarantine/${row!.media_id}/resolve`, { outcome: "false_positive", justification: "Reviewed hash metadata: list error." })).status).toBe(200);
    const [u] = await env.sql`SELECT status FROM users WHERE id = ${row!.owner_id}`;
    expect(u!.status).toBe("active");
  });
});
