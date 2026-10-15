import Constants from "expo-constants";
import { Platform } from "react-native";
import type { AuthTokens } from "@projectfeed/shared";
import { useAuth } from "../store/auth";

function resolveBaseUrl(): string {
  const configured =
    process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "http://localhost:4000";
  // The Android emulator reaches the host machine on 10.0.2.2, not localhost.
  if (Platform.OS === "android") return configured.replace("//localhost", "//10.0.2.2");
  return configured;
}

export const API_URL = resolveBaseUrl();

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** Refresh once even if many requests hit a 401 at the same moment (refresh tokens are single-use). */
async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const rt = useAuth.getState().refreshToken;
    if (!rt) return false;
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) {
        if (res.status === 401) await useAuth.getState().signOut();
        return false;
      }
      const t = (await res.json()) as AuthTokens;
      await useAuth.getState().setTokens(t.accessToken, t.refreshToken);
      useAuth.getState().setUser(t.user);
      return true;
    } catch {
      return false; // offline: keep the session, retry later
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Seconds until a JWT access token expires; Infinity if it can't be read. */
function secondsLeft(token: string): number {
  try {
    const part = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4))) as { exp?: number };
    return typeof exp === "number" ? exp - Date.now() / 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * The access token, renewed first if it expires within a minute. Waiting for a 401 works for small requests,
 * but a photo or video upload rejected that way is often reported by iOS as a dropped connection
 * ("Can't reach Projectfeed") instead of a 401, so the app never got the chance to refresh and retry.
 */
export async function freshAccessToken(): Promise<string | null> {
  const { accessToken, refreshToken } = useAuth.getState();
  if (accessToken && refreshToken && secondsLeft(accessToken) < 60) await refreshSession();
  return useAuth.getState().accessToken;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  auth?: boolean;
}

export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const token = opts.auth !== false ? await freshAccessToken() : null;
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (token && opts.auth !== false) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach Projectfeed. Check your connection.");
  }

  if (res.status === 401 && opts.auth !== false && !retried && useAuth.getState().refreshToken) {
    if (await refreshSession()) return api<T>(path, opts, true);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
