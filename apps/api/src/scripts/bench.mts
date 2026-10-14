// Endpoint latency benchmark against the perf database. Usage: DATABASE_URL=... npx tsx src/scripts/bench.mts
import { buildApp } from "../app";
import { config } from "../config";
import { createDb } from "../db";

process.env.RATE_LIMIT_PER_MIN = "1000000";
process.env.AUTH_RATE_LIMIT_PER_MIN = "1000000";
const sql = createDb(process.env.DATABASE_URL!);
const app = await buildApp({ ...config, databaseUrl: process.env.DATABASE_URL! }, sql);
const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { identifier: "perf", password: "projectfeed-demo" } });
const auth = { authorization: `Bearer ${login.json().accessToken}` };
const [top] = await sql<{ id: string }[]>`SELECT id FROM posts ORDER BY like_count DESC LIMIT 1`;
const popular = top!.id;
const ENDPOINTS: [string, string][] = [
  ["For you feed", "/v1/feed/for-you"],
  ["Following feed", "/v1/feed/following"],
  ["Following feed, page 2", "FOLLOWING_PAGE2"],
  ["Discover", "/v1/feed/discover"],
  ["Discover nearby", "/v1/feed/discover?topic=nearby&lat=12.95&lng=80.15"],
  ["Search posts (word)", "/v1/search/posts?q=chennai&mode=top"],
  ["Search posts (#tag latest)", "/v1/search/posts?q=%23travel&mode=latest"],
  ["Trends", "/v1/trends"],
  ["Thread (popular post)", `/v1/posts/${popular}/thread`],
  ["Profile posts", "/v1/users/2/posts?tab=posts"],
  ["Notifications", "/v1/notifications"],
  ["Places nearby", "/v1/places/nearby?lat=12.95&lng=80.15"],
  ["Reels", "/v1/feed/reels"],
  ["Me", "/v1/me"],
  ["Unread counts", "/v1/notifications/unread-count"],
];
const rows: string[] = [];
for (let [name, url] of ENDPOINTS) {
  if (url === "FOLLOWING_PAGE2") {
    const first = await app.inject({ method: "GET", url: "/v1/feed/following", headers: auth });
    url = `/v1/feed/following?cursor=${first.json().nextCursor}`;
  }
  const times: number[] = [];
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    const r = await app.inject({ method: "GET", url, headers: auth });
    const ms = performance.now() - t0;
    status = r.statusCode;
    bytes = r.rawPayload.length;
    if (i > 0) times.push(ms);
  }
  times.sort((a, b) => a - b);
  rows.push(`${name.padEnd(28)} ${String(status).padEnd(4)} median ${times[2]!.toFixed(0).padStart(5)} ms  max ${times[4]!.toFixed(0).padStart(5)} ms  ${(bytes / 1024).toFixed(1).padStart(6)} KB`);
}
console.log(rows.join("\n"));
await app.close();
await sql.end();
