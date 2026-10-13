import { Tabs } from "expo-router";
import { useUnreadCounts } from "../../../src/api/hooks";
import { GlassTabBar } from "../../../src/components/GlassTabBar";

export default function TabsLayout() {
  const unread = useUnreadCounts();
  const badge = (n?: number) => (n && n > 0 ? (n > 99 ? "99+" : n) : undefined);

  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" } }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      <Tabs.Screen name="search" options={{ title: "Trends" }} />
      <Tabs.Screen name="reels" options={{ title: "Reels" }} />
      <Tabs.Screen name="notifications" options={{ title: "Activity", tabBarBadge: badge(unread.data?.notifications) }} />
      {/* Messages lives in the Home header (five tabs fit the floating bar); the route stays a tab so its state is kept. */}
      <Tabs.Screen name="messages" options={{ title: "Messages", tabBarBadge: badge(unread.data?.messages) }} />
    </Tabs>
  );
}
