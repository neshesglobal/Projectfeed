import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Group, Header, Screen, Text } from "../../../src/components/ui";
import { usePrefs, type ThemePref } from "../../../src/store/prefs";
import { radius, space, themes, useTheme, type ThemeName } from "../../../src/theme";

const LOOKS: { pref: ThemePref; theme: ThemeName; label: string; body: string }[] = [
  { pref: "dark", theme: "midnight", label: "Midnight", body: "Deep violet glass" },
  { pref: "black", theme: "dark", label: "Dark", body: "True dark · OLED friendly" },
  { pref: "light", theme: "light", label: "Daylight", body: "Soft lavender glass" },
];

/** Miniature of the app in a given theme: backdrop, a post card and the floating tab bar. */
function Preview({ name, selected }: { name: ThemeName; selected: boolean }) {
  const th = themes[name];
  const line = (w: number | `${number}%`, o = 1) => <View style={{ height: 5, width: w, borderRadius: 3, backgroundColor: th.text, opacity: 0.55 * o }} />;
  return (
    <LinearGradient
      colors={th.gradient}
      style={{ height: 150, borderRadius: radius.lg, padding: 8, justifyContent: "space-between", borderWidth: 2, borderColor: selected ? th.accent : th.cardBorder, overflow: "hidden" }}
    >
      <View style={{ backgroundColor: th.card, borderColor: th.cardBorder, borderWidth: 1, borderRadius: 10, padding: 7, gap: 5 }}>
        <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
          <LinearGradient colors={th.accentGradient} style={{ width: 14, height: 14, borderRadius: 7 }} />
          {line(30)}
        </View>
        {line("100%", 0.8)}
        {line("70%", 0.8)}
      </View>
      <View style={{ height: 20, borderRadius: 10, backgroundColor: th.glassTint, borderWidth: 1, borderColor: th.glassBorder, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === 0 ? th.accent : th.textMuted }} />
        ))}
      </View>
    </LinearGradient>
  );
}

function RadioRow({ label, body, checked, first, onPress, left }: { label: string; body: string; checked: boolean; first?: boolean; onPress: () => void; left?: ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.lg,
        backgroundColor: pressed ? t.cardPressed : "transparent",
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.border,
      })}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text weight="600">{label}</Text>
        <Text muted size="sm">
          {body}
        </Text>
      </View>
      <Ionicons name={checked ? "checkmark-circle" : "ellipse-outline"} size={22} color={checked ? t.accent : t.textMuted} />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text muted size="sm" weight="600" style={{ marginLeft: space.xl, marginTop: space.xl, marginBottom: space.sm }}>
      {children}
    </Text>
  );
}

export default function Display() {
  const pref = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const autoDark = usePrefs((s) => s.autoDark);
  const setAutoDark = usePrefs((s) => s.setAutoDark);
  const density = usePrefs((s) => s.density);
  const setDensity = usePrefs((s) => s.setDensity);
  const current: ThemePref = pref === "dim" ? "dark" : pref;

  return (
    <Screen>
      <Header title="Appearance" />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm }}>
          {LOOKS.map((l) => (
            <Pressable key={l.pref} onPress={() => setTheme(l.pref)} accessibilityRole="radio" accessibilityState={{ checked: current === l.pref }} accessibilityLabel={l.label} style={{ flex: 1, gap: 6 }}>
              <Preview name={l.theme} selected={current === l.pref} />
              <Text size="sm" weight={current === l.pref ? "700" : "500"} style={{ textAlign: "center" }}>
                {l.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <SectionLabel>THEME</SectionLabel>
        <Group>
          <RadioRow first label="Automatic" body="Daylight by day, your dark look at night" checked={current === "system"} onPress={() => setTheme("system")} />
          {LOOKS.map((l) => (
            <RadioRow key={l.pref} label={l.label} body={l.body} checked={current === l.pref} onPress={() => setTheme(l.pref)} />
          ))}
        </Group>

        {current === "system" ? (
          <>
            <SectionLabel>AT NIGHT, USE</SectionLabel>
            <Group>
              <RadioRow first label="Midnight" body="Deep violet glass" checked={autoDark === "midnight"} onPress={() => setAutoDark("midnight")} />
              <RadioRow label="Dark" body="True dark · OLED friendly" checked={autoDark === "dark"} onPress={() => setAutoDark("dark")} />
            </Group>
          </>
        ) : null}

        <SectionLabel>FEED DENSITY</SectionLabel>
        <Group>
          {(
            [
              ["dense", "Dense (default)", "Most posts per screen, one continuous panel"],
              ["compact", "Compact", "Separate glass cards, about 4 posts per screen"],
              ["comfortable", "Comfortable", "Roomier cards, repost labels as pills, view counts"],
            ] as const
          ).map(([key, label, body], i) => (
            <RadioRow key={key} first={i === 0} label={label} body={body} checked={density === key} onPress={() => setDensity(key)} />
          ))}
        </Group>
      </ScrollView>
    </Screen>
  );
}
