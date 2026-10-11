import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectLanguage, extractEntities } from "@projectfeed/shared";
import { DemoTranslator, GoogleTranslator, fromHtml, segment, toHtml, type Segment, type Translator } from "../src/services/translate";
import { call, post, register, setup, type TestEnv, type TestUser } from "./helpers";

/** Fake provider: "translates" by upper-casing unprotected text and records every call. */
class FakeTranslator implements Translator {
  readonly name = "fake";
  readonly languages = ["en", "hi", "ta", "mr"];
  calls: { segments: Segment[]; target: string }[] = [];
  detect: string | null = null;
  async translate(segments: Segment[], target: string, source: string | null) {
    this.calls.push({ segments, target });
    return { text: segments.map((s) => (s.keep ? s.text : `${target}:${s.text.toUpperCase()}`)).join(""), detectedSource: this.detect ?? source };
  }
}

let env: TestEnv;
let fake: FakeTranslator;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  fake = new FakeTranslator();
  env = await setup({}, { translator: fake });
  alice = await register(env.app, "tr_alice");
  bob = await register(env.app, "tr_bob");
});
afterAll(() => env.close());

describe("language detection and Indic text", () => {
  it("detects the language from the dominant script", () => {
    expect(detectLanguage("Jet A1 premiums firm in Rotterdam")).toBe("en");
    expect(detectLanguage("डीज़ल की कीमतें बढ़ीं #EN590")).toBe("hi");
    expect(detectLanguage("சென்னை துறைமுகம்")).toBe("ta");
    expect(detectLanguage("ಬೆಂಗಳೂರು ಮಾರುಕಟ್ಟೆ")).toBe("kn");
    expect(detectLanguage("#gold $XAU")).toBeNull();
  });

  it("keeps Indic vowel signs inside hashtags", () => {
    expect(extractEntities("सोना #भारत #தமிழ்நாடு #ਪੰਜਾਬ").map((e) => e.value)).toEqual(["भारत", "தமிழ்நாடு", "ਪੰਜਾਬ"]);
  });

  it("stores the detected language on create and edit", async () => {
    const p = await post(env.app, alice, "मुंद्रा पोर्ट पर डीज़ल की माँग");
    expect(p.lang).toBe("hi");
    const edited = await call(env.app, alice, "PATCH", `/v1/posts/${p.id}`, { text: "Diesel demand at Mundra" });
    expect(edited.status).toBe(200);
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}`)).body.lang).toBe("en");
  });
});

describe("translating posts", () => {
  it("translates text, protects tickers, tags, mentions and links, and caches the result", async () => {
    const p = await post(env.app, alice, "EN590 bid firm @tr_bob #diesel $XAU see https://example.com/x");
    const r = await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=hi`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ targetLang: "hi", sourceLang: "en", sameLanguage: false, provider: "fake" });
    expect(r.body.text).toContain("@tr_bob");
    expect(r.body.text).toContain("#diesel");
    expect(r.body.text).toContain("$XAU");
    expect(r.body.text).toContain("https://example.com/x");
    expect(r.body.text).toContain("hi:EN590 BID FIRM");
    const kept = fake.calls.at(-1)!.segments.filter((s) => s.keep).map((s) => s.text);
    expect(kept).toEqual(["@tr_bob", "#diesel", "$XAU", "https://example.com/x"]);

    const before = fake.calls.length;
    const again = await call(env.app, alice, "GET", `/v1/posts/${p.id}/translation?to=hi`);
    expect(again.body.text).toBe(r.body.text);
    expect(fake.calls.length).toBe(before); // served from cache, for any viewer
  });

  it("re-translates after an edit", async () => {
    const p = await post(env.app, alice, "Copper warrants cancelled");
    await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=ta`);
    await call(env.app, alice, "PATCH", `/v1/posts/${p.id}`, { text: "Copper warrants cancelled overnight" });
    const r = await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=ta`);
    expect(r.body.text).toBe("ta:COPPER WARRANTS CANCELLED OVERNIGHT");
  });

  it("skips the provider when the post is already in the target language", async () => {
    const p = await post(env.app, alice, "Rice exports steady this week");
    const before = fake.calls.length;
    const r = await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=en`);
    expect(r.body).toMatchObject({ sameLanguage: true, text: "Rice exports steady this week" });
    expect(fake.calls.length).toBe(before);
  });

  it("learns the real language from the provider (Devanagari that is Marathi)", async () => {
    const p = await post(env.app, alice, "आज बाजारात कापसाचे भाव वाढले");
    expect(p.lang).toBe("hi");
    fake.detect = "mr";
    const r = await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=mr`);
    fake.detect = null;
    expect(r.body).toMatchObject({ sameLanguage: true, sourceLang: "mr", text: "आज बाजारात कापसाचे भाव वाढले" });
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}`)).body.lang).toBe("mr");
  });

  it("refuses unsupported languages, hidden posts and signed-out callers", async () => {
    const p = await post(env.app, alice, "Wheat FOB softening");
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=xx`)).status).toBe(400);
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=bn`)).status).toBe(400); // not offered by this provider
    expect((await call(env.app, null, "GET", `/v1/posts/${p.id}/translation?to=hi`)).status).toBe(401);
    await call(env.app, bob, "POST", `/v1/users/${alice.id}/block`);
    expect((await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=hi`)).status).toBe(404);
    await call(env.app, bob, "DELETE", `/v1/users/${alice.id}/block`);
  });

  it("stops calling the provider once the daily budget is spent", async () => {
    await env.sql`INSERT INTO translation_usage (day, chars) VALUES (current_date, 1999990)
                  ON CONFLICT (day) DO UPDATE SET chars = 1999990`;
    const p = await post(env.app, alice, "LNG spreads narrowing again today");
    const r = await call(env.app, bob, "GET", `/v1/posts/${p.id}/translation?to=hi`);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("TRANSLATION_BUDGET");
    await env.sql`DELETE FROM translation_usage`;
  });

  it("reports its configuration", async () => {
    const r = await call(env.app, bob, "GET", "/v1/translation/config");
    expect(r.body).toEqual({ enabled: true, provider: "fake", languages: ["en", "hi", "ta", "mr"] });
  });
});

