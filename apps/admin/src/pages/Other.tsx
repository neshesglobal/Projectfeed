import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, qs, type AdminPost, type Author, type HistoryItem, type Role } from "../api";
import { ActionPanel, AuthorChip, History, PostView, ROLE_LABEL, RevealModal, StatusBadge, fullDate, human, toast, useCan, when } from "../components";

// ───────────────────────────── Dashboard ─────────────────────────────

export function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<{ counts: Record<string, number | null>; openByReason: { reason: string; n: number }[] }>("/dashboard"), refetchInterval: 30_000 });
  const c = q.data?.counts ?? {};
  const kpi = (label: string, v: number | null | undefined, tone = "", href?: string) => (
    <a className={`panel kpi ${tone}`} href={href} style={{ color: "inherit", textDecoration: "none" }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{v == null ? "—" : v.toLocaleString("en-GB")}</div>
    </a>
  );
  const max = Math.max(1, ...(q.data?.openByReason.map((r) => r.n) ?? []));
  return (
    <div className="page grid" style={{ gap: 18 }}>
      <div className="grid kpis">
        {kpi("Urgent reports (P0–P1)", c.urgentReports, (c.urgentReports ?? 0) > 0 ? "alert" : "", "#/reports")}
        {kpi("Open reports", c.openReports, "gold", "#/reports")}
        {kpi("Open appeals", c.openAppeals, "", "#/appeals")}
        {kpi("Quarantined uploads", c.quarantined, (c.quarantined ?? 0) > 0 ? "alert" : "", "#/quarantine")}
        {kpi("Actions (24h)", c.actions24h)}
        {kpi("Suspended accounts", c.suspended, "", "#/users?status=suspended")}
        {kpi("Frozen accounts", c.frozen, "", "#/users?status=frozen")}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <div className="panel">
          <div className="panel-head">
            <h2>Open reports by reason</h2>
          </div>
          <div className="panel-body grid" style={{ gap: 10 }}>
            {q.data?.openByReason.length === 0 ? <div className="muted">No open reports.</div> : null}
            {q.data?.openByReason.map((r) => (
              <div key={r.reason} className="grid" style={{ gridTemplateColumns: "140px 1fr 40px", alignItems: "center", gap: 10 }}>
                <span className="small">{human(r.reason)}</span>
                <div style={{ height: 8, borderRadius: 4, background: "var(--raised)" }}>
                  <div style={{ width: `${(r.n / max) * 100}%`, height: "100%", borderRadius: 4, background: ["child_safety", "terrorism", "self_harm"].includes(r.reason) ? "var(--red)" : "var(--gold)" }} />
                </div>
                <span className="mono small" style={{ textAlign: "right" }}>
                  {r.n}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Platform activity (24h)</h2>
          </div>
          <div className="panel-body grid kpis">
            <div>
              <div className="kpi-label">Posts</div>
              <div className="kpi-value">{c.posts24h ?? "—"}</div>
            </div>
            <div>
              <div className="kpi-label">Uploads</div>
              <div className="kpi-value">{c.uploads24h ?? "—"}</div>
            </div>
            <div>
              <div className="kpi-label">Sign-ups</div>
              <div className="kpi-value">{c.signups24h ?? "—"}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="notice blue">
        ⓘ Service levels: P0 (hash match) and P1 (child safety, terrorism, self-harm) within 1 hour; P2 within 4 hours; P3 within 24 hours.
      </div>
    </div>
  );
}

// ───────────────────────────── Content ─────────────────────────────

export function Content() {
  const [tab, setTab] = useState<"posts" | "media">("media");
  const [form, setForm] = useState({ q: "", handle: "", tag: "", media: "", state: "", from: "", to: "" });
  const [applied, setApplied] = useState(form);
  const [mediaType, setMediaType] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const posts = useQuery({ queryKey: ["content", applied], enabled: tab === "posts", queryFn: () => api<{ items: AdminPost[] }>(`/content/posts${qs({ ...applied, limit: "50" })}`) });
  const media = useQuery({
    queryKey: ["content-media", mediaType],
    enabled: tab === "media",
    queryFn: () => api<{ items: { id: string; type: string; thumbUrl: string; url: string; createdAt: string; postId: string; owner: Author | null; durationMs: number | null; flags: { sensitive: boolean; removed: boolean } }[] }>(`/content/media${qs({ type: mediaType, limit: "60" })}`),
  });
  const focused = useQuery({ queryKey: ["content-post", focus], enabled: !!focus, queryFn: () => api<AdminPost>(`/content/posts/${focus}`) });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTab("posts");
    setApplied(form);
  };

  return (
    <div className="page">
      <div className="notice blue" style={{ marginBottom: 14 }}>
        ⓘ Public content only. Protected accounts and DMs are excluded from browsing; they are reachable only through a report, by authorised roles, with logged access.
      </div>
      <form className="toolbar" onSubmit={submit}>
        <input className="input" placeholder="Keywords" value={form.q} onChange={set("q")} style={{ minWidth: 200 }} />
        <input className="input" placeholder="@handle" value={form.handle} onChange={set("handle")} />
        <input className="input" placeholder="#hashtag" value={form.tag} onChange={set("tag")} />
        <select className="select" value={form.state} onChange={set("state")}>
          <option value="">Any state</option>
          <option value="reported">Reported</option>
          <option value="removed">Removed</option>
          <option value="sensitive">Sensitive</option>
          <option value="limited">Reach limited</option>
        </select>
        <select className="select" value={form.media} onChange={set("media")}>
          <option value="">Text and media</option>
          <option value="1">With media</option>
        </select>
        <input className="input" type="date" value={form.from} onChange={set("from")} title="From" />
        <input className="input" type="date" value={form.to} onChange={set("to")} title="To" />
        <button className="btn primary" type="submit">
          Search posts
        </button>
      </form>
      <div className="toolbar">
        <button className={`btn sm ${tab === "media" ? "primary" : ""}`} onClick={() => setTab("media")}>
          Latest uploads
        </button>
        <button className={`btn sm ${tab === "posts" ? "primary" : ""}`} onClick={() => setTab("posts")}>
          Post results
        </button>
        {tab === "media" ? (
          <select className="select" value={mediaType} onChange={(e) => setMediaType(e.target.value)}>
            <option value="">All media</option>
            <option value="image">Photos</option>
            <option value="video">Videos & reels</option>
            <option value="gif">GIFs</option>
          </select>
        ) : null}
      </div>

      {tab === "media" ? (
        <div className="split" style={{ gridTemplateColumns: "minmax(420px, 1.5fr) minmax(420px, 1fr)" }}>
          <div className="media-grid">
            {media.data?.items.length === 0 ? <div className="empty">No uploads yet.</div> : null}
            {media.data?.items.map((m) => (
              <div key={m.id} className={`media-tile ${m.flags.sensitive ? "blurred" : ""}`} onClick={() => setFocus(m.postId)} style={focus === m.postId ? { outline: "2px solid var(--gold)" } : undefined}>
                <img src={m.thumbUrl} alt="" loading="lazy" />
                <span className="type badge">{m.type}{m.durationMs ? ` · ${Math.round(m.durationMs / 1000)}s` : ""}</span>
                <div className="meta">
                  <span className="ellipsis">@{m.owner?.handle}</span>
                  <span className="faint" style={{ marginLeft: "auto" }}>{when(m.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="sticky grid">
            {focused.data ? (
              <>
                <PostView post={focused.data} />
                <div className="panel panel-body">
                  <ActionPanel key={focused.data.id} postId={focused.data.id} userId={focused.data.author.id} />
                </div>
              </>
            ) : (
              <div className="panel empty">Select an upload to review the post and act on it.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid">
          {posts.isLoading ? <div className="empty">Searching…</div> : null}
          {posts.data?.items.length === 0 ? <div className="empty">No public posts match.</div> : null}
          {posts.data?.items.map((p) => (
            <details key={p.id} className="panel">
              <summary style={{ listStyle: "none", cursor: "pointer", padding: 2 }}>
                <PostView post={p} compact />
              </summary>
              <div className="panel-body">
                <ActionPanel postId={p.id} userId={p.author.id} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Users ─────────────────────────────

type UserRow = Author & { strikes: number; createdAt: string; followers: number; kycLevel: number; suspendedUntil: string | null };

export function Users({ status: initialStatus }: { status?: string }) {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ q: "", status: initialStatus ?? "" });
  const list = useQuery({ queryKey: ["users", applied], queryFn: () => api<{ items: UserRow[] }>(`/users${qs(applied)}`) });
  return (
    <div className="page">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ ...applied, q });
        }}
      >
        <input className="input" style={{ minWidth: 280 }} placeholder="Handle or name (email search: compliance only)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" value={applied.status} onChange={(e) => setApplied({ ...applied, status: e.target.value })}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="frozen">Frozen</option>
          <option value="banned">Banned</option>
        </select>
        <button className="btn primary">Search</button>
      </form>
      {list.error ? <div className="error">{(list.error as Error).message}</div> : null}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Status</th>
              <th>Strikes</th>
              <th>Followers</th>
              <th>KYC</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => (location.hash = `#/users/${u.id}`)}>
                <td>
                  <AuthorChip a={u} />
                </td>
                <td>
                  <StatusBadge status={u.status} />
                </td>
                <td className="mono">{u.strikes}</td>
                <td className="mono">{u.followers}</td>
                <td>L{u.kycLevel}</td>
                <td className="muted small">{when(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.items.length === 0 ? <div className="empty">{applied.q || applied.status ? "No accounts found." : "Search for an account."}</div> : null}
      </div>
    </div>
  );
}

export function UserDetail({ id }: { id: string }) {
  const can = useCan();
  const u = useQuery({
    queryKey: ["user", id],
    queryFn: () =>
      api<UserRow & { bio: string; following: number; postsCount: number; reports: { open: number; total: number }; history: HistoryItem[]; recentPosts: AdminPost[] | null; postsRestricted: boolean; badge: string | null; accountType: string; countries: { id: string | null; phone: string | null; connection: string | null }; subscription: { plan: string; status: string; currentPeriodEnd: string; provider: string } | null; trust?: { score: number; band: string; factors: { label: string; points: number }[] } }>(`/users/${id}`),
  });
  const [modal, setModal] = useState(false);
  const pii = useMutation({ mutationFn: (justification: string) => api<{ email: string; kycLevel: number }>(`/users/${id}/reveal-pii`, { method: "POST", body: { justification } }), onSuccess: () => setModal(false) });
  const d = u.data;
  if (!d) return <div className="page empty">{u.error ? (u.error as Error).message : "Loading…"}</div>;
  return (
    <div className="page split">
      <div className="grid">
        <div className="panel panel-body grid">
          <AuthorChip a={d} />
          {d.bio ? <div className="post-text">{d.bio}</div> : null}
          <div className="row small muted">
            <StatusBadge status={d.status} />
            {d.suspendedUntil ? <span>until {fullDate(d.suspendedUntil)}</span> : null}
            <span>· {d.strikes} strikes</span>
            <span>· {d.followers} followers</span>
            <span>· {d.postsCount} posts</span>
            <span>· KYC L{d.kycLevel}</span>
            <span>· joined {fullDate(d.createdAt)}</span>
          </div>
          <div className="row small">
            <span className="badge red">{d.reports.open} open reports</span>
            <span className="badge">{d.reports.total} total</span>
            <span style={{ marginLeft: "auto" }} />
            {pii.data ? (
              <span className="mono">✉ {pii.data.email}</span>
            ) : can("revealPii") ? (
              <button className="btn sm" onClick={() => setModal(true)}>
                Reveal email (logged)
              </button>
            ) : (
              <span className="faint small">Email hidden · compliance only</span>
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Recent posts</h2>
          </div>
          <div className="panel-body grid">
            {d.postsRestricted ? (
              <div className="restricted">
                <div className="title">🔒 Protected account</div>
                <div className="muted small">This account's posts are private. They can be opened only through a report, by a senior moderator, with a logged justification.</div>
              </div>
            ) : d.recentPosts?.length === 0 ? (
              <div className="muted">No posts.</div>
            ) : (
              d.recentPosts?.map((p) => <PostView key={p.id} post={p} compact />)
            )}
          </div>
        </div>
      </div>
      <div className="sticky grid">
        <IdentityPanel d={d} userId={d.id} />
        <div className="panel">
          <div className="panel-head">
            <h2>Account action</h2>
          </div>
          <div className="panel-body">
            <ActionPanel userId={d.id} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>Moderation history</h2>
          </div>
          <div className="panel-body">
            <History items={d.history} />
          </div>
        </div>
      </div>
      {modal ? (
        <RevealModal
          title="Reveal personal data"
          body="Email addresses are personal data under UK GDPR. Reveal only for a legal request, law-enforcement referral or account-recovery check."
          pending={pii.isPending}
          error={pii.error ? (pii.error as Error).message : null}
          onClose={() => setModal(false)}
          onConfirm={(j) => pii.mutate(j)}
        />
      ) : null}
    </div>
  );
}

// ───────────────────────────── Appeals ─────────────────────────────

interface Appeal {
  id: string;
  text: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  user: Author | null;
  decision: { id: string; action: string; reasonCode: string; statement: string; createdAt: string; staff: string };
  post: AdminPost | null;
  canDecide: boolean;
}

function AppealCard({ a }: { a: Appeal }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "upheld" | "overturned") => api(`/appeals/${a.id}/decide`, { method: "POST", body: { decision, note } }),
    onSuccess: (_d, decision) => {
      toast(`Appeal ${decision}`);
      void qc.invalidateQueries();
    },
  });
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="badge gold">{human(a.decision.action)}</span>
        <span className="badge">{human(a.decision.reasonCode)}</span>
        <span className="faint small" style={{ marginLeft: "auto" }}>
          appealed {when(a.createdAt)}
        </span>
      </div>
      <div className="panel-body grid">
        <AuthorChip a={a.user} />
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div className="kpi-label">Original decision · {a.decision.staff}</div>
            <div className="small" style={{ marginTop: 4 }}>{a.decision.statement}</div>
          </div>
          <div>
            <div className="kpi-label">User's appeal</div>
            <div className="small" style={{ marginTop: 4 }}>“{a.text}”</div>
          </div>
        </div>
        {a.post ? <PostView post={a.post} compact /> : null}
        {a.status === "open" ? (
          a.canDecide ? (
            <>
              <textarea className="textarea" placeholder="Decision note (sent to the user)" value={note} onChange={(e) => setNote(e.target.value)} />
              {decide.error ? <div className="error">{(decide.error as Error).message}</div> : null}
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn" disabled={note.trim().length < 10 || decide.isPending} onClick={() => decide.mutate("upheld")}>
                  Uphold decision
                </button>
                <button className="btn primary" disabled={note.trim().length < 10 || decide.isPending} onClick={() => decide.mutate("overturned")}>
                  Overturn and reverse
                </button>
              </div>
            </>
          ) : (
            <div className="notice">You can't decide this appeal: it needs a senior moderator who did not make the original decision.</div>
          )
        ) : (
          <div className="small muted">
            {human(a.status)} by {a.decidedBy} {a.decidedAt ? `· ${fullDate(a.decidedAt)}` : ""} — {a.decisionNote}
          </div>
        )}
      </div>
    </div>
  );
}

export function Appeals() {
  const [status, setStatus] = useState("open");
  const q = useQuery({ queryKey: ["appeals", status], queryFn: () => api<{ items: Appeal[] }>(`/appeals?status=${status}`) });
  return (
    <div className="page">
      <div className="toolbar">
        {["open", "upheld", "overturned"].map((s) => (
          <button key={s} className={`btn sm ${status === s ? "primary" : ""}`} onClick={() => setStatus(s)}>
            {human(s)}
          </button>
        ))}
      </div>
      <div className="grid">
        {q.data?.items.length === 0 ? <div className="panel empty">No {status} appeals.</div> : null}
        {q.data?.items.map((a) => <AppealCard key={a.id} a={a} />)}
      </div>
    </div>
  );
}

// ───────────────────────────── Quarantine ─────────────────────────────

interface QItem {
  mediaId: string;
  mediaType: string;
  owner: Author | null;
  scanner: string;
  list: string;
  ref: string;
  sha256: string;
  createdAt: string;
  reportId: string | null;
  reportStatus: string | null;
  resolution: string | null;
}

export function Quarantine() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["quarantine"], queryFn: () => api<{ items: QItem[] }>("/quarantine") });
  const [modal, setModal] = useState<{ item: QItem; outcome: "confirm" | "false_positive" } | null>(null);
  const resolve = useMutation({
    mutationFn: (v: { mediaId: string; outcome: string; justification: string }) => api(`/quarantine/${v.mediaId}/resolve`, { method: "POST", body: { outcome: v.outcome, justification: v.justification } }),
    onSuccess: () => {
      setModal(null);
      toast("Resolved");
      void qc.invalidateQueries();
    },
  });
  return (
    <div className="page grid">
      <div className="notice red">
        ⛔ Hash-matched uploads are blocked before storage and are never displayed here — only match metadata. Confirmed matches must be reported to the NCA (and IWF where applicable) through the statutory reporting process; record the reference in the justification.
      </div>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Detected</th>
              <th>Account</th>
              <th>Type</th>
              <th>Match</th>
              <th>SHA-256</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((i) => (
              <tr key={i.mediaId}>
                <td className="small">{fullDate(i.createdAt)}</td>
                <td>
                  <AuthorChip a={i.owner} />
                </td>
                <td>{i.mediaType}</td>
                <td className="small">
                  <b>{i.list}</b>
                  <div className="mono faint">{i.ref}</div>
                </td>
                <td className="mono faint" title={i.sha256}>
                  {i.sha256.slice(0, 12)}…
                </td>
                <td>{i.reportStatus === "open" ? <span className="badge red">open</span> : <span className="badge">{human(i.resolution ?? i.reportStatus ?? "—")}</span>}</td>
                <td>
                  {i.reportStatus === "open" ? (
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button className="btn sm danger" onClick={() => setModal({ item: i, outcome: "confirm" })}>
                        Confirm & ban
                      </button>
                      <button className="btn sm" onClick={() => setModal({ item: i, outcome: "false_positive" })}>
                        False positive
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data?.items.length === 0 ? <div className="empty">No screening matches.</div> : null}
      </div>
      {modal ? (
        <RevealModal
          title={modal.outcome === "confirm" ? "Confirm match and ban account" : "Mark as false positive"}
          body={modal.outcome === "confirm" ? "The account will be permanently banned. File the statutory report and record its reference below." : "The account will be unfrozen. The file stays rejected; the user may upload again."}
          pending={resolve.isPending}
          error={resolve.error ? (resolve.error as Error).message : null}
          onClose={() => setModal(null)}
          onConfirm={(j) => resolve.mutate({ mediaId: modal.item.mediaId, outcome: modal.outcome, justification: j })}
        />
      ) : null}
    </div>
  );
}

// ───────────────────────────── Access log ─────────────────────────────

export function AccessLog() {
  const [action, setAction] = useState("");
  const q = useQuery({
    queryKey: ["access-log", action],
    queryFn: () => api<{ items: { id: string; staff: { displayName: string; role: string } | null; action: string; targetType: string | null; targetId: string | null; justification: string | null; reportId: string | null; ip: string | null; createdAt: string }[] }>(`/access-log${qs({ action })}`),
  });
  const sensitive = (a: string) => a.startsWith("view_") || a.startsWith("reveal_") || a.startsWith("search_by") || a.startsWith("quarantine");
  return (
    <div className="page">
      <div className="toolbar">
        <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All events</option>
          <option value="view_">Private content views</option>
          <option value="reveal_">PII reveals</option>
          <option value="moderation:">Moderation actions</option>
          <option value="appeal_">Appeal decisions</option>
          <option value="quarantine">Quarantine</option>
          <option value="staff_">Staff & logins</option>
        </select>
        <span className="muted small">Append-only: entries cannot be edited or deleted, including by admins.</span>
      </div>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Staff</th>
              <th>Event</th>
              <th>Target</th>
              <th>Justification</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((r) => (
              <tr key={r.id}>
                <td className="small" style={{ whiteSpace: "nowrap" }}>{fullDate(r.createdAt)}</td>
                <td className="small">
                  {r.staff?.displayName ?? "System"}
                  <div className="faint">{r.staff ? ROLE_LABEL[r.staff.role] : ""}</div>
                </td>
                <td>
                  <span className={`badge ${sensitive(r.action) ? "red" : r.action.startsWith("moderation") ? "gold" : ""}`}>{r.action.replace("moderation:", "")}</span>
                </td>
                <td className="mono faint small">{r.targetType ? `${r.targetType} ${r.targetId}` : "—"}</td>
                <td className="small" style={{ maxWidth: 360 }}>{r.justification ?? <span className="faint">—</span>}</td>
                <td className="mono faint small">{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────────── Staff ─────────────────────────────

export function Staff() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["staff"], queryFn: () => api<{ items: { id: string; email: string; displayName: string; role: Role; status: string; lastLoginAt: string | null }[] }>("/staff") });
  const [f, setF] = useState({ email: "", displayName: "", role: "moderator" as Role, password: "" });
  const create = useMutation({
    mutationFn: () => api("/staff", { method: "POST", body: f }),
    onSuccess: () => {
      toast("Staff account created");
      setF({ email: "", displayName: "", role: "moderator", password: "" });
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; role?: Role; status?: string }) => api(`/staff/${v.id}`, { method: "PATCH", body: { role: v.role, status: v.status } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["staff"] }),
    onError: (e) => toast((e as Error).message),
  });
  return (
    <div className="page grid">
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.items.map((s) => (
              <tr key={s.id}>
                <td>{s.displayName}</td>
                <td className="mono small">{s.email}</td>
                <td>
                  <select className="select" style={{ width: 190 }} value={s.role} onChange={(e) => patch.mutate({ id: s.id, role: e.target.value as Role })}>
                    {Object.entries(ROLE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className={`btn sm ${s.status === "active" ? "" : "danger"}`} onClick={() => patch.mutate({ id: s.id, status: s.status === "active" ? "disabled" : "active" })}>
                    {s.status === "active" ? "Active · disable" : "Disabled · enable"}
                  </button>
                </td>
                <td className="small muted">{s.lastLoginAt ? when(s.lastLoginAt) : "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="panel panel-body grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end" }}
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="field">
          <label>Name</label>
          <input className="input" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </div>
        <div className="field">
          <label>Role</label>
          <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {Object.entries(ROLE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Temporary password (12+)</label>
          <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </div>
        <button className="btn primary" disabled={create.isPending || f.password.length < 12 || !f.email || !f.displayName}>
          Add staff member
        </button>
        {create.error ? <div className="error">{(create.error as Error).message}</div> : null}
      </form>
    </div>
  );
}

// ───────────────────────────── Identity, badges and plan (account page) ─────────────────────────────

const flagOf = (c: string | null) => (c ? String.fromCodePoint(...[...c].map((x) => 0x1f1e6 + x.charCodeAt(0) - 65)) + " " + c : "—");

function IdentityPanel({
  d,
  userId,
}: {
  userId: string;
  d: {
    kycLevel: number;
    badge: string | null;
    countries: { id: string | null; phone: string | null; connection: string | null };
    subscription: { plan: string; status: string; currentPeriodEnd: string; provider: string } | null;
    trust?: { score: number; band: string; factors: { label: string; points: number }[] };
  };
}) {
  const can = useCan();
  const qc = useQueryClient();
  const [grant, setGrant] = useState({ badge: "public_figure", justification: "" });
  const [pay, setPay] = useState({ plan: "business", months: 1, reference: "" });
  const done = (msg: string) => () => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: ["user", userId] });
  };
  const grantM = useMutation({ mutationFn: (badge: string | null) => api(`/users/${userId}/badge`, { method: "POST", body: { badge, justification: grant.justification } }), onSuccess: done("Badge updated") });
  const payM = useMutation({ mutationFn: () => api(`/users/${userId}/subscription`, { method: "POST", body: pay }), onSuccess: done("Payment recorded") });
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Identity, badge and plan</h2>
      </div>
      <div className="panel-body grid" style={{ gap: 10 }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <div>
            <div className="kpi-label">ID country</div>
            <div>{d.kycLevel >= 1 ? flagOf(d.countries.id) : "Not verified"}</div>
          </div>
          <div>
            <div className="kpi-label">Phone</div>
            <div>{flagOf(d.countries.phone)}</div>
          </div>
          <div>
            <div className="kpi-label">Connects from</div>
            <div>{flagOf(d.countries.connection)}</div>
          </div>
        </div>
        {d.trust ? (
          <div>
            <div className="kpi-label">Trust score (private)</div>
            <div className="row" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{d.trust.score}</span>
              <span className={`badge ${d.trust.band === "Limited" ? "red" : d.trust.band === "Fair" ? "gold" : "green"}`}>{d.trust.band}</span>
            </div>
            <div className="small muted">{d.trust.factors.map((f) => `${f.label} ${f.points > 0 ? "+" : ""}${f.points}`).join(" · ")}</div>
          </div>
        ) : null}
        <div className="row small">
          <span className="kpi-label">Badge</span>
          {d.badge ? <span className="badge blue">{human(d.badge)}</span> : <span className="muted">None</span>}
          {d.subscription ? (
            <span className={`badge ${d.subscription.status === "active" && new Date(d.subscription.currentPeriodEnd) > new Date() ? "green" : "red"}`}>
              {d.subscription.plan} plan · {d.subscription.status} to {fullDate(d.subscription.currentPeriodEnd)} · {d.subscription.provider}
            </span>
          ) : null}
        </div>
        {can("verifyAccounts") ? (
          <>
            <div className="divider" style={{ margin: "4px 0" }} />
            <div className="kpi-label">Grant badge (never sold)</div>
            <div className="row">
              <select className="select" style={{ width: 160 }} value={grant.badge} onChange={(e) => setGrant({ ...grant, badge: e.target.value })}>
                <option value="public_figure">Public figure</option>
                <option value="government">Government</option>
                <option value="news">News organisation</option>
              </select>
              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Criteria met / evidence (logged)" value={grant.justification} onChange={(e) => setGrant({ ...grant, justification: e.target.value })} />
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              {d.badge && ["public_figure", "government", "news"].includes(d.badge) ? (
                <button className="btn sm" disabled={grant.justification.trim().length < 15} onClick={() => grantM.mutate(null)}>
                  Revoke badge
                </button>
              ) : null}
              <button className="btn sm primary" disabled={grant.justification.trim().length < 15 || grantM.isPending} onClick={() => grantM.mutate(grant.badge)}>
                Grant
              </button>
            </div>
            <div className="kpi-label">Record payment (manual invoice)</div>
            <div className="row">
              <select className="select" style={{ width: 120 }} value={pay.plan} onChange={(e) => setPay({ ...pay, plan: e.target.value })}>
                <option value="business">Business</option>
                <option value="creator">Creator</option>
              </select>
              <select className="select" style={{ width: 110 }} value={pay.months} onChange={(e) => setPay({ ...pay, months: Number(e.target.value) })}>
                {[1, 3, 6, 12].map((m) => (
                  <option key={m} value={m}>
                    {m} {m === 1 ? "month" : "months"}
                  </option>
                ))}
              </select>
              <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Invoice / UTR ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              <button className="btn sm primary" disabled={pay.reference.trim().length < 3 || payM.isPending} onClick={() => payM.mutate()}>
                Record
              </button>
            </div>
            {grantM.error || payM.error ? <div className="error">{((grantM.error ?? payM.error) as Error).message}</div> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
