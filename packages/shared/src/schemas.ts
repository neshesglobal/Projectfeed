import { REGIONS } from "./regions";
import { z } from "zod";
import { MAX_POST_LENGTH, weightedLength } from "./text";

export const handleSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{3,15}$/, "Handle must be 3–15 letters, numbers or underscores");

export const passwordSchema = z.string().min(10, "Password must be at least 10 characters").max(200);

export const registerSchema = z.object({
  email: z.email().max(254),
  password: passwordSchema,
  handle: handleSchema,
  displayName: z.string().trim().min(1).max(50),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: z.string().min(1).max(254), // email or handle
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const SECTORS = [
  "Petroleum",
  "Gas & LNG",
  "Gold & Precious Metals",
  "Base Metals",
  "Agriculture",
  "Fertilisers",
  "Shipping & Freight",
  "Trade Finance",
  "Other",
] as const;

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  bio: z.string().max(160).optional(),
  location: z.string().max(30).optional(),
  website: z.union([z.url().max(100), z.literal("")]).optional(),
  company: z.string().max(60).optional(),
  role: z.string().max(60).optional(),
  sectors: z.array(z.enum(SECTORS)).max(5).optional(),
  avatarMediaId: z.string().nullable().optional(),
  bannerMediaId: z.string().nullable().optional(),
  isProtected: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Who can reply. "following" = accounts the author follows; "following_network" = those accounts and the accounts
 * they follow; "mentioned" = only accounts mentioned in the post. People mentioned can always reply.
 */
export const REPLY_AUDIENCES = ["everyone", "following", "following_network", "mentioned"] as const;
export type ReplyAudience = (typeof REPLY_AUDIENCES)[number];

export const createPostSchema = z
  .object({
    text: z.string().max(4000).default(""),
    replyToId: z.string().optional(),
    paidPartnership: z.boolean().default(false),
    quoteOfId: z.string().optional(),
    mediaIds: z.array(z.string()).max(4).default([]),
    replyAudience: z.enum(REPLY_AUDIENCES).default("everyone"),
    /** Limit replies to people from these regions (by verified ID country). Omitted or null = everywhere. */
    replyRegions: z.array(z.enum(REGIONS)).min(1, "Choose at least one region").max(REGIONS.length).nullable().optional(),
    poll: z
      .object({
        options: z.array(z.string().trim().min(1).max(25)).min(2).max(4),
        durationMinutes: z.number().int().min(5).max(7 * 24 * 60),
      })
      .optional(),
  })
  .refine((p) => p.text.trim().length > 0 || p.mediaIds.length > 0 || p.quoteOfId, {
    message: "Post cannot be empty",
  })
  .refine((p) => weightedLength(p.text) <= MAX_POST_LENGTH, {
    message: `Post exceeds ${MAX_POST_LENGTH} characters`,
  })
  .refine((p) => !(p.poll && p.mediaIds.length > 0), {
    message: "A post cannot have both a poll and media",
  });
export type CreatePostInput = z.input<typeof createPostSchema>;

export const editPostSchema = z.object({
  text: z
    .string()
    .max(4000)
    .refine((t) => weightedLength(t) <= MAX_POST_LENGTH, `Post exceeds ${MAX_POST_LENGTH} characters`),
});

export const pollVoteSchema = z.object({ optionIndex: z.number().int().min(0).max(3) });

export const REPORT_REASONS = [
  "spam",
  "scam_fraud",
  "harassment",
  "hate",
  "violence",
  "impersonation",
  "child_safety",
  "terrorism",
  "self_harm",
  "illegal_goods",
  "other",
] as const;

export const reportSchema = z.object({
  targetType: z.enum(["post", "user", "message"]),
  targetId: z.string(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().max(1000).optional(),
});

export const sendMessageSchema = z
  .object({
    text: z.string().max(10_000).default(""),
    mediaIds: z.array(z.string()).max(4).default([]),
    sharedPostId: z.string().optional(),
  })
  .refine((m) => m.text.trim().length > 0 || m.mediaIds.length > 0 || m.sharedPostId, {
    message: "Message cannot be empty",
  });

export const createConversationSchema = z.object({
  participantIds: z.array(z.string()).min(1).max(49),
  title: z.string().max(50).optional(),
});

export const createListSchema = z.object({
  name: z.string().trim().min(1).max(25),
  description: z.string().max(100).optional(),
  isPrivate: z.boolean().default(false),
});

export const mutedWordSchema = z.object({ word: z.string().trim().min(1).max(100) });

export const EVENT_TYPES = [
  "impression",
  "dwell",
  "click_post",
  "click_profile",
  "click_link",
  "media_expand",
  "video_view",
  "share",
  "not_interested",
] as const;

export const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(EVENT_TYPES),
        postId: z.string().optional(),
        surface: z.string().max(30),
        position: z.number().int().min(0).optional(),
        durationMs: z.number().int().min(0).max(3_600_000).optional(),
        ts: z.string(),
      }),
    )
    .max(200),
});

