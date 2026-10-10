import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { usePrefs } from "../store/prefs";
import { radius, space } from "../theme";
import { Text, type IconName } from "./ui";

const ACTIONS: { icon: IconName; colors: [string, string]; label: string; path: string }[] = [
  { icon: "people", colors: ["#34D399", "#059669"], label: "Find verified traders", path: "/connect" },
  { icon: "person-circle", colors: ["#F472B6", "#7C3AED"], label: "Complete your profile", path: "/edit-profile" },
  { icon: "chatbubble-ellipses", colors: ["#FBBF24", "#F97316"], label: "Ask the community", path: "/compose" },
];

/** First-run welcome card on Home (dismissible), in the spirit of the reference design's hero. */
export function WelcomeHero() {
  const dismiss = usePrefs((s) => s.dismissHero);
  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
      <LinearGradient
        colors={["#5B2BC4", "#3A1D86", "#24124F"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={{ borderRadius: radius.xl, padding: space.xl, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" }}
      >
        {/* Specular sheen across the top edge. */}
        <LinearGradient colors={["rgba(255,255,255,0.22)", "transparent"]} style={[StyleSheet.absoluteFill, { height: 90 }]} />
        {[[18, 30], [64, 70], [120, 22], [210, 48], [280, 18], [300, 96], [36, 140]].map(([x, y], i) => (
          <View key={i} style={{ position: "absolute", left: x, top: y, width: 2.5, height: 2.5, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.7)" }} />
        ))}
        <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10} style={{ position: "absolute", top: 14, right: 14, padding: 4 }}>
          <Ionicons name="close" size={20} color="rgba(255,255,255,0.85)" />
        </Pressable>
        <Text size="sm" style={{ color: "rgba(255,255,255,0.8)", textAlign: "center" }}>
          Built for verified trade professionals
        </Text>
        <Text weight="800" size="xxl" style={{ color: "#fff", textAlign: "center", marginTop: space.sm, lineHeight: 30 }}>
          Trade with confidence. Connect with people who are who they say they are.
        </Text>
        <Text size="sm" style={{ color: "rgba(255,255,255,0.75)", textAlign: "center", marginTop: space.sm, lineHeight: 20 }}>
          Market colour, deal talk and introductions — from an identity-verified network, not anonymous accounts.
        </Text>
        <View style={{ gap: space.sm, marginTop: space.lg }}>
          {ACTIONS.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => router.push(a.path as never)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                padding: space.md,
                borderRadius: radius.lg,
                backgroundColor: pressed ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.09)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.14)",
              })}
            >
              <LinearGradient colors={a.colors} style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name={a.icon} size={18} color="#fff" />
              </LinearGradient>
              <Text weight="600" style={{ color: "#fff", flex: 1 }}>
                {a.label}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.8)" />
            </Pressable>
          ))}
        </View>
      </LinearGradient>
    </View>
  );
}
