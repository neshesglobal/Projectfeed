// System test: drives the web build of the app (same code as iOS/Android) against the running API.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH ?? "playwright");
const out = process.argv[2] ?? "e2e/output";
(await import("node:fs")).mkdirSync(out, { recursive: true });
const APP = "http://localhost:8081";
const API = "http://localhost:4000/v1";
const results = [];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: "dark", permissions: ["geolocation"], geolocation: { latitude: 13.04, longitude: 80.27 } });
await ctx.addInitScript(() => localStorage.setItem("pf.prefs", JSON.stringify({ theme: "dark", density: "dense", heroDismissed: true, translateTo: "en" })));
// The sandbox has no internet: answer map links locally so the popup keeps its URL.
await ctx.route(/https:\/\/(www\.google\.com|maps\.apple\.com)\/.*/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "maps" }));
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on("pageerror", (e) => { if (!String(e).includes("no supported source")) pageErrors.push(String(e)); });
let n = 0;
async function step(name, fn) {
  n++;
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ n, name, ok: true, note: note ?? "", ms: Date.now() - t0 });
  } catch (e) {
    results.push({ n, name, ok: false, note: String(e.message ?? e).split("\n")[0].slice(0, 220), ms: Date.now() - t0 });
    await page.screenshot({ path: `${out}/fail-${n}.png` }).catch(() => {});
  }
}
const visible = (text) => page.locator(`text=${text} >> visible=true`).first();
const wait = (ms) => page.waitForTimeout(ms);
const expectTrue = (cond, msg) => { if (!cond) throw new Error(msg); };
async function apiAs(token, path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(opts.headers ?? {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function tokenFor(identifier, password) {
  const r = await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, password }) });
  return (await r.json()).accessToken;
}

const handle = `qa_${Date.now().toString(36).slice(-6)}`;
const password = "qa-system-test-1";
const stamp = Date.now().toString(36);

// ── Accounts ──
await step("Welcome screen loads", async () => { await page.goto(APP); await visible("Create account").waitFor(); });
await step("Sign up validation rejects a short password", async () => {
  await visible("Create account").click();
  await page.getByLabel("Name").fill("QA Tester");
  await page.getByLabel("Handle").fill(handle);
  await page.getByLabel("Email").fill(`${handle}@example.com`);
  await page.getByLabel("Password (10+ characters)").fill("short");
  await page.getByRole("button", { name: "Sign up" }).click();
  await wait(800);
  expectTrue((await page.locator("text=For you >> visible=true").count()) === 0, "signed up with a short password");
  return "stayed on sign-up";
});
await step("Sign up a new account", async () => {
  await page.getByLabel("Password (10+ characters)").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await visible("For you").waitFor({ timeout: 15000 });
  return `@${handle}`;
});
const myToken = await tokenFor(handle, password);

// ── Home ──
await step("Home feed shows posts", async () => {
  await wait(1500);
  const likes = await page.getByRole("button", { name: /^(Like|Unlike)/ }).count();
  expectTrue(likes > 0, "no posts on For you");
  return `${likes} posts rendered`;
});
await step("Feed filters switch (Following, Travel, back to For you)", async () => {
  await page.getByRole("tab", { name: "Following" }).click(); await wait(1000);
  await page.getByRole("tab", { name: "Travel" }).click(); await wait(1500);
  expectTrue((await page.locator("text=#travel >> visible=true").count()) > 0, "Travel filter shows no #travel posts");
  await page.getByRole("tab", { name: "For you" }).click(); await wait(1000);
});
await step("Like and unlike a post", async () => {
  const btn = page.getByRole("button", { name: /^(Like|Unlike)/ }).first();
  const before = await btn.getAttribute("aria-label");
  await btn.click(); await wait(700);
  const after = await page.getByRole("button", { name: /^(Like|Unlike)/ }).first().getAttribute("aria-label");
  expectTrue(before !== after, `label unchanged: ${before}`);
  await page.getByRole("button", { name: /^(Like|Unlike)/ }).first().click(); await wait(500);
  return `${before} → ${after}`;
});
await step("Bookmark a post (appears in Bookmarks)", async () => {
  await page.getByRole("button", { name: /^Bookmark$/ }).first().click(); await wait(800);
  const r = await apiAs(myToken, "/me/bookmarks");
  expectTrue(r.body.items.length >= 1, "bookmark not saved on server");
  return `${r.body.items.length} bookmark(s) on server`;
});

