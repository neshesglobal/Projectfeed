// Unit tests for the pure rules shared by the app and the API (no server, no database).
import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  REGIONS,
  appleMapsDirections,
  createPhotoNoteSchema,
  createPlaceSchema,
  createPostSchema,
  detectLanguage,
  distanceMetres,
  formatDistance,
  googleMapsDirections,
  googleMapsPlace,
  isValidGstin,
  languageFromLocale,
  registerSchema,
  regionOf,
  validateRegistration,
} from "../src";

describe("maps (free directions links)", () => {
  const p = { lat: 13.0336, lng: 80.2687 };
  it("builds Apple and Google Maps links without any key", () => {
    expect(appleMapsDirections(p, "Mylapore Coffee House")).toBe("https://maps.apple.com/?daddr=13.0336,80.2687&q=Mylapore%20Coffee%20House");
    expect(googleMapsDirections(p)).toBe("https://www.google.com/maps/dir/?api=1&destination=13.0336,80.2687");
    expect(googleMapsPlace(p)).toBe("https://www.google.com/maps/search/?api=1&query=13.0336,80.2687");
  });
  it("measures great-circle distance", () => {
    expect(distanceMetres(p, p)).toBe(0);
    // Chennai to Mumbai is about 1,030 km.
    const d = distanceMetres({ lat: 13.0827, lng: 80.2707 }, { lat: 19.076, lng: 72.8777 });
    expect(d).toBeGreaterThan(1_000_000);
    expect(d).toBeLessThan(1_060_000);
  });
  it("formats distances for people", () => {
    expect(formatDistance(734)).toBe("730 m");
    expect(formatDistance(2_450)).toBe("2.5 km");
    expect(formatDistance(25_400)).toBe("25 km");
  });
});

describe("regions for reply controls", () => {
  it("covers every region and maps common countries", () => {
    expect(REGIONS).toHaveLength(10);
    const sample: Record<string, string> = { IN: "south_asia", PK: "south_asia", AE: "west_asia", TR: "west_asia", KZ: "central_asia", JP: "east_asia", SG: "southeast_asia", GB: "europe", RU: "europe", NG: "africa", EG: "africa", US: "north_america", MX: "north_america", BR: "south_america", AU: "australasia", FJ: "australasia" };
    for (const [cc, r] of Object.entries(sample)) expect(regionOf(cc)).toBe(r);
  });
  it("is case-insensitive and null-safe", () => {
    expect(regionOf("in")).toBe("south_asia");
    expect(regionOf("ZZ")).toBeNull();
    expect(regionOf(undefined)).toBeNull();
  });
});

describe("post validation", () => {
  it("accepts reply regions and rejects empty or unknown ones", () => {
    expect(createPostSchema.safeParse({ text: "hi", replyRegions: ["europe"] }).success).toBe(true);
    expect(createPostSchema.safeParse({ text: "hi", replyRegions: null }).success).toBe(true);
    expect(createPostSchema.safeParse({ text: "hi", replyRegions: [] }).success).toBe(false);
    expect(createPostSchema.safeParse({ text: "hi", replyRegions: ["mars"] }).success).toBe(false);
  });
  it("accepts every reply audience", () => {
    for (const a of ["everyone", "following", "following_network", "mentioned"]) {
      expect(createPostSchema.safeParse({ text: "hi", replyAudience: a }).success).toBe(true);
    }
    expect(createPostSchema.safeParse({ text: "hi", replyAudience: "friends" }).success).toBe(false);
  });
  it("needs text, media or a quote", () => {
    expect(createPostSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(createPostSchema.safeParse({ text: "", mediaIds: ["1"] }).success).toBe(true);
  });
});

describe("notes and places", () => {
  it("limits notes to a title, 1–10 media and a 1–5 star review", () => {
    const ok = { title: "Filter coffee", mediaIds: ["1"], review: { rating: 4, visitedOn: "2026-10-01" } };
    expect(createPhotoNoteSchema.safeParse(ok).success).toBe(true);
    expect(createPhotoNoteSchema.safeParse({ ...ok, title: "A" }).success).toBe(false);
    expect(createPhotoNoteSchema.safeParse({ ...ok, mediaIds: [] }).success).toBe(false);
    expect(createPhotoNoteSchema.safeParse({ ...ok, mediaIds: Array.from({ length: 11 }, (_, i) => String(i)) }).success).toBe(false);
    expect(createPhotoNoteSchema.safeParse({ ...ok, review: { rating: 6 } }).success).toBe(false);
    expect(createPhotoNoteSchema.safeParse({ ...ok, review: { rating: 4, visitedOn: "01/10/2026" } }).success).toBe(false);
  });
  it("validates place coordinates", () => {
    expect(createPlaceSchema.safeParse({ name: "Marina Beach", lat: 13.05, lng: 80.28 }).success).toBe(true);
    expect(createPlaceSchema.safeParse({ name: "Nowhere", lat: 95, lng: 0 }).success).toBe(false);
  });
});

describe("accounts", () => {
  it("enforces handle and password rules", () => {
    const base = { email: "a@example.com", password: "correct-horse-battery", handle: "kavya_agri", displayName: "Kavya" };
    expect(registerSchema.safeParse(base).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, handle: "has space" }).success).toBe(false);
  });
});

describe("business verification", () => {
  it("checks the GSTIN checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false);
    expect(validateRegistration("CIN", "U74999MH2016PTC123456")).toBeNull();
    expect(validateRegistration("UDYAM", "UDYAM-MH-19-0012345")).toBeNull();
    expect(validateRegistration("LLPIN", "12-AB")).not.toBeNull();
  });
});

describe("languages", () => {
  it("offers English plus the 22 scheduled Indian languages", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(23);
  });
  it("maps device locales and detects scripts", () => {
    expect(languageFromLocale("ta_IN")).toBe("ta");
    expect(languageFromLocale("xx-YY")).toBe("en");
    expect(detectLanguage("வணக்கம் சென்னை, காபி நல்லா இருக்கு")).toBe("ta");
    expect(detectLanguage("नमस्ते मुंबई, आज बाज़ार कैसा है")).toBe("hi");
    expect(detectLanguage("Good morning from Chennai")).toBe("en");
  });
});
