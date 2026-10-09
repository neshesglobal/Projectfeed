import { AppState } from "react-native";
import { api } from "../api/client";
import { useAuth } from "../store/auth";

/**
 * Client event log. Impressions and dwell are what the future ranking model trains on,
 * so they are collected from day one. Batched and flushed every 10s or when backgrounded.
 */

type EventType = "impression" | "dwell" | "click_post" | "click_profile" | "click_link" | "media_expand" | "video_view" | "share";

interface ClientEvent {
  type: EventType;
  postId?: string;
  surface: string;
  position?: number;
  durationMs?: number;
  ts: string;
}

let queue: ClientEvent[] = [];
const seenThisSession = new Set<string>();
const visibleSince = new Map<string, { at: number; surface: string; position?: number }>();

export function track(e: Omit<ClientEvent, "ts">): void {
  queue.push({ ...e, ts: new Date().toISOString() });
  if (queue.length >= 100) void flush();
}

/** Call when a post becomes visible / stops being visible in a feed. */
export function postVisible(postId: string, surface: string, position: number): void {
  const key = `${surface}:${postId}`;
  if (!seenThisSession.has(key)) {
    seenThisSession.add(key);
    track({ type: "impression", postId, surface, position });
  }
  if (!visibleSince.has(key)) visibleSince.set(key, { at: Date.now(), surface, position });
}

export function postHidden(postId: string, surface: string): void {
  const key = `${surface}:${postId}`;
  const v = visibleSince.get(key);
  if (!v) return;
  visibleSince.delete(key);
  const ms = Date.now() - v.at;
  if (ms >= 500) track({ type: "dwell", postId, surface, position: v.position, durationMs: Math.min(ms, 3_600_000) });
}

export async function flush(): Promise<void> {
  if (queue.length === 0 || useAuth.getState().status !== "signedIn") return;
  const batch = queue.slice(0, 200);
  queue = queue.slice(200);
  try {
    await api("/events", { method: "POST", body: { events: batch } });
  } catch {
    queue = batch.concat(queue).slice(-1000); // keep for retry, bounded
  }
}

let started = false;
export function startEventLoop(): void {
  if (started) return;
  started = true;
  setInterval(() => void flush(), 10_000);
  AppState.addEventListener("change", (s) => {
    if (s !== "active") void flush();
  });
}
