// "For You" Feed Mixer — a rule-based version of X's Home Mixer candidate pipeline:
//   sources → hydrate features → filter → score → diversify → select.
// Each stage is a plain function so an ML scorer or embedding source can replace one stage later
// without touching the others.

import type { Db } from "../db";
import { idAtTime } from "../lib/ids";
import { containsMutedWord, type ViewerFilters } from "../services/timeline";

export interface Candidate {
  postId: string;
  authorId: string;
  source: "in_network" | "social_proof" | "sector" | "popular";
  reason: string | null;
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  bookmarks: number;
  createdAt: Date;
  followed: boolean;
  affinity: number;
  seen: boolean;
  authorNegatives: number;
  score: number;
}

/** Tunable weights. Kept in one place so they can move to remote config without a release. */
export const WEIGHTS = {
  like: 1,
  repost: 2,
  reply: 4,
  quote: 3,
  bookmark: 2,
  freshnessHalfLifeHours: 6,
  outOfNetworkFactor: 0.7,
  seenFactor: 0.3,
  authorNegativeFactor: 0.5, // per "not interested" on this author
  authorRepeatDecay: 0.6, // each further post by the same author
  maxOutOfNetworkShare: 0.4,
  lookbackHours: 48,
};

type Row = Omit<Candidate, "score" | "affinity" | "followed" | "seen" | "authorNegatives" | "source" | "reason"> & {
  reason: string | null;
};

async function sources(db: Db, viewerId: string): Promise<Candidate[]> {
  const since = idAtTime(new Date(Date.now() - WEIGHTS.lookbackHours * 3600_000));
  const cols = () => db`p.id AS "postId", p.author_id AS "authorId", p.text, p.like_count AS likes, p.reply_count AS replies,
                  p.repost_count AS reposts, p.quote_count AS quotes, p.bookmark_count AS bookmarks, p.created_at AS "createdAt"`;
  const base = () => db`p.deleted_at IS NULL AND p.removed_at IS NULL AND p.id > ${since} AND p.author_id <> ${viewerId}`;
  // Reach-limited posts (moderation "limit_reach") still reach followers, but are never recommended out of network.
  const oon = () => db`${base()} AND NOT p.limited`;

  const [inNet, social, sector, popular] = await Promise.all([
    db<Row[]>`
      SELECT ${cols()}, NULL AS reason FROM posts p
      WHERE ${base()} AND p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId})
        AND (p.reply_to_id IS NULL OR p.reply_to_author_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId}))
      ORDER BY p.id DESC LIMIT 300`,
    // Out-of-network posts that people you follow liked or reposted ("Liked by @x").
    db<Row[]>`
      SELECT DISTINCT ON (p.id) ${cols()}, 'Liked by @' || u.handle AS reason
      FROM likes l JOIN posts p ON p.id = l.post_id JOIN users u ON u.id = l.user_id
      WHERE ${oon()} AND p.reply_to_id IS NULL
        AND l.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId})
        AND p.author_id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ${viewerId})
      ORDER BY p.id DESC LIMIT 200`,
    db<Row[]>`
      SELECT ${cols()}, 'Popular in ' || (SELECT s FROM unnest(a.sectors) s WHERE s = ANY(me.sectors) LIMIT 1) AS reason
      FROM posts p JOIN users a ON a.id = p.author_id, users me
      WHERE me.id = ${viewerId} AND ${oon()} AND p.reply_to_id IS NULL AND a.sectors && me.sectors
      ORDER BY (p.like_count + 2 * p.repost_count + 4 * p.reply_count) DESC LIMIT 100`,
    db<Row[]>`
      SELECT ${cols()}, 'Popular on Projectfeed' AS reason FROM posts p
      WHERE ${oon()} AND p.reply_to_id IS NULL
      ORDER BY (p.like_count + 2 * p.repost_count + 4 * p.reply_count) DESC, p.id DESC LIMIT 100`,
  ]);

  // Merge, keeping the first (most personal) source for each post.
  const out = new Map<string, Candidate>();
  const add = (rows: Row[], source: Candidate["source"]) => {
    for (const r of rows) {
      if (out.has(r.postId)) continue;
      out.set(r.postId, { ...r, source, followed: source === "in_network", affinity: 0, seen: false, authorNegatives: 0, score: 0 });
    }
  };
  add(inNet, "in_network");
  add(social, "social_proof");
  add(sector, "sector");
  add(popular, "popular");
  return [...out.values()];
}

