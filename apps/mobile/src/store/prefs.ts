import { create } from "zustand";
import { kv } from "../lib/storage";

/** "dim" is a legacy value from the first design; it now resolves to dark. */
export type ThemePref = "system" | "light" | "dim" | "dark";

interface Persisted {
  theme: ThemePref;
  homeTab: string;
  heroDismissed: boolean;
}

interface PrefsState extends Persisted {
  setTheme: (t: ThemePref) => void;
  setHomeTab: (t: string) => void;
  dismissHero: () => void;
  hydrate: () => Promise<void>;
}

const KEY = "pf.prefs";

export const usePrefs = create<PrefsState>((set, get) => {
  const save = (patch: Partial<Persisted>) => {
    set(patch);
    const { theme, homeTab, heroDismissed } = get();
    void kv.set(KEY, JSON.stringify({ theme, homeTab, heroDismissed }));
  };
  return {
    theme: "system",
    homeTab: "for-you",
    heroDismissed: false,
    setTheme: (theme) => save({ theme }),
    setHomeTab: (homeTab) => save({ homeTab }),
    dismissHero: () => save({ heroDismissed: true }),
    hydrate: async () => {
      try {
        const raw = await kv.get(KEY);
        if (raw) set(JSON.parse(raw) as Partial<Persisted>);
      } catch {
        /* corrupted prefs: keep defaults */
      }
    },
  };
});
