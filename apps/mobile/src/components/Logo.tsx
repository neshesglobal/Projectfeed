import { View } from "react-native";
import { useTheme } from "../theme";
import { Text } from "./ui";

/** Placeholder wordmark until the brand is designed. */
export function Logo({ size = 28 }: { size?: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="Projectfeed"
      style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}
    >
      <Text weight="800" style={{ color: t.accentText, fontSize: size * 0.6, lineHeight: size * 0.75 }}>
        P
      </Text>
    </View>
  );
}
