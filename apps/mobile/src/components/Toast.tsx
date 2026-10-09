import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { radius, space, useTheme } from "../theme";
import { Text } from "./ui";

interface ToastState {
  message: string | null;
  show: (m: string) => void;
  hide: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  hide: () => set({ message: null }),
}));

export const toast = (m: string) => useToast.getState().show(m);

export function ToastHost() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { message, hide } = useToast();
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(hide, 2800);
    return () => clearTimeout(id);
  }, [message, hide]);
  if (!message) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{ position: "absolute", left: space.lg, right: space.lg, bottom: insets.bottom + 72, alignItems: "center" }}
    >
      <View style={{ backgroundColor: t.accent, borderRadius: radius.sm, paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Text weight="600" style={{ color: t.accentText }}>
          {message}
        </Text>
      </View>
    </View>
  );
}
