// Reusable motion primitives. Timing comes from theme/motion; every piece honours Reduce Motion.

import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { duration, easing, spring } from "../theme/motion";
import { radius, space, useTheme } from "../theme";
import { Text } from "./ui";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A Pressable that sinks slightly under the finger and springs back: the basic touch response for buttons,
 * cards and chips. `to` is the pressed scale.
 */
export function PressScale({
  children,
  to = 0.96,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style"> & { children: ReactNode; to?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        if (!reduce) s.value = withSpring(to, spring.press);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, spring.press);
        onPressOut?.(e);
      }}
      style={[style, anim]}
    >
      {children}
    </AnimatedPressable>
  );
}

/** A number that rolls up or down when it changes (like and repost counts). */
export function RollingNumber({ value, format, color, size = "sm" }: { value: number; format: (n: number) => string; color: string; size?: "xs" | "sm" | "md" }) {
  const reduce = useReducedMotion();
  const prev = useRef(value);
  const y = useSharedValue(0);
  const o = useSharedValue(1);
  useEffect(() => {
    if (prev.current === value) return;
    const up = value > prev.current;
    prev.current = value;
    if (reduce) return;
    y.value = up ? 10 : -10;
    o.value = 0;
    y.value = withSpring(0, spring.snappy);
    o.value = withTiming(1, { duration: duration.fast });
  }, [value, reduce, y, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={anim}>
      <Text size={size} style={{ color, fontVariant: ["tabular-nums"] }}>
        {format(value)}
      </Text>
    </Animated.View>
  );
}

/**
 * Like burst: a ring that expands and fades, and six sparks flying out. Mount it behind the heart and
 * change `trigger` to fire it.
 */
export function Burst({ trigger, color, size = 20 }: { trigger: number; color: string; size?: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(1);
  useEffect(() => {
    if (trigger === 0 || reduce) return;
    p.value = 0;
    p.value = withTiming(1, { duration: 520, easing: easing.enter });
  }, [trigger, reduce, p]);
  const ring = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.15, 1], [0, 0.55, 0]),
    transform: [{ scale: interpolate(p.value, [0, 1], [0.3, 1.9]) }],
  }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View style={[{ position: "absolute", width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color }, ring]} />
      {Array.from({ length: 6 }, (_, i) => (
        <Spark key={i} p={p} angle={(i / 6) * Math.PI * 2 - Math.PI / 2} color={color} distance={size * 1.15} />
      ))}
    </View>
  );
}

function Spark({ p, angle, color, distance }: { p: { value: number }; angle: number; color: string; distance: number }) {
  const anim = useAnimatedStyle(() => {
    const d = interpolate(p.value, [0, 1], [distance * 0.35, distance]);
    return {
      opacity: interpolate(p.value, [0, 0.2, 0.8, 1], [0, 1, 0.6, 0]),
      transform: [{ translateX: Math.cos(angle) * d }, { translateY: Math.sin(angle) * d }, { scale: interpolate(p.value, [0, 1], [1, 0.4]) }],
    };
  });
  return <Animated.View style={[{ position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: color }, anim]} />;
}

/** Shimmering placeholder block, shown while content loads. */
export function Skeleton({ width, height, round, style }: { width: number | `${number}%`; height: number; round?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (reduce || !w) return;
    x.value = 0;
    x.value = withRepeat(withTiming(1, { duration: 1300, easing: easing.standard }), -1, false);
    return () => cancelAnimation(x);
  }, [reduce, w, x]);
  const sheen = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(x.value, [0, 1], [-w, w]) }] }));
  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: round ? height / 2 : radius.sm, backgroundColor: t.bgInput, overflow: "hidden" }, style]}
    >
      {reduce ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, sheen]}>
          <LinearGradient
            colors={["transparent", t.mode === "dark" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.7)", "transparent"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/** A post-shaped placeholder: avatar, name line, two lines of text, actions. */
export function PostSkeleton({ media }: { media?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space.md, padding: space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border }}>
      <Skeleton width={40} height={40} round />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton width="45%" height={12} />
        <Skeleton width="95%" height={12} />
        <Skeleton width="70%" height={12} />
        {media ? <Skeleton width="100%" height={170} style={{ borderRadius: radius.lg, marginTop: 4 }} /> : null}
        <View style={{ flexDirection: "row", gap: space.xl, marginTop: 4 }}>
          <Skeleton width={34} height={10} />
          <Skeleton width={34} height={10} />
          <Skeleton width={34} height={10} />
        </View>
      </View>
    </View>
  );
}

/** A first screenful of post placeholders; the second has media so the rhythm looks like a real feed. */
export function FeedSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <PostSkeleton key={i} media={i % 3 === 1} />
      ))}
    </View>
  );
}

