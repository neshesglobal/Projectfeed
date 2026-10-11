import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, View } from "react-native";
import { LANGUAGES, languageByCode } from "@projectfeed/shared";
import { useTranslationConfig } from "../../../src/api/hooks";
import { Group, Header, Screen, Text } from "../../../src/components/ui";
import { deviceLanguage } from "../../../src/lib/language";
import { usePrefs } from "../../../src/store/prefs";
import { space, useTheme } from "../../../src/theme";

function Option({ label, sub, checked, first, onPress }: { label: string; sub?: string; checked: boolean; first?: boolean; onPress: () => void }) {
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
        paddingHorizontal: space.lg,
        paddingVertical: 13,
        backgroundColor: pressed ? t.cardPressed : "transparent",
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.border,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text weight="600" style={{ textAlign: "left", writingDirection: "ltr" }}>
          {label}
        </Text>
        {sub ? (
          <Text muted size="sm">
            {sub}
          </Text>
        ) : null}
      </View>
      <Ionicons name={checked ? "checkmark-circle" : "ellipse-outline"} size={22} color={checked ? t.accent : t.textMuted} />
    </Pressable>
  );
}

/** Settings → Language: which language "Translate post" translates into. */
export default function LanguageSettings() {
  const pref = usePrefs((s) => s.translateTo);
  const setPref = usePrefs((s) => s.setTranslateTo);
  const config = useTranslationConfig().data;
  const device = languageByCode(deviceLanguage());
  const available = LANGUAGES.filter((l) => !config || config.languages.includes(l.code));

  return (
    <Screen>
      <Header title="Language" />
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <Text muted size="sm" style={{ marginHorizontal: space.xl, marginTop: space.sm, marginBottom: space.md }}>
          Posts written in another language show a Translate button. Choose the language you want them translated into.
        </Text>
        {config && !config.enabled ? (
          <Text muted size="sm" style={{ marginHorizontal: space.xl, marginBottom: space.md }}>
            Translation is currently unavailable.
          </Text>
        ) : null}
        <Text muted size="sm" weight="600" style={{ marginLeft: space.xl, marginBottom: space.sm }}>
          TRANSLATE POSTS INTO
        </Text>
        <Group>
          <Option first label="Automatic" sub={`Use my phone's language (${device?.native ?? "English"})`} checked={pref === null} onPress={() => setPref(null)} />
          {available.map((l) => (
            <Option key={l.code} label={l.native} sub={l.name} checked={pref === l.code} onPress={() => setPref(l.code)} />
          ))}
        </Group>
      </ScrollView>
    </Screen>
  );
}
