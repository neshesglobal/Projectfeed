import { describe, expect, it } from "vitest";
import { extractEntities, formatCount, weightedLength } from "@projectfeed/shared";
import { parseQuery } from "../src/routes/search";
import { containsMutedWord } from "../src/services/timeline";

describe("shared text rules", () => {
  it("weights URLs as 23 and CJK/emoji as 2", () => {
    expect(weightedLength("hello")).toBe(5);
    expect(weightedLength(`see https://example.com/${"x".repeat(100)}`)).toBe(4 + 23);
    expect(weightedLength("油价")).toBe(4);
    expect(weightedLength("🚢")).toBe(2);
  });

  it("extracts mentions, hashtags, cashtags and urls", () => {
    const e = extractEntities("Hi @bob, #EN590 at $XAU see https://x.com/a. email a@b.com");
    expect(e.map((x) => [x.type, x.value])).toEqual([
      ["mention", "bob"],
      ["hashtag", "EN590"],
      ["cashtag", "XAU"],
      ["url", "https://x.com/a"],
    ]);
  });

  it("formats counts like X", () => {
    expect([999, 1000, 1234, 12_345, 1_500_000, 25_000_000].map(formatCount)).toEqual(["999", "1K", "1.2K", "12K", "1.5M", "25M"]);
  });

  it("parses search operators", () => {
    expect(parseQuery("diesel from:@alice #EN590 $xau filter:media min_faves:5")).toEqual({
      terms: "diesel",
      from: "alice",
      tags: [
        { tag: "en590", kind: "hashtag" },
        { tag: "xau", kind: "cashtag" },
      ],
      mediaOnly: true,
      minLikes: 5,
    });
  });

  it("matches muted words on word boundaries", () => {
    expect(containsMutedWord("Spoiler alert", ["oil"])).toBe(false);
    expect(containsMutedWord("Oil prices up", ["oil"])).toBe(true);
    expect(containsMutedWord("Gold #XAU rally", ["#xau"])).toBe(true);
  });
});
