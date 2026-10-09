import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeAll(async () => {
  env = await setup();
  [alice, bob, carol] = (await Promise.all(["alice", "bob", "carol"].map((h) => register(env.app, h)))) as [TestUser, TestUser, TestUser];
});
afterAll(() => env.close());

describe("direct messages", () => {
  it("routes messages from non-followers to requests, and replying accepts", async () => {
    const conv = await call(env.app, alice, "POST", "/v1/conversations", { participantIds: [bob.id] });
    expect(conv.status).toBe(201);
    const cid = conv.body.id;
    await call(env.app, alice, "POST", `/v1/conversations/${cid}/messages`, { text: "Hello Bob — interested in EN590?" });

    expect((await call(env.app, bob, "GET", "/v1/conversations")).body.items).toHaveLength(0);
    const reqs = await call(env.app, bob, "GET", "/v1/conversations?tab=requests");
    expect(reqs.body.items[0].id).toBe(cid);
    expect(reqs.body.items[0].unreadCount).toBe(1);
    expect((await call(env.app, bob, "GET", "/v1/notifications/unread-count")).body.messages).toBe(0); // requests don't badge

    await call(env.app, bob, "POST", `/v1/conversations/${cid}/messages`, { text: "Yes, send FCO" });
    const inbox = await call(env.app, bob, "GET", "/v1/conversations");
    expect(inbox.body.items[0].lastMessage.text).toBe("Yes, send FCO");
    expect((await call(env.app, alice, "GET", "/v1/notifications/unread-count")).body.messages).toBe(1);
    await call(env.app, alice, "POST", `/v1/conversations/${cid}/read`);
    expect((await call(env.app, alice, "GET", "/v1/notifications/unread-count")).body.messages).toBe(0);

    // Starting a DM again returns the same conversation.
    const again = await call(env.app, bob, "POST", "/v1/conversations", { participantIds: [alice.id] });
    expect(again.body.id).toBe(cid);

    const msgs = await call(env.app, alice, "GET", `/v1/conversations/${cid}/messages`);
    expect(msgs.body.items.map((m: any) => m.text)).toEqual(["Yes, send FCO", "Hello Bob — interested in EN590?"]);
  });

  it("keeps outsiders out and enforces blocks", async () => {
    const conv = await call(env.app, alice, "POST", "/v1/conversations", { participantIds: [carol.id] });
    const cid = conv.body.id;
    expect((await call(env.app, bob, "GET", `/v1/conversations/${cid}/messages`)).status).toBe(404);
    await call(env.app, carol, "POST", `/v1/users/${alice.id}/block`);
    expect((await call(env.app, alice, "POST", `/v1/conversations/${cid}/messages`, { text: "hi" })).status).toBe(403);
    expect((await call(env.app, alice, "POST", "/v1/conversations", { participantIds: [carol.id] })).status).toBe(403);
    await call(env.app, carol, "DELETE", `/v1/users/${alice.id}/block`);
  });

  it("supports group chats, edits and deletes", async () => {
    const conv = await call(env.app, alice, "POST", "/v1/conversations", { participantIds: [bob.id, carol.id], title: "Desk" });
    expect(conv.body.isGroup).toBe(true);
    const m = await call(env.app, alice, "POST", `/v1/conversations/${conv.body.id}/messages`, { text: "teh" });
    const e = await call(env.app, alice, "PATCH", `/v1/messages/${m.body.id}`, { text: "the" });
    expect(e.body.editedAt).not.toBeNull();
    expect((await call(env.app, bob, "PATCH", `/v1/messages/${m.body.id}`, { text: "x" })).status).toBe(403);
    expect((await call(env.app, alice, "DELETE", `/v1/messages/${m.body.id}`)).status).toBe(204);
    const msgs = await call(env.app, bob, "GET", `/v1/conversations/${conv.body.id}/messages`);
    expect(msgs.body.items[0].deleted).toBe(true);
    expect(msgs.body.items[0].text).toBe("");
  });
});

describe("lists", () => {
  it("creates a list, adds members, pins it and reads its timeline", async () => {
    const l = await call(env.app, alice, "POST", "/v1/lists", { name: "Gold desk" });
    expect(l.status).toBe(201);
    await call(env.app, alice, "PUT", `/v1/lists/${l.body.id}/members/${bob.id}`);
    const bp = await post(env.app, bob, "Bob on the list");
    await post(env.app, carol, "Carol not on the list");
    const tl = await call(env.app, alice, "GET", `/v1/lists/${l.body.id}/timeline`);
    expect(tl.body.items.map((i: any) => i.post.id)).toEqual([bp.id]);
    await call(env.app, alice, "PUT", `/v1/lists/${l.body.id}/pin`, { pinned: true });
    const mine = await call(env.app, alice, "GET", "/v1/me/lists");
    expect(mine.body.items[0]).toMatchObject({ name: "Gold desk", memberCount: 1, viewerPinned: true });
  });

  it("keeps private lists private", async () => {
    const l = await call(env.app, alice, "POST", "/v1/lists", { name: "Secret", isPrivate: true });
    expect((await call(env.app, bob, "GET", `/v1/lists/${l.body.id}`)).status).toBe(404);
    expect((await call(env.app, bob, "PUT", `/v1/lists/${l.body.id}/members/${carol.id}`)).status).toBe(404);
  });
});

describe("media", () => {
  it("uploads an image, strips EXIF, and attaches it to a post once", async () => {
    const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#d4a017" } })
      .withExif({ IFD0: { Copyright: "secret-location" } })
      .jpeg()
      .toBuffer();
    const boundary = "----pfboundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="altText"\r\n\r\nGold bar\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await env.app.inject({
      method: "POST",
      url: "/v1/media",
      payload,
      headers: { ...alice.auth, "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    const media = res.json();
    expect(media).toMatchObject({ type: "image", width: 2048, height: 1024, altText: "Gold bar" });

    const file = await env.app.inject({ method: "GET", url: new URL(media.url).pathname });
    expect(file.statusCode).toBe(200);
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();

    const p = await post(env.app, alice, "", { mediaIds: [media.id] });
    expect(p.media[0].id).toBe(media.id);
    // The same media cannot be attached twice, nor by someone else.
    expect((await call(env.app, alice, "POST", "/v1/posts", { text: "again", mediaIds: [media.id] })).status).toBe(400);
    expect((await call(env.app, bob, "POST", "/v1/posts", { text: "steal", mediaIds: [media.id] })).status).toBe(400);

    const mediaTab = await call(env.app, bob, "GET", `/v1/users/${alice.id}/posts?tab=media`);
    expect(mediaTab.body.items[0].post.id).toBe(p.id);
  });

  it("rejects non-images", async () => {
    const boundary = "----pfboundary";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`,
    );
    const res = await env.app.inject({
      method: "POST",
      url: "/v1/media",
      payload,
      headers: { ...alice.auth, "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
