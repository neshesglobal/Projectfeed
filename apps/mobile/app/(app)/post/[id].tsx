import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import { formatCount, REGION_LABEL, type Page, type Post } from "@projectfeed/shared";
import { api, errorMessage } from "../../../src/api/client";
import { useThread } from "../../../src/api/hooks";
import { MediaGrid } from "../../../src/components/MediaGrid";
import { NoteCard } from "../../../src/components/NoteCard";
import { PollView } from "../../../src/components/PollView";
import { PostActions, PostCard, QuotedPost, unavailableText, usePostMenu } from "../../../src/components/PostCard";
import { RichText } from "../../../src/components/RichText";
import { TranslatePost } from "../../../src/components/TranslatePost";
import { Card, Glass } from "../../../src/components/glass";
import { Avatar, Divider, ErrorView, Header, IconButton, Loading, NameLine, Screen, Text } from "../../../src/components/ui";
import { postVisible } from "../../../src/lib/events";
import { radius, space, useTheme } from "../../../src/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePullRefresh } from "../../../src/lib/usePullRefresh";

function Stat({ n, label, onPress }: { n: number; label: string; onPress?: () => void }) {
  if (n === 0) return null;
  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      <Text>
        <Text weight="700">{formatCount(n)}</Text> <Text muted>{label}</Text>
      </Text>
    </Pressable>
  );
}

/** "Who can reply" notice on posts with limited replies, as on X. */
function ReplyLimit({ post }: { post: Post }) {
  const t = useTheme();
  if (post.replyAudience === "everyone" && !post.replyRegions) return null;
  const who: Record<Post["replyAudience"], string> = {
    everyone: "People",
    following: `Accounts @${post.author.handle} follows`,
    following_network: `Accounts @${post.author.handle} follows, and who they follow,`,
    mentioned: `Only accounts @${post.author.handle} mentioned`,
  };
  const where = post.replyRegions ? ` from ${post.replyRegions.map((r) => REGION_LABEL[r]).join(", ")}` : "";
  return (
    <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center", padding: space.md, borderRadius: radius.md, backgroundColor: t.accentSoft }}>
      <Ionicons name="lock-closed" size={16} color={t.accent} />
      <Text size="sm" style={{ flex: 1 }}>
        <Text size="sm" weight="700">
          Who can reply?{" "}
        </Text>
        {who[post.replyAudience]}
        {where} can reply.{post.viewer.canReply ? "" : " You can still like, repost and share."}
      </Text>
    </View>
  );
}

