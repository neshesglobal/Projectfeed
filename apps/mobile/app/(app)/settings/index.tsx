import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { Header, Screen, Text, type IconName } from "../../../src/components/ui";
import { space, useTheme } from "../../../src/theme";

function Row({ icon, title, body, path }: { icon: IconName; title: string; body: string; path: string }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => router.push(path as never)} style={({ pressed }) => ({ flexDirection: "row", gap: space.lg, padding: space.lg, alignItems: "center", backgroundColor: pressed ? t.bgElevated : t.bg })}>
      <Ionicons name={icon} size={22} color={t.textMuted} />
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
      <ScrollView>
        <Row icon="person-outline" title="Your account" body="Password, sessions, download your data, delete account" path="/settings/account" />
        <Row icon="shield-checkmark-outline" title="Verification" body="Identity verification status" path="/settings/verification" />
        <Row icon="lock-closed-outline" title="Privacy and safety" body="Protected posts, blocked and muted accounts" path="/settings/privacy" />
        <Row icon="volume-mute-outline" title="Muted words" body="Hide posts containing words, #hashtags or $cashtags" path="/settings/muted-words" />
        <Row icon="color-palette-outline" title="Display" body="Theme: light, dim or lights out" path="/settings/display" />
        <Row icon="information-circle-outline" title="About" body="Terms, privacy policy, version" path="/settings/about" />
      </ScrollView>
    </Screen>
  );
}
