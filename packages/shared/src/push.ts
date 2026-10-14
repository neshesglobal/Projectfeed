import { z } from "zod";

/** Which events send a push notification. Stored per user; anything missing falls back to the default. */
export interface PushPrefs {
  /** Master switch for every push from this account. */
  enabled: boolean;
  likes: boolean;
  reposts: boolean;
  replies: boolean;
  mentions: boolean;
  quotes: boolean;
  /** New followers and follow requests. */
  follows: boolean;
  messages: boolean;
  /** Show the message text on the lock screen, or only who it is from. */
  messagePreviews: boolean;
}

export const DEFAULT_PUSH_PREFS: PushPrefs = {
  enabled: true,
  likes: true,
  reposts: true,
  replies: true,
  mentions: true,
  quotes: true,
  follows: true,
  messages: true,
  messagePreviews: true,
};

export const pushPrefsPatchSchema = z
  .object({
    enabled: z.boolean(),
    likes: z.boolean(),
    reposts: z.boolean(),
    replies: z.boolean(),
    mentions: z.boolean(),
    quotes: z.boolean(),
    follows: z.boolean(),
    messages: z.boolean(),
    messagePreviews: z.boolean(),
  })
  .partial()
  .strict();

/** Expo push tokens look like ExponentPushToken[xxxxxxxx]. */
export const pushTokenSchema = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/, "Invalid push token"),
  platform: z.enum(["ios", "android"]),
});

export const pushTokenDeleteSchema = z.object({ token: z.string().min(10).max(200) });
