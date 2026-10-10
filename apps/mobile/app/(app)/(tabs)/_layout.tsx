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
      <Tabs.Screen name="search" options={{ title: "Explore" }} />
      <Tabs.Screen name="reels" options={{ title: "Reels" }} />
      <Tabs.Screen name="notifications" options={{ title: "Activity", tabBarBadge: badge(unread.data?.notifications) }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", tabBarBadge: badge(unread.data?.messages) }} />
    </Tabs>
  );
}
