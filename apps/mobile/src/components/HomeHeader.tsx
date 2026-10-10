import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../store/auth";
import { space } from "../theme";
import { Avatar, Text } from "./ui";

/**
 * Large-title header for tab screens (Apple style): bold title on the left, actions and the
 * account avatar on the right, optional search/chips underneath. Sits directly on the backdrop.
 */
export function TabHeader({ title = "Projectfeed", right, children }: { title?: string; right?: ReactNode; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  return (
    <View style={{ paddingTop: insets.top + space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <Text weight="800" size="title" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Text>
        {right}
        <Avatar user={me} size={36} onPress={() => router.push("/account-menu")} />
      </View>
      {children}
    </View>
  );
}
