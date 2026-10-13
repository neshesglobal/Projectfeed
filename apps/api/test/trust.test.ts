import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeTrust, refreshTrust } from "../src/services/trust";
import { admin, call, createStaff, post, register, setup, type TestEnv, type TestStaff } from "./helpers";

let env: TestEnv;
let mod: TestStaff;

beforeAll(async () => {
  env = await setup();
  mod = await createStaff(env, "moderator");
});
afterAll(() => env.close());

const setTrust = (id: string, score: number) => env.sql`UPDATE users SET trust_score = ${score}, trust_updated_at = now() WHERE id = ${id}`;

describe("trust score", () => {
  it("is built from explainable factors", async () => {
    const u = await register(env.app, "tr_new");
    expect(await computeTrust(env.sql, u.id)).toMatchObject({ score: 50, band: "Fair" });
    await env.sql`UPDATE users SET kyc_level = 1, created_at = now() - interval '200 days' WHERE id = ${u.id}`;
    const t = await computeTrust(env.sql, u.id);
    expect(t.factors.map((f) => f.key)).toEqual(["base", "id", "age", "clean"]);
    expect(t).toMatchObject({ score: 50 + 15 + 6 + 10, band: "Excellent" });
  });

  it("drops with upheld violations and when many people block the account", async () => {
    const u = await register(env.app, "tr_rude");
    await env.sql`UPDATE users SET kyc_level = 1 WHERE id = ${u.id}`;
    await admin(env.app, mod, "POST", "/actions", { action: "warn", targetId: u.id, reasonCode: "harassment", statement: "Warning for harassment in replies." });
    const [{ trust_score }] = (await env.sql`SELECT trust_score FROM users WHERE id = ${u.id}`) as unknown as [{ trust_score: number }];
    expect(trust_score).toBe(50 + 15 - 15); // refreshed by the moderation action
    for (let i = 0; i < 4; i++) {
      const b = await register(env.app, `tr_blocker${i}`);
      await call(env.app, b, "POST", `/v1/users/${u.id}/block`);
    }
    const t = await computeTrust(env.sql, u.id);
    expect(t.factors.find((f) => f.key === "blocks")).toMatchObject({ points: -8 });
    expect(t.band).toBe("Fair");
  });

  it("is shown only to the account holder", async () => {
    const u = await register(env.app, "tr_self");
    const other = await register(env.app, "tr_other");
    const standing = (await call(env.app, u, "GET", "/v1/me/standing")).body;
    expect(standing.trust).toMatchObject({ score: 50, band: "Fair" });
    const profile = (await call(env.app, other, "GET", `/v1/users/${u.id}`)).body;
    expect(JSON.stringify(profile)).not.toMatch(/trust/i);
    const about = (await call(env.app, other, "GET", `/v1/users/${u.id}/about`)).body;
    expect(JSON.stringify(about)).not.toMatch(/trust/i);
  });
});

describe("what the score changes", () => {
  it("keeps low-trust accounts out of strangers' For You, but not their followers'", async () => {
    const troll = await register(env.app, "tr_troll");
    const fan = await register(env.app, "tr_fan");
    const stranger = await register(env.app, "tr_stranger");
    await call(env.app, fan, "POST", `/v1/users/${troll.id}/follow`);
    const p = await post(env.app, troll, "Hot take nobody asked for #wheat");
    await setTrust(troll.id, 20);
    const feedIds = async (u: typeof fan) => ((await call(env.app, u, "GET", "/v1/feed/for-you")).body.items as { post: { id: string } }[]).map((i) => i.post.id);
    expect(await feedIds(stranger)).not.toContain(p.id);
    expect(await feedIds(fan)).toContain(p.id);
    await setTrust(troll.id, 70);
    expect(await feedIds(await register(env.app, "tr_stranger2"))).toContain(p.id);
  });

  it("ranks low-trust replies below everyone else", async () => {
    const op = await register(env.app, "tr_op");
    const good = await register(env.app, "tr_good");
    const bad = await register(env.app, "tr_bad");
    const reader = await register(env.app, "tr_reader");
    const root = await post(env.app, op, "Freight rates this week?");
    const badReply = await post(env.app, bad, "Rubbish question", { replyToId: root.id });
    const goodReply = await post(env.app, good, "MR rates up 12% w/w", { replyToId: root.id });
    for (let i = 0; i < 3; i++) await call(env.app, await register(env.app, `tr_liker${i}`), "POST", `/v1/posts/${badReply.id}/like`);
    await setTrust(bad.id, 25);
    const replies = (await call(env.app, reader, "GET", `/v1/posts/${root.id}/replies`)).body.items.map((p: { id: string }) => p.id);
    expect(replies).toEqual([goodReply.id, badReply.id]);
  });

  it("caps new conversations per day for low-trust accounts", async () => {
    const spammer = await register(env.app, "tr_spammer");
    await setTrust(spammer.id, 20); // Limited: 5 a day
    const targets = await Promise.all(Array.from({ length: 6 }, (_, i) => register(env.app, `tr_dm${i}`)));
    for (const t of targets.slice(0, 5)) {
      expect((await call(env.app, spammer, "POST", "/v1/conversations", { participantIds: [t.id] })).status).toBe(201);
    }
    const sixth = await call(env.app, spammer, "POST", "/v1/conversations", { participantIds: [targets[5]!.id] });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe("DM_LIMIT");
    // Reopening an existing conversation doesn't count.
    expect((await call(env.app, spammer, "POST", "/v1/conversations", { participantIds: [targets[0]!.id] })).status).toBeLessThan(300);
    await refreshTrust(env.sql, spammer.id);
  });
});
