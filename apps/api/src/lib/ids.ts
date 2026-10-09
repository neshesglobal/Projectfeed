// Snowflake-style 64-bit IDs: 41 bits ms since epoch | 10 bits worker | 12 bits sequence.
// Time-sortable, so ID order == creation order (used as feed cursors).

const EPOCH = 1_767_225_600_000n; // 2026-01-01T00:00:00Z
const WORKER_ID = BigInt(Number(process.env.WORKER_ID ?? 0) & 0x3ff);

let lastMs = -1n;
let seq = 0n;

export function newId(): string {
  let now = BigInt(Date.now());
  if (now === lastMs) {
    seq = (seq + 1n) & 0xfffn;
    if (seq === 0n) {
      while (now <= lastMs) now = BigInt(Date.now());
    }
  } else {
    seq = 0n;
  }
  if (now < lastMs) now = lastMs; // clock went backwards: never reuse an earlier timestamp
  lastMs = now;
  return (((now - EPOCH) << 22n) | (WORKER_ID << 12n) | seq).toString();
}

/** Smallest possible ID for a given time, for "posts since" range queries. */
export function idAtTime(date: Date): string {
  return ((BigInt(date.getTime()) - EPOCH) << 22n).toString();
}

export function isId(v: unknown): v is string {
  return typeof v === "string" && /^\d{1,19}$/.test(v);
}
