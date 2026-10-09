// Demo data for local development: `pnpm --filter @projectfeed/api seed`.
// Every account uses the password "projectfeed-demo". Fictional people only.

import sharp from "sharp";
import { buildApp } from "../app";
import { config } from "../config";
import { createDb, migrate } from "../db";

const PASSWORD = "projectfeed-demo";

const USERS = [
  { handle: "demo", name: "Demo User", company: "Projectfeed", role: "Tester", sectors: ["Petroleum", "Gold & Precious Metals"], bio: "The account you log in with. Password: projectfeed-demo" },
  { handle: "amara_fuel", name: "Amara Okafor", company: "Lagoon Energy", role: "Head of Trading", sectors: ["Petroleum"], bio: "Clean products, West Africa. Views my own." },
  { handle: "hk_bullion", name: "Henrik Kask", company: "Nordvault", role: "Bullion desk", sectors: ["Gold & Precious Metals"], bio: "Physical gold, LBMA good delivery. Loco London & Zurich." },
  { handle: "priya_freight", name: "Priya Raman", company: "Bluewake Chartering", role: "Tanker broker", sectors: ["Shipping & Freight"], bio: "MR/LR2 fixtures, laytime & demurrage nerd." },
  { handle: "tf_carlos", name: "Carlos Mendes", company: "Atlas Trade Finance", role: "Structured TF", sectors: ["Trade Finance"], bio: "LCs, SBLCs, and why your MT799 isn't a payment." },
  { handle: "grainwatch", name: "Sofia Petrova", company: "Black Sea Agri", role: "Analyst", sectors: ["Agriculture", "Fertilisers"], bio: "Wheat, corn, urea. Black Sea flows." },
  { handle: "lme_lena", name: "Lena Fischer", company: "Ruhr Metals", role: "Base metals trader", sectors: ["Base Metals"], bio: "Copper, aluminium, warrants & cancellations." },
  { handle: "lng_omar", name: "Omar Haddad", company: "Gulf Gas Partners", role: "LNG originator", sectors: ["Gas & LNG"], bio: "JKM vs TTF, every day." },
];

const POSTS: [string, string][] = [
  ["amara_fuel", "ULSD cracks firming into Q4. Seeing strong West African pull on EN590 cargoes ex-ARA. #EN590 #diesel"],
  ["hk_bullion", "Spot $XAU pushing highs again. Physical premiums in Asia widening vs loco London. #gold"],
  ["priya_freight", "Reminder: laytime starts on NOR tender + 6h unless your charter party says otherwise. Read the CP before you fix. #shipping"],
  ["tf_carlos", "An MT799 is a free-format bank message. It is NOT a payment guarantee. If someone says 'MT799 then MT103 dip', walk away. #tradefinance"],
  ["grainwatch", "Black Sea wheat FOB softening as harvest pressure peaks. Egypt tender results this week will set tone. #wheat"],
  ["lme_lena", "LME copper cancelled warrants jumped overnight — watch the backwardation. #copper"],
  ["lng_omar", "JKM–TTF spread narrowing; fewer US cargoes diverting to Asia. #LNG"],
  ["amara_fuel", "Jet A1 premiums in Rotterdam holding firm despite lower crude. Airline hedging season. #jetfuel"],
  ["hk_bullion", "Good delivery bars only. If your seller can't name the refiner and assay, there's no deal. #gold #DD"],
  ["priya_freight", "MR rates TC2 up 12% w/w. Tonnage tight in NWE. #tankers #shipping"],
  ["tf_carlos", "Confirmed LC from a top-tier bank > any 'bank comfort letter'. Always. #tradefinance"],
  ["demo", "Hello Projectfeed 👋 First post from the demo account."],
];

