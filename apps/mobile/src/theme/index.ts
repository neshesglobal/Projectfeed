import { useColorScheme } from "react-native";
import { usePrefs, type ThemePref } from "../store/prefs";

/** Design tokens. Three modes like X (light, dim, lights-out) with the Neshes gold accent. */
export interface Theme {
  mode: "light" | "dim" | "dark";
  bg: string;
  bgElevated: string;
  bgInput: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  accentText: string;
  like: string;
  repost: string;
  danger: string;
  success: string;
  overlay: string;
  statusBar: "light" | "dark";
}

const accent = "#D4A017";

export const themes: Record<Theme["mode"], Theme> = {
  light: {
    mode: "light",
    bg: "#FFFFFF",
    bgElevated: "#F7F9F9",
    bgInput: "#EFF3F4",
    text: "#0F1419",
    textMuted: "#536471",
    border: "#EFF3F4",
    accent: "#B8860B",
    accentText: "#FFFFFF",
    like: "#F91880",
    repost: "#00BA7C",
    danger: "#F4212E",
    success: "#00BA7C",
    overlay: "rgba(0,0,0,0.4)",
    statusBar: "dark",
  },
  dim: {
    mode: "dim",
    bg: "#15202B",
    bgElevated: "#1E2732",
    bgInput: "#273340",
    text: "#F7F9F9",
    textMuted: "#8B98A5",
    border: "#38444D",
    accent,
    accentText: "#15202B",
    like: "#F91880",
    repost: "#00BA7C",
    danger: "#F4212E",
    success: "#00BA7C",
    overlay: "rgba(91,112,131,0.4)",
    statusBar: "light",
  },
  dark: {
    mode: "dark",
    bg: "#000000",
    bgElevated: "#16181C",
    bgInput: "#202327",
    text: "#E7E9EA",
    textMuted: "#71767B",
    border: "#2F3336",
    accent,
    accentText: "#000000",
    like: "#F91880",
    repost: "#00BA7C",
    danger: "#F4212E",
    success: "#00BA7C",
    overlay: "rgba(91,112,131,0.4)",
    statusBar: "light",
  },
};

export function resolveTheme(pref: ThemePref, system: "light" | "dark" | null | undefined): Theme {
  if (pref === "system") return system === "light" ? themes.light : themes.dark;
  return themes[pref];
}

export function useTheme(): Theme {
  const pref = usePrefs((s) => s.theme);
  const system = useColorScheme();
  return resolveTheme(pref, system === "unspecified" ? null : system);
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const font = { xs: 13, sm: 14, md: 15, lg: 17, xl: 20, xxl: 24, title: 31 } as const;
