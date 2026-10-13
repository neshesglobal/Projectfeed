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
import { usePrefs } from "../store/prefs";
import { space, useTheme, radius } from "../theme";
import { MediaGrid } from "./MediaGrid";
import { TranslatePost } from "./TranslatePost";
import { NoteCard } from "./NoteCard";
import { PollView } from "./PollView";
import { RichText } from "./RichText";
import { useSheet, type SheetOption } from "./Sheet";
import { toast } from "./Toast";
import { Card } from "./glass";
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
  compact,
}: {
  compact?: boolean;
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
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: compact ? 4 : 6,
        borderRadius: radius.pill,
        backgroundColor: active ? `${color}22` : pressed ? t.cardPressed : "transparent",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Ionicons name={icon} size={compact ? 16 : 18} color={c} />
      {count !== undefined && count > 0 ? (
        <Text size="sm" style={{ color: c }}>
          {formatCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function PostActions({ post, large, compact, dense }: { post: Post; large?: boolean; compact?: boolean; dense?: boolean }) {
  const t = useTheme();
  const c = (compact || dense) && !large;
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
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: large ? space.md : dense ? 2 : c ? 6 : space.sm, marginBottom: dense ? -6 : c ? -4 : 0, marginHorizontal: -10 }}>
      <ActionButton
        compact={c}
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
      <ActionButton compact={c} icon="repeat" label="Repost" count={post.counts.reposts + post.counts.quotes} color={t.repost} active={post.viewer.reposted} onPress={onRepost} />
      <ActionButton compact={c} icon={post.viewer.liked ? "heart" : "heart-outline"} label="Like" count={post.counts.likes} color={t.like} active={post.viewer.liked} onPress={() => like.mutate(post)} />
      {c ? null : <ActionButton icon="stats-chart" label="Views" count={post.counts.views} color={t.textMuted} />}
      <View style={{ flexDirection: "row" }}>
        <ActionButton compact={c} icon={post.viewer.bookmarked ? "bookmark" : "bookmark-outline"} label="Bookmark" color={t.accent} active={post.viewer.bookmarked} onPress={() => bookmark.mutate(post)} />
        <ActionButton compact={c} icon="share-outline" label="Share" color={t.textMuted} onPress={onShare} />
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
    options.push({ label: "Community Notes", icon: "people-outline", onPress: () => router.push(`/notes/${post.id}`) });
    options.push({
      label: "View post engagements",
      icon: "stats-chart-outline",
      onPress: () => router.push({ pathname: "/engagements", params: { postId: post.id } }),
    });
    openSheet(options);
  };
}

/** Disclosure for promotional posts by verified businesses and creators (ASCI influencer guidelines). */
function PaidPartnership() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
      <Ionicons name="pricetag-outline" size={12} color={t.textMuted} />
      <Text muted size="xs" weight="600">
        Paid partnership
      </Text>
    </View>
  );
}

/** Tombstone copy for posts the viewer can't see. */
export function unavailableText(reason: Post["unavailable"]): string {
  switch (reason) {
    case "removed":
      return "This post was removed for breaking the Projectfeed Rules.";
    case "suspended":
      return "This post is from a suspended account.";
    case "protected":
      return "This post is from an account that has protected its posts.";
    case "blocked":
      return "This post is unavailable.";
    default:
      return "This post was deleted.";
  }
}

