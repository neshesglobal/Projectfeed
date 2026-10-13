// Demo Discover data: places, photo notes, verified reviews, comments and collections. Run after the other seeds.
// Covers are generated locally (no downloads) and labelled "Demo photo". Businesses are fictional; public
// landmarks use their real, approximate coordinates so the map and directions can be tried out.

import sharp from "sharp";
import { buildApp } from "../app";
import { config } from "../config";
import { createDb, migrate } from "../db";

const PASSWORD = "projectfeed-demo";
const sql = createDb(config.databaseUrl);
await migrate(sql);
const [existing] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM posts WHERE kind = 'note'`;
if (existing!.n > 0) {
  console.log("Notes already exist; skipping notes seed.");
  await sql.end();
  process.exit(0);
}

process.env.RATE_LIMIT_PER_MIN = "100000";
process.env.AUTH_RATE_LIMIT_PER_MIN = "100000";
const app = await buildApp(config, sql);

const auth = new Map<string, Record<string, string>>();
async function as(handle: string) {
  if (!auth.has(handle)) {
    const r = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { identifier: handle, password: PASSWORD } });
    if (r.statusCode !== 200) throw new Error(`Login failed for ${handle}; run the base seed first`);
    auth.set(handle, { authorization: `Bearer ${r.json().accessToken}` });
  }
  return auth.get(handle)!;
}
async function call<T>(handle: string, method: "POST" | "PATCH", url: string, payload?: unknown): Promise<T> {
  const r = await app.inject({ method, url: `/v1${url}`, headers: await as(handle), payload: payload as object });
  if (r.statusCode >= 300) throw new Error(`${method} ${url} as ${handle}: ${r.statusCode} ${r.body}`);
  return r.json() as T;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A generated cover: deep gradient, soft shapes, the subject in large type and a "Demo photo" tag. */
async function cover(handle: string, label: string, colors: [string, string], portrait: boolean) {
  const [w, h] = portrait ? [900, 1200] : [1200, 900];
  const words = label.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= 14) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  const fs = portrait ? 110 : 120;
  const top = h / 2 - ((lines.length - 1) * fs * 1.05) / 2 + fs / 3;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <circle cx="${w * 0.82}" cy="${h * 0.18}" r="${w * 0.28}" fill="#fff" opacity="0.10"/>
    <circle cx="${w * 0.1}" cy="${h * 0.92}" r="${w * 0.35}" fill="#000" opacity="0.12"/>
    ${lines.map((l, i) => `<text x="60" y="${top + i * fs * 1.05}" font-size="${fs}" font-family="Inter, DejaVu Sans, sans-serif" font-weight="800" fill="#fff">${esc(l)}</text>`).join("")}
    <rect x="56" y="${top + (lines.length - 1) * fs * 1.05 + 40}" rx="22" width="230" height="52" fill="#000" opacity="0.35"/>
    <text x="80" y="${top + (lines.length - 1) * fs * 1.05 + 76}" font-size="28" font-family="Inter, DejaVu Sans, sans-serif" font-weight="700" fill="#fff" opacity="0.9">Demo photo</text>
  </svg>`;
  const jpg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  const boundary = "----seednote";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cover.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    jpg,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const r = await app.inject({ method: "POST", url: "/v1/media", payload, headers: { ...(await as(handle)), "content-type": `multipart/form-data; boundary=${boundary}` } });
  if (r.statusCode >= 300) throw new Error(`Upload failed: ${r.body}`);
  return r.json().id as string;
}

type P = { key: string; name: string; category: string; lat: number; lng: number; city: string; address: string; by: string };
const PLACES: P[] = [
  { key: "coffee", name: "Mylapore Coffee House", category: "Café", lat: 13.0336, lng: 80.2687, city: "Chennai", address: "Kutchery Road, Mylapore", by: "kavya_agri" },
  { key: "marina", name: "Marina Beach", category: "Beach", lat: 13.05, lng: 80.2824, city: "Chennai", address: "Kamarajar Salai", by: "kavya_agri" },
  { key: "gateway", name: "Gateway of India", category: "Attraction", lat: 18.922, lng: 72.8347, city: "Mumbai", address: "Apollo Bandar, Colaba", by: "rajesh_mundra" },
  { key: "vadapav", name: "Dadar Vada Pav Corner", category: "Street food", lat: 19.0186, lng: 72.8424, city: "Mumbai", address: "Near Dadar station (W)", by: "rajesh_mundra" },
  { key: "hampi", name: "Virupaksha Temple", category: "Temple", lat: 15.335, lng: 76.4598, city: "Hampi", address: "Hampi, Vijayanagara", by: "priya_freight" },
  { key: "triund", name: "Triund Trek", category: "Trek", lat: 32.2596, lng: 76.3574, city: "McLeod Ganj", address: "Trailhead at Galu Devi temple", by: "priya_freight" },
  { key: "bazaar", name: "Kutch Handloom Bazaar", category: "Market", lat: 23.2525, lng: 69.6693, city: "Bhuj", address: "Old city, near Darbargadh", by: "rajesh_mundra" },
];

const placeIds = new Map<string, string>();
for (const p of PLACES) {
  const r = await call<{ place: { id: string } }>(p.by, "POST", "/places", { name: p.name, category: p.category, lat: p.lat, lng: p.lng, city: p.city, address: p.address, country: "IN" });
  placeIds.set(p.key, r.place.id);
}

