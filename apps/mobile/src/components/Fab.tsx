import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Platform, Pressable } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { spring } from "../theme/motion";
import { tabBarSpace, useTheme } from "../theme";
import { Icon } from "./Icon";
import type { IconName } from "./ui";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Compose button: a solid 56 pt circle in the accent fill, bottom-right and clear of the tab bar.
 * It springs in when the screen appears, sinks and turns its plus a quarter under the finger.
 * `icon` is kept for callers; the glyph is always the SF Symbol "plus".
 */
export function Fab({ label, onPress, aboveTabBar = true }: { icon?: IconName; label: string; onPress: () => void; aboveTabBar?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const appear = useSharedValue(reduce ? 1 : 0);
  const press = useSharedValue(0);
  useEffect(() => {
    if (!reduce) appear.value = withDelay(150, withSpring(1, spring.bouncy));
  }, [reduce, appear]);
  const body = useAnimatedStyle(() => ({ transform: [{ scale: appear.value * (1 - press.value * 0.08) }] }));
  const glyph = useAnimatedStyle(() => ({ transform: [{ rotate: `${press.value * 90}deg` }] }));
  return (
    <AnimatedPressable
      onPressIn={() => {
        if (!reduce) press.value = withSpring(1, spring.press);
      }}
      onPressOut={() => {
        press.value = withSpring(0, spring.snappy);
      }}
      onPress={() => {
        if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        {
          position: "absolute",
          right: 16,
          bottom: aboveTabBar ? tabBarSpace(insets.bottom) : insets.bottom + 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.accentGradient[0],
          shadowColor: t.accent,
          shadowOpacity: t.mode === "dark" ? 0.45 : 0.3,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 8,
        },
        body,
      ]}
    >
      <Animated.View style={glyph}>
        <Icon name="plus" size={24} color="#FFFFFF" weight="semibold" />
      </Animated.View>
    </AnimatedPressable>
  );
}
