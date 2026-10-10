import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, qs, type Author, type HistoryItem, type Preview, type ReportItem } from "../api";
import { ActionPanel, AuthorChip, History, Prio, TargetView, fullDate, human, toast, useCan, when } from "../components";

interface ReportDetail extends Omit<ReportItem, "openReportsOnTarget" | "resolvedAt" | "resolution"> {
  subject: Author | null;
  otherReports: { id: string; reason: string; details: string; status: string; createdAt: string }[];
  history: HistoryItem[];
}

function targetLabel(t: Preview): string {
  if (t.kind === "post") return "post" in t ? "Post" : "Protected post";
  if (t.kind === "message") return "Direct message";
  if (t.kind === "media") return "Upload (hash match)";
  if (t.kind === "user") return "Account";
  return "Missing";
}

function QueueRow({ r, selected, onClick }: { r: ReportItem; selected: boolean; onClick: () => void }) {
  const t = r.target;
  const snippet = "post" in t ? t.post.text || `${t.post.media.length} media` : t.kind === "user" ? `@${t.user.handle}` : "Restricted content";
  return (
    <div className={`queue-item ${selected ? "selected" : ""}`} onClick={onClick}>
      <div className="row" style={{ gap: 8 }}>
        <Prio p={r.priority} />
        <b>{human(r.reason)}</b>
        <span className="badge">{targetLabel(t)}</span>
        {r.source === "screening" ? <span className="badge red">auto</span> : null}
        {r.openReportsOnTarget > 1 ? <span className="badge gold">×{r.openReportsOnTarget}</span> : null}
        <span className="faint small" style={{ marginLeft: "auto" }}>
          {when(r.createdAt)}
        </span>
      </div>
      <div className="muted small ellipsis">{snippet}</div>
    </div>
  );
}

export function Reports() {
  const can = useCan();
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");
  const [reason, setReason] = useState("");
  const [type, setType] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const queue = useQuery({ queryKey: ["reports", status, reason, type], queryFn: () => api<{ items: ReportItem[] }>(`/reports${qs({ status, reason, type, limit: "100" })}`) });
  const items = queue.data?.items ?? [];
  useEffect(() => {
    if (!selected || !items.some((i) => i.id === selected)) setSelected(items[0]?.id ?? null);
  }, [items, selected]);
  const detail = useQuery({ queryKey: ["report", selected], enabled: !!selected, queryFn: () => api<ReportDetail>(`/reports/${selected}`) });
  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/reports/${id}/dismiss`, { method: "POST", body: { note: "No violation found" } }),
    onSuccess: () => {
      toast("Report dismissed");
      void qc.invalidateQueries();
    },
  });

  const d = detail.data;
  const postId = d && "post" in d.target ? d.target.post.id : d?.targetType === "post" ? d.targetId : null;
  const userId = d?.subject?.id ?? null;

  return (
    <div className="page">
      <div className="toolbar">
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option>
          <option value="actioned">Actioned</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All targets</option>
          <option value="post">Posts</option>
          <option value="user">Accounts</option>
          <option value="message">DMs</option>
          <option value="media">Uploads</option>
        </select>
        <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">All reasons</option>
          {["child_safety", "terrorism", "self_harm", "scam_fraud", "violence", "illegal_goods", "harassment", "hate", "impersonation", "spam", "other"].map((r) => (
            <option key={r} value={r}>
              {human(r)}
            </option>
          ))}
        </select>
        <span className="muted small">{items.length} reports · sorted by priority, oldest first</span>
      </div>

      <div className="split">
        <div className="panel">
          {queue.isLoading ? <div className="empty">Loading…</div> : items.length === 0 ? <div className="empty">Queue clear. Nice work.</div> : null}
          {items.map((r) => (
            <QueueRow key={r.id} r={r} selected={r.id === selected} onClick={() => setSelected(r.id)} />
          ))}
        </div>

        <div className="sticky grid">
          {!d ? (
            <div className="panel empty">{selected ? "Loading…" : "Select a report"}</div>
          ) : (
            <>
              <div className="panel">
                <div className="panel-head">
                  <Prio p={d.priority} />
                  <h2>{human(d.reason)} report</h2>
                  <span className="faint small mono" style={{ marginLeft: "auto" }}>
                    #{d.id}
                  </span>
                </div>
                <div className="panel-body grid">
                  <div className="row small muted">
                    <span>
                      Reported {fullDate(d.createdAt)} by {d.reporter ? <a href={`#/users/${d.reporter.id}`}>@{d.reporter.handle}</a> : <b>automated screening</b>}
                    </span>
                  </div>
                  {d.details ? <div className="notice blue">“{d.details}”</div> : null}
                  <TargetView preview={d.target} reportId={d.id} />
                </div>
              </div>

              {d.status === "open" ? (
                <div className="panel">
                  <div className="panel-head">
                    <h2>Decision</h2>
                    {can("act") && d.targetType !== "media" ? (
                      <button className="btn sm ghost" style={{ marginLeft: "auto" }} disabled={dismiss.isPending} onClick={() => dismiss.mutate(d.id)}>
                        Dismiss — no violation
                      </button>
                    ) : null}
                  </div>
                  <div className="panel-body">
                    {d.targetType === "media" ? (
                      <div className="notice red">Hash-match reports are resolved by compliance from the Quarantine page.</div>
                    ) : (
                      <ActionPanel
                        key={d.id}
                        postId={postId}
                        userId={userId}
                        reportId={d.id}
                        defaultReason={d.reason}
                        protectedPost={d.target.kind === "post" && "restricted" in d.target}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="panel panel-body muted">This report is {d.status}.</div>
              )}

              <div className="panel">
                <div className="panel-head">
                  <h2>Subject</h2>
                </div>
                <div className="panel-body grid">
                  <AuthorChip a={d.subject} />
                  <History items={d.history} />
                </div>
              </div>

              {d.otherReports.length > 0 ? (
                <div className="panel">
                  <div className="panel-head">
                    <h2>Other reports on this item ({d.otherReports.length})</h2>
                  </div>
                  <table className="table">
                    <tbody>
                      {d.otherReports.map((o) => (
                        <tr key={o.id}>
                          <td>{human(o.reason)}</td>
                          <td className="muted">{o.details || "—"}</td>
                          <td>
                            <span className="badge">{o.status}</span>
                          </td>
                          <td className="faint small">{when(o.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
