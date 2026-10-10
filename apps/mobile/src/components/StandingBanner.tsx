import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useStanding } from "../api/hooks";
import { Glass } from "./glass";
import { Text } from "./ui";
import { radius, space, useTheme } from "../theme";

/** Shown at the top of Home when the account is restricted or has an unread moderation decision. */
export function StandingBanner() {
  const t = useTheme();
  const s = useStanding().data;
  if (!s || (s.status === "active" && s.unread === 0)) return null;
  const restricted = s.status !== "active";
  const title = s.status === "suspended" ? "Your account is suspended" : s.status === "frozen" ? "Your account is under review" : "We've made a decision about your account";
  const body = restricted ? "Read-only for now. Tap for details." : "Tap to see why and appeal if you disagree.";
  return (
    <Pressable onPress={() => router.push("/settings/standing")} accessibilityRole="button" style={{ marginHorizontal: space.lg, marginTop: space.sm }}>
      <Glass radius={radius.lg} style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: restricted ? "rgba(255,90,106,0.16)" : t.accentSoft }}>
          <Ionicons name={restricted ? "alert-circle" : "mail-unread-outline"} size={19} color={restricted ? t.danger : t.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text weight="700" size="sm">
            {title}
          </Text>
          <Text muted size="sm">
            {body}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
      </Glass>
    </Pressable>
  );
}
