import { useColorScheme } from "react-native";
import { usePrefs, type ThemePref } from "../store/prefs";

/**
 * Projectfeed design tokens — "Liquid Glass" language.
 *
 * Layers, back to front:
 *   1. Backdrop   — a deep violet gradient with soft light orbs (never flat black like X).
 *   2. Content    — frosted, translucent cards with a hairline specular edge (no blur: cheap to scroll).
 *   3. Chrome     — real glass (native Liquid Glass on iOS 26, blur elsewhere) for the floating tab bar,
 *                   top bars, sheets, search and buttons — content visibly flows underneath.
 * Accent is violet; gold is reserved for the ID-verified badge (trust signal).
 */
export type ThemeName = "midnight" | "dark" | "light";

export interface Theme {
  /** Which palette this is (for previews and analytics). */
  name: ThemeName;
  /** Luminance family: drives blur tint, shadows and status-bar style. */
  mode: "light" | "dark";
  /** Solid base colour behind the gradient (also used where a solid surface is required). */
  bg: string;
  /** Backdrop gradient, top → bottom. */
  gradient: [string, string, string];
  /** Soft light orbs over the backdrop. */
  orbA: string;
  orbB: string;
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
  border: string;
  accent: string;
  accentSoft: string;
  accentGradient: [string, string];
  accentText: string;
  verified: string;
  like: string;
  repost: string;
  danger: string;
  success: string;
  overlay: string;
  statusBar: "light" | "dark";
}

export const themes: Record<ThemeName, Theme> = {
  /** Midnight: deep violet glass — the signature look. */
  midnight: {
    name: "midnight",
    mode: "dark",
    bg: "#0A0911",
    gradient: ["#34186E", "#170E33", "#0A0911"],
    orbA: "rgba(139, 92, 246, 0.35)",
    orbB: "rgba(79, 70, 229, 0.22)",
    bgElevated: "rgba(255,255,255,0.08)",
    bgInput: "rgba(255,255,255,0.09)",
    card: "rgba(255,255,255,0.055)",
    cardBorder: "rgba(255,255,255,0.10)",
    cardPressed: "rgba(255,255,255,0.10)",
    glassTint: "rgba(28, 20, 52, 0.62)",
    glassBorder: "rgba(255,255,255,0.16)",
    glassHighlight: "rgba(255,255,255,0.28)",
    blurTint: "systemChromeMaterialDark",
    text: "#F5F3FF",
    textMuted: "rgba(226, 220, 250, 0.62)",
    border: "rgba(255,255,255,0.08)",
    accent: "#A78BFA",
    accentSoft: "rgba(167, 139, 250, 0.18)",
    accentGradient: ["#A78BFA", "#7C3AED"],
    accentText: "#FFFFFF",
    verified: "#F2C14E",
    like: "#FF4D8D",
    repost: "#34D399",
    danger: "#FF5A6A",
    success: "#34D399",
    overlay: "rgba(5, 3, 15, 0.55)",
    statusBar: "light",
  },
  /**
   * Dark: true dark mode — near-black, neutral graphite glass, violet only as an accent.
   * Easier on the eyes at night and saves battery on OLED screens.
   */
  dark: {
    name: "dark",
    mode: "dark",
    bg: "#000000",
    gradient: ["#0E0E13", "#060608", "#000000"],
    orbA: "rgba(124, 58, 237, 0.10)",
    orbB: "rgba(255, 255, 255, 0.025)",
    bgElevated: "rgba(255,255,255,0.07)",
    bgInput: "rgba(255,255,255,0.08)",
    card: "rgba(255,255,255,0.045)",
    cardBorder: "rgba(255,255,255,0.085)",
    cardPressed: "rgba(255,255,255,0.085)",
    glassTint: "rgba(16, 16, 20, 0.72)",
    glassBorder: "rgba(255,255,255,0.12)",
    glassHighlight: "rgba(255,255,255,0.22)",
    blurTint: "systemChromeMaterialDark",
    text: "#F2F2F5",
    textMuted: "rgba(235, 235, 245, 0.6)",
    border: "rgba(255,255,255,0.08)",
    accent: "#A78BFA",
    accentSoft: "rgba(167, 139, 250, 0.14)",
    accentGradient: ["#A78BFA", "#7C3AED"],
    accentText: "#FFFFFF",
    verified: "#F2C14E",
    like: "#FF4D8D",
    repost: "#34D399",
    danger: "#FF5A6A",
    success: "#34D399",
    overlay: "rgba(0, 0, 0, 0.62)",
    statusBar: "light",
  },
  /** Daylight: soft lavender glass. */
  light: {
    name: "light",
    mode: "light",
    bg: "#F6F4FC",
    gradient: ["#E4D7FF", "#EFE9FF", "#F7F6FC"],
    orbA: "rgba(167, 139, 250, 0.35)",
    orbB: "rgba(99, 102, 241, 0.18)",
    bgElevated: "rgba(255,255,255,0.75)",
    bgInput: "rgba(255,255,255,0.72)",
    card: "rgba(255,255,255,0.68)",
    cardBorder: "rgba(255,255,255,0.95)",
    cardPressed: "rgba(255,255,255,0.9)",
    glassTint: "rgba(255,255,255,0.62)",
    glassBorder: "rgba(255,255,255,0.9)",
    glassHighlight: "rgba(255,255,255,1)",
    blurTint: "systemChromeMaterialLight",
    text: "#17122A",
    textMuted: "#6A6385",
    border: "rgba(23, 18, 42, 0.08)",
    accent: "#7C3AED",
    accentSoft: "rgba(124, 58, 237, 0.12)",
    accentGradient: ["#8B5CF6", "#6D28D9"],
    accentText: "#FFFFFF",
    verified: "#D99A0B",
    like: "#E11D74",
    repost: "#059669",
    danger: "#DC2626",
    success: "#059669",
    overlay: "rgba(23, 18, 42, 0.35)",
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
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;
export const font = { xs: 12, sm: 13.5, md: 15, lg: 17, xl: 20, xxl: 24, title: 32 } as const;

/** Height reserved at the bottom of tab screens for the floating glass tab bar. */
export const TAB_BAR_HEIGHT = 64;
export const tabBarSpace = (bottomInset: number) => TAB_BAR_HEIGHT + Math.max(bottomInset, 12) + 16;
