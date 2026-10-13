import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, View } from "react-native";
import type { MapPickerProps, MapPreviewProps } from "./types";
import { Text } from "../ui";
import { useTheme } from "../../theme";

/**
 * Web fallback. The native apps show a real Apple or Google map; the web preview draws a stylised
 * map tile with the pin (no third-party tile server, so no tile-usage terms or keys to manage).
 */
function Tile({ height, radius, children }: { height: number; radius: number; children?: React.ReactNode }) {
  const t = useTheme();
  const road = (s: object) => <View style={[{ position: "absolute", backgroundColor: t.mode === "light" ? "#FFFFFF" : "#3A4459" }, s]} />;
  return (
    <View style={{ height, borderRadius: radius, overflow: "hidden", backgroundColor: t.mode === "light" ? "#E8EEF3" : "#1B2230" }}>
      <LinearGradient colors={["transparent", t.mode === "light" ? "#CFE3F0" : "#183247"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.35 }} />
      {road({ left: -20, right: -20, top: height * 0.38, height: 9, transform: [{ rotate: "4deg" }] })}
      {road({ top: -20, bottom: -20, left: "38%", width: 9, transform: [{ rotate: "12deg" }] })}
      {road({ top: -20, bottom: -20, left: "72%", width: 6, transform: [{ rotate: "-6deg" }] })}
      {road({ left: -20, right: -20, top: height * 0.16, height: 5, transform: [{ rotate: "-3deg" }] })}
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>{children}</View>
    </View>
  );
}

export function MapPreview({ lat, lng, name, height = 160, radius = 16, onPress }: MapPreviewProps) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Map of ${name}`}>
      <Tile height={height} radius={radius}>
        <Ionicons name="location" size={40} color={t.accent} style={{ marginBottom: 30 }} />
        <Text size="xs" muted style={{ position: "absolute", right: 8, bottom: 6 }}>
          {lat.toFixed(4)}, {lng.toFixed(4)}
        </Text>
      </Tile>
    </Pressable>
  );
}

export function MapPicker({ lat, lng, height = 260 }: MapPickerProps) {
  const t = useTheme();
  return (
    <Tile height={height} radius={16}>
      <Ionicons name="location" size={40} color={t.accent} style={{ marginBottom: 30 }} />
      <Text size="xs" muted style={{ position: "absolute", left: 10, right: 10, bottom: 8, textAlign: "center" }}>
        Pin at {lat.toFixed(5)}, {lng.toFixed(5)} · drag the map in the app to move it
      </Text>
    </Tile>
  );
}