/** Compact embedded quote. */
export function QuotedPost({ post }: { post: Post }) {
  const t = useTheme();
  if (post.unavailable) {
    return (
      <View style={{ marginTop: space.md, backgroundColor: t.bgInput, borderRadius: radius.md, padding: space.md }}>
        <Text muted>{unavailableText(post.unavailable)}</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => router.push(`/post/${post.id}`)}
      style={{ marginTop: space.md, backgroundColor: t.bgInput, borderWidth: 1, borderColor: t.border, borderRadius: radius.md, padding: space.md, gap: 6 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Avatar user={post.author} size={20} />
        <NameLine user={post.author} size="sm" />
        <Text muted size="sm" numberOfLines={1} style={{ flexShrink: 1 }}>
          @{post.author.handle} · {formatRelativeTime(post.createdAt)}
        </Text>
      </View>
      {post.text ? <RichText text={post.text} size="sm" /> : null}
      <MediaGrid media={post.media} postId={post.id} surface="quote" sensitive={post.sensitive} />
    </Pressable>
  );
}

function SocialContext({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, marginBottom: space.md, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: t.accentSoft }}>
      <Ionicons name={icon} size={12} color={t.accent} />
      <Text size="xs" weight="700" numberOfLines={1} style={{ color: t.accent }}>
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
  segment,
}: {
  post: Post;
  repostedBy?: UserSummary | null;
  reason?: string | null;
  pinned?: boolean;
  threadLineAbove?: boolean;
  threadLineBelow?: boolean;
  /** Position inside a continuous dense panel ("first" gets the rounded top). */
  segment?: "first" | "middle";
  surface?: string;
}) {
  const t = useTheme();
  const density = usePrefs((st) => st.density);
  // Thread and notification surfaces keep separate cards; "dense" applies to timelines only.
  const compact = density !== "comfortable";
  const menu = usePostMenu();
  const goProfile = () => {
    track({ type: "click_profile", postId: post.id, surface });
    router.push(`/user/${post.author.handle}`);
  };
  const goPost = () => {
    track({ type: "click_post", postId: post.id, surface });
    router.push(`/post/${post.id}`);
  };

  // Compact: social context folds into the meta line, smaller avatar, tighter padding (~4 text posts per screen).
  const context = pinned ? "Pinned" : repostedBy ? `${repostedBy.displayName} reposted` : reason ?? null;
  const contextIcon: React.ComponentProps<typeof Ionicons>["name"] = pinned ? "pin" : repostedBy ? "repeat" : "sparkles";
  // Inline label for compact mode: the icon carries the verb, so a repost shows just the reposter's first name.
  const shortContext = pinned ? "Pinned" : repostedBy ? repostedBy.displayName.split(" ")[0] : reason ?? "";

  if (density === "dense" && segment) {
    // One continuous glass panel: rows share a frosted background, separated by hairlines.
    // Text sits beside the avatar and name · handle · time share one line (≈5 text posts per screen).
    const first = segment === "first";
    return (
      <View style={{ paddingHorizontal: space.md, paddingTop: first ? space.xs : 0 }}>
        <Pressable
          onPress={goPost}
          accessibilityHint="Opens the post"
          style={({ pressed }) => ({
            flexDirection: "row",
            gap: 10,
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: 10,
            backgroundColor: pressed ? t.cardPressed : t.card,
            borderColor: t.cardBorder,
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderTopWidth: first ? 1 : 0,
            borderBottomWidth: 1,
            borderBottomColor: t.border,
            borderTopLeftRadius: first ? radius.lg : 0,
            borderTopRightRadius: first ? radius.lg : 0,
          })}
        >
          <Avatar user={post.author} size={36} onPress={goProfile} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ flexShrink: 1 }}>
                <NameLine user={post.author} onPress={goProfile} />
              </View>
              <Text muted size="sm" numberOfLines={1} style={{ flexShrink: 2 }}>
                @{post.author.handle}
              </Text>
              <Text muted size="sm" style={{ flexShrink: 0 }}>
                · {formatRelativeTime(post.createdAt)}
              </Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => menu(post)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More options">
                <Ionicons name="ellipsis-horizontal" size={16} color={t.textMuted} />
              </Pressable>
            </View>
            {context ? (
              <View accessibilityLabel={context} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
                <Ionicons name={contextIcon} size={11} color={t.accent} />
                <Text size="xs" weight="600" numberOfLines={1} style={{ color: t.accent }}>
                  {context}
                </Text>
              </View>
            ) : null}
            {post.replyTo ? (
              <Text muted size="sm">
                Replying to <Text size="sm" weight="600" style={{ color: t.accent }}>@{post.replyTo.handle}</Text>
              </Text>
            ) : null}
            {post.paidPartnership ? <PaidPartnership /> : null}
            {post.text ? (
              <View style={{ marginTop: 2 }}>
                <RichText text={post.text} postId={post.id} />
                <TranslatePost post={post} />
              </View>
            ) : null}
            <MediaGrid media={post.media} postId={post.id} surface={surface} sensitive={post.sensitive} />
        <NoteCard post={post} />
            <NoteCard post={post} />
            {post.poll ? <PollView post={post} /> : null}
            {post.quote ? <QuotedPost post={post.quote} /> : null}
            <PostActions post={post} dense />
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: threadLineAbove ? 0 : compact ? 6 : space.sm }}>
      <Card onPress={goPost} accessibilityHint="Opens the post" padding={compact ? 14 : space.lg} style={{ borderRadius: compact ? radius.lg : radius.xl }}>
        {!compact && context ? <SocialContext icon={contextIcon} text={context} /> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: compact ? 10 : space.md }}>
          <Avatar user={post.author} size={compact ? 38 : 44} onPress={goProfile} />
          <View style={{ flex: 1 }}>
            <NameLine user={post.author} onPress={goProfile} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {/* The handle gives way first; the time never truncates. */}
              <Text muted size="sm" numberOfLines={1} style={{ flexShrink: 1 }}>
                @{post.author.handle}
              </Text>
              <Text muted size="sm" style={{ flexShrink: 0 }}>
                · {formatRelativeTime(post.createdAt)}
                {post.editedAt ? " · Edited" : ""}
              </Text>
              {compact && context ? (
                <View accessibilityLabel={context} style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 2, marginLeft: 2 }}>
                  <Ionicons name={contextIcon} size={12} color={t.accent} />
                  <Text size="sm" weight="600" numberOfLines={1} style={{ color: t.accent, flexShrink: 1 }}>
                    {shortContext}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <Pressable onPress={() => menu(post)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More options" style={{ padding: 4 }}>
            <Ionicons name="ellipsis-horizontal" size={18} color={t.textMuted} />
          </Pressable>
        </View>
        {post.replyTo ? (
          <Text muted size="sm" style={{ marginTop: compact ? 6 : space.sm }}>
            Replying to <Text size="sm" weight="600" style={{ color: t.accent }}>@{post.replyTo.handle}</Text>
          </Text>
        ) : null}
        {post.paidPartnership ? <PaidPartnership /> : null}
        {post.text ? (
          <View style={{ marginTop: compact ? 6 : space.sm }}>
            <RichText text={post.text} postId={post.id} />
            <TranslatePost post={post} />
          </View>
        ) : null}
        <MediaGrid media={post.media} postId={post.id} surface={surface} sensitive={post.sensitive} />
        <NoteCard post={post} />
        {post.poll ? <PollView post={post} /> : null}
        {post.quote ? <QuotedPost post={post.quote} /> : null}
        <PostActions post={post} compact={compact} />
      </Card>
      {threadLineBelow ? <View style={{ width: 2, height: space.md, marginLeft: space.lg + 21, backgroundColor: t.accent, opacity: 0.45, borderRadius: 1 }} /> : null}
    </View>
  );
});

export function FeedItemCard({ item, surface, segment }: { item: FeedItem; surface?: string; segment?: "first" | "middle" }) {
  return <PostCard post={item.post} repostedBy={item.repostedBy} reason={item.reason} surface={surface} segment={segment} />;
}
