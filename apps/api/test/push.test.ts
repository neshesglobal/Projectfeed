import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RecordingPushSender } from "../src/services/push";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
const sender = new RecordingPushSender();
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
const tok = (s: string) => `ExponentPushToken[${s.padEnd(22, "x")}]`;

beforeAll(async () => {
  env = await setup({}, { push: sender });
  alice = await register(env.app);
  bob = await register(env.app);
  carol = await register(env.app);
  for (const [u, t] of [[alice, "alice"], [bob, "bob"]] as const) {
    const r = await call(env.app, u, "PUT", "/v1/me/push-tokens", { token: tok(t), platform: "ios" });
    expect(r.status).toBe(204);
  }
});
afterAll(() => env.close());
beforeEach(async () => {
  await env.app.ctx.push.flush();
  sender.sent = [];
});

const flush = () => env.app.ctx.push.flush();

describe("push notifications", () => {
  it("rejects malformed tokens", async () => {
    const r = await call(env.app, alice, "PUT", "/v1/me/push-tokens", { token: "nope", platform: "ios" });
    expect(r.status).toBe(400);
  });

  it("pushes a like with the post text, a deep link and a badge, once per post per window", async () => {
    const p = await post(env.app, bob, "Cargo of EN590 loading at Rotterdam next week");
    await call(env.app, alice, "POST", `/v1/posts/${p.id}/like`);
    expect(await flush()).toBe(1);
    const [m] = sender.sent;
    expect(m!.to).toBe(tok("bob"));
    expect(m!.title).toMatch(/liked your post$/);
    expect(m!.body).toBe("Cargo of EN590 loading at Rotterdam next week");
    expect(m!.data.url).toBe(`/post/${p.id}`);
    expect(m!.badge).toBe(1);

    // A second like on the same post within the window does not push again.
    await call(env.app, carol, "POST", `/v1/posts/${p.id}/like`);
    expect(await flush()).toBe(0);
  });

  it("does not push a like that was undone before delivery", async () => {
    const p = await post(env.app, bob, "Second post");
    await call(env.app, alice, "POST", `/v1/posts/${p.id}/like`);
    await call(env.app, alice, "DELETE", `/v1/posts/${p.id}/like`);
    expect(await flush()).toBe(0);
  });

  it("pushes replies and follows; nothing for people without a device", async () => {
    const p = await post(env.app, alice, "Who has Jet A1 in Fujairah?");
    await call(env.app, bob, "POST", "/v1/posts", { text: "We do, DM me", replyToId: p.id });
    await call(env.app, carol, "POST", `/v1/users/${alice.id}/follow`);
    await call(env.app, alice, "POST", `/v1/users/${carol.id}/follow`); // carol has no device
    expect(await flush()).toBe(2);
    expect(sender.sent.map((m) => m.title).sort()).toEqual([`${bob.handle} replied`, `${carol.handle} followed you`].sort());
    expect(sender.sent.find((m) => m.title.endsWith("replied"))!.body).toBe("We do, DM me");
    expect(sender.sent.find((m) => m.title.endsWith("followed you"))!.data.url).toBe(`/user/${carol.handle}`);
  });

  it("respects the per-type and master switches", async () => {
    const off = await call(env.app, bob, "PATCH", "/v1/me/push-settings", { likes: false });
    expect(off.body.likes).toBe(false);
    expect(off.body.replies).toBe(true);
    const p = await post(env.app, bob, "Third post");
    await call(env.app, alice, "POST", `/v1/posts/${p.id}/like`);
    expect(await flush()).toBe(0);

    await call(env.app, bob, "PATCH", "/v1/me/push-settings", { likes: true, enabled: false });
    await call(env.app, alice, "POST", "/v1/posts", { text: "@" + bob.handle + " are you there?" });
    expect(await flush()).toBe(0);
    await call(env.app, bob, "PATCH", "/v1/me/push-settings", { enabled: true });
    expect((await call(env.app, bob, "PATCH", "/v1/me/push-settings", { bogus: true })).status).toBe(400);
  });

  it("pushes direct messages: requests without a preview, then the text once accepted", async () => {
    const conv = await call(env.app, carol, "POST", "/v1/conversations", { participantIds: [alice.id] });
    await call(env.app, carol, "POST", `/v1/conversations/${conv.body.id}/messages`, { text: "Private offer attached" });
    await flush();
    // alice follows carol, so this lands in the inbox rather than requests.
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.title).toBe(carol.handle);
    expect(sender.sent[0]!.body).toBe("Private offer attached");
    expect(sender.sent[0]!.data.url).toBe(`/conversation/${conv.body.id}`);

    sender.sent = [];
    const req = await call(env.app, carol, "POST", "/v1/conversations", { participantIds: [bob.id] });
    await call(env.app, carol, "POST", `/v1/conversations/${req.body.id}/messages`, { text: "Secret details" });
    await flush();
    expect(sender.sent[0]!.title).toBe("New message request");
    expect(sender.sent[0]!.body).not.toContain("Secret");

    sender.sent = [];
    await call(env.app, alice, "PATCH", "/v1/me/push-settings", { messagePreviews: false });
    await call(env.app, carol, "POST", `/v1/conversations/${conv.body.id}/messages`, { text: "Price is 650" });
    await flush();
    expect(sender.sent[0]!.body).toBe("Sent you a message");
  });

  it("drops uninstalled devices and devices signed out", async () => {
    await call(env.app, carol, "PUT", "/v1/me/push-tokens", { token: tok("carol"), platform: "android" });
    sender.gone.add(tok("carol"));
    await post(env.app, alice, `Hello @${carol.handle}`);
    expect(await flush()).toBe(1);
    expect(await env.sql`SELECT 1 FROM push_tokens WHERE token = ${tok("carol")}`).toHaveLength(0);

    await env.app.inject({ method: "POST", url: "/v1/auth/logout", payload: { pushToken: tok("alice") } });
    expect(await env.sql`SELECT 1 FROM push_tokens WHERE token = ${tok("alice")}`).toHaveLength(0);
  });

  it("moves a device to whoever signs in on it last", async () => {
    await call(env.app, alice, "PUT", "/v1/me/push-tokens", { token: tok("shared"), platform: "ios" });
    await call(env.app, bob, "PUT", "/v1/me/push-tokens", { token: tok("shared"), platform: "ios" });
    const [row] = await env.sql<{ user_id: string }[]>`SELECT user_id FROM push_tokens WHERE token = ${tok("shared")}`;
    expect(row!.user_id).toBe(bob.id);
  });
});
