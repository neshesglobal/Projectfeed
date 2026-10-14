import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let a: TestUser;
let b: TestUser;

beforeAll(async () => {
  env = await setup();
  a = await register(env.app, "perf_a");
  b = await register(env.app, "perf_b");
});
afterAll(() => {
  process.env.SHARED_CACHE_MS = "0";
  return env.close();
});

describe("response compression", () => {
  it("compresses JSON for clients that accept it, and not for those that don't", async () => {
    for (let i = 0; i < 12; i++) await post(env.app, a, `Compression check number ${i} with enough text to be worth compressing #perf`);
    const gz = await env.app.inject({ method: "GET", url: `/v1/users/${a.id}/posts?tab=posts`, headers: { ...a.auth, "accept-encoding": "gzip" } });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    const plain = await env.app.inject({ method: "GET", url: `/v1/users/${a.id}/posts?tab=posts`, headers: a.auth });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(gz.rawPayload.length).toBeLessThan(plain.rawPayload.length / 2);
  });
});

describe("shared caches", () => {
  it("reuse trends within the cache window", async () => {
    process.env.SHARED_CACHE_MS = "60000";
    const first = await call(env.app, a, "GET", "/v1/trends");
    await post(env.app, a, "#cachedtag one");
    await post(env.app, b, "#cachedtag two");
    const cached = await call(env.app, a, "GET", "/v1/trends");
    expect(cached.body).toEqual(first.body);
    process.env.SHARED_CACHE_MS = "0";
    const fresh = await call(env.app, a, "GET", "/v1/trends");
    expect(fresh.body.items.map((t: { tag: string }) => t.tag)).toContain("cachedtag");
  });
});

describe("top search", () => {
  it("still ranks the most engaged recent match first", async () => {
    const quiet = await post(env.app, a, "Monsoon market update quiet");
    const busy = await post(env.app, b, "Monsoon market update busy");
    await call(env.app, a, "POST", `/v1/posts/${busy.id}/like`);
    await call(env.app, b, "POST", `/v1/posts/${busy.id}/bookmark`);
    const r = await call(env.app, a, "GET", "/v1/search/posts?q=monsoon&mode=top");
    expect(r.body.items.map((i: { post: { id: string } }) => i.post.id).slice(0, 2)).toEqual([busy.id, quiet.id]);
  });
});
