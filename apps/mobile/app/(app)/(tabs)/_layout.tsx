import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useUnreadCounts } from "../../../src/api/hooks";
import { useTheme } from "../../../src/theme";

export default function TabsLayout() {
  const t = useTheme();
  const unread = useUnreadCounts();
  const badge = (n?: number) => (n && n > 0 ? (n > 99 ? "99+" : n) : undefined);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: t.text,
        tabBarInactiveTintColor: t.textMuted,
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.border },
        tabBarBadgeStyle: { backgroundColor: t.accent, color: t.accentText, fontSize: 11 },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "home" : "home-outline"} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "search" : "search-outline"} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Notifications",
          tabBarBadge: badge(unread.data?.notifications),
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "notifications" : "notifications-outline"} size={26} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarBadge: badge(unread.data?.messages),
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? "mail" : "mail-outline"} size={26} color={color} />,
        }}
      />
    </Tabs>
  );
}