/** A list of person-shaped placeholders (people search, followers, inbox). */
export function RowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }}>
          <Skeleton width={44} height={44} round />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="40%" height={12} />
            <Skeleton width="65%" height={10} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Slow drift up and down, for illustrations in empty states. */
export function Float({ children, amplitude = 5 }: { children: ReactNode; amplitude?: number }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withRepeat(withSequence(withTiming(-amplitude, { duration: 1600, easing: easing.standard }), withTiming(0, { duration: 1600, easing: easing.standard })), -1);
    return () => cancelAnimation(y);
  }, [reduce, amplitude, y]);
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={anim}>{children}</Animated.View>;
}

/** Pops (scale overshoot) whenever `value` changes: unread badges, counters. */
export function Pop({ value, children }: { value: unknown; children: ReactNode }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduce) return;
    s.value = withSequence(withTiming(1.35, { duration: 110 }), withSpring(1, spring.bouncy));
  }, [value, reduce, s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={anim}>{children}</Animated.View>;
}

/**
 * Ambient background: soft colour fields drifting slowly behind brand moments (welcome, sign-in, the Home hero).
 * Reduce Motion: the same composition, still.
 */
export function Aurora({ colors, style }: { colors: [string, string, string]; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withRepeat(withTiming(1, { duration: duration.ambient, easing: easing.standard }), -1, true);
    return () => cancelAnimation(p);
  }, [reduce, p]);
  const a = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(p.value, [0, 1], [-40, 50]) }, { translateY: interpolate(p.value, [0, 1], [-20, 40]) }, { scale: interpolate(p.value, [0, 1], [1, 1.15]) }],
  }));
  const b = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(p.value, [0, 1], [40, -60]) }, { translateY: interpolate(p.value, [0, 1], [30, -30]) }, { scale: interpolate(p.value, [0, 1], [1.1, 0.95]) }],
  }));
  const c = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.5, 0.85]) }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }, style]}>
      <Animated.View style={[{ position: "absolute", top: -200, left: -180 }, a]}>
        <Glow size={520} color={colors[0]} strength={0.7} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", bottom: -200, right: -200 }, b]}>
        <Glow size={500} color={colors[1]} strength={0.6} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", top: "30%", left: "15%" }, c]}>
        <Glow size={360} color={colors[2]} strength={0.55} />
      </Animated.View>
    </View>
  );
}

/** A soft radial light: full colour at the centre fading to nothing at the edge (a true radial gradient). */
function Glow({ size, color, strength }: { size: number; color: string; strength: number }) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const gradient = `radial-gradient(circle closest-side, rgba(${r}, ${g}, ${b}, ${strength}) 0%, rgba(${r}, ${g}, ${b}, ${strength * 0.45}) 45%, rgba(${r}, ${g}, ${b}, 0) 100%)`;
  // React Native draws CSS gradients natively (experimental_backgroundImage); the web build uses the CSS property.
  const style = Platform.OS === "web" ? ({ backgroundImage: gradient } as ViewStyle) : ({ experimental_backgroundImage: gradient } as ViewStyle);
  return <View style={[{ width: size, height: size, borderRadius: size / 2 }, style]} />;
}

/** Children appear one after another (headline, then body, then actions). */
export function Reveal({ children, delay = 0, rise = 16 }: { children: ReactNode; delay?: number; rise?: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    p.value = withDelay(delay, withTiming(1, { duration: duration.slow, easing: easing.enter }));
  }, [reduce, delay, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * rise }] }));
  return <Animated.View style={anim}>{children}</Animated.View>;
}

/** A small light that fades in and out on its own rhythm (decorative stars on brand cards). */
export function Twinkle({ x, y, delay = 0, size = 2.5 }: { x: number; y: number; delay?: number; size?: number }) {
  const reduce = useReducedMotion();
  const o = useSharedValue(0.7);
  useEffect(() => {
    if (reduce) return;
    o.value = withDelay(delay, withRepeat(withSequence(withTiming(0.15, { duration: 1400 }), withTiming(0.9, { duration: 1400 })), -1));
    return () => cancelAnimation(o);
  }, [reduce, delay, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: "#fff" }, anim]} />;
}

/** Very slow push-in on a still image (profile banners): makes a photo feel alive without drawing the eye. */
export function KenBurns({ children, height }: { children: ReactNode; height: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withRepeat(withTiming(1, { duration: 14000, easing: easing.standard }), -1, true);
    return () => cancelAnimation(p);
  }, [reduce, p]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(p.value, [0, 1], [1, 1.08]) }, { translateX: interpolate(p.value, [0, 1], [0, -8]) }] }));
  return (
    <View style={{ height, overflow: "hidden" }}>
      <Animated.View style={[{ height }, anim]}>{children}</Animated.View>
    </View>
  );
}