// ── Posting ──
await step("Compose and publish a text post", async () => {
  await page.getByRole("button", { name: "Compose post" }).click();
  await page.getByPlaceholder("What's happening?").fill(`System test ${stamp} #qa`);
  await page.getByRole("button", { name: "Post", exact: true }).click(); await wait(2000);
  const r = await apiAs(myToken, `/search/posts?q=${stamp}&mode=latest`);
  expectTrue(r.body.items.some((i) => i.post.text.includes(stamp)), "post not found via search");
});
await step("Post with reply limits (network + regions) shows 'Who can reply?'", async () => {
  await page.goto(APP + "/compose"); await wait(1500);
  await page.getByPlaceholder("What's happening?").fill(`Limited replies ${stamp}`);
  await visible("Everyone can reply").click(); await wait(600);
  await visible("Accounts you follow and who they follow").click();
  await visible("Regions").click(); await wait(400);
  for (const r of ["Africa", "South America", "Australasia"]) await visible(r).click();
  await page.getByRole("button", { name: "Done" }).first().click(); await wait(300);
  await page.getByRole("button", { name: "Done" }).first().click(); await wait(500);
  await page.getByRole("button", { name: "Post", exact: true }).click(); await wait(2000);
  const r = await apiAs(myToken, `/search/posts?q=Limited%20replies%20${stamp}&mode=latest`);
  const p = r.body.items[0]?.post;
  expectTrue(p?.replyAudience === "following_network", `audience ${p?.replyAudience}`);
  expectTrue(p?.replyRegions?.length === 7, `regions ${JSON.stringify(p?.replyRegions)}`);
  await page.goto(`${APP}/post/${p.id}`); await visible("Who can reply?").waitFor();
  return "7 regions stored";
});
await step("Post a GIF", async () => {
  await page.goto(APP + "/compose"); await wait(1500);
  await page.getByLabel("Add a GIF").click();
  await page.getByPlaceholder("Search GIFs").fill("chai");
  const tile = page.getByRole("button", { name: "Chai time" });
  await tile.first().waitFor({ timeout: 20000 }); await wait(1500); // first search after a restart generates the demo GIFs
  await tile.first().click(); await wait(1500);
  await page.getByPlaceholder("What's happening?").fill(`GIF test ${stamp}`);
  await page.getByRole("button", { name: "Post", exact: true }).click(); await wait(2000);
  const r = await apiAs(myToken, `/search/posts?q=GIF%20test%20${stamp}&mode=latest`);
  expectTrue(r.body.items[0]?.post.media[0]?.type === "gif", "no GIF media on the post");
});
await step("Reply to a post", async () => {
  const r = await apiAs(myToken, `/search/posts?q=${stamp}%20%23qa&mode=latest`);
  const id = r.body.items[0].post.id;
  await page.goto(`${APP}/compose?replyToId=${id}`); await wait(1500);
  await page.getByPlaceholder("Post your reply").fill(`Replying ${stamp}`);
  await page.getByRole("button", { name: "Reply", exact: true }).click(); await wait(1500);
  const th = await apiAs(myToken, `/posts/${id}/thread`);
  expectTrue(th.body.replies.items.some((x) => x.text.includes(`Replying ${stamp}`)), "reply not in thread");
});

