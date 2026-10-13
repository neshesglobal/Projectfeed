import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api, session, setUnauthorizedHandler, type Me, type Perm } from "./api";
import { MeContext, ROLE_LABEL, ToastHost } from "./components";
import { AccessLog, Appeals, Content, Dashboard, Quarantine, Staff, UserDetail, Users } from "./pages/Other";
import { Reports } from "./pages/Reports";
import { Verification } from "./pages/Verification";

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

const NAV: { href: string; label: string; icon: string; perm: Perm; section: string; count?: string; sub?: string }[] = [
  { href: "#/", label: "Overview", icon: "◧", perm: "view", section: "Queues", sub: "Queue health and service levels" },
  { href: "#/reports", label: "Reports", icon: "⚑", perm: "view", section: "Queues", count: "openReports", sub: "User reports and automated flags, by priority" },
  { href: "#/appeals", label: "Appeals", icon: "⚖", perm: "view", section: "Queues", count: "openAppeals", sub: "Second review by a different moderator" },
  { href: "#/content", label: "Content", icon: "▦", perm: "view", section: "Explore", sub: "Public posts, photos, videos and reels" },
  { href: "#/users", label: "Accounts", icon: "◉", perm: "view", section: "Explore", sub: "Account lookup, history and actions" },
  { href: "#/verification", label: "Verification", icon: "✓", perm: "verifyAccounts", section: "Compliance", count: "pendingVerifications", sub: "Business and creator badge applications" },
  { href: "#/quarantine", label: "Quarantine", icon: "⛔", perm: "quarantine", section: "Compliance", count: "quarantined", sub: "Hash-matched uploads (metadata only)" },
  { href: "#/access-log", label: "Access log", icon: "☰", perm: "readAccessLog", section: "Admin", sub: "Who viewed what, and why" },
  { href: "#/staff", label: "Staff", icon: "✦", perm: "manageStaff", section: "Admin", sub: "Roles and access" },
];

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>("/auth/login", { method: "POST", body: { email, password } });
      session.set(r.token);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="panel login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">Projectfeed</div>
            <div className="brand-sub">Trust &amp; Safety</div>
          </div>
        </div>
        <div className="field">
          <label>Staff email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error ? <div className="error">{error}</div> : null}
        <button className="btn primary" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="faint small">Authorised staff only. All access is logged.</div>
      </form>
    </div>
  );
}

export function App() {
  const qc = useQueryClient();
  const [token, setToken] = useState(session.get());
  const hash = useHash();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      session.set(null);
      setToken(null);
      qc.clear();
    });
  }, [qc]);
  const me = useQuery({ queryKey: ["me", token], enabled: !!token, queryFn: () => api<Me>("/me"), retry: false });
  const dash = useQuery({ queryKey: ["dashboard"], enabled: !!me.data, queryFn: () => api<{ counts: Record<string, number | null> }>("/dashboard"), refetchInterval: 30_000 });

  if (!token) return <Login onDone={() => setToken(session.get())} />;
  if (!me.data) return <div className="login muted">{me.error ? (me.error as Error).message : "Loading…"}</div>;

  const [path, query] = hash.slice(1).split("?");
  const params = new URLSearchParams(query ?? "");
  const seg = (path ?? "/").split("/").filter(Boolean);
  const current = NAV.find((n) => n.href === `#/${seg[0] ?? ""}`) ?? NAV[0]!;
  const allowed = (p: Perm) => me.data.permissions.includes(p);

  let page;
  let title = current.label;
  if (!allowed(current.perm)) page = <div className="page empty">Your role doesn't have access to this page.</div>;
  else if (seg[0] === "reports") page = <Reports />;
  else if (seg[0] === "appeals") page = <Appeals />;
  else if (seg[0] === "content") page = <Content />;
  else if (seg[0] === "users" && seg[1]) {
    page = <UserDetail key={seg[1]} id={seg[1]} />;
    title = "Account";
  } else if (seg[0] === "users") page = <Users key={params.get("status") ?? ""} status={params.get("status") ?? undefined} />;
  else if (seg[0] === "quarantine") page = <Quarantine />;
  else if (seg[0] === "verification") page = <Verification />;
  else if (seg[0] === "access-log") page = <AccessLog />;
  else if (seg[0] === "staff") page = <Staff />;
  else page = <Dashboard />;

  const sections = [...new Set(NAV.map((n) => n.section))];
  return (
    <MeContext.Provider value={me.data}>
      <div className="shell">
        <nav className="sidebar">
          <div className="brand">
            <div className="brand-mark">P</div>
            <div>
              <div className="brand-name">Projectfeed</div>
              <div className="brand-sub">Trust &amp; Safety</div>
            </div>
          </div>
          {sections.map((s) => (
            <div key={s} style={{ display: "contents" }}>
              <div className="nav-section">{s}</div>
              {NAV.filter((n) => n.section === s).map((n) => {
                const c = n.count ? dash.data?.counts[n.count] : null;
                return (
                  <a key={n.href} href={n.href} className={`nav-item ${n === current ? "active" : ""}`}>
                    <span style={{ width: 16, textAlign: "center" }}>{n.icon}</span>
                    {n.label}
                    {!allowed(n.perm) ? <span className="lock">🔒</span> : c ? <span className="count">{c}</span> : null}
                  </a>
                );
              })}
            </div>
          ))}
          <div className="sidebar-foot">
            <div className="me-name">{me.data.displayName}</div>
            <div className="me-role">{ROLE_LABEL[me.data.role]}</div>
            <button
              className="btn sm ghost"
              style={{ padding: "6px 0" }}
              onClick={() => {
                session.set(null);
                setToken(null);
                qc.clear();
              }}
            >
              Sign out
            </button>
          </div>
        </nav>
        <main className="main">
          <header className="topbar">
            <div>
              <h1>{title}</h1>
              <div className="sub">{current.sub}</div>
            </div>
            <div className="spacer" />
            <span className="badge gold">{ROLE_LABEL[me.data.role]}</span>
          </header>
          {page}
        </main>
      </div>
      <ToastHost />
    </MeContext.Provider>
  );
}
