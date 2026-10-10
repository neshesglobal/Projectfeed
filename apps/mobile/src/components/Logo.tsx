import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../theme";
import { Text } from "./ui";

/** Placeholder mark until the brand is designed: a glossy violet squircle. */
export function Logo({ size = 28 }: { size?: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="Projectfeed"
      style={{ width: size, height: size, borderRadius: size * 0.3, shadowColor: t.accentGradient[1], shadowOpacity: 0.5, shadowRadius: size * 0.4, shadowOffset: { width: 0, height: size * 0.12 } }}
    >
      <LinearGradient colors={t.accentGradient} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, borderRadius: size * 0.3, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <LinearGradient colors={["rgba(255,255,255,0.45)", "transparent"]} style={[StyleSheet.absoluteFill, { height: size * 0.5 }]} />
        <Text weight="800" style={{ color: "#fff", fontSize: size * 0.56, lineHeight: size * 0.72 }}>
          P
        </Text>
      </LinearGradient>
    </View>
  );
}
