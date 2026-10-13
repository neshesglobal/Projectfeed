// Community Notes "bridging" scorer — the matrix-factorisation model from X's open-source Community Notes
// algorithm (github.com/twitter/communitynotes), simplified to one viewpoint dimension:
//
//   predicted rating  r̂(u, n) = μ + i_u + i_n + f_u · f_n
//
// f_u and f_n learn the main axis along which raters disagree (often, but not necessarily, political).
// A note that only one side likes is explained by f_u · f_n, leaving a low note intercept i_n. A note that people
// on both sides of the axis find helpful can only be explained by a high i_n. Status uses i_n alone, so a note is
// shown only when it is helpful *across* viewpoints. Popularity with one camp is not enough.

export interface RatingRow {
  noteId: string;
  raterId: string;
  /** 1 helpful, 0.5 somewhat, 0 not helpful. */
  value: number;
}

export interface NoteScore {
  noteId: string;
  intercept: number;
  factor: number;
  ratings: number;
  status: "needs_ratings" | "helpful" | "not_helpful";
}

/**
 * Status thresholds are taken from the published Community Notes algorithm. The regularisation strengths are
 * tuned for this implementation's normalisation (penalties averaged per rater/note): with them, a note rated
 * helpful by a handful of raters from *both* sides clears 0.40, while a note only one side likes stays near 0.
 */
export const NOTE_PARAMS = {
  minRatings: 5,
  helpfulIntercept: 0.4,
  maxHelpfulFactor: 0.5,
  notHelpfulIntercept: -0.05,
  notHelpfulFactorSlope: 0.8,
  lambdaFactor: 0.03,
  lambdaIntercept: 0.05, // intercepts are regularised harder than factors
  epochs: 400,
  learningRate: 0.05,
};

/** Small deterministic PRNG so scoring is reproducible. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32) - 0.5;
}

export function scoreNotes(ratings: RatingRow[], p = NOTE_PARAMS): NoteScore[] {
  const users = new Map<string, number>();
  const notes = new Map<string, number>();
  for (const r of ratings) {
    if (!users.has(r.raterId)) users.set(r.raterId, users.size);
    if (!notes.has(r.noteId)) notes.set(r.noteId, notes.size);
  }
  const rand = lcg(42);
  const iu = new Float64Array(users.size);
  const inn = new Float64Array(notes.size);
  const fu = Float64Array.from({ length: users.size }, () => rand() * 0.2);
  const fn = Float64Array.from({ length: notes.size }, () => rand() * 0.2);
  let mu = ratings.reduce((s, r) => s + r.value, 0) / Math.max(1, ratings.length);
  const data = ratings.map((r) => [users.get(r.raterId)!, notes.get(r.noteId)!, r.value] as const);

  // Full-batch gradient descent: deterministic, and fast enough for the volumes an early network produces.
  // At scale this moves to a batch job (the reference implementation uses PyTorch).
  const n = Math.max(1, data.length);
  for (let epoch = 0; epoch < p.epochs; epoch++) {
    const gIu = new Float64Array(users.size);
    const gIn = new Float64Array(notes.size);
    const gFu = new Float64Array(users.size);
    const gFn = new Float64Array(notes.size);
    let gMu = 0;
    for (const [u, k, r] of data) {
      const err = mu + iu[u]! + inn[k]! + fu[u]! * fn[k]! - r;
      gMu += err;
      gIu[u]! += err;
      gIn[k]! += err;
      gFu[u]! += err * fn[k]!;
      gFn[k]! += err * fu[u]!;
    }
    const lr = p.learningRate * 20; // gradients are averaged per rating below
    mu -= (lr * gMu) / n;
    for (let u = 0; u < users.size; u++) {
      iu[u]! -= lr * (gIu[u]! / n + p.lambdaIntercept * iu[u]! / users.size);
      fu[u]! -= lr * (gFu[u]! / n + p.lambdaFactor * fu[u]! / users.size);
    }
    for (let k = 0; k < notes.size; k++) {
      inn[k]! -= lr * (gIn[k]! / n + p.lambdaIntercept * inn[k]! / notes.size);
      fn[k]! -= lr * (gFn[k]! / n + p.lambdaFactor * fn[k]! / notes.size);
    }
  }

  const counts = new Map<string, number>();
  for (const r of ratings) counts.set(r.noteId, (counts.get(r.noteId) ?? 0) + 1);
  return [...notes.entries()].map(([noteId, k]) => {
    const intercept = inn[k]!;
    const factor = fn[k]!;
    const ratingsN = counts.get(noteId) ?? 0;
    let status: NoteScore["status"] = "needs_ratings";
    if (ratingsN >= p.minRatings) {
      if (intercept >= p.helpfulIntercept && Math.abs(factor) < p.maxHelpfulFactor) status = "helpful";
      else if (intercept <= p.notHelpfulIntercept - p.notHelpfulFactorSlope * Math.abs(factor)) status = "not_helpful";
    }
    return { noteId, intercept, factor, ratings: ratingsN, status };
  });
}
