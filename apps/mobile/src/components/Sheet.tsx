import { Ionicons } from "@expo/vector-icons";
import { create } from "zustand";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, useTheme } from "../theme";
import { Glass } from "./glass";
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
      <View style={{ paddingHorizontal: space.md, paddingBottom: insets.bottom + space.md }}>
        {/* Floating glass sheet, detached from the screen edges as in iOS 26. */}
        <Glass radius={radius.xl} style={{ paddingVertical: space.sm }}>
          <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: t.textMuted, opacity: 0.4, marginBottom: space.sm }} />
          {title ? (
            <Text muted size="sm" weight="600" style={{ paddingHorizontal: space.xl, paddingVertical: space.sm }}>
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
                marginHorizontal: space.sm,
                paddingHorizontal: space.lg,
                paddingVertical: 14,
                borderRadius: radius.md,
                backgroundColor: pressed ? t.cardPressed : "transparent",
              })}
            >
              {o.icon ? <Ionicons name={o.icon} size={20} color={o.destructive ? t.danger : t.text} /> : null}
              <Text weight="600" style={o.destructive ? { color: t.danger } : undefined}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </Glass>
        <Pressable onPress={close} accessibilityRole="button" style={{ marginTop: space.sm }}>
          <Glass radius={radius.pill} interactive style={{ paddingVertical: 15, alignItems: "center" }}>
            <Text weight="700">Cancel</Text>
          </Glass>
        </Pressable>
      </View>
    </Modal>
  );
}
