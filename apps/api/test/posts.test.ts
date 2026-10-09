import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeAll(async () => {
  env = await setup();
  alice = await register(env.app, "alice");
  bob = await register(env.app, "bob");
  carol = await register(env.app, "carol");
});
afterAll(() => env.close());

describe("posting", () => {
  it("creates a post with entities and counts", async () => {
    const p = await post(env.app, alice, "Brent spread widening #EN590 $XAU @bob");
    expect(p.author.handle).toBe("alice");
    expect(p.counts.likes).toBe(0);
    const me = await call(env.app, alice, "GET", "/v1/me");
    expect(me.body.postsCount).toBe(1);
    // @bob was mentioned, so bob is notified.
    const n = await call(env.app, bob, "GET", "/v1/notifications");
    expect(n.body.items.some((i: any) => i.type === "mention" && i.post.id === p.id)).toBe(true);
  });

  it("enforces the 280 weighted-character limit", async () => {
    expect((await call(env.app, alice, "POST", "/v1/posts", { text: "a".repeat(281) })).status).toBe(400);
    expect((await call(env.app, alice, "POST", "/v1/posts", { text: "a".repeat(280) })).status).toBe(201);
    // A long URL counts as 23 characters.
    const url = `https://example.com/${"x".repeat(300)}`;
    expect((await call(env.app, alice, "POST", "/v1/posts", { text: `${"a".repeat(250)} ${url}` })).status).toBe(201);
    expect((await call(env.app, alice, "POST", "/v1/posts", { text: "   " })).status).toBe(400);
  });

  it("threads replies, ranks the author's reply first, and notifies", async () => {
    const root = await post(env.app, alice, "Root post");
    const r1 = await post(env.app, bob, "Bob reply", { replyToId: root.id });
    const r2 = await post(env.app, alice, "Author reply", { replyToId: root.id });
    const nested = await post(env.app, carol, "Nested", { replyToId: r1.id });
    expect(nested.conversationId).toBe(root.id);

    const thread = await call(env.app, carol, "GET", `/v1/posts/${nested.id}/thread`);
    expect(thread.body.ancestors.map((p: any) => p.id)).toEqual([root.id, r1.id]);

    const rootThread = await call(env.app, carol, "GET", `/v1/posts/${root.id}/thread`);
    expect(rootThread.body.post.counts.replies).toBe(2);
    expect(rootThread.body.replies.items[0].id).toBe(r2.id);

    const n = await call(env.app, alice, "GET", "/v1/notifications?tab=mentions");
    expect(n.body.items.some((i: any) => i.type === "reply" && i.post.id === r1.id)).toBe(true);
  });

  it("restricts replies by audience", async () => {
    const p = await post(env.app, alice, "Followers only", { replyAudience: "following" });
    expect(p.viewer.canReply).toBe(true); // author can always reply
    const denied = await call(env.app, bob, "POST", "/v1/posts", { text: "hi", replyToId: p.id });
    expect(denied.status).toBe(403);
    await call(env.app, alice, "POST", `/v1/users/${bob.id}/follow`);
    expect((await call(env.app, bob, "POST", "/v1/posts", { text: "hi", replyToId: p.id })).status).toBe(201);
  });

  it("likes are idempotent and notifications group", async () => {
    const p = await post(env.app, alice, "Like me");
    await call(env.app, bob, "POST", `/v1/posts/${p.id}/like`);
    await call(env.app, bob, "POST", `/v1/posts/${p.id}/like`);
    await call(env.app, carol, "POST", `/v1/posts/${p.id}/like`);
    const got = await call(env.app, alice, "GET", `/v1/posts/${p.id}`);
    expect(got.body.counts.likes).toBe(2);

    const n = await call(env.app, alice, "GET", "/v1/notifications");
    const likeGroup = n.body.items.find((i: any) => i.type === "like" && i.post.id === p.id);
    expect(likeGroup.actorCount).toBe(2);

    await call(env.app, bob, "DELETE", `/v1/posts/${p.id}/like`);
    await call(env.app, bob, "DELETE", `/v1/posts/${p.id}/like`);
    const after = await call(env.app, bob, "GET", `/v1/posts/${p.id}`);
    expect(after.body.counts.likes).toBe(1);
    expect(after.body.viewer.liked).toBe(false);
  });

  it("reposts, quotes and bookmarks", async () => {
    const p = await post(env.app, alice, "Original");
    expect((await call(env.app, bob, "POST", `/v1/posts/${p.id}/repost`)).status).toBe(200);
    const q = await post(env.app, carol, "Quoting this", { quoteOfId: p.id });
    expect(q.quote.id).toBe(p.id);
    await call(env.app, bob, "POST", `/v1/posts/${p.id}/bookmark`);
    const got = await call(env.app, bob, "GET", `/v1/posts/${p.id}`);
    expect(got.body.counts).toMatchObject({ reposts: 1, quotes: 1, bookmarks: 1 });
    expect(got.body.viewer).toMatchObject({ reposted: true, bookmarked: true });

    const bookmarks = await call(env.app, bob, "GET", "/v1/me/bookmarks");
    expect(bookmarks.body.items[0].post.id).toBe(p.id);

    const profile = await call(env.app, carol, "GET", `/v1/users/${bob.id}/posts`);
    const repostItem = profile.body.items.find((i: any) => i.post.id === p.id);
    expect(repostItem.repostedBy.handle).toBe("bob");
  });

  it("edits within the window and keeps history", async () => {
    const p = await post(env.app, alice, "Tpyo");
    const e = await call(env.app, alice, "PATCH", `/v1/posts/${p.id}`, { text: "Typo fixed" });
    expect(e.status).toBe(200);
    expect(e.body.editCount).toBe(1);
    const h = await call(env.app, bob, "GET", `/v1/posts/${p.id}/edits`);
    expect(h.body.previous[0].text).toBe("Tpyo");
    expect((await call(env.app, bob, "PATCH", `/v1/posts/${p.id}`, { text: "hijack" })).status).toBe(404);
    await env.sql`UPDATE posts SET created_at = now() - interval '31 minutes' WHERE id = ${p.id}`;
    expect((await call(env.app, alice, "PATCH", `/v1/posts/${p.id}`, { text: "late" })).status).toBe(403);
  });

  it("deletes posts and fixes counters", async () => {
    const parent = await post(env.app, alice, "Parent");
    const reply = await post(env.app, bob, "Reply", { replyToId: parent.id });
    expect((await call(env.app, alice, "DELETE", `/v1/posts/${reply.id}`)).status).toBe(404); // not alice's
    expect((await call(env.app, bob, "DELETE", `/v1/posts/${reply.id}`)).status).toBe(204);
    expect((await call(env.app, alice, "GET", `/v1/posts/${reply.id}`)).status).toBe(404);
    expect((await call(env.app, alice, "GET", `/v1/posts/${parent.id}`)).body.counts.replies).toBe(0);
  });

  it("runs polls", async () => {
    const p = await post(env.app, alice, "Which benchmark?", { poll: { options: ["Platts", "Argus"], durationMinutes: 60 } });
    const v = await call(env.app, bob, "POST", `/v1/posts/${p.id}/vote`, { optionIndex: 1 });
    expect(v.body.poll.options[1].votes).toBe(1);
    expect(v.body.poll.viewerVote).toBe(1);
    expect((await call(env.app, bob, "POST", `/v1/posts/${p.id}/vote`, { optionIndex: 0 })).status).toBe(403);
  });

  it("counts views once per user", async () => {
    const p = await post(env.app, alice, "Views");
    await call(env.app, bob, "GET", `/v1/posts/${p.id}`);
    await call(env.app, bob, "GET", `/v1/posts/${p.id}`);
    await call(env.app, carol, "POST", "/v1/events", {
      events: [{ type: "impression", postId: p.id, surface: "home", position: 0, ts: new Date().toISOString() }],
    });
    expect((await call(env.app, alice, "GET", `/v1/posts/${p.id}`)).body.counts.views).toBe(3); // bob, carol, alice
  });
});