const sql = createDb(config.databaseUrl);
await migrate(sql);
const [{ n }] = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`) as unknown as [{ n: number }];
if (n > 0) {
  console.log("Database already has users; skipping seed.");
  await sql.end();
  process.exit(0);
}

process.env.RATE_LIMIT_PER_MIN = "100000";
process.env.AUTH_RATE_LIMIT_PER_MIN = "100000";
const app = await buildApp(config, sql);
const tokens = new Map<string, { id: string; auth: { authorization: string } }>();

async function call(handle: string, method: "POST" | "PATCH" | "PUT", url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object, headers: tokens.get(handle)!.auth });
  if (res.statusCode >= 300) throw new Error(`${method} ${url} failed: ${res.body}`);
  return res.json();
}

async function avatar(handle: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="${color}"/>
    <text x="200" y="250" font-size="180" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">${handle[0]!.toUpperCase()}</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const boundary = "----seed";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({
    method: "POST",
    url: "/v1/media",
    payload,
    headers: { ...tokens.get(handle)!.auth, "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  return res.json().id as string;
}

const COLORS = ["#C8962E", "#2E6BC8", "#2EA37A", "#B8452F", "#7A4FC8", "#C82E7A", "#3A8F9A", "#8F7A3A"];

for (const [i, u] of USERS.entries()) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email: `${u.handle}@demo.projectfeed.app`, password: PASSWORD, handle: u.handle, displayName: u.name },
  });
  const body = res.json();
  tokens.set(u.handle, { id: body.user.id, auth: { authorization: `Bearer ${body.accessToken}` } });
  const avatarMediaId = await avatar(u.handle, COLORS[i % COLORS.length]!);
  await call(u.handle, "PATCH", "/v1/me", { bio: u.bio, company: u.company, role: u.role, sectors: u.sectors, avatarMediaId });
}
// Mark the professional accounts as ID-verified so the badge shows in the demo.
await sql`UPDATE users SET kyc_level = 1 WHERE handle <> 'demo'`;

// Everyone follows a few people; demo follows half.
const handles = USERS.map((u) => u.handle);
for (const a of handles) {
  for (const b of handles) {
    if (a !== b && (a.length + b.length) % 3 !== 0) await call(a, "POST", `/v1/users/${tokens.get(b)!.id}/follow`);
  }
}

const postIds: string[] = [];
for (const [h, text] of POSTS) {
  const p = await call(h, "POST", "/v1/posts", { text });
  postIds.push(p.id);
}
await call("tf_carlos", "POST", "/v1/posts", {
  text: "Poll: what's the biggest red flag in a commodity offer?",
  poll: { options: ["Dip-and-pay", "No named refinery", "MT799 'proof'", "All of the above"], durationMinutes: 24 * 60 },
});
// Replies, likes, reposts.
await call("priya_freight", "POST", "/v1/posts", { text: "@tf_carlos 100%. Seen too many of these this month.", replyToId: postIds[3] });
await call("hk_bullion", "POST", "/v1/posts", { text: "Same in gold. 'Proof of funds' via MT799 is meaningless.", replyToId: postIds[3] });
await call("amara_fuel", "POST", "/v1/posts", { text: "Worth repeating for anyone new to the game 👇", quoteOfId: postIds[3] });
for (const [i, id] of postIds.entries()) {
  for (const [j, h] of handles.entries()) {
    if ((i + j) % 2 === 0) await call(h, "POST", `/v1/posts/${id}/like`);
    if ((i * j) % 7 === 3) await call(h, "POST", `/v1/posts/${id}/repost`);
  }
}
const conv = await call("amara_fuel", "POST", "/v1/conversations", { participantIds: [tokens.get("demo")!.id] });
await call("amara_fuel", "POST", `/v1/conversations/${conv.id}/messages`, { text: "Hi! Welcome to Projectfeed. Shout if you need EN590 market colour." });

console.log(`Seeded ${USERS.length} users and ${POSTS.length + 4} posts. Log in as "demo" / "${PASSWORD}".`);
await app.close();
await sql.end();
