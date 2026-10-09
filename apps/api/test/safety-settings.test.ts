import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, post, register, setup, type TestEnv } from "./helpers";

describe("KYC gate (KYC_ENFORCED=true)", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup({ kycEnforced: true });
  });
  afterAll(() => env.close());

  it("makes unverified users read-only, but still lets them report", async () => {
    const u = await register(env.app, "unverified");
    const w = await register(env.app, "writer");
    const blocked = await call(env.app, u, "POST", "/v1/posts", { text: "hello" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("KYC_REQUIRED");
    expect((await call(env.app, u, "POST", `/v1/users/${w.id}/follow`)).status).toBe(403);
    expect((await call(env.app, u, "GET", "/v1/feed/for-you")).status).toBe(200);

    await env.sql`UPDATE users SET kyc_level = 1 WHERE id = ${w.id}`;
    // Verification takes effect immediately, without a new token.
    const p = await post(env.app, w, "verified post");
    expect(p.author.kycLevel).toBe(1);
    const report = await call(env.app, u, "POST", "/v1/reports", { targetType: "post", targetId: p.id, reason: "scam_fraud" });
    expect(report.status).toBe(201);
    const [row] = await env.sql<{ priority: number }[]>`SELECT priority FROM reports`;
    expect(row!.priority).toBe(2);
  });
});

describe("settings, suspension & account deletion", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup();
  });
  afterAll(() => env.close());

  it("changes password and signs out other sessions", async () => {
    const u = await register(env.app, "pwuser");
    const wrong = await call(env.app, u, "POST", "/v1/me/password", { currentPassword: "nope", newPassword: "another-long-password" });
    expect(wrong.status).toBe(401);
    const ok = await call(env.app, u, "POST", "/v1/me/password", {
      currentPassword: "correct-horse-battery",
      newPassword: "another-long-password",
    });
    expect(ok.status).toBe(200);
    expect((await call(env.app, null, "POST", "/v1/auth/refresh", { refreshToken: u.refreshToken })).status).toBe(401);
    expect((await call(env.app, null, "POST", "/v1/auth/login", { identifier: "pwuser", password: "another-long-password" })).status).toBe(200);
  });

  it("locks out suspended accounts immediately", async () => {
    const u = await register(env.app, "baduser");
    await env.sql`UPDATE users SET status = 'suspended' WHERE id = ${u.id}`;
    expect((await call(env.app, u, "GET", "/v1/me")).status).toBe(401);
  });

  it("exports data and deletes the account, freeing the handle", async () => {
    const u = await register(env.app, "leaver");
    const fan = await register(env.app, "fan");
    await call(env.app, fan, "POST", `/v1/users/${u.id}/follow`);
    const p = await post(env.app, u, "goodbye");
    await call(env.app, fan, "POST", `/v1/posts/${p.id}/like`);

    const exp = await call(env.app, u, "GET", "/v1/me/export");
    expect(exp.body.profile.handle).toBe("leaver");
    expect(exp.body.posts).toHaveLength(1);
    expect(exp.body.followers).toHaveLength(1);

    expect((await call(env.app, u, "POST", "/v1/me/delete", { password: "wrong" })).status).toBe(401);
    expect((await call(env.app, u, "POST", "/v1/me/delete", { password: "correct-horse-battery" })).status).toBe(204);

    expect((await call(env.app, u, "GET", "/v1/me")).status).toBe(401);
    expect((await call(env.app, fan, "GET", `/v1/posts/${p.id}`)).status).toBe(404);
    expect((await call(env.app, fan, "GET", "/v1/me")).body.followingCount).toBe(0);
    expect((await call(env.app, fan, "GET", "/v1/users/by-handle/leaver")).status).toBe(404);
    // Handle and email are reusable.
    await register(env.app, "leaver");
  });

  it("validates report input", async () => {
    const u = await register(env.app, "reporter");
    expect((await call(env.app, u, "POST", "/v1/reports", { targetType: "post", targetId: "x", reason: "spam" })).status).toBe(400);
    expect((await call(env.app, u, "POST", "/v1/reports", { targetType: "post", targetId: "1", reason: "nonsense" })).status).toBe(400);
  });
});
