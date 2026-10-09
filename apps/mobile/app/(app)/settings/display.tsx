import { Pressable, View } from "react-native";
import { Header, Screen, Text } from "../../../src/components/ui";
import { usePrefs, type ThemePref } from "../../../src/store/prefs";
import { radius, space, themes, useTheme } from "../../../src/theme";

const OPTIONS: { key: ThemePref; label: string; bg: string; fg: string }[] = [
  { key: "system", label: "Use device setting", bg: "transparent", fg: "" },
  { key: "light", label: "Default", bg: themes.light.bg, fg: themes.light.text },
  { key: "dim", label: "Dim", bg: themes.dim.bg, fg: themes.dim.text },
  { key: "dark", label: "Lights out", bg: themes.dark.bg, fg: themes.dark.text },
];

export default function Display() {
  const t = useTheme();
  const pref = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  return (
    <Screen>
      <Header title="Display" />
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text muted>Manage your background. These settings affect this device only.</Text>
        {OPTIONS.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => setTheme(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: pref === o.key }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: space.lg,
              borderRadius: radius.md,
              borderWidth: 2,
              borderColor: pref === o.key ? t.accent : t.border,
              backgroundColor: o.key === "system" ? t.bg : o.bg,
            }}
          >
            <Text weight="700" style={o.fg ? { color: o.fg } : undefined}>
              {o.label}
            </Text>
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: t.accent, backgroundColor: pref === o.key ? t.accent : "transparent" }} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
