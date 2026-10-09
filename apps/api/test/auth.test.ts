import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, register, setup, type TestEnv } from "./helpers";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(() => env.close());

describe("auth", () => {
  it("registers and returns the profile", async () => {
    const u = await register(env.app, "alice");
    const me = await call(env.app, u, "GET", "/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.handle).toBe("alice");
    expect(me.body.kycLevel).toBe(0);
  });

  it("rejects a duplicate handle case-insensitively", async () => {
    const r = await call(env.app, null, "POST", "/v1/auth/register", {
      email: "other@example.com",
      password: "correct-horse-battery",
      handle: "ALICE",
      displayName: "Other",
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("HANDLE_TAKEN");
  });

  it("rejects weak passwords and bad handles", async () => {
    const r = await call(env.app, null, "POST", "/v1/auth/register", {
      email: "x@example.com",
      password: "short",
      handle: "has space",
      displayName: "X",
    });
    expect(r.status).toBe(400);
  });

  it("logs in by handle or email, and rejects a wrong password", async () => {
    await register(env.app, "bob");
    expect((await call(env.app, null, "POST", "/v1/auth/login", { identifier: "@Bob", password: "correct-horse-battery" })).status).toBe(200);
    expect((await call(env.app, null, "POST", "/v1/auth/login", { identifier: "bob@example.com", password: "correct-horse-battery" })).status).toBe(200);
    const bad = await call(env.app, null, "POST", "/v1/auth/login", { identifier: "bob", password: "wrong-password!" });
    expect(bad.status).toBe(401);
    const unknown = await call(env.app, null, "POST", "/v1/auth/login", { identifier: "nobody", password: "wrong-password!" });
    expect(unknown.status).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const u = await register(env.app, "carol");
    const first = await call(env.app, null, "POST", "/v1/auth/refresh", { refreshToken: u.refreshToken });
    expect(first.status).toBe(200);
    expect(first.body.refreshToken).not.toBe(u.refreshToken);

    // Replaying the old token is treated as theft: it fails and kills the new token too.
    const replay = await call(env.app, null, "POST", "/v1/auth/refresh", { refreshToken: u.refreshToken });
    expect(replay.status).toBe(401);
    const afterTheft = await call(env.app, null, "POST", "/v1/auth/refresh", { refreshToken: first.body.refreshToken });
    expect(afterTheft.status).toBe(401);
  });

  it("rejects requests with an invalid access token", async () => {
    const r = await env.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Bearer nonsense" } });
    expect(r.statusCode).toBe(401);
  });

  it("requires auth for /me", async () => {
    expect((await call(env.app, null, "GET", "/v1/me")).status).toBe(401);
  });
});