type N = { by: string; title: string; text: string; covers: [string, [string, string], boolean][]; place?: string; review?: { rating: number; visitedOn?: string } };
const NOTES: N[] = [
  { by: "kavya_agri", title: "Best filter coffee in Mylapore, ₹30 a tumbler", text: "Thick decoction, chicory, served in a davara. Go before 8am — it's packed after. #food #chai #chennai", covers: [["Filter coffee", ["#7A4A2A", "#2B160B"], true], ["The decoction", ["#5A3A22", "#1E120A"], true]], place: "coffee", review: { rating: 5, visitedOn: "2026-10-01" } },
  { by: "priya_freight", title: "Great coffee, no seating and long queues", text: "Coffee is excellent but expect a 15-minute wait on weekends and nowhere to sit. Worth it once. #food #chennai", covers: [["Weekend queue", ["#4A3326", "#1A120D"], false]], place: "coffee", review: { rating: 3, visitedOn: "2026-09-01" } },
  { by: "kavya_agri", title: "Sunrise walk on Marina Beach", text: "5:45am, the light is unreal and it's cool enough to walk the full stretch. Sundal stalls open by 7. #travel #chennai", covers: [["Marina sunrise", ["#F29E4C", "#3B1F5C"], true], ["Sundal stall", ["#D9822B", "#5A2E0E"], true], ["Fishing boats", ["#2E6BC8", "#0B1F3A"], false]], place: "marina" },
  { by: "rajesh_mundra", title: "Gateway of India at 7am — no crowds", text: "Come early and you'll have it almost to yourself. Ferries to Elephanta start at 9. #travel #mumbai #guides", covers: [["Gateway at 7am", ["#C8962E", "#3A2A10"], false], ["Elephanta ferry", ["#1F4E5F", "#0A1A22"], true]], place: "gateway", review: { rating: 5 } },
  { by: "rajesh_mundra", title: "₹20 vada pav that beats every café", text: "Crisp vada, dry garlic chutney, fried chilli on the side. Cash or UPI. #streetfood #food #mumbai", covers: [["Vada pav", ["#E0A33A", "#6B3A0E"], true]], place: "vadapav", review: { rating: 4, visitedOn: "2026-10-01" } },
  { by: "priya_freight", title: "Hampi in two days: my route", text: "Day 1 Virupaksha, Hemakuta hill for sunset. Day 2 Vittala temple by cycle, coracle ride, Matanga hill. Carry water — it's hot even in October. #travel #guides", covers: [["Hampi in 2 days", ["#B8452F", "#3A140C"], true], ["Hemakuta sunset", ["#E8743B", "#4A1A3A"], false], ["Coracle ride", ["#2EA37A", "#0C2E22"], true]], place: "hampi" },
  { by: "priya_freight", title: "Triund trek: what to pack", text: "4–5 hours up from Galu Devi. Layers, a head torch, 2L water, and proper shoes — the last km is rocky. #trek #travel #guides", covers: [["Triund packing list", ["#3A6B4A", "#0E2416"], true]], place: "triund", review: { rating: 4, visitedOn: "2026-09-01" } },
  { by: "rajesh_mundra", title: "Kutch handloom: how to spot the real thing", text: "Real bandhani has tiny raised knots you can feel; printed copies are flat. Ask to see the weaver's card. #shopping #guides", covers: [["Real bandhani", ["#C82E7A", "#3A0C22"], true], ["Mirror work", ["#7A4FC8", "#1E0F3A"], true]], place: "bazaar", review: { rating: 5 } },
  { by: "kavya_agri", title: "Monsoon rice exports: what changed this year", text: "Shorter window at Kakinada, more containers out of Chennai. A quick explainer for small exporters. #business #guides", covers: [["Rice exports explained", ["#2E6BC8", "#0B1F3A"], false]] },
  { by: "lme_lena", title: "Five chai stops on a Delhi–Jaipur drive", text: "Ranked by kulhad chai, clean toilets and parking. #chai #travel #food", covers: [["Highway chai", ["#8F7A3A", "#2A220E"], true]] },
];

const ids: string[] = [];
for (const n of NOTES) {
  const mediaIds: string[] = [];
  for (const [label, colors, portrait] of n.covers) mediaIds.push(await cover(n.by, label, colors, portrait));
  const post = await call<{ id: string }>(n.by, "POST", "/notes", { title: n.title, text: n.text, mediaIds, placeId: n.place ? placeIds.get(n.place) : undefined, review: n.review });
  ids.push(post.id);
}

// Engagement, so the ranking and counts look lived-in.
const fans = ["demo", "amara_fuel", "hk_bullion", "tf_carlos", "grainwatch", "lng_omar", "lme_lena", "kavya_agri", "priya_freight", "rajesh_mundra"];
for (const [i, id] of ids.entries()) {
  for (const f of fans.slice(0, 3 + ((i * 3) % 7))) {
    await app.inject({ method: "POST", url: `/v1/posts/${id}/like`, headers: await as(f) });
  }
}
await call("demo", "POST", "/posts", { text: "Is it open on Mondays?", replyToId: ids[0] });
await call("kavya_agri", "POST", "/posts", { text: "Yes, every day from 6am.", replyToId: ids[0] });
await call("amara_fuel", "POST", "/posts", { text: "Saving this for my Chennai trip next month!", replyToId: ids[2] });

// A public and a private collection for the demo account.
const trip = await call<{ id: string }>("demo", "POST", "/me/collections", { name: "Chennai trip", isPrivate: false });
const eats = await call<{ id: string }>("demo", "POST", "/me/collections", { name: "Street food", isPrivate: true });
for (const i of [0, 2]) await call("demo", "POST", `/me/collections/${trip.id}/items`, { postId: ids[i] });
await call("demo", "POST", `/me/collections/${eats.id}/items`, { postId: ids[4] });

console.log(`Seeded ${PLACES.length} places, ${ids.length} notes and 2 collections.`);
await app.close();
await sql.end();
