// Community Notes persistence: runs the bridging scorer over all ratings and stores each note's status.

import type { Db } from "../db";
import { scoreNotes } from "./notes-scorer";
import { refreshTrust } from "./trust";

/** Re-score every note. Cheap at early-network volumes; becomes a scheduled batch job at scale. */
export async function rescoreNotes(db: Db): Promise<{ scored: number; changed: number }> {
  const ratings = await db<{ noteId: string; raterId: string; value: number }[]>`
    SELECT note_id AS "noteId", rater_id AS "raterId", helpful AS value FROM note_ratings`;
  const scores = scoreNotes(ratings);
  let changed = 0;
  for (const s of scores) {
    const [r] = await db<{ status: string; author_id: string; classification: string }[]>`
      UPDATE community_notes n SET intercept = ${s.intercept}, factor = ${s.factor}, rating_count = ${s.ratings},
        status = ${s.status},
        status_changed_at = CASE WHEN n.status <> ${s.status} THEN now() ELSE n.status_changed_at END
      FROM community_notes old JOIN posts p ON p.id = old.post_id
      WHERE n.id = ${s.noteId} AND old.id = n.id
      RETURNING old.status, p.author_id, n.classification`;
    if (r && r.status !== s.status) {
      changed++;
      // A misleading-post note going live (or coming down) affects the post author's trust score.
      if (r.classification === "misleading") await refreshTrust(db, r.author_id);
    }
  }
  return { scored: scores.length, changed };
}

/** Coalesces bursts of ratings into one re-score shortly after. */
export class NotesScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> = Promise.resolve();
  constructor(
    private db: Db,
    private delayMs = Number(process.env.NOTES_RESCORE_DELAY_MS ?? 5000),
  ) {}
  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.running = rescoreNotes(this.db).catch((e) => console.error("note scoring failed", e));
    }, this.delayMs);
    this.timer.unref();
  }
  async idle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.running;
  }
}
