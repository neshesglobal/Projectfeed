import { useColorScheme } from "react-native";
import { usePrefs, type ThemePref } from "../store/prefs";

/**
 * Projectfeed design tokens.
 *
 * Deep navy, midnight blue and soft porcelain, with a restrained blue accent. Content sits directly on a flat
 * background (no cards around posts, no decorative gradients); translucent native materials are kept for chrome
 * only (tab bar, sheets, search). Gold is reserved for the ID-verified seal, so it never competes with the accent.
 *
 * Theme names are kept for stored preferences: "midnight" is the standard dark look, "dark" is the true-black
 * (OLED) variant and "light" is the porcelain day look.
 */
export type ThemeName = "midnight" | "dark" | "light";

export interface Theme {
  /** Which palette this is (for previews and analytics). */
  name: ThemeName;
  /** Luminance family: drives blur tint, shadows and status-bar style. */
  mode: "light" | "dark";
  /** Primary background. */
  bg: string;
  /** Backdrop, top → bottom. Flat in this design language; kept as a token so screens can share one backdrop. */
  gradient: [string, string, string];
  orbA: string;
  orbB: string;
  /** Secondary surface (sheets, inputs, grouped settings). */
  bgElevated: string;
  bgInput: string;
  card: string;
  cardBorder: string;
  cardPressed: string;
  glassTint: string;
  glassBorder: string;
  glassHighlight: string;
  blurTint: "dark" | "light" | "systemChromeMaterialDark" | "systemChromeMaterialLight";
  text: string;
  textMuted: string;
  /** Hairline dividers between posts and rows. */
  border: string;
  /** Links, hashtags, active icons. */
  accent: string;
  accentSoft: string;
  /** Filled primary controls (buttons, compose). Flat: both stops are the same colour. */
  accentGradient: [string, string];
  accentText: string;
  /** Selected filter capsule: deep navy by day, bright blue at night. */
  selected: string;
  verified: string;
  like: string;
  repost: string;
  danger: string;
  success: string;
  overlay: string;
  statusBar: "light" | "dark";
}

export const themes: Record<ThemeName, Theme> = {
  /** Midnight: deep midnight blue — the standard dark appearance. */
  midnight: {
    name: "midnight",
    mode: "dark",
    bg: "#0B1018",
    gradient: ["#0B1018", "#0B1018", "#0B1018"],
    orbA: "transparent",
    orbB: "transparent",
    bgElevated: "#151E2B",
    bgInput: "#151E2B",
    card: "#151E2B",
    cardBorder: "#253142",
    cardPressed: "#1B2636",
    glassTint: "rgba(16, 23, 34, 0.78)",
    glassBorder: "rgba(255,255,255,0.10)",
    glassHighlight: "rgba(255,255,255,0.16)",
    blurTint: "systemChromeMaterialDark",
    text: "#F5F7FA",
    textMuted: "#A6B1C0",
    border: "#253142",
    accent: "#75A7FF",
    accentSoft: "rgba(117, 167, 255, 0.16)",
    accentGradient: ["#2F74E8", "#2F74E8"],
    accentText: "#FFFFFF",
    selected: "#2F74E8",
    verified: "#F2C14E",
    like: "#FF5C7A",
    repost: "#3DD68C",
    danger: "#FF6B6B",
    success: "#3DD68C",
    overlay: "rgba(4, 8, 14, 0.6)",
    statusBar: "light",
  },
  /** True black for OLED screens, with the same blue accent. */
  dark: {
    name: "dark",
    mode: "dark",
    bg: "#000000",
    gradient: ["#000000", "#000000", "#000000"],
    orbA: "transparent",
    orbB: "transparent",
    bgElevated: "#11161E",
    bgInput: "#11161E",
    card: "#0E1218",
    cardBorder: "#222A36",
    cardPressed: "#161C25",
    glassTint: "rgba(10, 12, 16, 0.8)",
    glassBorder: "rgba(255,255,255,0.10)",
    glassHighlight: "rgba(255,255,255,0.14)",
    blurTint: "systemChromeMaterialDark",
    text: "#F5F7FA",
    textMuted: "#9AA4B2",
    border: "#1E2530",
    accent: "#75A7FF",
    accentSoft: "rgba(117, 167, 255, 0.14)",
    accentGradient: ["#2F74E8", "#2F74E8"],
    accentText: "#FFFFFF",
    selected: "#2F74E8",
    verified: "#F2C14E",
    like: "#FF5C7A",
    repost: "#3DD68C",
    danger: "#FF6B6B",
    success: "#3DD68C",
    overlay: "rgba(0, 0, 0, 0.65)",
    statusBar: "light",
  },
  /** Daylight: soft porcelain with deep navy text. */
  light: {
    name: "light",
    mode: "light",
    bg: "#FAFAF8",
    gradient: ["#FAFAF8", "#FAFAF8", "#FAFAF8"],
    orbA: "transparent",
    orbB: "transparent",
    bgElevated: "#FFFFFF",
    bgInput: "#F0F2F5",
    card: "#FFFFFF",
    cardBorder: "#E8EBEF",
    cardPressed: "#F1F3F6",
    glassTint: "rgba(250, 250, 248, 0.82)",
    glassBorder: "rgba(20, 32, 51, 0.08)",
    glassHighlight: "rgba(255,255,255,0.9)",
    blurTint: "systemChromeMaterialLight",
    text: "#142033",
    textMuted: "#697586",
    border: "#E8EBEF",
    accent: "#2459A6",
    accentSoft: "rgba(36, 89, 166, 0.10)",
    accentGradient: ["#2459A6", "#2459A6"],
    accentText: "#FFFFFF",
    selected: "#142033",
    verified: "#C98A0B",
    like: "#E0245E",
    repost: "#17945A",
    danger: "#D92D20",
    success: "#17945A",
    overlay: "rgba(20, 32, 51, 0.35)",
    statusBar: "dark",
  },
};

export function resolveTheme(pref: ThemePref, system: "light" | "dark" | null | undefined, autoDark: ThemeName = "midnight"): Theme {
  if (pref === "light") return themes.light;
  if (pref === "black") return themes.dark;
  if (pref === "dark" || pref === "dim") return themes.midnight;
  // Automatic: Daylight by day, and the user's chosen dark style at night.
  return system === "light" ? themes.light : themes[autoDark === "light" ? "midnight" : autoDark];
}

export function useTheme(): Theme {
  const pref = usePrefs((s) => s.theme);
  const autoDark = usePrefs((s) => s.autoDark);
  const system = useColorScheme();
  return resolveTheme(pref, system === "unspecified" ? null : system, autoDark);
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Concentric radii: inner radius = outer radius − padding, as in Apple's Liquid Glass guidance. */
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
/** Type scale (San Francisco on iOS). Body and post titles are both md (16); titles differ by weight only. */
export const font = { xs: 13, sm: 14, md: 16, lg: 17, xl: 20, xxl: 24, title: 30 } as const;

/** Height reserved at the bottom of tab screens for the floating glass tab bar. */
export const TAB_BAR_HEIGHT = 64;
export const tabBarSpace = (bottomInset: number) => TAB_BAR_HEIGHT + Math.max(bottomInset, 12) + 16;
