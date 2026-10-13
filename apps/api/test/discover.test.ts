import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, call, createStaff, register, setup, upload, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let kavya: TestUser;
let arjun: TestUser;
let viewer: TestUser;

const png = (r: number, g: number, b: number, w = 300, h = 400) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
async function photo(u: TestUser, seed = 1): Promise<string> {
  const r = await upload(env.app, u, await png((seed * 40) % 255, (seed * 90) % 255, 120), "image/png", "p.png");
  expect(r.status).toBe(201);
  return r.body.id;
}
// Mylapore, Chennai and Bandra, Mumbai.
const MYLAPORE = { lat: 13.0339, lng: 80.2676 };
const BANDRA = { lat: 19.0596, lng: 72.8295 };

async function place(u: TestUser, name: string, at: { lat: number; lng: number }, extra = {}) {
  const r = await call(env.app, u, "POST", "/v1/places", { name, category: "Café", city: "Chennai", country: "IN", ...at, ...extra });
  expect(r.status).toBeLessThan(300);
  return r.body as { place: { id: string; rating: number | null; reviewCount: number }; existing: boolean };
}
async function note(u: TestUser, body: Record<string, unknown>) {
  const r = await call(env.app, u, "POST", "/v1/notes", body);
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body;
}

beforeAll(async () => {
  env = await setup();
  kavya = await register(env.app, "dv_kavya");
  arjun = await register(env.app, "dv_arjun");
  viewer = await register(env.app, "dv_viewer");
});
afterAll(() => env.close());

describe("notes", () => {
  it("need a title and at least one photo or video", async () => {
    expect((await call(env.app, kavya, "POST", "/v1/notes", { title: "", mediaIds: [await photo(kavya)] })).status).toBe(400);
    expect((await call(env.app, kavya, "POST", "/v1/notes", { title: "Filter coffee", mediaIds: [] })).status).toBe(400);
    expect((await call(env.app, kavya, "POST", "/v1/notes", { title: "Too long", text: "x".repeat(1001), mediaIds: [await photo(kavya)] })).status).toBe(400);
  });

  it("can carry up to 10 photos, a place and a verified review", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => photo(kavya, i + 1)));
    const p = await place(kavya, "Mylapore Coffee House", MYLAPORE);
    const n = await note(kavya, {
      title: "Best filter coffee in Mylapore",
      text: "Strong decoction, go before 8 am. #chennai #filtercoffee",
      mediaIds: ids,
      placeId: p.place.id,
      review: { rating: 4, visitedOn: "2026-10-12" },
    });
    expect(n).toMatchObject({
      kind: "note",
      title: "Best filter coffee in Mylapore",
      place: { id: p.place.id, name: "Mylapore Coffee House", city: "Chennai", lat: MYLAPORE.lat },
      review: { rating: 4, visitedOn: "2026-10-12" },
    });
    expect(n.media).toHaveLength(10);
    const tooMany = await Promise.all(Array.from({ length: 11 }, (_, i) => photo(kavya, i + 20)));
    expect((await call(env.app, kavya, "POST", "/v1/notes", { title: "Eleven", mediaIds: tooMany })).status).toBe(400);
  });

  it("rejects a visit date in the future and ratings outside 1–5", async () => {
    const m = await photo(arjun);
    expect((await call(env.app, arjun, "POST", "/v1/notes", { title: "Future", mediaIds: [m], review: { rating: 4, visitedOn: "2999-01-01" } })).status).toBe(400);
    expect((await call(env.app, arjun, "POST", "/v1/notes", { title: "Six stars", mediaIds: [m], review: { rating: 6 } })).status).toBe(400);
  });
});

describe("places", () => {
  it("merges the same place added twice nearby, but not different places", async () => {
    const a = await place(arjun, "Ratna Cafe", { lat: 13.0569, lng: 80.2796 });
    const again = await place(viewer, "Ratna Café", { lat: 13.0571, lng: 80.2797 }); // ~25 m away, accent differs
    expect(again).toMatchObject({ existing: true, place: { id: a.place.id } });
    const other = await place(viewer, "Murugan Idli Shop", { lat: 13.0569, lng: 80.2796 });
    expect(other.existing).toBe(false);
    const far = await place(viewer, "Ratna Cafe", BANDRA);
    expect(far.existing).toBe(false);
  });

  it("lists places near a pin by distance, optionally by name", async () => {
    const near = await call(env.app, viewer, "GET", `/v1/places/nearby?lat=13.0570&lng=80.2797`);
    expect(near.body.items.map((p: { name: string }) => p.name)).toEqual(["Ratna Cafe", "Murugan Idli Shop"]);
    expect(near.body.items[0].distanceM).toBeLessThan(30);
    const named = await call(env.app, viewer, "GET", `/v1/places/nearby?lat=13.0570&lng=80.2797&q=idli`);
    expect(named.body.items.map((p: { name: string }) => p.name)).toEqual(["Murugan Idli Shop"]);
  });

  it("rates a place from verified reviews only, live", async () => {
    const p = await place(arjun, "Saravana Bhavan Mylapore", { lat: 13.0335, lng: 80.2690 });
    await note(arjun, { title: "Ghee roast", mediaIds: [await photo(arjun, 3)], placeId: p.place.id, review: { rating: 5 } });
    const bad = await note(viewer, { title: "Slow service", mediaIds: [await photo(viewer, 4)], placeId: p.place.id, review: { rating: 2 } });
    await note(viewer, { title: "Just a photo", mediaIds: [await photo(viewer, 5)], placeId: p.place.id });
    expect((await call(env.app, viewer, "GET", `/v1/places/${p.place.id}`)).body).toMatchObject({ reviewCount: 2, rating: 3.5, noteCount: 3 });
    // A review removed by moderators no longer counts.
    const mod = await createStaff(env, "moderator");
    await admin(env.app, mod, "POST", "/actions", { action: "remove_post", targetId: bad.id, reasonCode: "spam", statement: "Removed: not a genuine visit." });
    expect((await call(env.app, viewer, "GET", `/v1/places/${p.place.id}`)).body).toMatchObject({ reviewCount: 1, rating: 5 });
    const reviews = await call(env.app, viewer, "GET", `/v1/places/${p.place.id}/notes?reviews=1`);
    expect(reviews.body.items.map((i: { post: { title: string } }) => i.post.title)).toEqual(["Ghee roast"]);
  });
});

