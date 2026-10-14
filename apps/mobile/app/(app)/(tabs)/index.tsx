import { Ionicons } from "@expo/vector-icons";
import type { FlashListRef } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { FeedItem, Page } from "@projectfeed/shared";
import { api } from "../../../src/api/client";
import { useFollowing, useForYou, useListTimeline, useMyLists, useSearchPosts, useUnreadCounts } from "../../../src/api/hooks";
import { Fab } from "../../../src/components/Fab";
import { Feed } from "../../../src/components/Feed";
import { FeedFilters, HomeTopBar, type FeedFilter } from "../../../src/components/HomeHeader";
import { Glass } from "../../../src/components/glass";
import { Button, EmptyState, Screen, Text } from "../../../src/components/ui";
import { StandingBanner } from "../../../src/components/StandingBanner";
import { WelcomeHero } from "../../../src/components/WelcomeHero";
import { useAuth } from "../../../src/store/auth";
import { usePrefs } from "../../../src/store/prefs";
import { useSignals } from "../../../src/store/signals";
import { radius, space, useTheme } from "../../../src/theme";

function ListFeed({ id }: { id: string }) {
  const q = useListTimeline(id);
  return <Feed query={q} surface={`list:${id}`} empty={<EmptyState title="No posts yet" body="Posts from members of this list will show up here." />} />;
}

/** Topic filters: each is the feed for one hashtag (top posts), reusing post search. */
const TOPICS: FeedFilter[] = [
  { key: "topic:travel", label: "Travel", icon: "airplane" },
  { key: "topic:food", label: "Food", icon: "fork.knife" },
  { key: "topic:outdoors", label: "Outdoors", icon: "mountain.2" },
];

function TopicFeed({ tag }: { tag: string }) {
  const q = useSearchPosts(`#${tag}`, "top");
  return <Feed query={q} surface={`topic:${tag}`} empty={<EmptyState title={`No #${tag} posts yet`} body={`Posts tagged #${tag} will show up here.`} />} />;
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
  const tabs: FeedFilter[] = [{ key: "for-you", label: "For you" }, { key: "following", label: "Following" }, ...pinned.map((l) => ({ key: `list:${l.id}`, label: l.name }))];
  const activeTab = [...tabs, ...TOPICS].some((x) => x.key === tab) ? tab : "for-you";
  const unread = useUnreadCounts();
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
      <HomeTopBar unreadMessages={unread.data?.messages ?? 0} />
      <FeedFilters primary={tabs} topics={TOPICS} value={activeTab} onChange={setTab} />
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
      <View style={{ flex: 1 }}>
        {activeTab.startsWith("list:") ? (
          <ListFeed id={activeTab.slice(5)} />
        ) : activeTab.startsWith("topic:") ? (
          <TopicFeed key={activeTab} tag={activeTab.slice(6)} />
        ) : (
          <Feed
            key={activeTab}
            ref={feedRef as never}
            query={active}
            surface={activeTab}
            header={
              <>
                <StandingBanner />
                {activeTab === "for-you" && !heroDismissed && (me?.followingCount ?? 0) < 5 ? <WelcomeHero /> : null}
              </>
            }
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
