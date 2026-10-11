import { create } from "zustand";
import { kv } from "../lib/storage";

/**
 * Theme preference. "dark" = Midnight (violet), "black" = Dark (true neutral dark), "light" = Daylight.
 * ("dim" is a legacy value from the first design and resolves to Midnight.)
 */
export type ThemePref = "system" | "light" | "dim" | "dark" | "black";

export type Density = "dense" | "compact" | "comfortable";

interface Persisted {
  theme: ThemePref;
  /** Which dark look "Automatic" uses at night. */
  autoDark: "midnight" | "dark";
  /** Feed density: Dense ≈5 text posts per screen (one glass panel), Compact ≈4 (cards), Comfortable is roomier. */
  density: Density;
  homeTab: string;
  heroDismissed: boolean;
  /** Language to translate posts into; null = follow the device language. */
  translateTo: string | null;
}

interface PrefsState extends Persisted {
  setTheme: (t: ThemePref) => void;
  setAutoDark: (d: "midnight" | "dark") => void;
  setDensity: (d: Density) => void;
  setHomeTab: (t: string) => void;
  dismissHero: () => void;
  setTranslateTo: (lang: string | null) => void;
  hydrate: () => Promise<void>;
}

const KEY = "pf.prefs";

export const usePrefs = create<PrefsState>((set, get) => {
  const save = (patch: Partial<Persisted>) => {
    set(patch);
    const { theme, autoDark, density, homeTab, heroDismissed, translateTo } = get();
    void kv.set(KEY, JSON.stringify({ theme, autoDark, density, homeTab, heroDismissed, translateTo }));
  };
  return {
    theme: "system",
    autoDark: "midnight",
    density: "dense",
    homeTab: "for-you",
    heroDismissed: false,
    translateTo: null,
    setTheme: (theme) => save({ theme }),
    setAutoDark: (autoDark) => save({ autoDark }),
    setDensity: (density) => save({ density }),
    setHomeTab: (homeTab) => save({ homeTab }),
    dismissHero: () => save({ heroDismissed: true }),
    setTranslateTo: (translateTo) => save({ translateTo }),
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
