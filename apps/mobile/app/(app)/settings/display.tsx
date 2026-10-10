import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, View } from "react-native";
import { Group, Header, Screen, Text } from "../../../src/components/ui";
import { usePrefs, type ThemePref } from "../../../src/store/prefs";
import { radius, space, themes, useTheme } from "../../../src/theme";

const OPTIONS: { key: ThemePref; label: string; body: string }[] = [
  { key: "system", label: "Automatic", body: "Match your device" },
  { key: "dark", label: "Midnight", body: "Deep violet glass" },
  { key: "light", label: "Daylight", body: "Soft lavender glass" },
];

export default function Display() {
  const t = useTheme();
  const pref = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const current = pref === "dim" ? "dark" : pref;
  const density = usePrefs((s) => s.density);
  const setDensity = usePrefs((s) => s.setDensity);
  return (
    <Screen>
      <Header title="Appearance" />
      <View style={{ flexDirection: "row", gap: space.md, padding: space.lg }}>
        {(["dark", "light"] as const).map((m) => (
          <LinearGradient key={m} colors={themes[m].gradient} style={{ flex: 1, height: 120, borderRadius: radius.lg, padding: space.md, justifyContent: "flex-end", borderWidth: 1, borderColor: t.cardBorder }}>
            <View style={{ height: 22, borderRadius: radius.pill, backgroundColor: themes[m].glassTint, borderWidth: 1, borderColor: themes[m].glassBorder }} />
          </LinearGradient>
        ))}
      </View>
      <Group>
        {OPTIONS.map((o, i) => (
          <Pressable
            key={o.key}
            onPress={() => setTheme(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: current === o.key }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              padding: space.lg,
              backgroundColor: pressed ? t.cardPressed : "transparent",
              borderTopWidth: i ? 1 : 0,
              borderTopColor: t.border,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text weight="600">{o.label}</Text>
              <Text muted size="sm">
                {o.body}
              </Text>
            </View>
            {current === o.key ? <Ionicons name="checkmark-circle" size={22} color={t.accent} /> : <Ionicons name="ellipse-outline" size={22} color={t.textMuted} />}
          </Pressable>
        ))}
      </Group>
      <Text muted size="sm" weight="600" style={{ marginLeft: space.xl, marginTop: space.xl, marginBottom: space.sm }}>
        FEED DENSITY
      </Text>
      <Group>
        {(
          [
            ["dense", "Dense (default)", "Most posts per screen, one continuous panel"],
            ["compact", "Compact", "Separate glass cards, about 4 posts per screen"],
            ["comfortable", "Comfortable", "Roomier cards, repost labels as pills, view counts"],
          ] as const
        ).map(([key, label, body], i) => (
          <Pressable
            key={key}
            onPress={() => setDensity(key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: density === key }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              padding: space.lg,
              backgroundColor: pressed ? t.cardPressed : "transparent",
              borderTopWidth: i ? 1 : 0,
              borderTopColor: t.border,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text weight="600">{label}</Text>
              <Text muted size="sm">
                {body}
              </Text>
            </View>
            {density === key ? <Ionicons name="checkmark-circle" size={22} color={t.accent} /> : <Ionicons name="ellipse-outline" size={22} color={t.textMuted} />}
          </Pressable>
        ))}
      </Group>
    </Screen>
  );
}
