// Push notifications. Actions write to push_outbox in their own transaction (services/notify.ts, message send);
// this worker claims those rows, turns them into lock-screen text and sends them through Expo's push service,
// which forwards to APNs (iOS) and FCM (Android).
//
// Delivery is at most once: rows are deleted when claimed, so a crash mid-send loses a push rather than
// sending it twice. Several API servers can run the worker at once (FOR UPDATE SKIP LOCKED).

import { DEFAULT_PUSH_PREFS, type NotificationType, type PushPrefs } from "@projectfeed/shared";
import type { Db } from "../db";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Opened in the app when the notification is tapped. */
  data: { url: string };
  badge: number;
  sound: "default";
  /** Android notification channel, created by the app. */
  channelId: "default";
}

export type PushTicket = { status: "ok"; id: string } | { status: "error"; message: string; details?: { error?: string } };
export type PushReceipt = { status: "ok" } | { status: "error"; message: string; details?: { error?: string } };

export interface PushSender {
  /** One ticket per message, in order. */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>>;
}

const EXPO_PUSH = "https://exp.host/--/api/v2/push";

/** Expo's push service. EXPO_ACCESS_TOKEN is needed only if "enhanced push security" is on for the project. */
export class ExpoPushSender implements PushSender {
  constructor(private accessToken = process.env.EXPO_ACCESS_TOKEN) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${EXPO_PUSH}/${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Expo push ${path} failed: ${res.status} ${await res.text()}`);
    return ((await res.json()) as { data: T }).data;
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const out: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += 100) out.push(...(await this.post<PushTicket[]>("send", messages.slice(i, i + 100))));
    return out;
  }

  async receipts(ticketIds: string[]): Promise<Record<string, PushReceipt>> {
    const out: Record<string, PushReceipt> = {};
    for (let i = 0; i < ticketIds.length; i += 1000) Object.assign(out, await this.post("getReceipts", { ids: ticketIds.slice(i, i + 1000) }));
    return out;
  }
}

/** Keeps what would have been sent; used by tests. */
export class RecordingPushSender implements PushSender {
  sent: PushMessage[] = [];
  /** Tokens that should come back as uninstalled. */
  gone = new Set<string>();
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map((m, i) =>
      this.gone.has(m.to)
        ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
        : { status: "ok", id: `ticket-${this.sent.length}-${i}` },
    );
  }
  async receipts(ids: string[]): Promise<Record<string, PushReceipt>> {
    return Object.fromEntries(ids.map((id) => [id, { status: "ok" } as PushReceipt]));
  }
}

export function createPushSender(): PushSender | null {
  const provider = process.env.PUSH_PROVIDER ?? "expo";
  if (provider === "off") return null;
  if (provider === "expo") return new ExpoPushSender();
  throw new Error(`Unknown PUSH_PROVIDER: ${provider}`);
}

export function pushPrefs(stored: unknown): PushPrefs {
  return { ...DEFAULT_PUSH_PREFS, ...((stored ?? {}) as Partial<PushPrefs>) };
}

const PREF_FOR: Record<NotificationType, keyof PushPrefs | null> = {
  like: "likes",
  repost: "reposts",
  reply: "replies",
  mention: "mentions",
  quote: "quotes",
  follow: "follows",
  follow_request: "follows",
  poll_ended: null,
};

/** At most one push per window for things that can repeat (many likes on one post, follow/unfollow loops). */
const THROTTLE_MS = 10 * 60_000;

const excerpt = (text: string, max = 140) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

interface OutboxRow {
  id: string;
  user_id: string;
  notification_id: string | null;
  message_id: string | null;
}

interface Draft {
  userId: string;
  title: string;
  body: string;
  url: string;
  /** Repeat-suppression key, if this kind of push is throttled. */
  throttle: string | null;
}

export class PushWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private lastReceiptCheck = Date.now();

  constructor(
    private db: Db,
    private sender: PushSender | null,
    private opts: { pollMs?: number; settleMs?: number; receiptAfterMs?: number } = {},
  ) {}

  private get settleMs() {
    return this.opts.settleMs ?? Number(process.env.PUSH_SETTLE_MS ?? 1500);
  }

  /** Starts polling the outbox. pollMs 0 leaves it to explicit flush() calls (tests). */
  start(): void {
    const pollMs = this.opts.pollMs ?? Number(process.env.PUSH_POLL_MS ?? 2000);
    if (!this.sender || pollMs <= 0 || this.timer) return;
    const tick = () => {
      this.running = this.flush()
        .catch((e) => console.error("push delivery failed", e))
        .finally(() => {
          if (this.timer) {
            this.timer = setTimeout(tick, pollMs);
            this.timer.unref();
          }
        });
    };
    this.timer = setTimeout(tick, pollMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  /** Sends everything in the outbox that has settled. Returns how many pushes went out. */
  async flush(): Promise<number> {
    if (!this.sender) {
      await this.db`DELETE FROM push_outbox`;
      return 0;
    }
    let sent = 0;
    for (;;) {
      const rows = await this.db<OutboxRow[]>`
        DELETE FROM push_outbox WHERE id IN (
          SELECT id FROM push_outbox WHERE created_at <= now() - make_interval(secs => ${this.settleMs / 1000})
          ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED)
        RETURNING id, user_id, notification_id, message_id`;
      if (rows.length === 0) break;
      sent += await this.deliver(rows);
      if (rows.length < 500) break;
    }
    const receiptAfter = this.opts.receiptAfterMs ?? 15 * 60_000;
    if (Date.now() - this.lastReceiptCheck >= Math.min(receiptAfter, 5 * 60_000)) {
      this.lastReceiptCheck = Date.now();
      await this.checkReceipts(receiptAfter);
    }
    return sent;
  }

  private async deliver(rows: OutboxRow[]): Promise<number> {
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const users = await this.db<{ id: string; status: string; push_prefs: unknown }[]>`
      SELECT id, status, push_prefs FROM users WHERE id = ANY(${userIds}::bigint[])`;
    const prefsOf = new Map(users.filter((u) => u.status === "active").map((u) => [u.id, pushPrefs(u.push_prefs)]));

    const drafts = [
      ...(await this.notificationDrafts(rows.filter((r) => r.notification_id), prefsOf)),
      ...(await this.messageDrafts(rows.filter((r) => r.message_id), prefsOf)),
    ];
    const kept: Draft[] = [];
    for (const d of drafts) {
      if (d.throttle) {
        // Claims the key only if it is free or old; otherwise this push is a repeat.
        const [ok] = await this.db`
          INSERT INTO push_throttle (user_id, key, at) VALUES (${d.userId}, ${d.throttle}, now())
          ON CONFLICT (user_id, key) DO UPDATE SET at = now()
            WHERE push_throttle.at < now() - make_interval(secs => ${THROTTLE_MS / 1000})
          RETURNING 1`;
        if (!ok) continue;
      }
      kept.push(d);
    }
    if (kept.length === 0) return 0;

    const recipients = [...new Set(kept.map((d) => d.userId))];
    const [tokens, badges] = await Promise.all([
      this.db<{ token: string; user_id: string }[]>`SELECT token, user_id FROM push_tokens WHERE user_id = ANY(${recipients}::bigint[])`,
      this.badges(recipients),
    ]);
    const messages: PushMessage[] = [];
    for (const d of kept) {
      for (const t of tokens.filter((t) => t.user_id === d.userId)) {
        messages.push({
          to: t.token,
          title: d.title,
          body: d.body,
          data: { url: d.url },
          badge: badges.get(d.userId) ?? 0,
          sound: "default",
          channelId: "default",
        });
      }
    }
    if (messages.length === 0) return 0;
    const tickets = await this.sender!.send(messages);
    await this.handleTickets(messages, tickets);
    return messages.length;
  }

  private async notificationDrafts(rows: OutboxRow[], prefsOf: Map<string, PushPrefs>): Promise<Draft[]> {
    if (rows.length === 0) return [];
    // Notifications undone before delivery (unlike, unfollow) are gone and are skipped by the join.
    const ns = await this.db<
      { id: string; user_id: string; type: NotificationType; post_id: string | null; post_kind: string | null; text: string | null; title: string | null; name: string; handle: string }[]
    >`
      SELECT n.id, n.user_id, n.type, n.post_id, p.kind AS post_kind, p.text, p.title, a.display_name AS name, a.handle::text
      FROM notifications n JOIN users a ON a.id = n.actor_id AND a.status = 'active'
      LEFT JOIN posts p ON p.id = n.post_id AND p.deleted_at IS NULL AND p.removed_at IS NULL
      WHERE n.id = ANY(${rows.map((r) => r.notification_id!)}::bigint[]) AND n.read_at IS NULL`;
    const out: Draft[] = [];
    for (const n of ns) {
      const prefs = prefsOf.get(n.user_id);
      const pref = PREF_FOR[n.type];
      if (!prefs?.enabled || (pref && !prefs[pref])) continue;
      if (n.post_id && n.post_kind === null) continue; // the post was deleted or removed meanwhile
      const postUrl = n.post_id ? (n.post_kind === "note" ? `/note/${n.post_id}` : `/post/${n.post_id}`) : `/user/${n.handle}`;
      const snippet = excerpt(n.title || n.text || "");
      const d = (title: string, body: string, url = postUrl, throttle: string | null = null) =>
        out.push({ userId: n.user_id, title, body, url, throttle });
      switch (n.type) {
        case "like":
          d(`${n.name} liked your post`, snippet || "Tap to see it", postUrl, `like:${n.post_id}`);
          break;
        case "repost":
          d(`${n.name} reposted your post`, snippet || "Tap to see it", postUrl, `repost:${n.post_id}`);
          break;
        case "reply":
          d(`${n.name} replied`, snippet || "Tap to see the reply");
          break;
        case "mention":
          d(`${n.name} mentioned you`, snippet || "Tap to see the post");
          break;
        case "quote":
          d(`${n.name} quoted your post`, snippet || "Tap to see it");
          break;
        case "follow":
          d(`${n.name} followed you`, `@${n.handle}`, `/user/${n.handle}`, `follow:${n.handle}`);
          break;
        case "follow_request":
          d(`${n.name} wants to follow you`, "Review the request", "/follow-requests", `follow:${n.handle}`);
          break;
        case "poll_ended":
          d("Your poll has ended", snippet || "See the results");
          break;
      }
    }
    return out;
  }

  private async messageDrafts(rows: OutboxRow[], prefsOf: Map<string, PushPrefs>): Promise<Draft[]> {
    if (rows.length === 0) return [];
    const ms = await this.db<
      { recipient: string; conversation_id: string; text: string; has_media: boolean; shared: boolean; is_group: boolean; conv_title: string | null; member_status: string; name: string }[]
    >`
      SELECT o.user_id AS recipient, m.conversation_id, m.text, m.shared_post_id IS NOT NULL AS shared,
             EXISTS (SELECT 1 FROM message_media mm WHERE mm.message_id = m.id) AS has_media,
             c.is_group, c.title AS conv_title, cm.status AS member_status, s.display_name AS name
      FROM unnest(${rows.map((r) => r.user_id)}::bigint[], ${rows.map((r) => r.message_id!)}::bigint[]) AS o(user_id, message_id)
      JOIN messages m ON m.id = o.message_id AND m.deleted_at IS NULL
      JOIN conversations c ON c.id = m.conversation_id
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = o.user_id AND cm.status <> 'left'
      JOIN users s ON s.id = m.sender_id AND s.status = 'active'
      WHERE m.id > cm.last_read_id
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = o.user_id AND b.blocked_id = m.sender_id)
        AND NOT EXISTS (SELECT 1 FROM mutes x WHERE x.muter_id = o.user_id AND x.muted_id = m.sender_id)`;
    const out: Draft[] = [];
    for (const m of ms) {
      const prefs = prefsOf.get(m.recipient);
      if (!prefs?.enabled || !prefs.messages) continue;
      const url = `/conversation/${m.conversation_id}`;
      if (m.member_status === "request") {
        // Requests come from people you don't follow: no preview, and one push per conversation per window.
        out.push({ userId: m.recipient, title: "New message request", body: `${m.name} wants to send you a message`, url, throttle: `dmreq:${m.conversation_id}` });
        continue;
      }
      const title = m.is_group ? `${m.name} in ${m.conv_title || "your group"}` : m.name;
      const preview = m.text ? excerpt(m.text) : m.has_media ? "Sent a photo or video" : m.shared ? "Shared a post" : "Sent a message";
      out.push({ userId: m.recipient, title, body: prefs.messagePreviews ? preview : "Sent you a message", url, throttle: null });
    }
    return out;
  }

  /** The app icon badge: unread notifications plus conversations with unread messages. */
  private async badges(userIds: string[]): Promise<Map<string, number>> {
    const rows = await this.db<{ user_id: string; n: number }[]>`
      SELECT u.id AS user_id,
        (SELECT count(*) FROM notifications n WHERE n.user_id = u.id AND n.read_at IS NULL)::int +
        (SELECT count(DISTINCT cm.conversation_id) FROM conversation_members cm JOIN messages m ON m.conversation_id = cm.conversation_id
         WHERE cm.user_id = u.id AND cm.status = 'accepted' AND m.id > cm.last_read_id AND m.sender_id <> u.id AND m.deleted_at IS NULL)::int AS n
      FROM users u WHERE u.id = ANY(${userIds}::bigint[])`;
    return new Map(rows.map((r) => [r.user_id, r.n]));
  }

  private async handleTickets(messages: PushMessage[], tickets: PushTicket[]): Promise<void> {
    const gone: string[] = [];
    const receipts: { id: string; token: string }[] = [];
    tickets.forEach((t, i) => {
      const token = messages[i]!.to;
      if (t.status === "ok") receipts.push({ id: t.id, token });
      else if (t.details?.error === "DeviceNotRegistered") gone.push(token);
      else console.error("push rejected", t.message);
    });
    if (gone.length) await this.db`DELETE FROM push_tokens WHERE token = ANY(${gone})`;
    if (receipts.length) {
      await this.db`INSERT INTO push_receipts (ticket_id, token)
                    SELECT * FROM unnest(${receipts.map((r) => r.id)}::text[], ${receipts.map((r) => r.token)}::text[])
                    ON CONFLICT DO NOTHING`;
    }
  }

  /** Expo reports delivery failures (uninstalled app, bad credentials) some minutes after accepting a push. */
  async checkReceipts(olderThanMs: number): Promise<void> {
    if (!this.sender) return;
    const rows = await this.db<{ ticket_id: string; token: string }[]>`
      SELECT ticket_id, token FROM push_receipts WHERE created_at <= now() - make_interval(secs => ${olderThanMs / 1000})
      ORDER BY created_at LIMIT 1000`;
    if (rows.length === 0) return;
    const result = await this.sender.receipts(rows.map((r) => r.ticket_id));
    const gone = rows.filter((r) => {
      const rec = result[r.ticket_id];
      if (rec?.status === "error" && rec.details?.error !== "DeviceNotRegistered") console.error("push failed", rec.message);
      return rec?.status === "error" && rec.details?.error === "DeviceNotRegistered";
    });
    if (gone.length) await this.db`DELETE FROM push_tokens WHERE token = ANY(${gone.map((g) => g.token)})`;
    // Receipts are kept by Expo for about a day; anything we could not read by then is dropped.
    await this.db`DELETE FROM push_receipts WHERE ticket_id = ANY(${rows.map((r) => r.ticket_id)}) OR created_at < now() - interval '1 day'`;
  }
}
