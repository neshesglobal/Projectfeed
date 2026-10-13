import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GiphyProvider } from "../src/services/gifs";
import { call, post, register, setup, upload, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let me: TestUser;

beforeAll(async () => {
  env = await setup();
  me = await register(env.app, "gif_user");
});
afterAll(() => env.close());
afterEach(() => vi.unstubAllGlobals());

describe("GIF picker (demo provider)", () => {
  it("reports its provider and attribution", async () => {
    const r = await call(env.app, me, "GET", "/v1/gifs/config");
    expect(r.body).toEqual({ enabled: true, provider: "demo", attribution: "Demo GIFs" });
  });

  it("lists trending GIFs that are real animated GIFs", async () => {
    const r = await call(env.app, me, "GET", "/v1/gifs/trending");
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(10);
    const file = await env.app.inject({ method: "GET", url: new URL(r.body.items[0].url).pathname });
    expect(file.statusCode).toBe(200);
    const meta = await sharp(file.rawPayload, { animated: true }).metadata();
    expect(meta.format).toBe("gif");
    expect(meta.pages).toBeGreaterThan(1);
  });

  it("searches by keyword", async () => {
    const r = await call(env.app, me, "GET", "/v1/gifs/search?q=chai");
    expect(r.body.items.map((g: { title: string }) => g.title)).toContain("Chai time");
    expect((await call(env.app, me, "GET", "/v1/gifs/search?q=")).body.items).toEqual([]);
  });

  it("attaches a GIF by id and posts it", async () => {
    const m = await call(env.app, me, "POST", "/v1/media/gif", { id: "demo-thanks" });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ type: "gif", status: "ready", width: 320, height: 240, altText: "Thank you" });
    const p = await post(env.app, me, "Thanks all!", { mediaIds: [m.body.id] });
    expect(p.media[0]).toMatchObject({ type: "gif", url: m.body.url });
  });

  it("rejects unknown GIFs and GIFs mixed with photos", async () => {
    expect((await call(env.app, me, "POST", "/v1/media/gif", { id: "https://evil.example/x.gif" })).status).toBe(404);
    const gif = (await call(env.app, me, "POST", "/v1/media/gif", { id: "demo-wow" })).body.id;
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#888" } }).png().toBuffer();
    const photo = (await upload(env.app, me, png, "image/png", "a.png")).body.id;
    expect((await call(env.app, me, "POST", "/v1/posts", { text: "Mixed", mediaIds: [gif, photo] })).status).toBe(400);
  });
});

describe("GIPHY provider", () => {
  const gif = (id: string, host: string) => ({
    id,
    title: "Cat",
    images: {
      fixed_width: { url: `${host}/fw.gif`, webp: `${host}/fw.webp`, width: "200", height: "150" },
      fixed_width_still: { url: `${host}/s.gif`, width: "200", height: "150" },
      downsized_medium: { url: `${host}/dm.gif`, width: "480", height: "360" },
      original: { url: `${host}/o.gif`, width: "480", height: "360" },
    },
  });

  it("maps results, keeps the key server-side and drops non-GIPHY URLs", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [gif("abc", "https://media1.giphy.com/media/abc"), gif("bad", "https://evil.example")], pagination: { total_count: 2, count: 2, offset: 0 } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const page = await new GiphyProvider("secret-key").search("cat", null, "en_IN");
    expect(page.items).toEqual([
      { id: "abc", title: "Cat", previewUrl: "https://media1.giphy.com/media/abc/fw.webp", url: "https://media1.giphy.com/media/abc/dm.gif", stillUrl: "https://media1.giphy.com/media/abc/s.gif", width: 480, height: 360 },
    ]);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("rating")).toBe("pg-13");
    expect(url.searchParams.get("api_key")).toBe("secret-key");
  });
});

describe("web app CORS", () => {
  it("allows edits and deletes from the browser", async () => {
    const r = await env.app.inject({
      method: "OPTIONS",
      url: "/v1/media/1",
      headers: { origin: "http://localhost:8081", "access-control-request-method": "PATCH" },
    });
    expect(r.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(r.headers["access-control-allow-methods"]).toContain("DELETE");
  });
});
