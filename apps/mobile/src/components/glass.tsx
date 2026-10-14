import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { radius as R, space, useTheme } from "../theme";
import { Text } from "./ui";

/** Native Liquid Glass is only available on iOS 26+. */
const NATIVE_GLASS = Platform.OS === "ios" && (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

/**
 * The glass material for navigation-layer surfaces (tab bar, top bars, sheets, search, floating buttons).
 * - iOS 26+: Apple's native Liquid Glass (refraction, specular highlights, adaptive tint).
 * - Older iOS & web: system blur + tint + a specular top edge.
 * - Android: tinted translucent fill (real-time blur on Android is costly and inconsistent across devices).
 */
export function Glass({
  children,
  style,
  radius = R.xl,
  interactive,
  tint,
  intensity = 60,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  interactive?: boolean;
  tint?: string;
  intensity?: number;
}) {
  const t = useTheme();
  const shape: ViewStyle = { borderRadius: radius, overflow: "hidden" };

  if (NATIVE_GLASS) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tint} style={[shape, style]}>
        {children}
      </GlassView>
    );
  }

  const edge = (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: t.glassBorder,
          borderTopColor: t.glassHighlight,
        },
      ]}
    />
  );

  if (Platform.OS === "android") {
    return (
      <View style={[shape, { backgroundColor: tint ?? t.glassTint }, style]}>
        {children}
        {edge}
      </View>
    );
  }

  // The material layers sit at zIndex −1 inside their own stacking context (zIndex 0 on the container):
  // on web, absolutely positioned layers would otherwise paint over non-positioned children such as inputs.
  return (
    <View style={[shape, { zIndex: 0 }, style]}>
      <BlurView intensity={intensity} tint={t.blurTint} style={[StyleSheet.absoluteFill, { zIndex: -1 }]} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: -1, backgroundColor: tint ?? t.glassTint, opacity: 0.55 }]} />
      {children}
      {edge}
    </View>
  );
}

/** Full-screen backdrop: the flat theme background (content takes priority over decoration). */
export function Backdrop() {
  const t = useTheme();
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} />;
}

/** Frosted content card (no live blur, so long feeds stay at 60fps). */
export function Card({
  children,
  style,
  onPress,
  padding = space.lg,
  ...rest
}: { children?: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padding?: number } & Omit<PressableProps, "style" | "children" | "onPress">) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.card,
    borderRadius: R.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: t.cardBorder,
    padding,
    ...(t.mode === "light"
      ? { shadowColor: "#4C1D95", shadowOpacity: 0.06, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }
      : null),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable {...rest} onPress={onPress} style={({ pressed }) => [base, pressed && { backgroundColor: t.cardPressed }, style]}>
      {children}
    </Pressable>
  );
}

/** Filter capsule. Selected: solid deep navy (day) or bright blue (night); unselected: hairline outline. */
export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: ReactNode }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 14,
        borderRadius: R.pill,
        backgroundColor: active ? t.selected : pressed ? t.cardPressed : "transparent",
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: active ? t.selected : t.cardBorder,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon}
      <Text weight={active ? "600" : "500"} size="sm" style={{ color: active ? "#FFFFFF" : t.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Small section heading used across screens ("What's happening", "Suggested for you"). */
export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: space.lg, marginTop: space.xl, marginBottom: space.md }}>
      <Text weight="800" size="xl" style={{ letterSpacing: -0.3 }}>
        {title}
      </Text>
      {action ? (
        <Text weight="600" size="sm" style={{ color: t.accent }} onPress={onAction} accessibilityRole="link">
          {action}
        </Text>
      ) : null}
    </View>
  );
}
