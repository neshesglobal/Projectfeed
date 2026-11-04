import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import Animated, { ReduceMotion, SlideInUp } from "react-native-reanimated";
import { fadeOut } from "../theme/motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { radius, space, useTheme } from "../theme";
import { Glass } from "./glass";
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
    <Animated.View
      key={message}
      // Drops in from the status bar with a spring, fades away.
      entering={SlideInUp.springify().damping(16).stiffness(220).reduceMotion(ReduceMotion.System)}
      exiting={fadeOut()}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{ position: "absolute", left: space.lg, right: space.lg, top: insets.top + space.sm, alignItems: "center" }}
    >
      <Glass radius={radius.pill} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Ionicons name="checkmark-circle" size={18} color={t.accent} />
        <Text weight="600">{message}</Text>
      </Glass>
    </Animated.View>
  );
}
