import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { tabBarSpace, useTheme } from "../theme";
import type { IconName } from "./ui";

/** Floating action button: a glowing gradient orb that sits just above the floating tab bar. */
export function Fab({ icon = "add", label, onPress, aboveTabBar = true }: { icon?: IconName; label: string; onPress: () => void; aboveTabBar?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        position: "absolute",
        right: 20,
        bottom: aboveTabBar ? tabBarSpace(insets.bottom) : insets.bottom + 20,
        borderRadius: 30,
        transform: [{ scale: pressed ? 0.93 : 1 }],
        shadowColor: t.accentGradient[1],
        shadowOpacity: 0.6,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
      })}
    >
      <LinearGradient
        colors={t.accentGradient}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={{ width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" }}
      >
        <Ionicons name={icon} size={28} color="#fff" />
      </LinearGradient>
    </Pressable>
  );
}
