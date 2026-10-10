import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { View } from "react-native";
import { Glass } from "../../src/components/glass";
import { Logo } from "../../src/components/Logo";
import { Button, Screen, Text, type IconName } from "../../src/components/ui";
import { radius, space, useTheme } from "../../src/theme";

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: "shield-checkmark", title: "Verified people only", body: "Every account is ID-verified — no bots, no impersonators." },
  { icon: "pulse", title: "Real-time market talk", body: "Petroleum, metals, ags, freight and trade finance." },
  { icon: "play-circle", title: "Reels from the field", body: "Short video from terminals, vaults and vessels." },
];

export default function Welcome() {
  const t = useTheme();
  return (
    <Screen edges={["top", "bottom"]} style={{ paddingHorizontal: space.xl }}>
      <View style={{ flex: 1, justifyContent: "center", gap: space.xl }}>
        <Logo size={64} />
        <View style={{ gap: space.sm }}>
          <Text weight="800" style={{ fontSize: 38, lineHeight: 44, letterSpacing: -1 }}>
            The trusted network for global trade.
          </Text>
          <Text muted size="lg" style={{ lineHeight: 24 }}>
            Connect, share and discover with verified commodity professionals.
          </Text>
        </View>
        <Glass radius={radius.xl} style={{ padding: space.lg, gap: space.lg }}>
          {POINTS.map((p) => (
            <View key={p.title} style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={p.icon} size={20} color={t.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text weight="700">{p.title}</Text>
                <Text muted size="sm">
                  {p.body}
                </Text>
              </View>
            </View>
          ))}
        </Glass>
      </View>
      <View style={{ gap: space.md, paddingBottom: space.lg }}>
        <Button title="Create account" onPress={() => router.push("/signup")} />
        <Button title="I already have an account" variant="outline" onPress={() => router.push("/login")} />
        <Text muted size="xs" style={{ textAlign: "center", marginTop: space.xs }}>
          By continuing you agree to the Terms of Service and Privacy Policy.
        </Text>
      </View>
    </Screen>
  );
}
