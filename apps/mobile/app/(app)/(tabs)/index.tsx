import { Ionicons } from "@expo/vector-icons";
import type { FlashListRef } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { FeedItem, Page } from "@projectfeed/shared";
import { api } from "../../../src/api/client";
import { useFollowing, useForYou, useListTimeline, useMyLists } from "../../../src/api/hooks";
import { Fab } from "../../../src/components/Fab";
import { Feed } from "../../../src/components/Feed";
import { TabHeader } from "../../../src/components/HomeHeader";
import { Button, EmptyState, Screen, Text } from "../../../src/components/ui";
import { usePrefs } from "../../../src/store/prefs";
import { useSignals } from "../../../src/store/signals";
import { radius, space, useTheme } from "../../../src/theme";

function HomeTabs({ value, onChange, tabs }: { value: string; onChange: (k: string) => void; tabs: { key: string; label: string }[] }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: 1, borderBottomColor: t.border, flexGrow: 0 }} contentContainerStyle={{ flexGrow: 1 }}>
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{ flexGrow: 1, minWidth: 110, alignItems: "center", paddingTop: space.md, paddingHorizontal: space.lg }}
          >
            <Text weight={active ? "700" : "500"} muted={!active}>
              {tab.label}
            </Text>
            <View style={{ height: 4, width: active ? 56 : 0, borderRadius: 2, backgroundColor: t.accent, marginTop: space.md }} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ListFeed({ id }: { id: string }) {
  const q = useListTimeline(id);
  return <Feed query={q} surface={`list:${id}`} empty={<EmptyState title="No posts yet" body="Posts from members of this list will show up here." />} />;
}

export default function Home() {
  const t = useTheme();
  const tab = usePrefs((s) => s.homeTab);
  const setTab = usePrefs((s) => s.setHomeTab);
  const forYou = useForYou();
  const following = useFollowing();
  const lists = useMyLists();
  const feedRef = useRef<FlashListRef<unknown>>(null);
  const navigation = useNavigation();

  const pinned = (lists.data?.items ?? []).filter((l) => l.viewerPinned);
  const tabs = [{ key: "for-you", label: "For you" }, { key: "following", label: "Following" }, ...pinned.map((l) => ({ key: `list:${l.id}`, label: l.name }))];
  const activeTab = tabs.some((x) => x.key === tab) ? tab : "for-you";
  const active = activeTab === "following" ? following : forYou;

  // "New posts" pill: poll the Following timeline and compare with what is on screen.
  const newest = following.data?.pages[0]?.items[0]?.post.id;
  const latest = useQuery({
    queryKey: ["feed", "latest-check"],
    refetchInterval: 60_000,
    queryFn: () => api<Page<FeedItem>>("/feed/following?limit=3"),
  });
  const latestId = latest.data?.items[0]?.post.id;
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const hasNew = !!latestId && !!newest && BigInt(latestId) > BigInt(newest) && dismissedId !== latestId;

  const scrollTopAndRefresh = () => {
    feedRef.current?.scrollToOffset({ offset: 0, animated: true });
    setDismissedId(latestId ?? null);
    void active.refetch();
  };

  // After posting, jump to the top so the new post is visible.
  const scrollSignal = useSignals((s) => s.homeScrollTop);
  useEffect(() => {
    if (scrollSignal > 0) feedRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [scrollSignal]);

  // Tapping the Home tab while on Home scrolls to the top and refreshes, as on X.
  useEffect(() => {
    const unsub = navigation.addListener("tabPress" as never, () => {
      if (navigation.isFocused()) scrollTopAndRefresh();
    });
    return unsub;
  });

  return (
    <Screen>
      <TabHeader
        right={<Ionicons name="options-outline" size={22} color={t.text} onPress={() => router.push("/settings/display")} accessibilityLabel="Display settings" />}
      >
        <HomeTabs value={activeTab} onChange={setTab} tabs={tabs} />
      </TabHeader>
      <View style={{ flex: 1 }}>
        {activeTab.startsWith("list:") ? (
          <ListFeed id={activeTab.slice(5)} />
        ) : (
          <Feed
            key={activeTab}
            ref={feedRef as never}
            query={active}
            surface={activeTab}
            empty={
              activeTab === "following" ? (
                <EmptyState
                  title="Welcome to your timeline"
                  body="Follow people to see their posts here, newest first."
                  action={<Button title="Find people to follow" onPress={() => router.push("/connect")} />}
                />
              ) : (
                <EmptyState title="Nothing here yet" body="Be the first to post, or follow a few accounts to personalise this feed." />
              )
            }
          />
        )}
        {hasNew ? (
          <Pressable
            onPress={scrollTopAndRefresh}
            accessibilityRole="button"
            accessibilityLabel="Show new posts"
            style={{ position: "absolute", top: space.md, alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: t.accent, borderRadius: radius.pill, paddingHorizontal: space.lg, paddingVertical: space.sm }}
          >
            <Ionicons name="arrow-up" size={16} color={t.accentText} />
            <Text weight="700" size="sm" style={{ color: t.accentText }}>
              New posts
            </Text>
          </Pressable>
        ) : null}
        <Fab icon="add" label="Compose post" onPress={() => router.push("/compose")} />
      </View>
    </Screen>
  );
}