/** The focal post, rendered large like X's post detail. */
function FocalPost({ post }: { post: Post }) {
  const t = useTheme();
  const menu = usePostMenu();
  const created = new Date(post.createdAt);
  const engagements = () => router.push({ pathname: "/engagements", params: { postId: post.id } });
  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
    <Card style={{ gap: space.md, borderRadius: radius.xl, borderColor: `${t.accent}55` }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <Avatar user={post.author} size={48} onPress={() => router.push(`/user/${post.author.handle}`)} />
        <View style={{ flex: 1 }}>
          <NameLine user={post.author} onPress={() => router.push(`/user/${post.author.handle}`)} />
          <Text muted>@{post.author.handle}</Text>
        </View>
        <IconButton name="ellipsis-horizontal" label="More options" color={t.textMuted} size={18} onPress={() => menu(post)} />
      </View>
      {post.replyTo ? (
        <Text muted size="sm">
          Replying to <Text size="sm" style={{ color: t.accent }}>@{post.replyTo.handle}</Text>
        </Text>
      ) : null}
      {post.text ? <RichText text={post.text} size="lg" postId={post.id} /> : null}
      <TranslatePost post={post} size="lg" />
      <MediaGrid media={post.media} postId={post.id} sensitive={post.sensitive} />
      <NoteCard post={post} />
      {post.poll ? <PollView post={post} /> : null}
      {post.quote ? <QuotedPost post={post.quote} /> : null}
      <Text muted>
        {created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {created.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        {post.counts.views > 0 ? ` · ${formatCount(post.counts.views)} Views` : ""}
      </Text>
      {post.editedAt ? (
        <Pressable onPress={() => router.push({ pathname: "/edit-history", params: { postId: post.id } })}>
          <Text size="sm" style={{ color: t.accent }}>
            Last edited {new Date(post.editedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · view history
          </Text>
        </Pressable>
      ) : null}
      {post.counts.reposts + post.counts.quotes + post.counts.likes + post.counts.bookmarks > 0 ? (
        <>
          <Divider />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
            <Stat n={post.counts.reposts} label="Reposts" onPress={engagements} />
            <Stat n={post.counts.quotes} label="Quotes" onPress={() => router.push({ pathname: "/engagements", params: { postId: post.id, tab: "quotes" } })} />
            <Stat n={post.counts.likes} label="Likes" onPress={engagements} />
            <Stat n={post.counts.bookmarks} label="Bookmarks" />
          </View>
        </>
      ) : null}
      <ReplyLimit post={post} />
      <Divider />
      <PostActions post={post} large />
    </Card>
    </View>
  );
}

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const thread = useThread(id);
  const pull = usePullRefresh(thread.refetch);

  // Further pages of replies beyond the first page bundled with the thread.
  const more = useInfiniteQuery({
    queryKey: ["replies", id],
    enabled: !!thread.data?.replies.nextCursor,
    initialPageParam: thread.data?.replies.nextCursor ?? "",
    queryFn: ({ pageParam }) => api<Page<Post>>(`/posts/${id}/replies?cursor=${pageParam}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  useEffect(() => {
    if (thread.data) postVisible(thread.data.post.id, "post_detail", 0);
  }, [thread.data]);

  if (thread.isLoading) {
    return (
      <Screen>
        <Header title="Post" />
        <Loading />
      </Screen>
    );
  }
  if (thread.isError || !thread.data) {
    return (
      <Screen>
        <Header title="Post" />
        <ErrorView message={thread.error ? errorMessage(thread.error) : "This post is unavailable"} />
      </Screen>
    );
  }

  const { ancestors, post } = thread.data;
  const replies = [...thread.data.replies.items, ...(more.data?.pages.flatMap((p) => p.items) ?? [])];
  type Row = { kind: "ancestor"; post: Post; last: boolean } | { kind: "focal"; post: Post } | { kind: "reply"; post: Post };
  const rows: Row[] = [
    ...ancestors.map((p, i) => ({ kind: "ancestor" as const, post: p, last: i === ancestors.length - 1 })),
    { kind: "focal", post },
    ...replies.map((p) => ({ kind: "reply" as const, post: p })),
  ];

  return (
    <Screen>
      <Header title="Post" />
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.kind}:${r.post.id}`}
        initialScrollIndex={ancestors.length > 0 ? ancestors.length : undefined}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item }) => {
          if (item.kind === "focal") return <FocalPost post={item.post} />;
          if (item.kind === "ancestor") {
            return item.post.unavailable ? (
              <Text muted style={{ padding: space.lg }}>
                {unavailableText(item.post.unavailable)}
              </Text>
            ) : (
              <PostCard post={item.post} threadLineBelow surface="thread" threadLineAbove={ancestors[0]?.id !== item.post.id} />
            );
          }
          return <PostCard post={item.post} surface="replies" />;
        }}
        ItemSeparatorComponent={null}
        onEndReached={() => more.hasNextPage && !more.isFetchingNextPage && void more.fetchNextPage()}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={t.accent} />}
        ListFooterComponent={<View style={{ height: 160 }}>{more.isFetchingNextPage ? <Loading /> : null}</View>}
      />
      {post.viewer.canReply ? (
        <Pressable
          onPress={() => router.push({ pathname: "/compose", params: { replyToId: post.id } })}
          style={{ position: "absolute", left: space.md, right: space.md, bottom: insets.bottom + space.md }}
          accessibilityRole="button"
        >
          <Glass radius={radius.pill} interactive style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14 }}>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={t.accent} />
            <Text muted style={{ flex: 1 }}>
              Post your reply
            </Text>
            <Ionicons name="arrow-up-circle" size={26} color={t.accent} />
          </Glass>
        </Pressable>
      ) : null}
    </Screen>
  );
}
