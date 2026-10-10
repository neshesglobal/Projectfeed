import { FlashList, type FlashListRef } from "@shopify/flash-list";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { forwardRef, useCallback, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { RefreshControl, View, type ViewToken } from "react-native";
import type { FeedItem, Page, UserSummary } from "@projectfeed/shared";
import { errorMessage } from "../api/client";
import { postHidden, postVisible } from "../lib/events";
import { usePlayback, videoKey } from "../store/playback";
import { space, useTheme } from "../theme";
import { FeedItemCard } from "./PostCard";
import { router } from "expo-router";
import { SectionTitle } from "./glass";
import { SuggestionCards } from "./SuggestionCards";
import { EmptyState, ErrorView, Loading } from "./ui";

type Row = { kind: "post"; item: FeedItem; key: string } | { kind: "suggestions"; users: UserSummary[]; key: string };

interface Props {
  query: UseInfiniteQueryResult<InfiniteData<Page<FeedItem> & Record<string, unknown>>>;
  surface: string;
  header?: ReactElement | null;
  empty?: ReactNode;
  pinned?: FeedItem | null;
  contentTopInset?: number;
}

function Suggestions({ users }: { users: UserSummary[] }) {
  if (users.length === 0) return null;
  return (
    <View style={{ paddingVertical: space.sm }}>
      <SectionTitle title="Suggested connections" action="See all" onAction={() => router.push("/connect")} />
      <SuggestionCards users={users} />
    </View>
  );
}

/** Infinite, pull-to-refresh post feed with impression/dwell logging. */
export const Feed = forwardRef<FlashListRef<Row>, Props>(function Feed({ query, surface, header, empty, pinned, contentTopInset = 0 }, ref) {
  const t = useTheme();
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    if (pinned) {
      out.push({ kind: "post", item: { ...pinned, reason: "Pinned" }, key: `pinned:${pinned.post.id}` });
      seen.add(pinned.post.id);
    }
    for (const page of query.data?.pages ?? []) {
      const sugg = page.suggestions as { position: number; users: UserSummary[] } | undefined;
      page.items.forEach((item, i) => {
        const key = `${item.repostedBy?.id ?? ""}:${item.post.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ kind: "post", item, key });
        if (sugg && i === sugg.position - 1) out.push({ kind: "suggestions", users: sugg.users, key: `sugg:${item.post.id}` });
      });
    }
    return out;
  }, [query.data, pinned]);

  const onViewable = useRef(({ changed, viewableItems }: { changed: ViewToken<Row>[]; viewableItems: ViewToken<Row>[] }) => {
    for (const v of changed) {
      if (v.item?.kind !== "post") continue;
      if (v.isViewable) postVisible(v.item.item.post.id, surface, v.index ?? 0);
      else postHidden(v.item.item.post.id, surface);
    }
    // Autoplay the top-most visible video in this feed; stop when none is visible.
    const firstVideo = viewableItems.find((v) => v.item?.kind === "post" && v.item.item.post.media[0]?.type === "video");
    const { activeKey, setActive } = usePlayback.getState();
    if (firstVideo?.item?.kind === "post") setActive(videoKey(surface, firstVideo.item.item.post.id));
    else if (activeKey?.startsWith(`${surface}:`)) setActive(null);
  }).current;

  const renderItem = useCallback(
    ({ item, index }: { item: Row; index: number }) =>
      item.kind === "post" ? (
        <FeedItemCard item={item.item} surface={surface} segment={index === 0 || rows[index - 1]?.kind !== "post" ? "first" : "middle"} />
      ) : (
        <Suggestions users={item.users} />
      ),
    [surface, rows],
  );

  return (
    <FlashList
      ref={ref}
      data={rows}
      keyExtractor={(r) => r.key}
      getItemType={(r) => r.kind}
      renderItem={renderItem}
      // New posts arrive via refresh or the "New posts" pill, which scroll to the top; don't pin the old position.
      maintainVisibleContentPosition={{ disabled: true }}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingTop: contentTopInset + space.xs, paddingBottom: 150 }}
      onEndReachedThreshold={0.6}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      viewabilityConfig={{ itemVisiblePercentThreshold: 50, minimumViewTime: 250 }}
      onViewableItemsChanged={onViewable}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={() => void query.refetch()}
          tintColor={t.accent}
          colors={[t.accent]}
          progressViewOffset={contentTopInset}
        />
      }
      ListEmptyComponent={
        query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorView message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <>{empty ?? <EmptyState title="Nothing to see here — yet" />}</>
        )
      }
      ListFooterComponent={query.isFetchingNextPage ? <Loading /> : null}
    />
  );
});
