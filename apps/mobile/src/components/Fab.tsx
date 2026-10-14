import * as Haptics from "expo-haptics";
import { Platform, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tabBarSpace, useTheme } from "../theme";
import { Icon } from "./Icon";
import type { IconName } from "./ui";

/**
 * Compose button: a solid 56 pt circle in the accent fill, bottom-right and clear of the tab bar.
 * `icon` is kept for callers; the glyph is always the SF Symbol "plus".
 */
export function Fab({ label, onPress, aboveTabBar = true }: { icon?: IconName; label: string; onPress: () => void; aboveTabBar?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={() => {
        if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        position: "absolute",
        right: 16,
        bottom: aboveTabBar ? tabBarSpace(insets.bottom) : insets.bottom + 20,
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.accentGradient[0],
        transform: [{ scale: pressed ? 0.94 : 1 }],
        shadowColor: "#000",
        shadowOpacity: t.mode === "dark" ? 0.4 : 0.18,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 6,
      })}
    >
      <Icon name="plus" size={24} color="#FFFFFF" weight="semibold" />
    </Pressable>
  );
}
