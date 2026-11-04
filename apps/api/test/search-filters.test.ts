import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_FILTERS, searchFilterParams } from "@projectfeed/shared";
import { newId } from "../src/lib/ids";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let me: TestUser;
let friend: TestUser;
let stranger: TestUser;
let muted: TestUser;
const ids: Record<string, string> = {};

async function attach(postId: string, owner: string, type: "image" | "video") {
  const mid = newId();
  await env.sql`INSERT INTO media (id, owner_id, type, storage_key, thumb_key, width, height) VALUES (${mid}, ${owner}, ${type}, 'k', 'k', 10, 10)`;
  await env.sql`INSERT INTO post_media (post_id, media_id, position) VALUES (${postId}, ${mid}, 0)`;
}

const search = async (params: Record<string, string | undefined>, user: TestUser | null = me) => {
  const qs = new URLSearchParams(Object.entries({ q: "#hyundai", ...params }).filter((e): e is [string, string] => e[1] !== undefined));
  const r = await call(env.app, user, "GET", `/v1/search/posts?${qs}`);
  if (r.status !== 200) return { status: r.status, ids: [] as string[] };
  return { status: r.status, ids: (r.body.items as { post: { id: string } }[]).map((i) => i.post.id) };
};

beforeAll(async () => {
  env = await setup();
  me = await register(env.app);
  friend = await register(env.app);
  stranger = await register(env.app);
  muted = await register(env.app);
  await call(env.app, me, "POST", `/v1/users/${friend.id}/follow`);
  await call(env.app, me, "POST", `/v1/users/${muted.id}/mute`);

  ids.friend = (await post(env.app, friend, "New #Hyundai Creta spotted")).id;
  ids.photo = (await post(env.app, stranger, "#Hyundai showroom photos")).id;
  await attach(ids.photo, stranger.id, "image");
  ids.video = (await post(env.app, stranger, "#Hyundai launch video")).id;
  await attach(ids.video, stranger.id, "video");
  ids.reply = (await post(env.app, stranger, "Agreed #Hyundai", { replyToId: ids.friend })).id;
  ids.muted = (await post(env.app, muted, "#Hyundai from a muted account")).id;
  ids.hindi = (await post(env.app, stranger, "नई गाड़ी #Hyundai")).id;
  await env.sql`UPDATE posts SET lang = 'hi' WHERE id = ${ids.hindi}`;
  // A post from 10 days ago: ids carry their creation time, and search windows compare ids.
  ids.old = (BigInt(newId()) - ((10n * 86_400_000n) << 22n)).toString();
  await env.sql`INSERT INTO posts (id, author_id, text, conversation_id, created_at) VALUES (${ids.old}, ${stranger.id}, 'Old #Hyundai news', ${ids.old}, now() - interval '10 days')`;
  await env.sql`INSERT INTO post_tags (post_id, tag, kind, author_id, created_at) VALUES (${ids.old}, 'hyundai', 'hashtag', ${stranger.id}, now() - interval '10 days')`;
  await env.sql`UPDATE posts SET like_count = 150, reply_count = 12 WHERE id = ${ids.photo}`;
  // A note tagged with a place in Chennai.
  const placeId = newId();
  await env.sql`INSERT INTO places (id, name, lat, lng) VALUES (${placeId}, 'Hyundai showroom', 13.0827, 80.2707)`;
  ids.placed = (await post(env.app, stranger, "#Hyundai test drive here")).id;
  await env.sql`UPDATE posts SET place_id = ${placeId} WHERE id = ${ids.placed}`;
});
afterAll(() => env.close());

describe("search filters", () => {
  it("finds everything with no filters, but hides muted accounts by default", async () => {
    const r = await search({ mode: "latest" });
    expect(r.ids).toEqual(expect.arrayContaining([ids.friend, ids.photo, ids.video, ids.reply, ids.hindi, ids.old, ids.placed]));
    expect(r.ids).not.toContain(ids.muted);
    expect((await search({ mode: "latest", muted: "show" })).ids).toContain(ids.muted);
  });

  it("splits Videos and Photos", async () => {
    expect((await search({ mode: "videos" })).ids).toEqual([ids.video]);
    expect((await search({ mode: "photos" })).ids).toEqual([ids.photo]);
  });

  it("filters by people you follow, date, language and replies", async () => {
    expect((await search({ mode: "latest", from: "following" })).ids).toEqual([ids.friend]);
    expect((await search({ mode: "latest", from: "following" }, null)).status).toBe(400);
    const week = (await search({ mode: "latest", since: "week" })).ids;
    expect(week).not.toContain(ids.old);
    expect(week).toContain(ids.friend);
    expect((await search({ mode: "latest", lang: "hi" })).ids).toEqual([ids.hindi]);
    expect((await search({ mode: "latest", replies: "exclude" })).ids).not.toContain(ids.reply);
  });

  it("filters by post activity and by distance", async () => {
    expect((await search({ mode: "latest", minLikes: "100" })).ids).toEqual([ids.photo]);
    expect((await search({ mode: "latest", minReplies: "10" })).ids).toEqual([ids.photo]);
    expect((await search({ mode: "latest", minReposts: "10" })).ids).toEqual([]);
    expect((await search({ mode: "latest", near: "13.05,80.25" })).ids).toEqual([ids.placed]); // ~4 km away
    expect((await search({ mode: "latest", near: "19.07,72.87" })).ids).toEqual([]); // Mumbai
  });

  it("rejects malformed filters", async () => {
    for (const bad of [{ since: "year" }, { lang: "xx" }, { near: "abc" }, { minLikes: "-1" }, { from: "enemies" }, { mode: "audio" }]) {
      expect((await search(bad)).status).toBe(400);
    }
  });

  it("encodes the app's filter panel into these parameters", () => {
    expect(Object.values(searchFilterParams(DEFAULT_SEARCH_FILTERS)).filter(Boolean)).toEqual([]);
    expect(
      searchFilterParams({ ...DEFAULT_SEARCH_FILTERS, from: "following", since: "week", activity: "likes100", excludeReplies: true, hideMuted: false, near: { lat: 13.0827, lng: 80.2707 } }),
    ).toMatchObject({ from: "following", since: "week", minLikes: "100", replies: "exclude", muted: "show", near: "13.083,80.271" });
  });
});