// ───────────────────────────── Moderation ─────────────────────────────

/** Policy reasons a moderator cites in a statement of reasons (shown to the affected user). */
export const MODERATION_REASONS = [
  ...REPORT_REASONS.filter((r) => r !== "other"),
  "adult_content",
  "graphic_content",
  "misleading",
  "platform_manipulation",
  "legal_request",
  "other",
] as const;

export const MODERATION_ACTIONS = [
  "remove_post",
  "restore_post",
  "label_sensitive",
  "unlabel_sensitive",
  "limit_reach",
  "unlimit_reach",
  "warn",
  "suspend",
  "unsuspend",
  "freeze",
  "unfreeze",
  "ban",
  "unban",
] as const;

/** Decisions a user can appeal (reversals and automated freezes are not appealable). */
export const APPEALABLE_ACTIONS = ["remove_post", "label_sensitive", "limit_reach", "warn", "suspend", "ban"] as const;

export const appealSchema = z.object({
  actionId: z.string(),
  text: z.string().trim().min(10, "Tell us why you think this decision was wrong").max(2000),
});

export const changeHandleSchema = z.object({ handle: handleSchema });

export const verificationApplySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("business"),
    legalName: z.string().trim().min(2).max(120),
    regType: z.enum(["GSTIN", "CIN", "LLPIN", "UDYAM", "OTHER"]),
    regNumber: z.string().trim().min(3).max(40),
    country: z.string().length(2).default("IN"),
    website: z.union([z.url().max(200), z.literal("")]).default(""),
    signatoryName: z.string().trim().min(2).max(80),
    signatoryRole: z.string().trim().min(2).max(80),
  }),
  z.object({
    kind: z.literal("creator"),
    category: z.string().trim().min(2).max(60),
    links: z.array(z.url().max(200)).max(5).default([]),
    about: z.string().trim().max(500).default(""),
  }),
]);
export type VerificationApplyInput = z.infer<typeof verificationApplySchema>;

export const affiliateInviteSchema = z.object({ handle: z.string().trim().min(1).max(16), title: z.string().trim().max(60).default("") });

export const noteCreateSchema = z
  .object({
    classification: z.enum(["misleading", "not_misleading"]),
    text: z.string().trim().min(20, "Explain the context in at least 20 characters").max(500),
    sources: z.array(z.url().max(500)).max(5).default([]),
  })
  .refine((n) => n.classification === "not_misleading" || n.sources.length > 0, {
    message: "Add at least one source link",
    path: ["sources"],
  });

export const noteRateSchema = z.object({ helpful: z.enum(["yes", "somewhat", "no"]) });

// ───────────────────────────── Notes, places, collections ─────────────────────────────

export const MAX_NOTE_TEXT = 1000;
export const MAX_NOTE_MEDIA = 10;

/** A Discover note: photo- or video-first, with a title. Optionally a review of a place. */
export const createPhotoNoteSchema = z.object({
  title: z.string().trim().min(2, "Add a title").max(60),
  text: z.string().max(MAX_NOTE_TEXT).default(""),
  mediaIds: z.array(z.string()).min(1, "Add at least one photo or video").max(MAX_NOTE_MEDIA),
  placeId: z.string().optional(),
  review: z
    .object({
      rating: z.number().int().min(1).max(5),
      visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .optional(),
  paidPartnership: z.boolean().default(false),
  replyAudience: z.enum(REPLY_AUDIENCES).default("everyone"),
  replyRegions: z.array(z.enum(REGIONS)).min(1, "Choose at least one region").max(REGIONS.length).nullable().optional(),
});
export type CreatePhotoNoteInput = z.input<typeof createPhotoNoteSchema>;

export const PLACE_CATEGORIES = ["Café", "Restaurant", "Street food", "Shop", "Market", "Hotel", "Attraction", "Trek", "Beach", "Temple", "Office", "Port", "Other"] as const;

export const createPlaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().max(40).default(""),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(200).default(""),
  city: z.string().trim().max(60).default(""),
  country: z.string().length(2).optional(),
});

export const collectionSchema = z.object({
  name: z.string().trim().min(1).max(40),
  isPrivate: z.boolean().default(false),
});
