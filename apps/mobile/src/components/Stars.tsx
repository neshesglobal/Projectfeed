import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";

export const STAR = "#F2C14E";

/** Read-only star row, with half stars for averages. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }} accessibilityLabel={`${value.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={value >= i ? "star" : value >= i - 0.5 ? "star-half" : "star-outline"} size={size} color={STAR} />
      ))}
    </View>
  );
}

/** Tappable star rating for the review composer. */
export function StarInput({ value, onChange, size = 32 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 5, now: value }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable key={i} onPress={() => onChange(i)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`${i} star${i > 1 ? "s" : ""}`}>
          <Ionicons name={value >= i ? "star" : "star-outline"} size={size} color={STAR} />
        </Pressable>
      ))}
    </View>
  );
}
