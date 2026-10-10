// Demo moderation data: one staff account per role plus a realistic queue (reports, a protected post,
// a reported DM, a removed post with an appeal, and a screening match). Run after `seed.ts`.
// Staff password for every role: "projectfeed-staff". Never use these accounts outside local development.
//
// The screening match is simulated with metadata only — no image is involved.

import { buildApp } from "../app";
import { config } from "../config";
import { createDb, migrate } from "../db";
import { hashPassword } from "../lib/auth";
import { newId } from "../lib/ids";
import { recordScan } from "../services/screening";

const STAFF_PASSWORD = "projectfeed-staff";
const STAFF = [
  ["support@staff.projectfeed.app", "Sam Support", "support"],
  ["moderator@staff.projectfeed.app", "Morgan Moderator", "moderator"],
  ["senior@staff.projectfeed.app", "Sasha Senior", "senior_moderator"],
  ["compliance@staff.projectfeed.app", "Casey Compliance", "compliance"],
  ["admin@staff.projectfeed.app", "Alex Admin", "admin"],
] as const;

const sql = createDb(config.databaseUrl);
await migrate(sql);
const [{ n }] = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM staff`) as unknown as [{ n: number }];
if (n > 0) {
  console.log("Staff already exist; skipping moderation seed.");
  await sql.end();
  process.exit(0);
}
const users = await sql<{ id: string; handle: string }[]>`SELECT id, handle::text AS handle FROM users`;
if (users.length === 0) {
  console.log("Run the base seed first.");
  await sql.end();
  process.exit(1);
}

process.env.RATE_LIMIT_PER_MIN = "100000";
process.env.AUTH_RATE_LIMIT_PER_MIN = "100000";
const app = await buildApp(config, sql);
const id = (h: string) => users.find((u) => u.handle === h)!.id;

const pw = await hashPassword(STAFF_PASSWORD);
for (const [email, name, role] of STAFF) {
  await sql`INSERT INTO staff (id, email, password_hash, display_name, role) VALUES (${newId()}, ${email}, ${pw}, ${name}, ${role})`;
}

async function token(kind: "user" | "staff", ident: string): Promise<{ authorization: string }> {
  const res =
    kind === "user"
      ? await app.inject({ method: "POST", url: "/v1/auth/login", payload: { identifier: ident, password: "projectfeed-demo" } })
      : await app.inject({ method: "POST", url: "/admin/v1/auth/login", payload: { email: ident, password: STAFF_PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login ${ident} failed: ${res.body}`);
  const b = res.json();
  return { authorization: `Bearer ${kind === "user" ? b.accessToken : b.token}` };
}

async function call(auth: { authorization: string }, method: "POST" | "PATCH", url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object, headers: auth });
  if (res.statusCode >= 300) throw new Error(`${method} ${url} failed: ${res.body}`);
  return res.json();
}

const u = {
  demo: await token("user", "demo"),
  amara: await token("user", "amara_fuel"),
  henrik: await token("user", "hk_bullion"),
  priya: await token("user", "priya_freight"),
  carlos: await token("user", "tf_carlos"),
  sofia: await token("user", "grainwatch"),
};
const mod = await token("staff", "moderator@staff.projectfeed.app");

// A newcomer pushing an advance-fee scheme: several reports against one post.
const scam = await app.inject({
  method: "POST",
  url: "/v1/auth/register",
  payload: { email: "fast_deals@example.com", password: "projectfeed-demo", handle: "fast_deals_247", displayName: "Fast Deals Global" },
});
const scamAuth = { authorization: `Bearer ${scam.json().accessToken}` };
const scamId = scam.json().user.id as string;
const p1 = await call(scamAuth, "POST", "/v1/posts", { text: "EN590 10ppm 200,000 MT x 12 months, Rotterdam tank, Dip & Pay! Pay the €25k TSA fee today and get POP. DM now #EN590 #diesel" });
const p2 = await call(scamAuth, "POST", "/v1/posts", { text: "Gold dore 500kg Ghana, 20% below LBMA, buyer pays courier fee first. Serious buyers only #gold" });
await call(u.henrik, "POST", "/v1/reports", { targetType: "post", targetId: p1.id, reason: "scam_fraud", details: "Classic dip-and-pay advance-fee pattern. Asking for an upfront TSA fee." });
await call(u.amara, "POST", "/v1/reports", { targetType: "post", targetId: p1.id, reason: "scam_fraud", details: "No refinery named, upfront fee." });
await call(u.carlos, "POST", "/v1/reports", { targetType: "post", targetId: p2.id, reason: "scam_fraud", details: "Gold 20% below LBMA is not a real offer." });
await call(u.priya, "POST", "/v1/reports", { targetType: "user", targetId: scamId, reason: "impersonation", details: "Uses a logo copied from a real refiner." });

// Harassment in replies.
const target = await call(u.sofia, "POST", "/v1/posts", { text: "Urea FOB Middle East softening again this week. #fertilisers" });
const reply = await call(u.demo, "POST", "/v1/posts", { text: "Nobody asked for your useless numbers. Log off.", replyToId: target.id });
await call(u.sofia, "POST", "/v1/reports", { targetType: "post", targetId: reply.id, reason: "harassment", details: "Hostile reply to my market update." });

// A protected account's post, reported by an approved follower.
await call(u.carlos, "PATCH", "/v1/me", { isProtected: true });
// (priya_freight already follows tf_carlos from the base seed, so she can still see and report it.)
const priv = await call(u.carlos, "POST", "/v1/posts", { text: "Private note: that Bluewake broker shorted us on laytime again. Never using them." });
await call(u.priya, "POST", "/v1/reports", { targetType: "post", targetId: priv.id, reason: "harassment", details: "Defamatory about my firm, in a protected post." });

// A reported DM.
const conv = await call(u.demo, "POST", "/v1/conversations", { participantIds: [id("grainwatch")] });
await call(u.demo, "POST", `/v1/conversations/${conv.id}/messages`, { text: "Saw your urea post." });
const dm = await call(u.demo, "POST", `/v1/conversations/${conv.id}/messages`, { text: "Send me your client list or I'll post your home address." });
await call(u.sofia, "POST", "/v1/reports", { targetType: "message", targetId: dm.id, reason: "harassment", details: "Threat in DMs." });

// A removed post that the author has appealed.
const spammy = await call(u.amara, "POST", "/v1/posts", { text: "Our desk is hiring two junior traders in Lagos — DM me with your CV. #jobs" });
const removed = await call(mod, "POST", "/admin/v1/actions", { action: "remove_post", targetId: spammy.id, reasonCode: "spam", statement: "We removed your post because it breaks our rules on spam." });
await call(u.amara, "POST", "/v1/me/appeals", { actionId: removed.actionId, text: "This is a genuine job advert for my own company, not spam. Happy to edit it." });

// A screening match (metadata only — no file exists).
const mediaId = newId();
await sql`INSERT INTO media (id, owner_id, type, storage_key, thumb_key, width, height, status) VALUES (${mediaId}, ${scamId}, 'image', '', '', 0, 0, 'quarantined')`;
await recordScan(sql, { id: mediaId, ownerId: scamId }, { scanner: "hashlist", sha256: "9f2b5c0e7d1a43b8a6e4f0c2d9b7a1e3c5f8d0b2a4c6e8f0a1b3c5d7e9f1a2b3", match: { list: "demo-list", ref: "DEMO-0001" } });

await app.close();
await sql.end();
console.log(`Moderation demo data ready. Staff sign-in (password "${STAFF_PASSWORD}"):`);
for (const [email, , role] of STAFF) console.log(`  ${role.padEnd(17)} ${email}`);
