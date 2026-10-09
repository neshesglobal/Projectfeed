import { create } from "zustand";
import { kv } from "../lib/storage";

export type ThemePref = "system" | "light" | "dim" | "dark";

interface PrefsState {
  theme: ThemePref;
  homeTab: string;
  setTheme: (t: ThemePref) => void;
  setHomeTab: (t: string) => void;
  hydrate: () => Promise<void>;
}

const KEY = "pf.prefs";

export const usePrefs = create<PrefsState>((set, get) => ({
  theme: "system",
  homeTab: "for-you",
  setTheme: (theme) => {
    set({ theme });
    void kv.set(KEY, JSON.stringify({ theme, homeTab: get().homeTab }));
  },
  setHomeTab: (homeTab) => {
    set({ homeTab });
    void kv.set(KEY, JSON.stringify({ theme: get().theme, homeTab }));
  },
  hydrate: async () => {
    try {
      const raw = await kv.get(KEY);
      if (raw) set(JSON.parse(raw) as Partial<PrefsState>);
    } catch {
      /* corrupted prefs: keep defaults */
    }
  },
}));
