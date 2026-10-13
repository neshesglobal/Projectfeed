import { FlashList } from "@shopify/flash-list";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { useMemo, type ReactElement, type ReactNode } from "react";
import { RefreshControl, View } from "react-native";
import type { FeedItem, Page, Post } from "@projectfeed/shared";
import { errorMessage } from "../api/client";
import { DiscoverCard } from "./DiscoverCard";
import { EmptyState, ErrorView, Loading } from "./ui";
import { space, useTheme } from "../theme";

/** Two-column masonry grid of Discover notes (FlashList v2 masonry), infinite and pull-to-refresh. */
export function NoteGrid({
  query,
  header,
  empty,
  bottomInset = 150,
}: {
  query: UseInfiniteQueryResult<InfiniteData<Page<FeedItem> & Record<string, unknown>>>;
  header?: ReactElement | null;
  empty?: ReactNode;
  bottomInset?: number;
}) {
  const t = useTheme();
  const posts = useMemo(() => {
    const seen = new Set<string>();
    const out: Post[] = [];
    for (const page of query.data?.pages ?? [])
      for (const { post } of page.items) {
        if (seen.has(post.id) || post.unavailable) continue;
        seen.add(post.id);
        out.push(post);
      }
    return out;
  }, [query.data]);

  return (
    <FlashList
      data={posts}
      masonry
      numColumns={2}
      keyExtractor={(p) => p.id}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: space.xs + 1, paddingBottom: space.sm + 2 }}>
          <DiscoverCard post={item} />
        </View>
      )}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: bottomInset }}
      onEndReachedThreshold={0.8}
      onEndReached={() => {
        if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      }}
      refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={t.accent} colors={[t.accent]} />}
      ListEmptyComponent={
        query.isLoading ? (
          <Loading />
        ) : query.isError ? (
          <ErrorView message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <>{empty ?? <EmptyState title="No notes yet" />}</>
        )
      }
      ListFooterComponent={query.isFetchingNextPage ? <Loading /> : null}
    />
  );
}
