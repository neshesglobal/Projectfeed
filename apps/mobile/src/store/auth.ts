import { create } from "zustand";
import type { AuthTokens, UserProfile } from "@projectfeed/shared";
import { kv } from "../lib/storage";

interface AuthState {
  status: "loading" | "signedOut" | "signedIn";
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  signIn: (t: AuthTokens) => Promise<void>;
  setTokens: (access: string, refresh: string) => Promise<void>;
  setUser: (u: UserProfile) => void;
  signOut: () => Promise<void>;
  hydrate: () => Promise<void>;
}

const KEY = "pf.session";

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  accessToken: null,
  refreshToken: null,
  user: null,
  signIn: async (t) => {
    set({ status: "signedIn", accessToken: t.accessToken, refreshToken: t.refreshToken, user: t.user });
    await kv.set(KEY, JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken, user: t.user }));
  },
  setTokens: async (accessToken, refreshToken) => {
    set({ accessToken, refreshToken });
    await kv.set(KEY, JSON.stringify({ accessToken, refreshToken, user: get().user }));
  },
  setUser: (user) => {
    set({ user });
    void kv.set(KEY, JSON.stringify({ accessToken: get().accessToken, refreshToken: get().refreshToken, user }));
  },
  signOut: async () => {
    set({ status: "signedOut", accessToken: null, refreshToken: null, user: null });
    await kv.remove(KEY);
  },
  hydrate: async () => {
    try {
      const raw = await kv.get(KEY);
      if (raw) {
        const s = JSON.parse(raw) as { accessToken: string; refreshToken: string; user: UserProfile };
        if (s.refreshToken) {
          set({ status: "signedIn", ...s });
          return;
        }
      }
    } catch {
      /* fall through to signed out */
    }
    set({ status: "signedOut" });
  },
}));
