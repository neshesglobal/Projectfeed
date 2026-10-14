import { Ionicons } from "@expo/vector-icons";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { ComponentProps } from "react";
import { Platform } from "react-native";

type IonName = ComponentProps<typeof Ionicons>["name"];

/** SF Symbols used across the app, with the closest Ionicons glyph for Android and the web. */
const FALLBACK = {
  magnifyingglass: "search",
  paperplane: "paper-plane-outline",
  "paperplane.fill": "paper-plane",
  heart: "heart-outline",
  "heart.fill": "heart",
  bubble: "chatbubble-outline",
  "arrow.2.squarepath": "repeat",
  bookmark: "bookmark-outline",
  "bookmark.fill": "bookmark",
  "square.and.arrow.up": "share-outline",
  mappin: "location-outline",
  ellipsis: "ellipsis-horizontal",
  plus: "add",
  house: "home-outline",
  "house.fill": "home",
  safari: "compass-outline",
  "safari.fill": "compass",
  "chart.line.uptrend.xyaxis": "trending-up",
  "play.rectangle": "play-circle-outline",
  "play.rectangle.fill": "play-circle",
  bell: "notifications-outline",
  "bell.fill": "notifications",
  "star.fill": "star",
  star: "star-outline",
  "star.leadinghalf.filled": "star-half",
  "checkmark.seal.fill": "checkmark-circle",
  airplane: "airplane-outline",
  "fork.knife": "restaurant-outline",
  "mountain.2": "triangle-outline",
  pin: "pin",
  sparkles: "sparkles",
  "chart.bar": "stats-chart-outline",
  person: "person-outline",
  folder: "folder-open-outline",
  "list.bullet": "list-outline",
  "person.2": "people-outline",
  "person.badge.plus": "person-add-outline",
  "checkmark.shield": "shield-checkmark-outline",
  gearshape: "settings-outline",
  "rectangle.portrait.and.arrow.right": "log-out-outline",
} satisfies Record<string, IonName>;

export type IconSymbol = keyof typeof FALLBACK;

/** One icon, drawn natively: SF Symbols on iPhone (crisp, weight-matched to San Francisco), Ionicons elsewhere. */
export function Icon({ name, size = 20, color, weight = "regular" }: { name: IconSymbol; size?: number; color: string; weight?: "regular" | "medium" | "semibold" }) {
  const fallback = <Ionicons name={FALLBACK[name]} size={size} color={color} />;
  if (Platform.OS !== "ios") return fallback;
  return <SymbolView name={name as SFSymbol} size={size} tintColor={color} weight={weight} type="monochrome" fallback={fallback} />;
}
