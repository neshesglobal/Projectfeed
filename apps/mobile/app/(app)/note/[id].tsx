import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { FlatList, Pressable, RefreshControl, Share, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCount, type Page, type Post } from "@projectfeed/shared";
import { api, errorMessage } from "../../../src/api/client";
import { useFollow, useProfile, useThread, useToggleLike } from "../../../src/api/hooks";
import { NoteCard } from "../../../src/components/NoteCard";
import { NoteCarousel } from "../../../src/components/NoteCarousel";
import { PlaceCard } from "../../../src/components/PlaceCard";
import { PaidPartnership, PostCard, SHARE_BASE, usePostMenu } from "../../../src/components/PostCard";
import { RichText } from "../../../src/components/RichText";
import { Stars, STAR } from "../../../src/components/Stars";
import { TranslatePost } from "../../../src/components/TranslatePost";
import { Glass } from "../../../src/components/glass";
import { Avatar, Button, Divider, ErrorView, Header, IconButton, Loading, Screen, Text, UserBadges } from "../../../src/components/ui";
import { postVisible } from "../../../src/lib/events";
import { useAuth } from "../../../src/store/auth";
import { radius, space, useTheme } from "../../../src/theme";

const MAX_WIDTH = 640;

function dateLine(post: Post) {
  const d = new Date(post.createdAt);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  return [post.editedAt ? `Edited ${date}` : date, post.place?.city].filter(Boolean).join(" · ");
}

