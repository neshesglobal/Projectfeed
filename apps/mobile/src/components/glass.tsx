import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { useEffect, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { radius as R, space, useTheme } from "../theme";
import { Text } from "./ui";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { duration } from "../theme/motion";
import { PressScale } from "./motion";

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
  native,
  onLayout,
}: {
  children?: ReactNode;
  onLayout?: ViewProps["onLayout"];
  style?: StyleProp<ViewStyle>;
  radius?: number;
  interactive?: boolean;
  tint?: string;
  intensity?: number;
  /**
   * Use Apple's native Liquid Glass on iOS 26+. Only for chrome over moving content (the tab bar): it is very
   * clear and turns pale over bright content, so panels that carry text (sheets, toolbars, menus) use the
   * themed frosted material below instead.
   */
  native?: boolean;
}) {
  const t = useTheme();
  const shape: ViewStyle = { borderRadius: radius, overflow: "hidden" };

  if (NATIVE_GLASS && native) {
    return (
      // Follow the app's theme, not the phone's: otherwise a dark app on a phone set to light shows pale glass.
      <GlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tint} colorScheme={t.mode} style={[shape, style]} onLayout={onLayout}>
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
      <View style={[shape, { backgroundColor: tint ?? t.glassTint }, style]} onLayout={onLayout}>
        {children}
        {edge}
      </View>
    );
  }

  // The material layers sit at zIndex −1 inside their own stacking context (zIndex 0 on the container):
  // on web, absolutely positioned layers would otherwise paint over non-positioned children such as inputs.
  return (
    <View style={[shape, { zIndex: 0 }, style]} onLayout={onLayout}>
      <BlurView intensity={intensity} tint={t.blurTint} style={[StyleSheet.absoluteFill, { zIndex: -1 }]} />
      {/* A strong theme tint over the blur keeps text readable whatever is behind the panel. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: -1, backgroundColor: tint ?? t.glassTint }]} />
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
    <PressScale {...rest} onPress={onPress} to={0.98} style={[base, style]}>
      {children}
    </PressScale>
  );
}

/** Filter capsule. Selected: solid deep navy (day) or bright blue (night); unselected: hairline outline. */
export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; icon?: ReactNode }) {
  const t = useTheme();
  // Selection fades between outline and fill rather than snapping, so the change reads as one movement.
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.value = withTiming(active ? 1 : 0, { duration: duration.fast });
  }, [active, on]);
  const fill = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], ["rgba(0,0,0,0)", t.selected]),
    borderColor: interpolateColor(on.value, [0, 1], [t.cardBorder, t.selected]),
  }));
  return (
    <PressScale onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: !!active }} to={0.94} style={{ borderRadius: R.pill }}>
      <Animated.View
        style={[
          { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: StyleSheet.hairlineWidth * 2 },
          fill,
        ]}
      >
        {icon}
        <Text weight={active ? "600" : "500"} size="sm" style={{ color: active ? "#FFFFFF" : t.text }}>
          {label}
        </Text>
      </Animated.View>
    </PressScale>
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
