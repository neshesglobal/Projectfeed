import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StaticGeoIp, connectionStatus } from "../src/services/location";
import { call, register, setup, type TestEnv, type TestUser } from "./helpers";

// Documentation-style addresses mapped to countries; "VPN" ones are flagged anonymous.
const geo = new StaticGeoIp({
  "49.36.10.1": { country: "IN", anonymous: false }, // Indian mobile network
  "49.36.10.2": { country: "IN", anonymous: false },
  "94.200.1.1": { country: "AE", anonymous: false }, // UAE
  "185.220.1.1": { country: "US", anonymous: true }, // commercial VPN exit in the US
  "45.33.1.1": { country: "NL", anonymous: true }, // hosting provider
});

let env: TestEnv;
let viewer: TestUser;

beforeAll(async () => {
  env = await setup({}, { geo });
  viewer = await register(env.app, "ab_viewer");
});
afterAll(() => env.close());

const from = (user: TestUser, ip: string) =>
  env.app.inject({ method: "GET", url: "/v1/me", headers: { ...user.auth, "x-forwarded-for": ip } });

/** Usable connection days in the past (the hook only records today). */
async function pastDays(user: TestUser, country: string, days: number[], anonymous = false) {
  for (const d of days) {
    await env.sql`INSERT INTO connection_signals (user_id, day, country, anonymous) VALUES (${user.id}, current_date - ${d}::int, ${country}, ${anonymous})`;
  }
}
const about = async (u: TestUser) => (await call(env.app, viewer, "GET", `/v1/users/${u.id}/about`)).body;

describe("About this account", () => {
  it("shows the KYC document country and phone country", async () => {
    const u = await register(env.app, "ab_kyc");
    expect((await about(u)).identity).toEqual({ verified: false, country: null, verifiedAt: null });
    await env.sql`UPDATE users SET kyc_level = 1, id_country = 'IN', id_verified_at = now(), phone_country = 'IN' WHERE id = ${u.id}`;
    const a = await about(u);
    expect(a.identity).toMatchObject({ verified: true, country: { code: "IN", name: "India" } });
    expect(a.phoneCountry).toEqual({ code: "IN", name: "India" });
  });

  it("ignores VPN and hosting connections when working out where an account connects from", async () => {
    const u = await register(env.app, "ab_mumbai");
    await pastDays(u, "IN", [3, 2]);
    await from(u, "49.36.10.1"); // today, India
    for (let i = 0; i < 5; i++) await pastDays(u, "US", [10 + i], true); // lots of VPN days
    await from(u, "185.220.1.1");
    await from(u, "45.33.1.1");
    const a = await about(u);
    expect(a.connection).toMatchObject({ status: "ok", country: { code: "IN", name: "India" } });
    // VPN users are not labelled: the data is simply excluded.
    expect(JSON.stringify(a)).not.toMatch(/vpn|anonymous|proxy/i);
  });

  it("says 'not enough data' for accounts that only connect through VPNs", async () => {
    const u = await register(env.app, "ab_onlyvpn");
    await pastDays(u, "US", [1, 2, 3, 4, 5], true);
    await from(u, "185.220.1.1");
    expect((await about(u)).connection).toMatchObject({ status: "insufficient", country: null });
  });

  it("says 'varies' when no country dominates, and logs settled changes", async () => {
    const u = await register(env.app, "ab_mixed");
    await pastDays(u, "IN", [20, 19, 18]);
    await from(u, "49.36.10.1");
    expect((await about(u)).connection.country.code).toBe("IN");
    await pastDays(u, "AE", [5, 4, 3, 2, 1]);
    expect((await about(u)).connection.status).toBe("varies");
    await pastDays(u, "AE", [6, 7, 8, 9, 10, 11, 12, 13]);
    await from(u, "94.200.1.1"); // first AE connection today triggers a recompute
    const a = await about(u);
    expect(a.connection).toMatchObject({ status: "ok", country: { code: "AE", name: "United Arab Emirates" }, changesLastYear: 1 });
  });

  it("never stores raw IP addresses", async () => {
    const rows = await env.sql`SELECT * FROM connection_signals`;
    expect(JSON.stringify(rows)).not.toMatch(/49\.36|185\.220|94\.200|45\.33/);
  });

  it("shows 'unavailable' when VPN detection isn't configured, instead of an unfiltered country", async () => {
    const noVpnDetection = { name: "country-only", detectsAnonymous: false, lookup: () => ({ country: "IN", anonymous: false }) };
    const u = await register(env.app, "ab_novpndb");
    await pastDays(u, "IN", [1, 2, 3, 4]);
    expect(await connectionStatus(env.sql, noVpnDetection, u.id)).toEqual({ status: "unavailable", country: null });
  });

  it("hides the panel from blocked users", async () => {
    const u = await register(env.app, "ab_blocker");
    await call(env.app, u, "POST", `/v1/users/${viewer.id}/block`);
    expect((await call(env.app, viewer, "GET", `/v1/users/${u.id}/about`)).status).toBe(404);
  });

  it("shows a clean record only for established accounts with no upheld strikes", async () => {
    const u = await register(env.app, "ab_clean");
    expect((await about(u)).cleanRecord).toBe(false); // too new
    await env.sql`UPDATE users SET created_at = now() - interval '200 days' WHERE id = ${u.id}`;
    expect((await about(u)).cleanRecord).toBe(true);
    await env.sql`INSERT INTO moderation_actions (id, target_type, target_id, user_id, action, reason_code, statement)
                  VALUES (${String(Date.now())}, 'user', ${u.id}, ${u.id}, 'warn', 'spam', 'Warned for spam.')`;
    expect((await about(u)).cleanRecord).toBe(false);
  });
});

describe("username changes", () => {
  it("records every change publicly and enforces a cooldown", async () => {
    const u = await register(env.app, "ab_old");
    const r = await call(env.app, u, "PATCH", "/v1/me/handle", { handle: "ab_new" });
    expect(r.status).toBe(200);
    expect(r.body.handle).toBe("ab_new");
    expect((await about(u)).handleChanges).toEqual([{ from: "ab_old", to: "ab_new", at: expect.any(String) }]);
    const again = await call(env.app, u, "PATCH", "/v1/me/handle", { handle: "ab_newer" });
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("HANDLE_COOLDOWN");
  });

  it("refuses a taken handle", async () => {
    const u = await register(env.app, "ab_taker");
    expect((await call(env.app, u, "PATCH", "/v1/me/handle", { handle: "ab_viewer" })).status).toBe(409);
  });
});
