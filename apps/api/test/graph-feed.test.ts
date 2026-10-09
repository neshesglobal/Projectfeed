import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let dave: TestUser;

beforeAll(async () => {
  env = await setup();
  [alice, bob, carol, dave] = (await Promise.all(["alice", "bob", "carol", "dave"].map((h) => register(env.app, h)))) as [TestUser, TestUser, TestUser, TestUser];
});
afterAll(() => env.close());

const ids = (page: any) => page.items.map((i: any) => i.post.id);

describe("follow graph & Following timeline", () => {
  it("shows followed accounts' posts and reposts newest first", async () => {
    await call(env.app, alice, "POST", `/v1/users/${bob.id}/follow`);
    const b1 = await post(env.app, bob, "bob one");
    const c1 = await post(env.app, carol, "carol one (not followed)");
    const b2 = await post(env.app, bob, "bob two");
    await call(env.app, bob, "POST", `/v1/posts/${c1.id}/repost`);
    const a1 = await post(env.app, alice, "my own post");

    const feed = await call(env.app, alice, "GET", "/v1/feed/following");
    expect(ids(feed.body)).toEqual([a1.id, c1.id, b2.id, b1.id]);
    expect(feed.body.items[1].repostedBy.handle).toBe("bob");

    const me = await call(env.app, alice, "GET", "/v1/me");
    expect(me.body.followingCount).toBe(1);
    const bobProfile = await call(env.app, alice, "GET", `/v1/users/by-handle/bob`);
    expect(bobProfile.body.followersCount).toBe(1);
    expect(bobProfile.body.viewer.following).toBe(true);
  });

  it("paginates with a cursor without gaps or duplicates", async () => {
    for (let i = 0; i < 7; i++) await post(env.app, bob, `page ${i}`);
    const all: string[] = [];
    let cursor: string | null = "";
    while (cursor !== null) {
      const r: any = await call(env.app, alice, "GET", `/v1/feed/following?limit=3&cursor=${cursor}`);
      all.push(...ids(r.body));
      cursor = r.body.nextCursor;
    }
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(10);
  });

  it("filters muted accounts and muted words from the timeline", async () => {
    const spam = await post(env.app, bob, "Buy my course on crypto now");
    await call(env.app, alice, "POST", "/v1/me/muted-words", { word: "crypto" });
    let feed = await call(env.app, alice, "GET", "/v1/feed/following");
    expect(ids(feed.body)).not.toContain(spam.id);

    const ok = await post(env.app, bob, "cryptography is not crypto-adjacent"); // contains "crypto" as a whole word
    feed = await call(env.app, alice, "GET", "/v1/feed/following");
    expect(ids(feed.body)).not.toContain(ok.id);
    const ok2 = await post(env.app, bob, "cryptography lecture");
    feed = await call(env.app, alice, "GET", "/v1/feed/following");
    expect(ids(feed.body)).toContain(ok2.id);

    await call(env.app, alice, "POST", `/v1/users/${bob.id}/mute`);
    feed = await call(env.app, alice, "GET", "/v1/feed/following");
    expect(feed.body.items.every((i: any) => i.post.author.id !== bob.id)).toBe(true);
    await call(env.app, alice, "DELETE", `/v1/users/${bob.id}/mute`);
  });
});

describe("protected accounts", () => {
  it("hides posts until a follow request is accepted", async () => {
    await call(env.app, dave, "PATCH", "/v1/me", { isProtected: true });
    const secret = await post(env.app, dave, "protected thoughts");

    expect((await call(env.app, carol, "GET", `/v1/posts/${secret.id}`)).status).toBe(404);
    expect((await call(env.app, carol, "GET", `/v1/users/${dave.id}/posts`)).status).toBe(403);

    const f = await call(env.app, carol, "POST", `/v1/users/${dave.id}/follow`);
    expect(f.body.state).toBe("requested");
    const reqs = await call(env.app, dave, "GET", "/v1/me/follow-requests");
    expect(reqs.body.items[0].id).toBe(carol.id);

    await call(env.app, dave, "POST", `/v1/me/follow-requests/${carol.id}/accept`);
    expect((await call(env.app, carol, "GET", `/v1/posts/${secret.id}`)).status).toBe(200);
    // Protected posts cannot be reposted.
    expect((await call(env.app, carol, "POST", `/v1/posts/${secret.id}/repost`)).status).toBe(403);
  });
});

