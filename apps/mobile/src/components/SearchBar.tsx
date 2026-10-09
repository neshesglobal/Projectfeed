import { Ionicons } from "@expo/vector-icons";
import { TextInput, View } from "react-native";
import { radius, space, useTheme } from "../theme";

export function SearchBar({ value, onChange, onSubmit, autoFocus }: { value: string; onChange: (v: string) => void; onSubmit: () => void; autoFocus?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: t.bgInput, borderRadius: radius.pill, paddingHorizontal: space.md, height: 40, gap: space.sm }}>
      <Ionicons name="search" size={16} color={t.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        placeholder="Search"
        placeholderTextColor={t.textMuted}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        accessibilityLabel="Search"
        style={{ flex: 1, color: t.text, fontSize: 15 }}
      />
      {value ? <Ionicons name="close-circle" size={18} color={t.textMuted} onPress={() => onChange("")} accessibilityLabel="Clear search" /> : null}
    </View>
  );
}