describe("providers", () => {
  it("sends protected spans to Google as translate=no HTML and restores them", async () => {
    let sent: any;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ data: { translations: [{ translatedText: 'डीज़ल &amp; जेट <span translate="no">#EN590</span><br>नई लाइन &quot;उद्धरण&quot;', detectedSourceLanguage: "en" }] } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const g = new GoogleTranslator("test-key", undefined, fakeFetch);
    const r = await g.translate(segment('Diesel & jet #EN590\nnew line "quote"'), "hi", "en");
    expect(sent).toMatchObject({ target: "hi", format: "html" });
    expect(sent.q[0]).toBe('Diesel &amp; jet <span translate="no">#EN590</span><br>new line &quot;quote&quot;');
    expect(r).toEqual({ text: 'डीज़ल & जेट #EN590\nनई लाइन "उद्धरण"', detectedSource: "en" });
  });

  it("round-trips HTML escaping", () => {
    const segs = segment("a < b && c > d @x");
    expect(fromHtml(toHtml(segs))).toBe("a < b && c > d @x");
  });

  it("demo translator only translates seeded posts and never fakes others", async () => {
    const d = new DemoTranslator();
    const hit = await d.translate(segment("Spot $XAU pushing highs again. Physical premiums in Asia widening vs loco London. #gold"), "hi");
    expect(hit.text).toContain("$XAU");
    expect(hit.detectedSource).toBe("en");
    await expect(d.translate(segment("Something else entirely"), "hi")).rejects.toThrow(/Demo mode/);
  });
});
