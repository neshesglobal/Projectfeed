import { View } from "react-native";
import { useTheme } from "../theme";
import { Text } from "./ui";

/**
 * Brand mark (placeholder until the final logo asset is designed): a flat squircle in the theme's navy/blue
 * with the "P" monogram. No glow or gradient.
 */
export function Logo({ size = 28 }: { size?: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="Projectfeed"
      style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t.selected, alignItems: "center", justifyContent: "center" }}
    >
      <Text weight="800" allowFontScaling={false} style={{ color: "#fff", fontSize: size * 0.56, lineHeight: size * 0.72 }}>
        P
      </Text>
    </View>
  );
}
