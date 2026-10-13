// Console API client. The staff token lives in sessionStorage only: closing the tab signs the moderator out.

const KEY = "pf.staff.token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export const session = {
  get: () => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set: (t: string | null) => {
    try {
      if (t) sessionStorage.setItem(KEY, t);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* storage blocked: in-memory session only */
    }
  },
};

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get();
  const res = await fetch(`/admin/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== "/auth/login") onUnauthorized();
    throw new ApiError(res.status, data?.error?.code ?? "ERROR", data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const qs = (p: Record<string, string | undefined | null>) => {
  const parts = Object.entries(p).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

// ── Types (mirror apps/api/src/routes/admin.ts) ──

export type Role = "support" | "moderator" | "senior_moderator" | "compliance" | "admin";
export type Perm =
  | "view" | "act" | "suspendLong" | "ban" | "decideAppeals" | "viewProtected"
  | "viewDms" | "revealPii" | "freeze" | "quarantine" | "verifyAccounts" | "manageStaff" | "readAccessLog";

export interface Me {
  id: string;
  role: Role;
  displayName: string;
  permissions: Perm[];
}

export interface Author {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  isProtected: boolean;
}

export interface AdminPost {
  id: string;
  author: Author;
  text: string;
  createdAt: string;
  replyToId: string | null;
  media: { id: string; type: string; url: string; thumbUrl: string; width: number; height: number; altText: string }[];
  counts: { likes: number; replies: number; reposts: number; views: number };
  flags: { removed: boolean; deleted: boolean; sensitive: boolean; limited: boolean };
  openReports: number;
}

export type Preview =
  | { kind: "post"; post: AdminPost }
  | { kind: "post"; restricted: "protected"; requires: Role; author: Author | null }
  | { kind: "user"; user: Author & { strikes: number; createdAt: string; followers: number; kycLevel: number } }
  | { kind: "message"; restricted: "dm"; requires: Role; sender: Author | null }
  | { kind: "media"; restricted: "quarantine"; requires: Role; owner: Author | null; mediaType: string }
  | { kind: "missing" };

export interface ReportItem {
  id: string;
  reason: string;
  details: string;
  status: string;
  priority: number;
  source: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  targetType: string;
  targetId: string;
  openReportsOnTarget: number;
  reporter: Author | null;
  target: Preview;
}

export interface HistoryItem {
  id: string;
  action: string;
  reasonCode: string;
  statement: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  expiresAt: string | null;
  staff: string;
  appealStatus: string | null;
}

export interface Meta {
  reasons: string[];
  actions: string[];
  roles: Role[];
  moderatorMaxSuspensionDays: number;
}
