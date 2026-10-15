import { Ionicons } from "@expo/vector-icons";
import { FlashList } from "@shopify/flash-list";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactElement, ReactNode } from "react";
import { Pressable, RefreshControl, useWindowDimensions, View } from "react-native";
import type { FeedItem, Page } from "@projectfeed/shared";
import { formatDuration } from "../lib/upload";
import { useTheme } from "../theme";
import { Loading, Text } from "./ui";
import { usePullRefresh } from "../lib/usePullRefresh";

/** Profile "Media" tab: a 3-column grid of photos and videos. */
export function MediaTabGrid({
  query,
  header,
  empty,
}: {
  query: UseInfiniteQueryResult<InfiniteData<Page<FeedItem> & Record<string, unknown>>>;
  header: ReactElement;
  empty: ReactNode;
}) {
  const t = useTheme();
  const pull = usePullRefresh(query.refetch);
  const { width } = useWindowDimensions();
  const size = Math.floor((Math.min(width, 700) - 4) / 3);
  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => i.post.media.length > 0);

  return (
    <FlashList
      data={items}
      numColumns={3}
      keyExtractor={(i) => i.post.id}
      ListHeaderComponent={header}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={t.accent} />}
      ListEmptyComponent={query.isLoading ? <Loading /> : <>{empty}</>}
      ListFooterComponent={query.isFetchingNextPage ? <Loading /> : <View style={{ height: 120 }} />}
      renderItem={({ item }) => {
        const m = item.post.media[0]!;
        const isVideo = m.type === "video";
        return (
          <Pressable
            onPress={() => router.push(isVideo ? `/reels/${item.post.id}` : `/post/${item.post.id}`)}
            accessibilityRole="imagebutton"
            accessibilityLabel={isVideo ? `Video, ${formatDuration(m.durationMs)}` : m.altText || "Photo"}
            style={{ width: size, height: size, margin: 0.5, backgroundColor: t.bgInput }}
          >
            {m.thumbUrl ? <Image source={{ uri: m.thumbUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={120} /> : null}
            {isVideo ? (
              <View style={{ position: "absolute", left: 4, bottom: 4, flexDirection: "row", alignItems: "center", gap: 2 }}>
                <Ionicons name="play" size={12} color="#fff" />
                <Text size="xs" weight="700" style={{ color: "#fff", textShadowColor: "#000", textShadowRadius: 3 }}>
                  {formatDuration(m.durationMs)}
                </Text>
              </View>
            ) : item.post.media.length > 1 ? (
              <Ionicons name="copy" size={14} color="#fff" style={{ position: "absolute", top: 5, right: 5 }} />
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