// ── People ──
await step("Open a profile and follow", async () => {
  await page.goto(APP + "/user/kavya_agri"); await wait(2000);
  await page.getByRole("button", { name: "Follow", exact: true }).first().click(); await wait(1200);
  const r = await apiAs(myToken, "/users/by-handle/kavya_agri");
  expectTrue(r.body.viewer?.following === true, "not following on server");
});
await step("About this account shows countries", async () => {
  await page.goto(APP + "/about/kavya_agri").catch(() => {}); await wait(1500);
  const txt = await page.locator("body").innerText();
  expectTrue(/India|Joined|account/i.test(txt), "about page empty");
});

// ── Search & Trends ──
await step("Trends tab loads", async () => { await page.goto(APP + "/search"); await visible("What's happening").waitFor(); });
await step("Search posts and people", async () => {
  await page.goto(APP + "/search-results?q=chennai"); await wait(2000);
  expectTrue((await page.locator("text=Chennai >> visible=true").count()) > 0, "no Chennai results");
  await page.getByRole("tab", { name: "People" }).click(); await wait(1200);
});

// ── Discover ──
await step("Discover grid, Nearby and Reviews", async () => {
  await page.goto(APP + "/discover"); await wait(2500);
  expectTrue((await page.locator("text=Filter coffee >> visible=true").count()) + (await page.locator("text=Best filter coffee >> visible=true").count()) > 0, "grid empty");
  await page.getByRole("tab", { name: "Nearby" }).click(); await wait(2000);
  expectTrue((await page.locator("text=Mylapore >> visible=true").count()) > 0, "Nearby shows no Chennai notes");
  await page.getByRole("tab", { name: "Reviews" }).click(); await wait(1500);
});
let noteId;
await step("Open a note: verified review, map, directions link", async () => {
  await page.getByRole("tab", { name: "For you" }).click(); await wait(1500);
  await visible("Best filter coffee in Mylapore").click(); await wait(2000);
  noteId = page.url().split("/note/")[1];
  await visible("Verified review").waitFor();
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 5000 }), visible("Directions").click()]);
  const url = popup.url(); await popup.close();
  expectTrue(url.includes("google.com/maps/dir") && url.includes("destination=13.0336"), `directions url ${url}`);
  return url;
});
await step("Save a note into a new collection", async () => {
  await page.getByRole("button", { name: "Save to a collection" }).click(); await wait(1200);
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByPlaceholder("Collection name, e.g. Goa trip").fill(`QA ${stamp}`);
  await page.getByRole("button", { name: "Create and save" }).click(); await wait(1500);
  const r = await apiAs(myToken, "/me/collections");
  const c = r.body.items.find((x) => x.name === `QA ${stamp}`);
  expectTrue(c && c.itemCount === 1, `collection ${JSON.stringify(c)}`);
});
await step("Place page shows rating and reviews", async () => {
  await page.goto(`${APP}/note/${noteId}`); await wait(1500);
  await visible("All reviews").click(); await wait(2000);
  await visible("verified review").waitFor();
});
await step("Write a review: location picker finds nearby places", async () => {
  await page.goto(APP + "/place-picker"); await wait(3000);
  await visible("Mylapore Coffee House").waitFor();
});

// ── Messages & Activity ──
await step("Send a direct message", async () => {
  const demo = await apiAs(myToken, "/users/by-handle/demo");
  const conv = await apiAs(myToken, "/conversations", { method: "POST", body: JSON.stringify({ participantIds: [demo.body.id] }) });
  expectTrue(conv.status < 300, `create conversation ${conv.status} ${JSON.stringify(conv.body)}`);
  await page.goto(`${APP}/conversation/${conv.body.id}`); await wait(2000);
  await page.getByPlaceholder("Start a message").fill(`Hello from QA ${stamp}`);
  await page.keyboard.press("Enter"); await wait(300);
  const send = page.getByRole("button", { name: /send/i });
  if (await send.count()) await send.first().click();
  await wait(1500);
  const msgs = await apiAs(myToken, `/conversations/${conv.body.id}/messages`);
  expectTrue(JSON.stringify(msgs.body).includes(`Hello from QA ${stamp}`), "message not on server");
});
await step("Activity tab loads", async () => { await page.goto(APP + "/notifications"); await visible("Activity").waitFor(); });

