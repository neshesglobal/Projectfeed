import { Ionicons } from "@expo/vector-icons";
import { create } from "zustand";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, useTheme } from "../theme";
import { Text, type IconName } from "./ui";

export interface SheetOption {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

interface SheetState {
  options: SheetOption[] | null;
  title?: string;
  open: (options: SheetOption[], title?: string) => void;
  close: () => void;
}

/** One global bottom sheet (cross-platform action sheet), opened imperatively from anywhere. */
export const useSheet = create<SheetState>((set) => ({
  options: null,
  open: (options, title) => set({ options, title }),
  close: () => set({ options: null, title: undefined }),
}));

export function SheetHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { options, title, close } = useSheet();
  return (
    <Modal visible={!!options} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={{ flex: 1, backgroundColor: t.overlay }} onPress={close} accessibilityLabel="Close menu" />
      <View
        style={{
          backgroundColor: t.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingBottom: insets.bottom + space.md,
          paddingTop: space.sm,
        }}
      >
        <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: t.border, marginBottom: space.sm }} />
        {title ? (
          <Text muted size="sm" style={{ paddingHorizontal: space.xl, paddingVertical: space.sm }}>
            {title}
          </Text>
        ) : null}
        {options?.map((o) => (
          <Pressable
            key={o.label}
            accessibilityRole="button"
            onPress={() => {
              close();
              // Let the sheet close before the action opens another modal or navigates.
              setTimeout(o.onPress, 50);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.lg,
              paddingHorizontal: space.xl,
              paddingVertical: space.lg,
              backgroundColor: pressed ? t.bgElevated : "transparent",
            })}
          >
            {o.icon ? <Ionicons name={o.icon} size={20} color={o.destructive ? t.danger : t.text} /> : null}
            <Text weight="700" style={o.destructive ? { color: t.danger } : undefined}>
              {o.label}
            </Text>
          </Pressable>
        ))}
        <Pressable onPress={close} style={{ marginHorizontal: space.lg, marginTop: space.sm, borderWidth: 1, borderColor: t.border, borderRadius: radius.pill, paddingVertical: space.md, alignItems: "center" }}>
          <Text weight="700">Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
