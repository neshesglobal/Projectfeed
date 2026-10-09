import type { Conversation } from "@projectfeed/shared";

export function conversationTitle(c: Conversation): string {
  if (c.title) return c.title;
  return c.participants.map((p) => p.displayName).join(", ") || "Conversation";
}