async function hydrateFeatures(db: Db, viewerId: string, cands: Candidate[]): Promise<void> {
  if (cands.length === 0) return;
  const authorIds = [...new Set(cands.map((c) => c.authorId))];
  const postIds = cands.map((c) => c.postId);
  const [affinity, seen, negatives, follows] = await Promise.all([
    // How much has the viewer engaged with each author in the last 30 days?
    db<{ author_id: string; n: number }[]>`
      SELECT author_id, sum(w)::float AS n FROM (
        SELECT p.author_id, 1 AS w FROM likes l JOIN posts p ON p.id = l.post_id
        WHERE l.user_id = ${viewerId} AND l.created_at > now() - interval '30 days' AND p.author_id = ANY(${authorIds}::bigint[])
        UNION ALL
        SELECT p.reply_to_author_id, 3 FROM posts p
        WHERE p.author_id = ${viewerId} AND p.created_at > now() - interval '30 days' AND p.reply_to_author_id = ANY(${authorIds}::bigint[])
        UNION ALL
        SELECT p.author_id, 2 FROM reposts r JOIN posts p ON p.id = r.post_id
        WHERE r.user_id = ${viewerId} AND r.created_at > now() - interval '30 days' AND p.author_id = ANY(${authorIds}::bigint[])
      ) x GROUP BY author_id`,
    db<{ post_id: string }[]>`SELECT post_id FROM post_views WHERE user_id = ${viewerId} AND post_id = ANY(${postIds}::bigint[])`,
    db<{ author_id: string; n: number }[]>`
      SELECT author_id, count(*)::int AS n FROM feed_negative
      WHERE user_id = ${viewerId} AND author_id = ANY(${authorIds}::bigint[]) GROUP BY author_id`,
    db<{ id: string }[]>`SELECT followee_id AS id FROM follows WHERE follower_id = ${viewerId} AND followee_id = ANY(${authorIds}::bigint[])`,
  ]);
  const aff = new Map(affinity.map((a) => [a.author_id, a.n]));
  const seenSet = new Set(seen.map((s) => s.post_id));
  const neg = new Map(negatives.map((n) => [n.author_id, n.n]));
  const followed = new Set(follows.map((f) => f.id));
  for (const c of cands) {
    c.affinity = aff.get(c.authorId) ?? 0;
    c.seen = seenSet.has(c.postId);
    c.authorNegatives = neg.get(c.authorId) ?? 0;
    c.followed = followed.has(c.authorId);
  }
}

function filter(cands: Candidate[], f: ViewerFilters): Candidate[] {
  return cands.filter(
    (c) =>
      !f.blockedUsers.has(c.authorId) &&
      !f.mutedUsers.has(c.authorId) &&
      !f.notInterestedPosts.has(c.postId) &&
      !containsMutedWord(c.text, f.mutedWords),
  );
}

export function score(c: Candidate, now = Date.now()): number {
  const W = WEIGHTS;
  const engagement =
    1 + W.like * c.likes + W.repost * c.reposts + W.reply * c.replies + W.quote * c.quotes + W.bookmark * c.bookmarks;
  const ageHours = Math.max(0, (now - c.createdAt.getTime()) / 3600_000);
  const freshness = Math.pow(0.5, ageHours / W.freshnessHalfLifeHours);
  const affinity = 1 + Math.log1p(c.affinity);
  let s = Math.log1p(engagement) * freshness * affinity;
  if (!c.followed) s *= W.outOfNetworkFactor;
  if (c.seen) s *= W.seenFactor;
  if (c.authorNegatives > 0) s *= Math.pow(W.authorNegativeFactor, c.authorNegatives);
  // In-network posts get a floor so a quiet account you follow is not buried by viral strangers.
  if (c.followed) s += 0.5 * freshness;
  return s;
}

/**
 * Author diversity + out-of-network cap, applied greedily on the sorted list
 * (same idea as X's AuthorDiversityScorer and OON scaling, without the DPP re-ranker).
 */
function diversify(sorted: Candidate[]): Candidate[] {
  const perAuthor = new Map<string, number>();
  const adjusted = sorted.map((c) => {
    const n = perAuthor.get(c.authorId) ?? 0;
    perAuthor.set(c.authorId, n + 1);
    return { ...c, score: c.score * Math.pow(WEIGHTS.authorRepeatDecay, n) };
  });
  adjusted.sort((a, b) => b.score - a.score);

  const out: Candidate[] = [];
  const deferred: Candidate[] = [];
  let oon = 0;
  for (const c of adjusted) {
    if (!c.followed && (oon + 1) / (out.length + 1) > WEIGHTS.maxOutOfNetworkShare && out.length >= 3) {
      deferred.push(c);
      continue;
    }
    if (!c.followed) oon++;
    out.push(c);
  }
  return out.concat(deferred); // over-cap posts still appear, just further down
}

export interface RankedItem {
  postId: string;
  reason: string | null;
}

export async function rankForYou(db: Db, viewerId: string, filters: ViewerFilters): Promise<RankedItem[]> {
  const cands = await sources(db, viewerId);
  await hydrateFeatures(db, viewerId, cands);
  const kept = filter(cands, filters);
  const now = Date.now();
  for (const c of kept) c.score = score(c, now);
  kept.sort((a, b) => b.score - a.score);
  return diversify(kept).map((c) => ({
    postId: c.postId,
    reason: c.followed ? null : (c.reason ?? "Suggested for you"),
  }));
}
