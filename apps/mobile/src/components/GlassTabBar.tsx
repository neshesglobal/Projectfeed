import { Ionicons } from "@expo/vector-icons";
import type { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, TAB_BAR_HEIGHT, useTheme } from "../theme";
import { Glass } from "./glass";
import { Text, type IconName } from "./ui";

/** Props the router passes to a custom tab bar (React Navigation is bundled inside expo-router). */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ICONS: Record<string, [IconName, IconName]> = {
  index: ["home-outline", "home"],
  search: ["compass-outline", "compass"],
  reels: ["play-circle-outline", "play-circle"],
  notifications: ["notifications-outline", "notifications"],
  messages: ["chatbubbles-outline", "chatbubbles"],
};

/**
 * Floating Liquid Glass tab bar: a detached capsule above the home indicator, with a lens-like
 * highlight behind the active tab. Screens scroll underneath it (they reserve `tabBarSpace`).
 */
export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const onReels = state.routes[state.index]?.name === "reels";

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: Math.max(insets.bottom, 12), alignItems: "center" }}>
      <Glass
        radius={radius.pill}
        tint={onReels ? "rgba(10,8,20,0.55)" : undefined}
        style={{
          height: TAB_BAR_HEIGHT,
          width: "92%",
          maxWidth: 520,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 6,
          shadowColor: "#000",
          shadowOpacity: t.mode === "dark" ? 0.45 : 0.12,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 10 },
          elevation: 12,
        }}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const opts = descriptors[route.key]!.options;
          const [off, on] = ICONS[route.name] ?? ["ellipse-outline", "ellipse"];
          const badge = opts.tabBarBadge;
          const color = focused ? (onReels || t.mode === "dark" ? "#fff" : t.accent) : onReels ? "rgba(255,255,255,0.7)" : t.textMuted;
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
              {focused ? (
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 2,
                    right: 2,
                    borderRadius: radius.pill,
                    backgroundColor: onReels ? "rgba(255,255,255,0.16)" : t.accentSoft,
                    borderWidth: 1,
                    borderColor: onReels ? "rgba(255,255,255,0.18)" : t.glassBorder,
                  }}
                />
              ) : null}
              <Ionicons name={focused ? on : off} size={22} color={color} />
              <Text size="xs" weight={focused ? "700" : "500"} style={{ color, marginTop: 2, fontSize: 10.5 }} numberOfLines={1}>
                {label}
              </Text>
              {badge !== undefined ? (
                <View
                  style={{
                    position: "absolute",
                    top: 2,
                    left: "56%",
                    minWidth: 18,
                    height: 18,
                    borderRadius: 9,
                    paddingHorizontal: 5,
                    backgroundColor: t.like,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1.5,
                    borderColor: t.mode === "dark" ? "#1A1230" : "#fff",
                  }}
                >
                  <Text weight="800" style={{ color: "#fff", fontSize: 10 }}>
                    {String(badge)}
                  </Text>
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
