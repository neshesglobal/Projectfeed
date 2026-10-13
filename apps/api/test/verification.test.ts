import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidGstin, validateRegistration } from "@projectfeed/shared";
import { admin, call, createStaff, post, register, setup, type TestEnv, type TestStaff, type TestUser } from "./helpers";

let env: TestEnv;
let mod: TestStaff;
let compliance: TestStaff;
let biz: TestUser;
let emp: TestUser;
let viewer: TestUser;

const verify = (u: TestUser) => env.sql`UPDATE users SET kyc_level = 1, id_country = 'IN' WHERE id = ${u.id}`;
const summary = async (u: TestUser) => (await call(env.app, viewer, "GET", `/v1/users/${u.id}`)).body;

const BUSINESS = {
  kind: "business",
  legalName: "Kutch Petro Traders Pvt Ltd",
  regType: "GSTIN",
  regNumber: "27AAPFU0939F1ZV",
  website: "https://example.com",
  signatoryName: "Rajesh Kumar",
  signatoryRole: "Director",
};

beforeAll(async () => {
  env = await setup();
  mod = await createStaff(env, "moderator");
  compliance = await createStaff(env, "compliance");
  biz = await register(env.app, "kutch_petro");
  emp = await register(env.app, "vr_employee");
  viewer = await register(env.app, "vr_viewer");
});
afterAll(() => env.close());

describe("registration formats", () => {
  it("validates GSTIN checksums and Indian company identifiers", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false); // wrong check character
    expect(validateRegistration("CIN", "U74999MH2016PTC123456")).toBeNull();
    expect(validateRegistration("UDYAM", "UDYAM-MH-19-0012345")).toBeNull();
    expect(validateRegistration("LLPIN", "AAB-1234")).toBeNull();
    expect(validateRegistration("CIN", "12345")).toMatch(/isn't valid/);
  });
});

describe("business verification", () => {
  it("requires ID verification and a valid registration number", async () => {
    expect((await call(env.app, biz, "POST", "/v1/me/verification/apply", BUSINESS)).body.error.code).toBe("KYC_REQUIRED");
    await verify(biz);
    const bad = await call(env.app, biz, "POST", "/v1/me/verification/apply", { ...BUSINESS, regNumber: "27AAPFU0939F1ZX" });
    expect(bad.status).toBe(400);
  });

  it("is reviewed by compliance; approval shows the badge while the plan is active", async () => {
    const applied = await call(env.app, biz, "POST", "/v1/me/verification/apply", BUSINESS);
    expect(applied.status).toBe(201);
    expect((await call(env.app, biz, "POST", "/v1/me/verification/apply", BUSINESS)).status).toBe(409);

    expect((await admin(env.app, mod, "GET", "/verifications")).status).toBe(403);
    const queue = await admin(env.app, compliance, "GET", "/verifications");
    expect(queue.body.items[0]).toMatchObject({ kind: "business", regNumber: "27AAPFU0939F1ZV", applicantKyc: { level: 1, country: "IN" } });

    const decided = await admin(env.app, compliance, "POST", `/verifications/${applied.body.id}/decide`, { decision: "approved", note: "GSTIN checked on the GST portal: active.", months: 1 });
    expect(decided.status).toBe(200);
    expect(await summary(biz)).toMatchObject({ badge: "business", kycLevel: 2 });
    const status = (await call(env.app, biz, "GET", "/v1/me/verification")).body;
    expect(status).toMatchObject({ badge: "business", subscription: { plan: "business", status: "active" } });
    expect(status.applications[0].status).toBe("approved");

    // Badge disappears when the plan lapses, and returns when a payment is recorded.
    await env.sql`UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE user_id = ${biz.id}`;
    expect((await summary(biz)).badge).toBeNull();
    expect((await admin(env.app, compliance, "POST", `/users/${biz.id}/subscription`, { plan: "business", months: 3, reference: "INV-2026-0042" })).status).toBe(200);
    expect((await summary(biz)).badge).toBe("business");
  });

  it("lets verified businesses and creators label paid partnerships, and nobody else", async () => {
    expect((await call(env.app, viewer, "POST", "/v1/posts", { text: "Buy this!", paidPartnership: true })).status).toBe(403);
    const p = await post(env.app, biz, "Our new bonded tank farm in Kandla is open.", { paidPartnership: true });
    expect(p.paidPartnership).toBe(true);
  });
});

describe("affiliations", () => {
  it("shows the business logo on an employee's profile once they accept", async () => {
    expect((await call(env.app, viewer, "POST", "/v1/me/affiliates", { handle: "vr_employee" })).body.error.code).toBe("NOT_A_BUSINESS");
    expect((await call(env.app, biz, "POST", "/v1/me/affiliates", { handle: "vr_employee", title: "Head of Trading" })).status).toBe(201);
    expect((await summary(emp)).affiliation).toBeNull(); // pending

    const inv = (await call(env.app, emp, "GET", "/v1/me/verification")).body.affiliations;
    expect(inv[0]).toMatchObject({ org: { handle: "kutch_petro" }, status: "pending", title: "Head of Trading" });
    expect((await call(env.app, emp, "POST", `/v1/me/affiliations/${biz.id}/accept`)).status).toBe(200);
    expect((await summary(emp)).affiliation).toMatchObject({ handle: "kutch_petro" });

    const p = await post(env.app, emp, "Hello from the desk");
    expect(p.author.affiliation.handle).toBe("kutch_petro");
    const list = (await call(env.app, viewer, "GET", `/v1/users/${biz.id}/affiliates`)).body.items;
    expect(list).toEqual([{ user: expect.objectContaining({ handle: "vr_employee" }), title: "Head of Trading" }]);
  });

  it("hides affiliations while the business isn't verified, and lets either side end them", async () => {
    await env.sql`UPDATE subscriptions SET status = 'canceled' WHERE user_id = ${biz.id}`;
    expect((await summary(emp)).affiliation).toBeNull();
    await env.sql`UPDATE subscriptions SET status = 'active' WHERE user_id = ${biz.id}`;
    expect((await summary(emp)).affiliation).not.toBeNull();
    await call(env.app, emp, "POST", `/v1/me/affiliations/${biz.id}/leave`);
    expect((await summary(emp)).affiliation).toBeNull();
  });
});

describe("granted badges", () => {
  it("are given by compliance on criteria, never sold, and logged", async () => {
    const minister = await register(env.app, "vr_official");
    expect((await admin(env.app, mod, "POST", `/users/${minister.id}/badge`, { badge: "government", justification: "Official ministry account confirmed." })).status).toBe(403);
    expect((await admin(env.app, compliance, "POST", `/users/${minister.id}/badge`, { badge: "government", justification: "Official ministry account confirmed by letter." })).status).toBe(200);
    expect((await summary(minister)).badge).toBe("government");
    expect((await admin(env.app, compliance, "POST", `/users/${biz.id}/badge`, { badge: null, justification: "Trying to remove a paid badge." })).status).toBe(400);
    const [log] = await env.sql`SELECT action FROM access_log WHERE action = 'badge_grant_government'`;
    expect(log).toBeTruthy();
  });

  it("creators apply with a category and get the creator badge", async () => {
    const c = await register(env.app, "vr_creator");
    await verify(c);
    const r = await call(env.app, c, "POST", "/v1/me/verification/apply", { kind: "creator", category: "Commodity education", links: ["https://youtube.com/@example"] });
    expect(r.status).toBe(201);
    await admin(env.app, compliance, "POST", `/verifications/${r.body.id}/decide`, { decision: "approved", note: "Consistent original content; ID verified." });
    expect((await summary(c)).badge).toBe("creator");
  });
});
