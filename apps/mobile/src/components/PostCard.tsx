import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { memo } from "react";
import { Alert, Platform, Pressable, Share, View } from "react-native";
import { formatCount, formatRelativeTime, type FeedItem, type Post, type UserSummary } from "@projectfeed/shared";
import { api, errorMessage } from "../api/client";
import {
  useDeletePost,
  useFollow,
  useNotInterested,
  useRelationshipAction,
  useToggleBookmark,
  useToggleLike,
  useToggleRepost,
} from "../api/hooks";
import { track } from "../lib/events";
import { useAuth } from "../store/auth";
import { space, useTheme, radius } from "../theme";
import { MediaGrid } from "./MediaGrid";
import { PollView } from "./PollView";
import { RichText } from "./RichText";
import { useSheet, type SheetOption } from "./Sheet";
import { toast } from "./Toast";
import { Avatar, NameLine, Text } from "./ui";

export const SHARE_BASE = "https://projectfeed.app";

function confirm(title: string, message: string, action: string, onConfirm: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: action, style: "destructive", onPress: onConfirm },
  ]);
}

export function openReport(targetType: "post" | "user" | "message", targetId: string) {
  router.push({ pathname: "/report", params: { targetType, targetId } });
}

function ActionButton({
  icon,
  count,
  color,
  active,
  label,
  onPress,
  onLongPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  count?: number;
  color: string;
  active?: boolean;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const c = active ? color : t.textMuted;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`${label}${count ? `, ${count}` : ""}`}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 52, opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name={icon} size={18} color={c} />
      {count !== undefined && count > 0 ? (
        <Text size="sm" style={{ color: c }}>
          {formatCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function PostActions({ post, large }: { post: Post; large?: boolean }) {
  const t = useTheme();
  const like = useToggleLike();
  const repost = useToggleRepost();
  const bookmark = useToggleBookmark();
  const openSheet = useSheet((s) => s.open);

  const onRepost = () =>
    openSheet([
      { label: post.viewer.reposted ? "Undo repost" : "Repost", icon: "repeat", onPress: () => repost.mutate(post) },
      { label: "Quote", icon: "create-outline", onPress: () => router.push({ pathname: "/compose", params: { quoteOfId: post.id } }) },
    ]);

  const onShare = () => {
    track({ type: "share", postId: post.id, surface: "post" });
    const url = `${SHARE_BASE}/@${post.author.handle}/post/${post.id}`;
    void Share.share(Platform.OS === "ios" ? { url } : { message: url });
  };

  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: large ? space.md : space.sm, paddingRight: space.sm }}>
      <ActionButton
        icon="chatbubble-outline"
        label="Reply"
        count={post.counts.replies}
        color={t.accent}
        onPress={() =>
          post.viewer.canReply
            ? router.push({ pathname: "/compose", params: { replyToId: post.id } })
            : toast("Only some accounts can reply to this post")
        }
      />
      <ActionButton icon="repeat" label="Repost" count={post.counts.reposts + post.counts.quotes} color={t.repost} active={post.viewer.reposted} onPress={onRepost} />
      <ActionButton icon={post.viewer.liked ? "heart" : "heart-outline"} label="Like" count={post.counts.likes} color={t.like} active={post.viewer.liked} onPress={() => like.mutate(post)} />
      <ActionButton icon="stats-chart" label="Views" count={post.counts.views} color={t.textMuted} />
      <View style={{ flexDirection: "row", gap: space.md }}>
        <ActionButton icon={post.viewer.bookmarked ? "bookmark" : "bookmark-outline"} label="Bookmark" color={t.accent} active={post.viewer.bookmarked} onPress={() => bookmark.mutate(post)} />
        <ActionButton icon="share-outline" label="Share" color={t.textMuted} onPress={onShare} />
      </View>
    </View>
  );
}

export function usePostMenu() {
  const me = useAuth((s) => s.user);
  const openSheet = useSheet((s) => s.open);
  const del = useDeletePost();
  const notInterested = useNotInterested();
  const follow = useFollow();
  const rel = useRelationshipAction();

  return (post: Post) => {
    const own = post.author.id === me?.id;
    const options: SheetOption[] = [];
    if (own) {
      const editable = Date.now() - new Date(post.createdAt).getTime() < 30 * 60_000 && post.editCount < 5;
      if (editable) options.push({ label: "Edit", icon: "pencil", onPress: () => router.push({ pathname: "/compose", params: { editId: post.id } }) });
      options.push({
        label: me?.pinnedPostId === post.id ? "Unpin from profile" : "Pin to your profile",
        icon: "pin-outline",
        onPress: async () => {
          try {
            const r = await api<{ pinnedPostId: string | null }>("/me/pinned-post", {
              method: "PUT",
              body: { postId: me?.pinnedPostId === post.id ? null : post.id },
            });
            if (me) useAuth.getState().setUser({ ...me, pinnedPostId: r.pinnedPostId });
            toast(r.pinnedPostId ? "Pinned to your profile" : "Unpinned");
          } catch (e) {
            toast(errorMessage(e));
          }
        },
      });
      options.push({
        label: "Delete",
        icon: "trash-outline",
        destructive: true,
        onPress: () =>
          confirm("Delete post?", "This can't be undone and it will be removed from your profile and timelines.", "Delete", () =>
            del.mutate(post, { onSuccess: () => toast("Your post was deleted") }),
          ),
      });
    } else {
      options.push({ label: "Not interested in this post", icon: "sad-outline", onPress: () => notInterested.mutate(post, { onSuccess: () => toast("You'll see fewer posts like this") }) });
      options.push({ label: `Follow @${post.author.handle}`, icon: "person-add-outline", onPress: () => follow.mutate({ user: post.author, follow: true }, { onSuccess: () => toast(`Following @${post.author.handle}`) }) });
      options.push({ label: `Mute @${post.author.handle}`, icon: "volume-mute-outline", onPress: () => rel.mutate({ userId: post.author.id, action: "mute", on: true }, { onSuccess: () => toast(`@${post.author.handle} muted`) }) });
      options.push({
        label: `Block @${post.author.handle}`,
        icon: "ban-outline",
        destructive: true,
        onPress: () =>
          confirm(`Block @${post.author.handle}?`, "They won't be able to follow you or see your posts, and you won't see theirs.", "Block", () =>
            rel.mutate({ userId: post.author.id, action: "block", on: true }, { onSuccess: () => toast(`@${post.author.handle} blocked`) }),
          ),
      });
      options.push({ label: "Report post", icon: "flag-outline", destructive: true, onPress: () => openReport("post", post.id) });
    }
    options.push({
      label: "View post engagements",
      icon: "stats-chart-outline",
      onPress: () => router.push({ pathname: "/engagements", params: { postId: post.id } }),
    });
    openSheet(options);
  };
}

/** Compact embedded quote. */
export function QuotedPost({ post }: { post: Post }) {
  const t = useTheme();
  if (post.unavailable) {
    return (
      <View style={{ marginTop: space.md, borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: space.md }}>
        <Text muted>This post is unavailable.</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => router.push(`/post/${post.id}`)}
      style={{ marginTop: space.md, borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: space.md, gap: 4 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Avatar user={post.author} size={20} />
        <NameLine user={post.author} size="sm" />
        <Text muted size="sm" numberOfLines={1} style={{ flexShrink: 1 }}>
          @{post.author.handle} · {formatRelativeTime(post.createdAt)}
        </Text>
      </View>
      {post.text ? <RichText text={post.text} size="sm" /> : null}
      <MediaGrid media={post.media} postId={post.id} surface="quote" />
    </Pressable>
  );
}

function SocialContext({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 30, marginBottom: 2 }}>
      <Ionicons name={icon} size={14} color={t.textMuted} />
      <Text muted size="sm" weight="700" numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export const PostCard = memo(function PostCard({
  post,
  repostedBy,
  reason,
  pinned,
  threadLineAbove,
  threadLineBelow,
  surface = "feed",
}: {
  post: Post;
  repostedBy?: UserSummary | null;
  reason?: string | null;
  pinned?: boolean;
  threadLineAbove?: boolean;
  threadLineBelow?: boolean;
  surface?: string;
}) {
  const t = useTheme();
  const menu = usePostMenu();
  const goProfile = () => {
    track({ type: "click_profile", postId: post.id, surface });
    router.push(`/user/${post.author.handle}`);
  };
  const goPost = () => {
    track({ type: "click_post", postId: post.id, surface });
    router.push(`/post/${post.id}`);
  };

  return (
    <Pressable
      onPress={goPost}
      accessibilityHint="Opens the post"
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingTop: threadLineAbove ? 0 : space.md,
        paddingBottom: threadLineBelow ? 0 : space.md,
        backgroundColor: pressed ? t.bgElevated : t.bg,
        borderBottomWidth: threadLineBelow ? 0 : 1,
        borderBottomColor: t.border,
      })}
    >
      {pinned ? <SocialContext icon="pin" text="Pinned" /> : null}
      {repostedBy ? <SocialContext icon="repeat" text={`${repostedBy.displayName} reposted`} /> : null}
      {!repostedBy && reason ? <SocialContext icon="sparkles-outline" text={reason} /> : null}
      <View style={{ flexDirection: "row", gap: space.md }}>
        <View style={{ alignItems: "center" }}>
          {threadLineAbove ? <View style={{ width: 2, height: space.md, backgroundColor: t.border }} /> : null}
          <Avatar user={post.author} size={40} onPress={goProfile} />
          {threadLineBelow ? <View style={{ width: 2, flex: 1, backgroundColor: t.border, marginTop: 4 }} /> : null}
        </View>
        <View style={{ flex: 1, paddingBottom: threadLineBelow ? space.md : 0, paddingTop: threadLineAbove ? space.md : 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <NameLine user={post.author} onPress={goProfile} />
            <Text muted numberOfLines={1} style={{ flexShrink: 1 }}>
              @{post.author.handle} · {formatRelativeTime(post.createdAt)}
            </Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => menu(post)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More options">
              <Ionicons name="ellipsis-horizontal" size={16} color={t.textMuted} />
            </Pressable>
          </View>
          {post.replyTo ? (
            <Text muted size="sm" style={{ marginBottom: 2 }}>
              Replying to <Text size="sm" style={{ color: t.accent }}>@{post.replyTo.handle}</Text>
            </Text>
          ) : null}
          {post.text ? <RichText text={post.text} postId={post.id} /> : null}
          <MediaGrid media={post.media} postId={post.id} surface={surface} />
          {post.poll ? <PollView post={post} /> : null}
          {post.quote ? <QuotedPost post={post.quote} /> : null}
          {post.editedAt ? (
            <Text muted size="xs" style={{ marginTop: 4 }}>
              Edited
            </Text>
          ) : null}
          <PostActions post={post} />
        </View>
      </View>
    </Pressable>
  );
});

export function FeedItemCard({ item, surface }: { item: FeedItem; surface?: string }) {
  return <PostCard post={item.post} repostedBy={item.repostedBy} reason={item.reason} surface={surface} />;
}
