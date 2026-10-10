import { Ionicons } from "@expo/vector-icons";
import { Pressable, TextInput, View } from "react-native";
import { radius, space, useTheme } from "../theme";
import { Glass } from "./glass";

/** Glass search capsule with an optional circular filter button beside it (as in the reference design). */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  autoFocus,
  placeholder = "Search people, posts, #topics, $tickers",
  onFilter,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  onFilter?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <Glass radius={radius.pill} style={{ flex: 1, height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, gap: space.sm }}>
        <Ionicons name="search" size={18} color={t.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={t.textMuted}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          accessibilityLabel="Search"
          style={{ flex: 1, color: t.text, fontSize: 15, height: 48 }}
        />
        {value ? <Ionicons name="close-circle" size={18} color={t.textMuted} onPress={() => onChange("")} accessibilityLabel="Clear search" /> : null}
      </Glass>
      {onFilter ? (
        <Pressable onPress={onFilter} accessibilityRole="button" accessibilityLabel="Search filters" hitSlop={4}>
          <Glass radius={radius.pill} interactive style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="options-outline" size={20} color={t.text} />
          </Glass>
        </Pressable>
      ) : null}
    </View>
  );
}
