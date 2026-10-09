import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../store/auth";
import { space, useTheme } from "../theme";
import { Logo } from "./Logo";
import { Avatar, Text } from "./ui";

/** Top bar used on the tab screens: avatar (opens account menu) · title or logo · optional action. */
export function TabHeader({ title, right, children }: { title?: string; right?: ReactNode; children?: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: t.bg }}>
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg }}>
        <View style={{ width: 64 }}>
          <Avatar user={me} size={32} onPress={() => router.push("/account-menu")} />
        </View>
        <View style={{ flex: 1, alignItems: "center" }}>{title ? <Text weight="700" size="lg">{title}</Text> : <Logo size={28} />}</View>
        <View style={{ width: 64, alignItems: "flex-end" }}>{right}</View>
      </View>
      {children}
    </View>
  );
}
