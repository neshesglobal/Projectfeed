// Post text rules shared by the composer (live counter) and the API (validation).

export const MAX_POST_LENGTH = 280;
export const URL_WEIGHT = 23;

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const MENTION_RE = /(^|[^\w@])@([A-Za-z0-9_]{1,15})\b/g;
const HASHTAG_RE = /(^|[^\w#&])#([\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;
const CASHTAG_RE = /(^|[^\w$])\$([A-Za-z]{1,6}(?:[._][A-Za-z]{1,2})?)\b/g;

/** X-style weighted length: every URL counts as 23, CJK and emoji count as 2. */
export function weightedLength(text: string): number {
  const withoutUrls = text.replace(URL_RE, "");
  const urlCount = (text.match(URL_RE) ?? []).length;
  let len = urlCount * URL_WEIGHT;
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0)!;
    const heavy =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      cp >= 0x1f000;
    len += heavy ? 2 : 1;
  }
  return len;
}

export type EntityType = "url" | "mention" | "hashtag" | "cashtag";
export interface TextEntity {
  type: EntityType;
  start: number; // UTF-16 index, inclusive
  end: number; // UTF-16 index, exclusive
  value: string; // url, handle, tag (without sigil)
}

function collect(text: string, re: RegExp, type: EntityType, out: TextEntity[]) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (type === "url") {
      const value = m[0].replace(/[.,!?;:)\]]+$/, "");
      out.push({ type, start: m.index, end: m.index + value.length, value });
    } else {
      const prefix = m[1] ?? "";
      const start = m.index + prefix.length;
      const value = m[2]!;
      out.push({ type, start, end: start + value.length + 1, value });
    }
  }
}

/** Extract URLs, @mentions, #hashtags and $cashtags, sorted and non-overlapping. */
export function extractEntities(text: string): TextEntity[] {
  const all: TextEntity[] = [];
  collect(text, URL_RE, "url", all);
  collect(text, MENTION_RE, "mention", all);
  collect(text, HASHTAG_RE, "hashtag", all);
  collect(text, CASHTAG_RE, "cashtag", all);
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextEntity[] = [];
  let lastEnd = -1;
  for (const e of all) {
    if (e.start >= lastEnd) {
      out.push(e);
      lastEnd = e.end;
    }
  }
  return out;
}

/** Abbreviated counts as shown on post cards: 999, 1.2K, 34K, 1.5M. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(Math.floor(n / 100) / 10).toString()}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  if (n < 10_000_000) return `${(Math.floor(n / 100_000) / 10).toString()}M`;
  return `${Math.floor(n / 1_000_000)}M`;
}

/** Relative timestamps as shown on post cards: 45s, 12m, 3h, 9 Oct, 9 Oct 2024. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const secs = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  const month = then.toLocaleString("en-GB", { month: "short" });
  const base = `${then.getDate()} ${month}`;
  return then.getFullYear() === now.getFullYear() ? base : `${base} ${then.getFullYear()}`;
}
