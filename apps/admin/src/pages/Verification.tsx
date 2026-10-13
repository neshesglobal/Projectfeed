import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Author } from "../api";
import { AuthorChip, fullDate, human, toast, when } from "../components";

interface Application {
  id: string;
  user: Author | null;
  kind: "business" | "creator";
  status: string;
  legalName: string | null;
  regType: string | null;
  regNumber: string | null;
  country: string | null;
  website: string | null;
  signatory: { name: string; role: string } | null;
  category: string | null;
  links: string[];
  about: string | null;
  reviewNote: string | null;
  applicantKyc: { level: number; country: string | null };
  createdAt: string;
  decidedAt: string | null;
}

/** Where a reviewer checks each registration type. */
const REGISTRY: Record<string, { label: string; url: string }> = {
  GSTIN: { label: "GST portal · Search taxpayer", url: "https://services.gst.gov.in/services/searchtp" },
  CIN: { label: "MCA · Company master data", url: "https://www.mca.gov.in/" },
  LLPIN: { label: "MCA · LLP master data", url: "https://www.mca.gov.in/" },
  UDYAM: { label: "Udyam · Verify registration", url: "https://udyamregistration.gov.in/" },
};

function ApplicationCard({ a }: { a: Application }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [months, setMonths] = useState(1);
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") => api(`/verifications/${a.id}/decide`, { method: "POST", body: { decision, note, months } }),
    onSuccess: (_d, decision) => {
      toast(`Application ${decision}`);
      void qc.invalidateQueries();
    },
  });
  const registry = a.regType ? REGISTRY[a.regType] : undefined;
  return (
    <div className="panel">
      <div className="panel-head">
        <span className={`badge ${a.kind === "business" ? "blue" : "violet"}`}>{a.kind}</span>
        {a.applicantKyc.level >= 1 ? <span className="badge green">ID verified · {a.applicantKyc.country ?? "?"}</span> : <span className="badge red">ID not verified</span>}
        <span className="faint small" style={{ marginLeft: "auto" }}>
          applied {when(a.createdAt)}
        </span>
      </div>
      <div className="panel-body grid">
        <AuthorChip a={a.user} />
        {a.kind === "business" ? (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <div>
              <div className="kpi-label">Registered name</div>
              <div>{a.legalName}</div>
            </div>
            <div>
              <div className="kpi-label">{a.regType} · {a.country}</div>
              <div className="mono">{a.regNumber}</div>
              {registry ? (
                <a className="small" href={registry.url} target="_blank" rel="noreferrer noopener">
                  Check on {registry.label} ↗
                </a>
              ) : null}
            </div>
            <div>
              <div className="kpi-label">Authorised signatory</div>
              <div>
                {a.signatory?.name} <span className="muted">· {a.signatory?.role}</span>
              </div>
            </div>
            {a.website ? (
              <div>
                <div className="kpi-label">Website</div>
                <a href={a.website} target="_blank" rel="noreferrer noopener">
                  {a.website}
                </a>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid" style={{ gap: 6 }}>
            <div>
              <span className="kpi-label">Category</span> {a.category}
            </div>
            {a.links.map((l) => (
              <a key={l} href={l} target="_blank" rel="noreferrer noopener" className="small">
                {l} ↗
              </a>
            ))}
            {a.about ? <div className="small muted">{a.about}</div> : null}
          </div>
        )}
        {a.status === "pending" ? (
          <>
            <div className="notice blue">
              ⓘ Check the registration on the official registry and that the signatory matches the ID-verified applicant before approving. Approval starts a manually invoiced plan.
            </div>
            <textarea className="textarea" placeholder="Review note (shown to the applicant if rejected)" value={note} onChange={(e) => setNote(e.target.value)} />
            {decide.error ? <div className="error">{(decide.error as Error).message}</div> : null}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <select className="select" style={{ width: 170 }} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {[1, 3, 6, 12].map((m) => (
                  <option key={m} value={m}>
                    Invoice {m} {m === 1 ? "month" : "months"}
                  </option>
                ))}
              </select>
              <button className="btn" disabled={note.trim().length < 10 || decide.isPending} onClick={() => decide.mutate("rejected")}>
                Reject
              </button>
              <button className="btn primary" disabled={note.trim().length < 10 || decide.isPending} onClick={() => decide.mutate("approved")}>
                Approve and grant badge
              </button>
            </div>
          </>
        ) : (
          <div className="small muted">
            {human(a.status)} {a.decidedAt ? `· ${fullDate(a.decidedAt)}` : ""} — {a.reviewNote}
          </div>
        )}
      </div>
    </div>
  );
}

export function Verification() {
  const [status, setStatus] = useState("pending");
  const q = useQuery({ queryKey: ["verifications", status], queryFn: () => api<{ items: Application[] }>(`/verifications?status=${status}`) });
  return (
    <div className="page">
      <div className="toolbar">
        {["pending", "approved", "rejected", "withdrawn"].map((s) => (
          <button key={s} className={`btn sm ${status === s ? "primary" : ""}`} onClick={() => setStatus(s)}>
            {human(s)}
          </button>
        ))}
      </div>
      <div className="grid">
        {q.data?.items.length === 0 ? <div className="panel empty">No {status} applications.</div> : null}
        {q.data?.items.map((a) => <ApplicationCard key={a.id} a={a} />)}
      </div>
    </div>
  );
}
