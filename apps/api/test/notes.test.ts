import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rescoreNotes } from "../src/services/notes";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;

/** An established, ID-verified contributor in good standing. */
async function contributor(handle: string): Promise<TestUser> {
  const u = await register(env.app, handle);
  await env.sql`UPDATE users SET kyc_level = 1, created_at = now() - interval '120 days', trust_score = 70 WHERE id = ${u.id}`;
  return u;
}
const rate = (u: TestUser, noteId: string, helpful: "yes" | "somewhat" | "no") => call(env.app, u, "POST", `/v1/notes/${noteId}/rate`, { helpful });
const SRC = ["https://www.lbma.org.uk/prices-and-data"];

let campA: TestUser[];
let campB: TestUser[];
let writer: TestUser;
let poster: TestUser;

beforeAll(async () => {
  env = await setup();
  writer = await contributor("cn_writer");
  poster = await register(env.app, "cn_poster");
  campA = await Promise.all(Array.from({ length: 10 }, (_, i) => contributor(`cn_a${i}`)));
  campB = await Promise.all(Array.from({ length: 10 }, (_, i) => contributor(`cn_b${i}`)));
});
afterAll(() => env.close());

describe("writing notes", () => {
  it("requires ID verification, account age and good standing, and never on your own post", async () => {
    const p = await post(env.app, poster, "Gold will hit $10,000 by Friday, guaranteed");
    const newbie = await register(env.app, "cn_newbie");
    const r = await call(env.app, newbie, "GET", `/v1/posts/${p.id}/notes`);
    expect(r.body).toMatchObject({ canWrite: false, canRate: false, eligibility: expect.stringMatching(/Verify your identity/) });
    await env.sql`UPDATE users SET kyc_level = 1 WHERE id = ${newbie.id}`;
    expect((await call(env.app, newbie, "GET", `/v1/posts/${p.id}/notes`)).body.eligibility).toMatch(/after 30 days/);
    expect((await call(env.app, poster, "POST", `/v1/posts/${p.id}/notes`, { classification: "misleading", text: "This is my own post, noting it.", sources: SRC })).status).toBe(403);
    expect((await call(env.app, writer, "GET", `/v1/posts/${p.id}/notes`)).body).toMatchObject({ canWrite: true, canRate: true, eligibility: null });
  });

  it("needs a source for 'misleading' and allows one note per post", async () => {
    const p = await post(env.app, poster, "MT799 is a payment guarantee");
    expect((await call(env.app, writer, "POST", `/v1/posts/${p.id}/notes`, { classification: "misleading", text: "An MT799 is a free-format message, not a guarantee." })).status).toBe(400);
    expect((await call(env.app, writer, "POST", `/v1/posts/${p.id}/notes`, { classification: "misleading", text: "An MT799 is a free-format message, not a guarantee.", sources: ["https://www.swift.com/"] })).status).toBe(201);
    expect((await call(env.app, writer, "POST", `/v1/posts/${p.id}/notes`, { classification: "misleading", text: "Second attempt at a note here.", sources: SRC })).status).toBe(409);
  });
});

describe("bridging: a note shows only when people who usually disagree both find it helpful", () => {
  it("separates cross-viewpoint notes from one-sided ones", async () => {
    const writers = await Promise.all([1, 2, 3].map((i) => contributor(`cn_writer${i}`)));
    let w = 0;
    const note = async (text: string) => {
      const p = await post(env.app, poster, text);
      const r = await call(env.app, writers[w++ % writers.length]!, "POST", `/v1/posts/${p.id}/notes`, { classification: "misleading", text: `Context for: ${text}`, sources: SRC });
      return { postId: p.id, noteId: r.body.id as string };
    };
    // Rating history that reveals two camps: each camp likes its own side's notes and dislikes the other's.
    for (let k = 0; k < 6; k++) {
      const a = await note(`Camp A talking point number ${k}`);
      const b = await note(`Camp B talking point number ${k}`);
      for (const u of campA) await rate(u, a.noteId, "yes"), await rate(u, b.noteId, "no");
      for (const u of campB) await rate(u, a.noteId, "no"), await rate(u, b.noteId, "yes");
    }
    const bridging = await note("Claim both sides agree is wrong");
    const oneSided = await note("Claim only camp A dislikes");
    const rejected = await note("Claim with a poor note");
    for (const u of [...campA.slice(0, 4), ...campB.slice(0, 4)]) await rate(u, bridging.noteId, "yes");
    for (const u of campA.slice(0, 6)) await rate(u, oneSided.noteId, "yes");
    for (const u of campB.slice(0, 2)) await rate(u, oneSided.noteId, "no");
    for (const u of [...campA.slice(5, 8), ...campB.slice(5, 8)]) await rate(u, rejected.noteId, "no");

    await env.app.ctx.notes.idle();
    await rescoreNotes(env.sql);
    const status = async (id: string) => (await env.sql`SELECT status FROM community_notes WHERE id = ${id}`)[0]!.status;
    expect(await status(bridging.noteId)).toBe("helpful");
    expect(await status(oneSided.noteId)).toBe("needs_ratings");
    expect(await status(rejected.noteId)).toBe("not_helpful");

    const reader = await register(env.app, "cn_reader");
    const shown = (await call(env.app, reader, "GET", `/v1/posts/${bridging.postId}`)).body;
    expect(shown.note).toMatchObject({ id: bridging.noteId, sources: SRC });
    expect((await call(env.app, reader, "GET", `/v1/posts/${oneSided.postId}`)).body.note).toBeNull();
    // Non-contributors only ever see shown notes.
    expect((await call(env.app, reader, "GET", `/v1/posts/${oneSided.postId}/notes`)).body.notes).toEqual([]);

    // A shown "misleading" note counts against the post author's trust score.
    const standing = (await call(env.app, poster, "GET", "/v1/me/standing")).body;
    expect(standing.trust.factors.find((f: { key: string }) => f.key === "notes")).toBeTruthy();
  });

  it("blocks self-rating and rating notes on your own post", async () => {
    const p = await post(env.app, poster, "Another dubious claim about freight");
    const w2 = await contributor("cn_writer_x");
    const n = await call(env.app, w2, "POST", `/v1/posts/${p.id}/notes`, { classification: "misleading", text: "Freight data shows otherwise this week.", sources: SRC });
    expect((await rate(w2, n.body.id, "yes")).status).toBe(400);
    expect((await rate(poster, n.body.id, "no")).status).toBe(403);
  });

  it("offers contributors a queue of notes to rate", async () => {
    const q = (await call(env.app, campA[9]!, "GET", "/v1/notes/needs-ratings")).body;
    expect(q.items.length).toBeGreaterThan(0);
    expect(q.items[0]).toMatchObject({ post: expect.any(Object), note: expect.objectContaining({ myRating: null }) });
  });
});
