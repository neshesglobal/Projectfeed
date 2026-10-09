import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { useTheme } from "../theme";
import type { IconName } from "./ui";

/** Floating action button (compose / new message), bottom-right like X. */
export function Fab({ icon = "add", label, onPress }: { icon?: IconName; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        position: "absolute",
        right: 18,
        bottom: 18,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: t.accent,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.85 : 1,
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
      })}
    >
      <Ionicons name={icon} size={30} color={t.accentText} />
    </Pressable>
  );
}
