// Upload screening: every image and sampled video keyframe is checked against known-abuse hash lists
// BEFORE anything is written to public storage.
//
// Production uses an industry matcher (Microsoft PhotoDNA via the IWF/NCMEC programmes, or Thorn Safer).
// Those require an approved agreement, so this module ships with:
//   - HashListScanner: exact SHA-256 / MD5 plus a perceptual dHash, loaded from a local list file.
//     Used for development and tests with BENIGN images only. Never place real abuse material on disk.
//   - PhotoDnaScanner: adapter stub; wire up once the vendor agreement is signed.
//   - NoopScanner: development only; production refuses to start with it unless explicitly disabled.

import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import type { Sql } from "../db";
import { newId } from "../lib/ids";

export interface ScanMatch {
  list: string;
  ref: string;
}

export interface ScanResult {
  scanner: string;
  sha256: string;
  match: ScanMatch | null;
}

export interface MediaScanner {
  readonly name: string;
  /** Scan the original bytes and/or decoded frames. Throws if the scan could not be completed. */
  scan(input: ScanInput): Promise<ScanResult>;
}

export interface ScanInput {
  /** Original upload bytes (images). */
  original?: Buffer;
  /** Precomputed digests of an original too large to buffer (videos). */
  digests?: { sha256: string; md5: string };
  /** Decoded frames: the image itself, or sampled video keyframes. */
  frames: Buffer[];
}

/** Stream a file through SHA-256 and MD5 without loading it into memory. */
export async function fileDigests(file: string): Promise<{ sha256: string; md5: string }> {
  const a = crypto.createHash("sha256");
  const b = crypto.createHash("md5");
  for await (const chunk of fs.createReadStream(file)) {
    a.update(chunk as Buffer);
    b.update(chunk as Buffer);
  }
  return { sha256: a.digest("hex"), md5: b.digest("hex") };
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest("hex");

/** 64-bit difference hash: robust to re-encoding and resizing, not to crops. A stand-in for PhotoDNA/PDQ in tests. */
export async function dHash(image: Buffer): Promise<bigint> {
  const px = await sharp(image, { limitInputPixels: 50_000_000 }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      h = (h << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return h;
}

function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Hash list file format, one entry per line (# comments allowed):
 *   sha256:<hex> <ref>
 *   md5:<hex> <ref>
 *   dhash:<16 hex digits> <ref>
 */
export class HashListScanner implements MediaScanner {
  readonly name = "hashlist";
  private exact = new Map<string, string>();
  private perceptual: { hash: bigint; ref: string }[] = [];

  constructor(
    private listName: string,
    text: string,
    private maxDistance = 6,
  ) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const [entry, ref = "unlabelled"] = line.split(/\s+/, 2);
      const [kind, value] = entry!.split(":", 2);
      if (!value) continue;
      if (kind === "sha256" || kind === "md5") this.exact.set(`${kind}:${value.toLowerCase()}`, ref);
      else if (kind === "dhash") this.perceptual.push({ hash: BigInt(`0x${value}`), ref });
    }
  }

  static fromFile(file: string): HashListScanner {
    return new HashListScanner(process.env.SCREENING_LIST_NAME ?? "local", fs.readFileSync(file, "utf8"));
  }

  get size(): number {
    return this.exact.size + this.perceptual.length;
  }

  async scan(input: ScanInput): Promise<ScanResult> {
    const digests = input.digests ?? (input.original ? { sha256: sha256(input.original), md5: md5(input.original) } : null);
    const digest = digests?.sha256 ?? sha256(input.frames[0] ?? Buffer.alloc(0));
    const hit = (ref: string): ScanResult => ({ scanner: this.name, sha256: digest, match: { list: this.listName, ref } });
    if (digests) {
      const ref = this.exact.get(`sha256:${digests.sha256}`) ?? this.exact.get(`md5:${digests.md5}`);
      if (ref) return hit(ref);
    }
    for (const frame of input.frames) {
      const ref = this.exact.get(`sha256:${sha256(frame)}`);
      if (ref) return hit(ref);
      if (this.perceptual.length === 0) continue;
      const h = await dHash(frame);
      const near = this.perceptual.find((p) => hamming(p.hash, h) <= this.maxDistance);
      if (near) return hit(near.ref);
    }
    return { scanner: this.name, sha256: digest, match: null };
  }
}

/** Placeholder for Microsoft PhotoDNA Cloud Service (via IWF / NCMEC membership). */
export class PhotoDnaScanner implements MediaScanner {
  readonly name = "photodna";
  async scan(): Promise<ScanResult> {
    throw new Error("PhotoDNA is not configured: complete the vendor agreement and add credentials");
  }
}

export class NoopScanner implements MediaScanner {
  readonly name = "none";
  async scan(input: ScanInput): Promise<ScanResult> {
    return { scanner: this.name, sha256: input.digests?.sha256 ?? sha256(input.original ?? input.frames[0] ?? Buffer.alloc(0)), match: null };
  }
}

export function createScanner(isProd: boolean): MediaScanner {
  const list = process.env.SCREENING_HASH_LIST;
  if (process.env.SCREENING_PROVIDER === "photodna") return new PhotoDnaScanner();
  if (list) return HashListScanner.fromFile(list);
  if (isProd && process.env.SCREENING_DISABLED !== "true") {
    throw new Error("Upload screening is required in production: set SCREENING_HASH_LIST or SCREENING_PROVIDER");
  }
  return new NoopScanner();
}

/**
 * Record a scan. On a match the upload is quarantined: the bytes are never written to storage, the media row is
 * marked 'quarantined', a priority-0 report goes to the compliance queue and the account is frozen (read-only).
 * The user is NOT told why — alerting a suspect can prejudice a law-enforcement investigation.
 */
export async function recordScan(
  sql: Sql,
  media: { id: string; ownerId: string },
  result: ScanResult,
): Promise<"clear" | "quarantined"> {
  if (!result.match) {
    await sql`INSERT INTO media_scans (id, media_id, scanner, result, sha256)
              VALUES (${newId()}, ${media.id}, ${result.scanner}, 'clear', ${result.sha256})`;
    return "clear";
  }
  const m = result.match;
  await sql.begin(async (tx) => {
    await tx`UPDATE media SET status = 'quarantined', storage_key = '', thumb_key = '', source_key = NULL,
               error = 'This file could not be uploaded' WHERE id = ${media.id}`;
    await tx`INSERT INTO media_scans (id, media_id, scanner, result, match_list, match_ref, sha256)
             VALUES (${newId()}, ${media.id}, ${result.scanner}, 'match', ${m.list}, ${m.ref}, ${result.sha256})`;
    const reportId = newId();
    await tx`INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, priority, source)
             VALUES (${reportId}, NULL, 'media', ${media.id}, 'child_safety',
                     ${`Hash match on upload (${m.list}: ${m.ref})`}, 0, 'screening')`;
    const [u] = await tx<{ status: string }[]>`SELECT status FROM users WHERE id = ${media.ownerId} FOR UPDATE`;
    if (u && u.status !== "banned" && u.status !== "deleted") {
      await tx`UPDATE users SET status = 'frozen' WHERE id = ${media.ownerId}`;
      await tx`INSERT INTO moderation_actions (id, staff_id, target_type, target_id, user_id, action, reason_code, statement, report_id)
               VALUES (${newId()}, NULL, 'user', ${media.ownerId}, ${media.ownerId}, 'freeze', 'screening_match',
                       'Account placed under review', ${reportId})`;
    }
  });
  return "quarantined";
}
