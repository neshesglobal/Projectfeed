import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { Header, Screen, Text } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { space, useTheme } from "../../../src/theme";

/** Placeholder for the KYC flow (vendor SDK). See docs/DEV_PLAN.md §2. */
export default function Verification() {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const verified = (me?.kycLevel ?? 0) >= 1;
  return (
    <Screen>
      <Header title="Verification" />
      <View style={{ padding: space.xl, gap: space.lg, alignItems: "center" }}>
        <Ionicons name={verified ? "checkmark-circle" : "shield-outline"} size={64} color={verified ? t.accent : t.textMuted} />
        <Text weight="800" size="xl" style={{ textAlign: "center" }}>
          {verified ? "Your identity is verified" : "Identity verification is coming soon"}
        </Text>
        <Text muted style={{ textAlign: "center" }}>
          {verified
            ? "Your profile shows the ID verified badge."
            : "Every Projectfeed account will verify a government photo ID with a quick selfie check. Verified accounts get the gold badge, and it keeps the network free of bots and impersonators."}
        </Text>
      </View>
    </Screen>
  );
}
