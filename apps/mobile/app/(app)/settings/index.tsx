import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { Group, Header, Screen, Text, type IconName } from "../../../src/components/ui";
import { space, useTheme } from "../../../src/theme";

function Row({ icon, title, body, path, first }: { icon: IconName; title: string; body: string; path: string; first?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => router.push(path as never)}
      style={({ pressed }) => ({ flexDirection: "row", gap: space.md, padding: space.lg, alignItems: "center", backgroundColor: pressed ? t.cardPressed : "transparent", borderTopWidth: first ? 0 : 1, borderTopColor: t.border })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={18} color={t.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text>{title}</Text>
        <Text muted size="sm">
          {body}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );
}

export default function Settings() {
  return (
    <Screen>
      <Header title="Settings" />
      <ScrollView contentContainerStyle={{ paddingTop: space.sm, paddingBottom: 60 }}>
        <Group>
        <Row first icon="person-outline" title="Your account" body="Password, sessions, download your data, delete account" path="/settings/account" />
        <Row icon="shield-checkmark-outline" title="Verification" body="Identity verification status" path="/settings/verification" />
        <Row icon="lock-closed-outline" title="Privacy and safety" body="Protected posts, blocked and muted accounts" path="/settings/privacy" />
        <Row icon="volume-mute-outline" title="Muted words" body="Hide posts containing words, #hashtags or $cashtags" path="/settings/muted-words" />
        <Row icon="color-palette-outline" title="Appearance" body="Midnight, Dark or Daylight · feed density" path="/settings/display" />
        <Row icon="information-circle-outline" title="About" body="Terms, privacy policy, version" path="/settings/about" />
        </Group>
      </ScrollView>
    </Screen>
  );
}
