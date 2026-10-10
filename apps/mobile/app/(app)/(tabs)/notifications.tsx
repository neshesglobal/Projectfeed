import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, RefreshControl, View } from "react-native";
import type { NotificationItem } from "@projectfeed/shared";
import { api, errorMessage } from "../../../src/api/client";
import { useNotifications } from "../../../src/api/hooks";
import { TabHeader } from "../../../src/components/HomeHeader";
import { PostCard } from "../../../src/components/PostCard";
import { Card } from "../../../src/components/glass";
import { Avatar, EmptyState, ErrorView, IconButton, Loading, Screen, Text, TopTabs } from "../../../src/components/ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, space, tabBarSpace, useTheme } from "../../../src/theme";

const VERBS: Record<string, string> = {
  like: "liked your post",
  repost: "reposted your post",
  follow: "followed you",
  follow_request: "requested to follow you",
  poll_ended: "'s poll has ended",
};

function GroupedNotification({ n }: { n: NotificationItem }) {
  const t = useTheme();
  const first = n.actors[0];
  if (!first) return null;
  const icon = n.type === "like" ? "heart" : n.type === "repost" ? "repeat" : "person";
  const color = n.type === "like" ? t.like : n.type === "repost" ? t.repost : t.accent;
  const others = n.actorCount - 1;
  const onPress = () => {
    if (n.type === "follow_request") router.push("/follow-requests");
    else if (n.post) router.push(`/post/${n.post.id}`);
    else router.push(`/user/${first.handle}`);
  };
  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
    <Card onPress={onPress} style={{ flexDirection: "row", gap: space.md, borderRadius: radius.xl, borderColor: n.read ? t.cardBorder : `${t.accent}88` }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: `${color}22` }}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1, gap: space.sm }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {n.actors.map((a) => (
            <Avatar key={a.id} user={a} size={32} onPress={() => router.push(`/user/${a.handle}`)} />
          ))}
        </View>
        <Text>
          <Text weight="700">{first.displayName}</Text>
          {others > 0 ? ` and ${others} ${others === 1 ? "other" : "others"}` : ""} {VERBS[n.type] ?? ""}
        </Text>
        {n.post?.text ? (
          <Text muted numberOfLines={3}>
            {n.post.text}
          </Text>
        ) : null}
      </View>
    </Card>
    </View>
  );
}

export default function Notifications() {
  const [tab, setTab] = useState<"all" | "verified" | "mentions">("all");
  const q = useNotifications(tab);
  const qc = useQueryClient();
  const t = useTheme();
  const insets = useSafeAreaInsets();

  // Opening the tab marks everything read and clears the badge.
  useFocusEffect(
    useCallback(() => {
      void api("/notifications/read", { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["unread"] }));
    }, [qc]),
  );

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <TabHeader title="Activity" right={<IconButton name="settings-outline" glass size={18} label="Settings" onPress={() => router.push("/settings")} />}>
        <TopTabs
          tabs={[
            { key: "all", label: "All" },
            { key: "verified", label: "Verified" },
            { key: "mentions", label: "Mentions" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </TabHeader>
      <FlashList
        data={items}
        contentContainerStyle={{ paddingBottom: tabBarSpace(insets.bottom) + 24 }}
        keyExtractor={(n) => n.id}
        getItemType={(n) => (n.type === "reply" || n.type === "mention" || n.type === "quote" ? "post" : "grouped")}
        renderItem={({ item }) =>
          (item.type === "reply" || item.type === "mention" || item.type === "quote") && item.post ? (
            <PostCard post={item.post} surface="notifications" />
          ) : (
            <GroupedNotification n={item} />
          )
        }
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.accent} />}
        ListEmptyComponent={
          q.isLoading ? (
            <Loading />
          ) : q.isError ? (
            <ErrorView message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
          ) : (
            <EmptyState
              title={tab === "mentions" ? "Nothing to see here — yet" : "Join the conversation"}
              body={tab === "mentions" ? "When someone mentions you, you'll find it here." : "Likes, reposts, replies and new followers will show up here."}
            />
          )
        }
        ListFooterComponent={q.isFetchingNextPage ? <Loading /> : null}
      />
    </Screen>
  );
}
