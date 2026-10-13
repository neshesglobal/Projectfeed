import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { regionOf } from "@projectfeed/shared";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

let env: TestEnv;
let author: TestUser;
let friend: TestUser; // followed by the author
let friendOfFriend: TestUser; // followed by the friend
let stranger: TestUser;

const canReply = async (u: TestUser, postId: string) => (await call(env.app, u, "GET", `/v1/posts/${postId}/thread`)).body.post.viewer.canReply as boolean;
const reply = (u: TestUser, postId: string) => call(env.app, u, "POST", "/v1/posts", { text: "Reply", replyToId: postId });
const setCountry = (u: TestUser, idCountry: string | null, phoneCountry: string | null = null) =>
  env.sql`UPDATE users SET id_country = ${idCountry}, phone_country = ${phoneCountry} WHERE id = ${u.id}`;

beforeAll(async () => {
  env = await setup();
  author = await register(env.app, "rc_author");
  friend = await register(env.app, "rc_friend");
  friendOfFriend = await register(env.app, "rc_fof");
  stranger = await register(env.app, "rc_stranger");
  await call(env.app, author, "POST", `/v1/users/${friend.id}/follow`);
  await call(env.app, friend, "POST", `/v1/users/${friendOfFriend.id}/follow`);
});
afterAll(() => env.close());

describe("regions", () => {
  it("map countries to regions", () => {
    expect(regionOf("IN")).toBe("south_asia");
    expect(regionOf("ae")).toBe("west_asia");
    expect(regionOf("SG")).toBe("southeast_asia");
    expect(regionOf("GB")).toBe("europe");
    expect(regionOf("EG")).toBe("africa");
    expect(regionOf("MX")).toBe("north_america");
    expect(regionOf("BR")).toBe("south_america");
    expect(regionOf("NZ")).toBe("australasia");
    expect(regionOf("KZ")).toBe("central_asia");
    expect(regionOf("JP")).toBe("east_asia");
    expect(regionOf(null)).toBeNull();
  });
});

describe("who can reply", () => {
  it("accounts you follow and who they follow", async () => {
    const p = await post(env.app, author, "Network only", { replyAudience: "following_network" });
    expect(p.replyAudience).toBe("following_network");
    expect(await canReply(friend, p.id)).toBe(true);
    expect(await canReply(friendOfFriend, p.id)).toBe(true);
    expect(await canReply(stranger, p.id)).toBe(false);
    expect((await reply(stranger, p.id)).status).toBe(403);
    expect((await reply(friendOfFriend, p.id)).status).toBe(201);
  });

  it("accounts you follow excludes their follows", async () => {
    const p = await post(env.app, author, "Follows only", { replyAudience: "following" });
    expect(await canReply(friend, p.id)).toBe(true);
    expect(await canReply(friendOfFriend, p.id)).toBe(false);
  });

  it("people mentioned can always reply", async () => {
    const p = await post(env.app, author, `Hey @${stranger.handle}`, { replyAudience: "following", replyRegions: ["europe"] });
    expect(await canReply(stranger, p.id)).toBe(true);
  });

  it("regions are checked against the verified ID country, then the phone country", async () => {
    await setCountry(friend, "IN");
    await setCountry(friendOfFriend, null, "GB");
    await setCountry(stranger, "BR", "IN"); // ID country wins over phone country
    const p = await post(env.app, author, "South Asia and Europe only", { replyRegions: ["south_asia", "europe"] });
    expect(p.replyRegions?.sort()).toEqual(["europe", "south_asia"]);
    expect(await canReply(friend, p.id)).toBe(true);
    expect(await canReply(friendOfFriend, p.id)).toBe(true);
    expect(await canReply(stranger, p.id)).toBe(false);
    expect((await reply(stranger, p.id)).status).toBe(403);
    expect(await canReply(author, p.id)).toBe(true); // the author always can
  });

  it("people with no verified country can't reply to region-limited posts", async () => {
    const nobody = await register(env.app, "rc_nocountry");
    const p = await post(env.app, author, "Africa only", { replyRegions: ["africa"] });
    expect(await canReply(nobody, p.id)).toBe(false);
  });

  it("combine the audience and the region rule", async () => {
    await setCountry(friend, "IN");
    const p = await post(env.app, author, "Follows in Europe", { replyAudience: "following", replyRegions: ["europe"] });
    expect(await canReply(friend, p.id)).toBe(false); // follows, but wrong region
  });

  it("all regions selected means no limit; an empty list is rejected", async () => {
    const all = ["south_asia", "central_asia", "west_asia", "east_asia", "southeast_asia", "europe", "africa", "north_america", "south_america", "australasia"];
    const p = await post(env.app, author, "Everywhere", { replyRegions: all });
    expect(p.replyRegions).toBeNull();
    expect((await call(env.app, author, "POST", "/v1/posts", { text: "None", replyRegions: [] })).status).toBe(400);
    expect((await call(env.app, author, "POST", "/v1/posts", { text: "Bad", replyRegions: ["mars"] })).status).toBe(400);
  });
});
