import { router } from "expo-router";
import { View } from "react-native";
import { Logo } from "../../src/components/Logo";
import { Button, Screen, Text } from "../../src/components/ui";
import { space, useTheme } from "../../src/theme";

export default function Welcome() {
  const t = useTheme();
  return (
    <Screen edges={["top", "bottom"]} style={{ paddingHorizontal: space.xxl }}>
      <View style={{ alignItems: "center", paddingTop: space.lg }}>
        <Logo size={36} />
      </View>
      <View style={{ flex: 1, justifyContent: "center", gap: space.lg }}>
        <Text weight="800" style={{ fontSize: 34, lineHeight: 40 }}>
          See what the market is talking about.
        </Text>
        <Text muted size="lg">
          Real-time conversation for commodity and trade professionals.
        </Text>
      </View>
      <View style={{ gap: space.md, paddingBottom: space.xl }}>
        <Button title="Create account" onPress={() => router.push("/signup")} />
        <Text muted size="sm" style={{ textAlign: "center" }}>
          By signing up, you agree to the Terms of Service and Privacy Policy.
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 4, marginTop: space.lg }}>
          <Text muted>Have an account already?</Text>
          <Text weight="700" style={{ color: t.accent }} onPress={() => router.push("/login")} accessibilityRole="link">
            Log in
          </Text>
        </View>
      </View>
    </Screen>
  );
}