describe("blocking", () => {
  it("severs follows, hides content both ways and prevents interaction", async () => {
    const x = await register(env.app, "xavier");
    const y = await register(env.app, "yasmin");
    await call(env.app, x, "POST", `/v1/users/${y.id}/follow`);
    await call(env.app, y, "POST", `/v1/users/${x.id}/follow`);
    const yp = await post(env.app, y, "yasmin's post");

    await call(env.app, y, "POST", `/v1/users/${x.id}/block`);
    expect((await call(env.app, x, "GET", `/v1/posts/${yp.id}`)).status).toBe(404);
    expect((await call(env.app, x, "POST", `/v1/users/${y.id}/follow`)).status).toBe(403);
    expect((await call(env.app, x, "POST", `/v1/posts/${yp.id}/like`)).status).toBe(404);
    const xme = await call(env.app, x, "GET", "/v1/me");
    expect(xme.body.followingCount).toBe(0);
    expect(xme.body.followersCount).toBe(0);
    const rel = await call(env.app, x, "GET", `/v1/users/${y.id}`);
    expect(rel.body.viewer.blockedBy).toBe(true);
  });
});

describe("For You", () => {
  it("ranks in-network and out-of-network posts with reasons, and pages a stable snapshot", async () => {
    const viewer = await register(env.app, "viewer");
    const friend = await register(env.app, "friend");
    const stranger = await register(env.app, "stranger");
    const blocked = await register(env.app, "blockedguy");
    await call(env.app, viewer, "POST", `/v1/users/${friend.id}/follow`);
    await call(env.app, viewer, "POST", `/v1/users/${blocked.id}/block`);

    const fp = await post(env.app, friend, "from a friend");
    const viral = await post(env.app, stranger, "viral take");
    const bp = await post(env.app, blocked, "blocked content");
    for (const u of [alice, bob, carol, dave, friend]) await call(env.app, u, "POST", `/v1/posts/${viral.id}/like`);

    const feed = await call(env.app, viewer, "GET", "/v1/feed/for-you?limit=50");
    const got = ids(feed.body);
    expect(got).toContain(fp.id);
    expect(got).toContain(viral.id);
    expect(got).not.toContain(bp.id);
    const viralItem = feed.body.items.find((i: any) => i.post.id === viral.id);
    expect(viralItem.reason).toBe("Liked by @friend");
    expect(feed.body.items.find((i: any) => i.post.id === fp.id).reason).toBeNull();

    // Page through with a small limit: no duplicates across pages.
    const seen: string[] = [];
    let cursor: string | null = "";
    while (cursor !== null) {
      const r: any = await call(env.app, viewer, "GET", `/v1/feed/for-you?limit=4&cursor=${cursor}`);
      seen.push(...ids(r.body));
      cursor = r.body.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);

    // "Not interested" removes the post.
    await call(env.app, viewer, "POST", `/v1/posts/${viral.id}/not-interested`);
    expect(ids((await call(env.app, viewer, "GET", "/v1/feed/for-you?limit=50")).body)).not.toContain(viral.id);
  });

  it("gives a brand-new user a non-empty feed (cold start)", async () => {
    const newbie = await register(env.app, "newbie");
    const feed = await call(env.app, newbie, "GET", "/v1/feed/for-you");
    expect(feed.body.items.length).toBeGreaterThan(0);
    expect(feed.body.items.every((i: any) => i.reason)).toBe(true);
  });

  it("suggests accounts to follow", async () => {
    const s = await call(env.app, carol, "GET", "/v1/users/suggestions");
    expect(s.status).toBe(200);
    expect(s.body.items.every((u: any) => u.id !== carol.id)).toBe(true);
  });
});

describe("search & trends", () => {
  it("searches posts by text, hashtag, cashtag and from:", async () => {
    const s1 = await post(env.app, alice, "Jet A1 premiums rising in Rotterdam #jetfuel");
    const s2 = await post(env.app, bob, "Gold above 3k $XAU #jetfuel");
    expect(ids((await call(env.app, carol, "GET", "/v1/search/posts?q=rotterdam&mode=latest")).body)).toEqual([s1.id]);
    expect(ids((await call(env.app, carol, "GET", `/v1/search/posts?q=${encodeURIComponent("#JetFuel")}&mode=latest`)).body)).toEqual([s2.id, s1.id]);
    expect(ids((await call(env.app, carol, "GET", `/v1/search/posts?q=${encodeURIComponent("$xau")}`)).body)).toEqual([s2.id]);
    expect(ids((await call(env.app, carol, "GET", `/v1/search/posts?q=${encodeURIComponent("#jetfuel from:alice")}&mode=latest`)).body)).toEqual([s1.id]);
  });

  it("searches users and typeahead", async () => {
    const r = await call(env.app, carol, "GET", "/v1/search/users?q=ali");
    expect(r.body.items[0].handle).toBe("alice");
    const t = await call(env.app, carol, "GET", "/v1/search/typeahead?q=%23jet");
    expect(t.body.tags[0].tag).toBe("jetfuel");
  });

  it("trends tags used by several distinct authors", async () => {
    const t = await call(env.app, carol, "GET", "/v1/trends");
    expect(t.body.items.map((i: any) => i.tag)).toContain("jetfuel");
  });
});
