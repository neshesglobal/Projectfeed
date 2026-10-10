import { Ionicons } from "@expo/vector-icons";
import type { FlashListRef } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { FeedItem, Page } from "@projectfeed/shared";
import { api } from "../../../src/api/client";
import { useFollowing, useForYou, useListTimeline, useMyLists } from "../../../src/api/hooks";
import { Fab } from "../../../src/components/Fab";
import { Feed } from "../../../src/components/Feed";
import { TabHeader } from "../../../src/components/HomeHeader";
import { Glass } from "../../../src/components/glass";
import { Button, EmptyState, IconButton, Screen, Text, TopTabs } from "../../../src/components/ui";
import { WelcomeHero } from "../../../src/components/WelcomeHero";
import { useAuth } from "../../../src/store/auth";
import { usePrefs } from "../../../src/store/prefs";
import { useSignals } from "../../../src/store/signals";
import { radius, space, useTheme } from "../../../src/theme";

function ListFeed({ id }: { id: string }) {
  const q = useListTimeline(id);
  return <Feed query={q} surface={`list:${id}`} empty={<EmptyState title="No posts yet" body="Posts from members of this list will show up here." />} />;
}

export default function Home() {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const heroDismissed = usePrefs((s) => s.heroDismissed);
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
      <TabHeader title="Projectfeed" right={<IconButton name="color-palette-outline" glass size={18} label="Appearance" onPress={() => router.push("/settings/display")} />}>
        <TopTabs value={activeTab} onChange={setTab} tabs={tabs} />
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
            header={activeTab === "for-you" && !heroDismissed && (me?.followingCount ?? 0) < 5 ? <WelcomeHero /> : null}
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
          <Pressable onPress={scrollTopAndRefresh} accessibilityRole="button" accessibilityLabel="Show new posts" style={{ position: "absolute", top: space.sm, alignSelf: "center" }}>
            <Glass radius={radius.pill} interactive style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.lg, paddingVertical: 10 }}>
              <Ionicons name="arrow-up" size={16} color={t.accent} />
              <Text weight="700" size="sm">
                New posts
              </Text>
            </Glass>
          </Pressable>
        ) : null}
        <Fab icon="add" label="Compose post" onPress={() => router.push("/compose")} />
      </View>
    </Screen>
  );
}
