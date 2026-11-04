import type { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { spring } from "../theme/motion";
import { Pop } from "./motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, TAB_BAR_HEIGHT, useTheme } from "../theme";
import { Glass } from "./glass";
import { Icon, type IconSymbol } from "./Icon";
import { Text } from "./ui";

/** Props the router passes to a custom tab bar (React Navigation is bundled inside expo-router). */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, [IconSymbol, IconSymbol]> = {
  index: ["house", "house.fill"],
  discover: ["safari", "safari.fill"],
  search: ["chart.line.uptrend.xyaxis", "chart.line.uptrend.xyaxis"],
  reels: ["play.rectangle", "play.rectangle.fill"],
  notifications: ["bell", "bell.fill"],
};

/** Tab routes reached from elsewhere (Messages opens from the Home header), not shown in the bar. */
const HIDDEN = new Set(["messages"]);

/**
 * Floating tab bar on the platform material (native Liquid Glass on iOS 26, system blur on earlier iOS): five
 * destinations, SF Symbols, and the selected tab in the accent colour with a filled symbol and a dot.
 * Screens scroll underneath it (they reserve `tabBarSpace`).
 */
export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const onReels = state.routes[state.index]?.name === "reels";
  const reduce = useReducedMotion();
  const visible = state.routes.filter((r) => !HIDDEN.has(r.name));
  const selected = visible.findIndex((r) => r.key === state.routes[state.index]?.key);
  // A soft pill slides behind the selected tab (springs between tabs, so the eye follows the change).
  const [barWidth, setBarWidth] = useState(0);
  const slot = barWidth > 0 ? (barWidth - 12) / visible.length : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    if (!slot || selected < 0) return;
    const to = 6 + selected * slot + slot * 0.12;
    x.value = reduce || x.value === 0 ? to : withSpring(to, spring.snappy);
  }, [slot, selected, reduce, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(insets.bottom, 12), alignItems: "center" }}>
      <Glass
        native
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        radius={radius.pill}
        tint={onReels ? "rgba(10,8,20,0.55)" : undefined}
        style={{
          height: TAB_BAR_HEIGHT,
          width: "92%",
          maxWidth: 520,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 6,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: t.mode === "dark" ? 0.35 : 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 12,
        }}
      >
        {slot > 0 && selected >= 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              { position: "absolute", left: 0, top: 6, height: TAB_BAR_HEIGHT - 12, width: slot * 0.76, borderRadius: radius.pill, backgroundColor: onReels ? "rgba(255,255,255,0.14)" : t.accentSoft },
              pill,
            ]}
          />
        ) : null}
        {state.routes.map((route, index) => {
          if (HIDDEN.has(route.name)) return null;
          const focused = state.index === index;
          const opts = descriptors[route.key]!.options;
          const [off, on] = ICONS[route.name] ?? ["house", "house.fill"];
          const badge = opts.tabBarBadge;
          const color = focused ? (onReels ? "#fff" : t.accent) : onReels ? "rgba(255,255,255,0.7)" : t.textMuted;
          const label = typeof opts.title === "string" ? opts.title : route.name;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (Platform.OS !== "web") void Haptics.selectionAsync();
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={`${label}${badge ? `, ${badge} new` : ""}`}
              style={{ flex: 1, height: TAB_BAR_HEIGHT - 12, alignItems: "center", justifyContent: "center" }}
            >
              <TabIcon focused={focused} name={focused ? on : off} color={color} />
              <Text weight={focused ? "600" : "500"} style={{ color, marginTop: 3, fontSize: 11 }} numberOfLines={1}>
                {label}
              </Text>
              {/* Selection is shown by colour, a filled symbol and a dot, so it doesn't rely on colour alone. */}
              <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: focused ? color : "transparent" }} />
              {badge !== undefined ? (
                <View
                  style={{
                    position: "absolute",
                    top: 4,
                    left: "54%",
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 5,
                    backgroundColor: t.like,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1.5,
                    borderColor: t.mode === "dark" ? t.bg : "#fff",
                  }}
                >
                  <Pop value={badge}>
                    <Text weight="800" style={{ color: "#fff", fontSize: 10 }}>
                      {String(badge)}
                    </Text>
                  </Pop>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </Glass>
      <View style={{ height: space.xs }} />
    </View>
  );
}

/** The selected tab's symbol pops once (a quick dip and spring) as it becomes selected. */
function TabIcon({ focused, name, color }: { focused: boolean; name: IconSymbol; color: string }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (focused && !reduce) s.value = withSequence(withTiming(0.82, { duration: 90 }), withSpring(1, spring.bouncy));
  }, [focused, reduce, s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Animated.View style={anim}>
      <Icon name={name} size={23} color={color} weight={focused ? "semibold" : "regular"} />
    </Animated.View>
  );
}
