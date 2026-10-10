import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type AdminPost, type Author, type HistoryItem, type Me, type Meta, type Perm, type Preview } from "./api";

// ── Session context ──

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext)!;
export const useCan = () => {
  const me = useMe();
  return (p: Perm) => me.permissions.includes(p);
};

export const ROLE_LABEL: Record<string, string> = {
  support: "Support",
  moderator: "Moderator",
  senior_moderator: "Senior moderator",
  compliance: "Compliance",
  admin: "Admin",
};

export const human = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export const fullDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

// ── Toast ──

let pushToast: (m: string) => void = () => {};
export const toast = (m: string) => pushToast(m);
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    pushToast = (m) => {
      setMsg(m);
      setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3500);
    };
  }, []);
  return msg ? <div className="toast">{msg}</div> : null;
}

// ── Small pieces ──

export function Avatar({ a, size = 32 }: { a: Pick<Author, "avatarUrl" | "displayName"> | null; size?: number }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {a?.avatarUrl ? <img src={a.avatarUrl} alt="" /> : (a?.displayName ?? "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls = status === "active" ? "green" : status === "suspended" ? "gold" : status === "frozen" ? "blue" : "red";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function AuthorChip({ a, sub }: { a: Author | null; sub?: ReactNode }) {
  if (!a) return <span className="muted">Unknown account</span>;
  return (
    <div className="author">
      <Avatar a={a} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <a href={`#/users/${a.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>
            {a.displayName}
          </a>
          {a.isProtected ? <span className="badge violet">🔒 protected</span> : null}
          {a.status !== "active" ? <StatusBadge status={a.status} /> : null}
        </div>
        <div className="muted small ellipsis">
          @{a.handle}
          {sub ? <> · {sub}</> : null}
        </div>
      </div>
    </div>
  );
}

export function Prio({ p }: { p: number }) {
  return <span className={`prio prio-${Math.min(p, 3)}`}>P{p}</span>;
}

export function PostFlags({ f }: { f: AdminPost["flags"] }) {
  return (
    <>
      {f.removed ? <span className="badge red">removed</span> : null}
      {f.deleted ? <span className="badge">deleted by user</span> : null}
      {f.sensitive ? <span className="badge gold">sensitive</span> : null}
      {f.limited ? <span className="badge blue">reach limited</span> : null}
    </>
  );
}

export function PostView({ post, compact }: { post: AdminPost; compact?: boolean }) {
  return (
    <div className="post">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <AuthorChip a={post.author} sub={<span title={fullDate(post.createdAt)}>{when(post.createdAt)}</span>} />
        <div className="row" style={{ gap: 6 }}>
          <PostFlags f={post.flags} />
          {post.openReports > 0 ? <span className="badge red">{post.openReports} open reports</span> : null}
        </div>
      </div>
      {post.replyToId ? <div className="faint small">Reply to post {post.replyToId}</div> : null}
      {post.text ? <div className="post-text" style={compact ? { maxHeight: 120, overflow: "hidden" } : undefined}>{post.text}</div> : <div className="faint small">No text</div>}
      {post.media.length > 0 ? (
        <div className="media-row">
          {post.media.map((m) =>
            m.type === "video" ? (
              <video key={m.id} src={m.url} poster={m.thumbUrl} controls preload="none" muted />
            ) : (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer noopener">
                <img src={m.thumbUrl} alt={m.altText || "Image"} loading="lazy" />
              </a>
            ),
          )}
        </div>
      ) : null}
      <div className="faint small mono">
        ♥ {post.counts.likes} · ↩ {post.counts.replies} · ⇄ {post.counts.reposts} · 👁 {post.counts.views} · id {post.id}
      </div>
    </div>
  );
}

// ── Reveal (logged access) ──

export function RevealModal({ title, body, onClose, onConfirm, pending, error }: { title: string; body: ReactNode; onClose: () => void; onConfirm: (justification: string) => void; pending?: boolean; error?: string | null }) {
  const [j, setJ] = useState("");
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{title}</h3>
        <div className="notice">⚠ {body}</div>
        <div className="field">
          <label>Justification (recorded in the access log)</label>
          <textarea className="textarea" value={j} onChange={(e) => setJ(e.target.value)} placeholder="e.g. Reviewing report for harassment; need to see the reported content." autoFocus />
          <span className="faint small">{j.trim().length}/15 characters minimum</span>
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={j.trim().length < 15 || pending} onClick={() => onConfirm(j.trim())}>
            {pending ? "Opening…" : "Open and log access"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Report target, with restricted content gated behind a logged reveal. */
export function TargetView({ preview, reportId }: { preview: Preview; reportId: string }) {
  const can = useCan();
  const [modal, setModal] = useState(false);
  const reveal = useMutation({
    mutationFn: (justification: string) => api(`/reports/${reportId}/reveal`, { method: "POST", body: { justification } }),
    onSuccess: () => setModal(false),
  });
  useEffect(() => reveal.reset(), [reportId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (preview.kind === "missing") return <div className="empty">The reported item no longer exists.</div>;
  if (preview.kind === "user") {
    const u = preview.user;
    return (
      <div className="post">
        <AuthorChip a={u} />
        <div className="row small muted">
          <span>Joined {when(u.createdAt)}</span>·<span>{u.followers} followers</span>·<span>KYC level {u.kycLevel}</span>·<span>{u.strikes} strikes</span>
        </div>
      </div>
    );
  }
  if ("post" in preview) return <PostView post={preview.post} />;

  if (reveal.data) {
    const d = reveal.data as { kind: string; post?: AdminPost; messages?: { id: string; sender: Author | null; text: string; createdAt: string; deleted: boolean; media: { type: string; url: string; thumbUrl: string }[] }[]; reportedMessageId?: string };
    if (d.post) {
      return (
        <div className="grid">
          <div className="notice blue">🔓 Protected post opened — this view was logged.</div>
          <PostView post={d.post} />
        </div>
      );
    }
    return (
      <div className="grid">
        <div className="notice blue">🔓 DM evidence opened — this view was logged. Only the reported message and the messages before it are shown.</div>
        <div className="grid" style={{ gap: 4 }}>
          {d.messages!.map((m) => (
            <div key={m.id} className={`dm ${m.id === d.reportedMessageId ? "reported" : ""}`}>
              <div className="small muted">
                <b style={{ color: "var(--text)" }}>@{m.sender?.handle ?? "unknown"}</b> · {fullDate(m.createdAt)}
                {m.id === d.reportedMessageId ? <span className="badge red" style={{ marginLeft: 8 }}>reported</span> : null}
              </div>
              <div className="post-text">{m.deleted ? <i className="faint">deleted by sender</i> : m.text}</div>
              {m.media.length ? (
                <div className="media-row" style={{ marginTop: 6 }}>
                  {m.media.map((x, i) => (
                    <img key={i} src={x.thumbUrl} alt="" />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const spec =
    preview.kind === "post"
      ? { icon: "🔒", title: "Protected account post", who: preview.author, perm: "viewProtected" as Perm, need: "Senior moderator", what: "This account's posts are private to approved followers. Opening the reported post is logged with your justification." }
      : preview.kind === "message"
        ? { icon: "✉", title: "Direct message", who: preview.sender, perm: "viewDms" as Perm, need: "Compliance", what: "DMs are private. You will see only the reported message and the few messages before it that the reporter could already see. This is logged." }
        : { icon: "⛔", title: `Quarantined ${preview.mediaType} — hash match`, who: preview.owner, perm: "quarantine" as Perm, need: "Compliance", what: "The file was blocked before storage and is never displayed. Handle it from the Quarantine page." };
  const allowed = can(spec.perm);
  return (
    <div className="restricted">
      <div className="title">
        {spec.icon} {spec.title}
      </div>
      <AuthorChip a={spec.who} />
      <div className="muted small">{spec.what}</div>
      {preview.kind === "media" ? (
        allowed ? <a className="btn sm" href="#/quarantine">Open quarantine</a> : <span className="badge">Requires {spec.need}</span>
      ) : allowed ? (
        <button className="btn sm primary" onClick={() => setModal(true)}>
          Open with justification
        </button>
      ) : (
        <span className="badge">Requires {spec.need}</span>
      )}
      {modal ? (
        <RevealModal
          title={`Open ${spec.title.toLowerCase()}`}
          body={spec.what}
          pending={reveal.isPending}
          error={reveal.error ? (reveal.error as Error).message : null}
          onClose={() => setModal(false)}
          onConfirm={(j) => reveal.mutate(j)}
        />
      ) : null}
    </div>
  );
}

// ── Actions ──

const POST_ACTIONS = ["remove_post", "restore_post", "label_sensitive", "unlabel_sensitive", "limit_reach", "unlimit_reach"];
const USER_ACTIONS = ["warn", "suspend", "unsuspend", "ban", "unban", "freeze", "unfreeze"];
const ACTION_PERM: Record<string, Perm> = { ban: "ban", unban: "ban", freeze: "freeze", unfreeze: "freeze" };

const TEMPLATES: Record<string, string> = {
  remove_post: "We removed your post because it breaks our rules on {reason}.",
  label_sensitive: "We've placed your media behind a sensitive-content warning under our rules on {reason}.",
  limit_reach: "We've limited how widely your post is recommended under our rules on {reason}. Your followers can still see it.",
  warn: "This is a warning: your recent activity breaks our rules on {reason}. Further breaches may lead to suspension.",
  suspend: "Your account has been suspended for breaking our rules on {reason}. You can still read and browse, and you can appeal.",
  ban: "Your account has been permanently suspended for serious or repeated breaches of our rules on {reason}.",
};

/** Moderation action form: pick an action, a policy reason and write the statement of reasons the user sees. */
export function ActionPanel({
  postId: rawPostId,
  userId,
  reportId,
  defaultReason,
  protectedPost,
  onDone,
}: {
  postId?: string | null;
  userId?: string | null;
  reportId?: string;
  defaultReason?: string;
  /** The post belongs to a protected account: only roles that may view it may act on it. */
  protectedPost?: boolean;
  onDone?: () => void;
}) {
  const can = useCan();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/meta"), staleTime: Infinity });
  const postLocked = !!protectedPost && !can("viewProtected");
  const postId = postLocked ? null : rawPostId;
  const options = [...(postId ? POST_ACTIONS : []), ...(userId ? USER_ACTIONS : [])];
  const [action, setAction] = useState(options[0] ?? "warn");
  const [reason, setReason] = useState(defaultReason && defaultReason !== "other" ? defaultReason : "spam");
  const [statement, setStatement] = useState("");
  const [days, setDays] = useState<string>("3");
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    if (!edited) setStatement((TEMPLATES[action] ?? "").replace("{reason}", human(reason).toLowerCase()));
  }, [action, reason, edited]);

  const maxDays = meta.data?.moderatorMaxSuspensionDays ?? 7;
  const durationDays = days === "indefinite" ? null : Number(days);
  const needed: Perm = ACTION_PERM[action] ?? (action === "suspend" && (durationDays == null || durationDays > maxDays) ? "suspendLong" : "act");
  const allowed = can(needed);

  const run = useMutation({
    mutationFn: () =>
      api("/actions", {
        method: "POST",
        body: {
          action,
          targetId: POST_ACTIONS.includes(action) ? postId : userId,
          reasonCode: reason,
          statement,
          reportId,
          ...(action === "suspend" ? { durationDays } : {}),
        },
      }),
    onSuccess: () => {
      toast(`${human(action)} applied`);
      setEdited(false);
      void qc.invalidateQueries();
      onDone?.();
    },
  });

  if (!can("act")) return <div className="notice blue">Your role can review but not take action.</div>;
  if (options.length === 0) return null;
  return (
    <div className="grid" style={{ gap: 12 }}>
      {postLocked ? <div className="notice">Post actions on a protected account need a senior moderator. Account-level actions are available below.</div> : null}
      <div className="row" style={{ gap: 10, alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 1, minWidth: 170 }}>
          <label>Action</label>
          <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
            {postId ? (
              <optgroup label="Post">
                {POST_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {human(a)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {userId ? (
              <optgroup label="Account">
                {USER_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {human(a)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 170 }}>
          <label>Policy reason</label>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {(meta.data?.reasons ?? ["spam"]).map((r) => (
              <option key={r} value={r}>
                {human(r)}
              </option>
            ))}
          </select>
        </div>
        {action === "suspend" ? (
          <div className="field" style={{ width: 150 }}>
            <label>Duration</label>
            <select className="select" value={days} onChange={(e) => setDays(e.target.value)}>
              {["1", "3", "7", "14", "30", "90", "indefinite"].map((d) => (
                <option key={d} value={d}>
                  {d === "indefinite" ? "Indefinite" : `${d} days`}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label>Statement of reasons (sent to the user)</label>
        <textarea
          className="textarea"
          value={statement}
          onChange={(e) => {
            setEdited(true);
            setStatement(e.target.value);
          }}
        />
      </div>
      {!allowed ? <div className="notice">This needs the {needed === "suspendLong" ? `senior moderator role (suspensions over ${maxDays} days)` : `${human(needed)} permission`}.</div> : null}
      {run.error ? <div className="error">{(run.error as Error).message}</div> : null}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className={`btn ${["ban", "suspend", "remove_post", "freeze"].includes(action) ? "danger" : "primary"}`} disabled={!allowed || statement.trim().length < 10 || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Applying…" : `Apply: ${human(action)}`}
        </button>
      </div>
    </div>
  );
}

export function History({ items }: { items: HistoryItem[] }) {
  if (items.length === 0) return <div className="muted small">No previous moderation actions.</div>;
  return (
    <div className="timeline">
      {items.map((h) => (
        <div key={h.id} className="timeline-item">
          <div className="timeline-dot" style={{ background: h.action.startsWith("un") || h.action === "restore_post" ? "var(--green)" : undefined }} />
          <div>
            <div className="row" style={{ gap: 6 }}>
              <b>{human(h.action)}</b>
              <span className="badge">{human(h.reasonCode)}</span>
              {h.appealStatus ? <span className={`badge ${h.appealStatus === "overturned" ? "green" : h.appealStatus === "open" ? "gold" : ""}`}>appeal {h.appealStatus}</span> : null}
            </div>
            <div className="muted small">
              {h.staff} · {fullDate(h.createdAt)}
              {h.expiresAt ? ` · until ${fullDate(h.expiresAt)}` : ""}
            </div>
            {h.statement ? <div className="small" style={{ marginTop: 2 }}>{h.statement}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