// ── Safety ──
await step("Report a post", async () => {
  const r = await apiAs(myToken, `/search/posts?q=chennai&mode=latest`);
  const target = r.body.items.find((i) => i.post.author.handle !== handle).post;
  await page.goto(`${APP}/report?targetType=post&targetId=${target.id}`); await wait(1500);
  await visible("Spam").click();
  await page.getByRole("button", { name: "Submit report" }).click(); await wait(1500);
  return `reported post ${target.id}`;
});

// ── Settings & account ──
await step("Edit profile bio", async () => {
  await page.goto(APP + "/edit-profile"); await wait(1500);
  await page.getByLabel("Bio").fill(`QA bio ${stamp}`);
  await page.getByRole("button", { name: "Save" }).click(); await wait(1500);
  const me = await apiAs(myToken, "/me");
  expectTrue(me.body.bio === `QA bio ${stamp}`, `bio ${me.body.bio}`);
});
await step("Switch theme to Daylight", async () => {
  await page.goto(APP + "/settings/display"); await wait(1200);
  await page.getByRole("radio", { name: /Daylight/ }).first().click().catch(async () => visible("Daylight").click());
  await wait(800);
  await page.screenshot({ path: `${out}/daylight.png` });
  const porcelain = await page.evaluate(() => [...document.querySelectorAll("div")].some((d) => getComputedStyle(d).backgroundColor === "rgb(250, 250, 248)"));
  expectTrue(porcelain, "porcelain background #FAFAF8 not applied");
  return "porcelain #FAFAF8 applied";
});
await step("Settings screens open (Language, Account status, Privacy)", async () => {
  for (const p of ["/settings", "/settings/language", "/settings/standing", "/settings/privacy"]) {
    await page.goto(APP + p); await wait(1000);
    expectTrue(!(await page.locator("text=Unmatched Route >> visible=true").count()), `${p} missing`);
  }
});
await step("Account menu: Collections opens", async () => {
  await page.goto(APP + "/"); await wait(1500);
  await page.getByRole("button", { name: "QA Tester's profile" }).first().click(); await wait(800);
  await page.getByRole("button", { name: "Collections" }).click(); await wait(1200);
  await visible(`QA ${stamp}`).waitFor();
});
await step("Log out and log back in", async () => {
  await page.goto(APP + "/"); await wait(1500);
  await page.getByRole("button", { name: "QA Tester's profile" }).first().click(); await wait(800);
  await page.getByRole("button", { name: "Log out" }).click(); await wait(1500);
  await visible("I already have an account").click();
  await page.getByLabel("Email or handle").fill(handle); await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Log in" }).click(); await wait(1200);
  expectTrue((await page.locator("text=For you >> visible=true").count()) === 0, "logged in with wrong password");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await visible("For you").waitFor({ timeout: 10000 });
  return "wrong password rejected; correct one accepted";
});

// ── Moderation console ──
await step("Moderation console: moderator sees the report", async () => {
  const admin = await ctx.newPage();
  await admin.goto("http://localhost:5175/");
  await admin.locator("input[type=email]").fill("moderator@staff.projectfeed.app");
  await admin.locator("input[type=password]").fill("projectfeed-staff");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await admin.waitForTimeout(2500);
  const txt = await admin.locator("body").innerText();
  await admin.screenshot({ path: `${out}/admin.png` });
  await admin.close();
  expectTrue(/report|queue/i.test(txt), "console did not load the queue");
});

await b.close();
const pass = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${String(r.n).padStart(2)} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
console.log(`\n${pass}/${results.length} passed`);
console.log(pageErrors.length ? `Page errors:\n${[...new Set(pageErrors)].slice(0, 8).join("\n")}` : "No page errors");