describe("Discover feed", () => {
  it("shows notes only, not ordinary posts", async () => {
    await call(env.app, arjun, "POST", "/v1/posts", { text: "A plain text post" });
    const feed = await call(env.app, viewer, "GET", "/v1/feed/discover");
    expect(feed.body.items.length).toBeGreaterThan(0);
    expect(feed.body.items.every((i: { post: { kind: string } }) => i.post.kind === "note")).toBe(true);
  });

  it("filters by reviews, hashtag and nearby (nearest first)", async () => {
    const reviews = (await call(env.app, viewer, "GET", "/v1/feed/discover?topic=reviews")).body.items;
    expect(reviews.every((i: { post: { review: unknown } }) => i.post.review)).toBe(true);
    const tagged = (await call(env.app, viewer, "GET", "/v1/feed/discover?topic=filtercoffee")).body.items;
    expect(tagged.map((i: { post: { title: string } }) => i.post.title)).toEqual(["Best filter coffee in Mylapore"]);
    expect((await call(env.app, viewer, "GET", "/v1/feed/discover?topic=nearby")).status).toBe(400);
    const near = (await call(env.app, viewer, "GET", `/v1/feed/discover?topic=nearby&lat=${MYLAPORE.lat}&lng=${MYLAPORE.lng}`)).body.items;
    expect(near[0].post.place.name).toBe("Mylapore Coffee House");
    const mumbai = (await call(env.app, viewer, "GET", `/v1/feed/discover?topic=nearby&lat=${BANDRA.lat}&lng=${BANDRA.lng}`)).body.items;
    expect(mumbai).toHaveLength(0);
  });

  it("never recommends reach-limited or sensitive notes", async () => {
    const n = await note(arjun, { title: "Borderline content", mediaIds: [await photo(arjun, 9)] });
    const mod = await createStaff(env, "moderator");
    await admin(env.app, mod, "POST", "/actions", { action: "limit_reach", targetId: n.id, reasonCode: "spam", statement: "Reach limited: repetitive promotion." });
    const ids = (await call(env.app, viewer, "GET", "/v1/feed/discover?limit=40")).body.items.map((i: { post: { id: string } }) => i.post.id);
    expect(ids).not.toContain(n.id);
  });

  it("searches note titles and text, with related hashtags", async () => {
    const r = await call(env.app, viewer, "GET", "/v1/search/notes?q=coffee");
    expect(r.body.items.map((i: { post: { title: string } }) => i.post.title)).toContain("Best filter coffee in Mylapore");
    expect(r.body.related).toEqual(expect.arrayContaining(["#chennai", "#filtercoffee"]));
  });
});

describe("collections", () => {
  it("organise saves, and saving into one also bookmarks", async () => {
    const [n] = (await call(env.app, viewer, "GET", "/v1/feed/discover?topic=filtercoffee")).body.items;
    const c = await call(env.app, viewer, "POST", "/v1/me/collections", { name: "Chennai food" });
    expect(c.status).toBe(201);
    expect((await call(env.app, viewer, "POST", "/v1/me/collections", { name: "Chennai food" })).status).toBe(409);
    expect((await call(env.app, viewer, "POST", `/v1/me/collections/${c.body.id}/items`, { postId: n.post.id })).status).toBe(201);
    const mine = (await call(env.app, viewer, "GET", "/v1/me/collections")).body.items;
    expect(mine[0]).toMatchObject({ name: "Chennai food", itemCount: 1, covers: [expect.stringContaining("/media/")] });
    expect((await call(env.app, viewer, "GET", `/v1/posts/${n.post.id}/saved-in`)).body.collectionIds).toEqual([c.body.id]);
    expect((await call(env.app, viewer, "GET", `/v1/posts/${n.post.id}`)).body.viewer.bookmarked).toBe(true);

    // Public collections are visible to others; private ones aren't.
    expect((await call(env.app, arjun, "GET", `/v1/collections/${c.body.id}`)).body.items).toHaveLength(1);
    await call(env.app, viewer, "PATCH", `/v1/me/collections/${c.body.id}`, { isPrivate: true });
    expect((await call(env.app, arjun, "GET", `/v1/collections/${c.body.id}`)).status).toBe(404);
    expect((await call(env.app, arjun, "GET", `/v1/users/${viewer.id}/collections`)).body.items).toHaveLength(0);

    // Un-saving removes it from collections too.
    await call(env.app, viewer, "DELETE", `/v1/posts/${n.post.id}/bookmark`);
    expect((await call(env.app, viewer, "GET", "/v1/me/collections")).body.items[0].itemCount).toBe(0);
  });
});