function visited(on: string) {
  return new Date(`${on}T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Author strip over the note: back, who posted it, follow, share and the menu. */
function NoteHeader({ post }: { post: Post }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const me = useAuth((s) => s.user);
  const follow = useFollow();
  const menu = usePostMenu();
  const own = me?.id === post.author.id;
  const viewer = useProfile(post.author.handle).data?.viewer;
  const canFollow = !own && !!viewer && !viewer.following && !viewer.followRequested;
  return (
    <View style={{ paddingTop: insets.top + 4, paddingBottom: space.sm, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <IconButton name="chevron-back" glass size={20} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/discover"))} />
      <Pressable onPress={() => router.push(`/user/${post.author.handle}`)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm }} accessibilityRole="link">
        <Avatar user={post.author} size={34} />
        <View style={{ flexShrink: 1, flexDirection: "row", alignItems: "center" }}>
          <Text weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
            {post.author.displayName}
          </Text>
          <UserBadges user={post.author} size={14} />
        </View>
      </Pressable>
      {canFollow ? (
        <Button small title="Follow" onPress={() => follow.mutate({ user: post.author, follow: true })} style={{ minWidth: 84 }} />
      ) : null}
      <IconButton
        name="share-outline"
        size={20}
        color={t.text}
        label="Share"
        onPress={() => void Share.share({ message: `${post.title ?? "A note"} by @${post.author.handle} on Projectfeed ${SHARE_BASE}/@${post.author.handle}/post/${post.id}` })}
      />
      <IconButton name="ellipsis-horizontal" size={20} color={t.text} label="More options" onPress={() => menu(post)} />
    </View>
  );
}

function NoteBody({ post, width }: { post: Post; width: number }) {
  const t = useTheme();
  return (
    <View>
      <NoteCarousel post={post} width={width} />
      <View style={{ padding: space.lg, gap: space.md }}>
        {post.review ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
            <Stars value={post.review.rating} size={16} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: `${STAR}22` }}>
              <Ionicons name="checkmark-circle" size={13} color={t.verified} />
              <Text size="xs" weight="700">
                Verified review
              </Text>
            </View>
            {post.review.visitedOn ? (
              <Text size="xs" muted>
                Visited {visited(post.review.visitedOn)}
              </Text>
            ) : null}
          </View>
        ) : null}
        {post.title ? (
          <Text weight="800" size="xl" style={{ letterSpacing: -0.3, lineHeight: 26 }}>
            {post.title}
          </Text>
        ) : null}
        {post.text ? <RichText text={post.text} size="md" postId={post.id} /> : null}
        <TranslatePost post={post} />
        {post.paidPartnership ? <PaidPartnership /> : null}
        <NoteCard post={post} />
        {post.place ? <PlaceCard place={post.place} /> : null}
        <Text size="xs" muted>
          {dateLine(post)}
        </Text>
        <Divider />
        <Text weight="800" size="lg">
          {post.counts.replies > 0 ? `${formatCount(post.counts.replies)} comments` : "Comments"}
        </Text>
      </View>
    </View>
  );
}

/** Like, save and comment, pinned to the bottom (RedNote-style). Save opens the collection picker. */
function ActionBar({ post }: { post: Post }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const like = useToggleLike();
  const stat = (icon: React.ComponentProps<typeof Ionicons>["name"], n: number, color: string, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name={icon} size={22} color={color} />
      <Text weight="600" size="sm">
        {n > 0 ? formatCount(n) : ""}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ position: "absolute", left: space.md, right: space.md, bottom: insets.bottom + space.sm }}>
      <Glass radius={radius.pill} style={{ flexDirection: "row", alignItems: "center", gap: space.lg, paddingLeft: 6, paddingRight: space.lg, paddingVertical: 6 }}>
        <Pressable
          onPress={() => (post.viewer.canReply ? router.push({ pathname: "/compose", params: { replyToId: post.id } }) : undefined)}
          accessibilityRole="button"
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, height: 38, borderRadius: radius.pill, backgroundColor: t.bgInput }}
        >
          <Ionicons name="create-outline" size={16} color={t.textMuted} />
          <Text muted size="sm" numberOfLines={1}>
            {post.viewer.canReply ? "Add a comment…" : "Comments are limited"}
          </Text>
        </Pressable>
        {stat(post.viewer.liked ? "heart" : "heart-outline", post.counts.likes, post.viewer.liked ? t.like : t.text, post.viewer.liked ? "Unlike" : "Like", () => like.mutate(post))}
        {stat(post.viewer.bookmarked ? "bookmark" : "bookmark-outline", post.counts.bookmarks, post.viewer.bookmarked ? STAR : t.text, "Save to a collection", () =>
          router.push({ pathname: "/save-to-collection", params: { postId: post.id } }),
        )}
        {stat("chatbubble-outline", post.counts.replies, t.text, "Comment", () => router.push({ pathname: "/compose", params: { replyToId: post.id } }))}
      </Glass>
    </View>
  );
}

/** A Discover note: photos or a video, title, text, review, place with directions, and comments. */
export default function NoteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const width = Math.min(screenWidth, MAX_WIDTH);
  const thread = useThread(id);
  const more = useInfiniteQuery({
    queryKey: ["replies", id],
    enabled: !!thread.data?.replies.nextCursor,
    initialPageParam: thread.data?.replies.nextCursor ?? "",
    queryFn: ({ pageParam }) => api<Page<Post>>(`/posts/${id}/replies?cursor=${pageParam}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  useEffect(() => {
    if (thread.data) postVisible(thread.data.post.id, "note_detail", 0);
  }, [thread.data]);

  if (thread.isLoading) {
    return (
      <Screen>
        <Header title="Note" />
        <Loading />
      </Screen>
    );
  }
  if (thread.isError || !thread.data || thread.data.post.unavailable) {
    return (
      <Screen>
        <Header title="Note" />
        <ErrorView message={thread.error ? errorMessage(thread.error) : "This note is unavailable"} />
      </Screen>
    );
  }

  const { post } = thread.data;
  const replies = [...thread.data.replies.items, ...(more.data?.pages.flatMap((p) => p.items) ?? [])];

  return (
    <Screen>
      <NoteHeader post={post} />
      <FlatList
        data={replies}
        keyExtractor={(p) => p.id}
        style={{ width, alignSelf: "center" }}
        ListHeaderComponent={<NoteBody post={post} width={width} />}
        renderItem={({ item }) => <PostCard post={item} surface="note_comments" />}
        ListEmptyComponent={
          <Text muted style={{ paddingHorizontal: space.lg }}>
            No comments yet. Ask a question or share your own visit.
          </Text>
        }
        onEndReached={() => more.hasNextPage && !more.isFetchingNextPage && void more.fetchNextPage()}
        refreshControl={<RefreshControl refreshing={thread.isRefetching} onRefresh={() => void thread.refetch()} tintColor={t.accent} />}
        ListFooterComponent={<View style={{ height: 140 }}>{more.isFetchingNextPage ? <Loading /> : null}</View>}
      />
      <ActionBar post={post} />
    </Screen>
  );
}
