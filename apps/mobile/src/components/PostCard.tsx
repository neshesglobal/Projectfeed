import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { memo, useRef } from "react";
import { Alert, Animated, Platform, Pressable, Share, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
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
import { Stars } from "./Stars";
import { useSheet, type SheetOption } from "./Sheet";
import { toast } from "./Toast";
import { Icon, type IconSymbol } from "./Icon";
import { Avatar, NameLine, Text, UserBadges } from "./ui";

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
  activeIcon,
  count,
  color,
  active,
  label,
  onPress,
  onLongPress,
  bounce,
}: {
  icon: IconSymbol;
  activeIcon?: IconSymbol;
  count?: number;
  color: string;
  active?: boolean;
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Brief scale-up when the action turns on (likes); skipped with Reduce Motion. */
  bounce?: boolean;
}) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const c = active ? color : t.textMuted;
  const press = () => {
    if (bounce && !active && !reduceMotion) {
      scale.setValue(0.8);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: Platform.OS !== "web" }).start();
    }
    onPress?.();
  };
  return (
    <Pressable
      onPress={press}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}${count ? `, ${formatCount(count)}` : ""}`}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 44, minHeight: 44, paddingRight: 4, opacity: pressed ? 0.55 : 1 })}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name={active && activeIcon ? activeIcon : icon} size={20} color={c} />
      </Animated.View>
      {count !== undefined && count > 0 ? (
        <Text size="sm" style={{ color: active ? color : t.textMuted, fontVariant: ["tabular-nums"] }}>
          {formatCount(count)}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Like, comment and repost on the left; bookmark and share on the right. The post page also shows views. */
export function PostActions({ post, large }: { post: Post; large?: boolean; compact?: boolean; dense?: boolean }) {
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
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: large ? space.sm : 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg, flex: 1 }}>
        <ActionButton icon="heart" activeIcon="heart.fill" label={post.viewer.liked ? "Unlike" : "Like"} count={post.counts.likes} color={t.like} active={post.viewer.liked} bounce onPress={() => like.mutate(post)} />
        <ActionButton
          icon="bubble"
          label="Comment"
          count={post.counts.replies}
          color={t.accent}
          onPress={() =>
            post.viewer.canReply
              ? router.push({ pathname: "/compose", params: { replyToId: post.id } })
              : toast("Only some accounts can reply to this post")
          }
        />
        <ActionButton icon="arrow.2.squarepath" label={post.viewer.reposted ? "Reposted" : "Repost"} count={post.counts.reposts + post.counts.quotes} color={t.repost} active={post.viewer.reposted} onPress={onRepost} />
        {large ? <ActionButton icon="chart.bar" label="Views" count={post.counts.views} color={t.textMuted} /> : null}
      </View>
      <ActionButton icon="bookmark" activeIcon="bookmark.fill" label={post.viewer.bookmarked ? "Remove bookmark" : "Bookmark"} color={t.accent} active={post.viewer.bookmarked} onPress={() => bookmark.mutate(post)} />
      <ActionButton icon="square.and.arrow.up" label="Share" color={t.textMuted} onPress={onShare} />
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
export function PaidPartnership() {
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

/** Verified-review line: the real star rating plus a labelled check (never colour alone). */
export function ReviewLine({ rating }: { rating: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }} accessible accessibilityLabel={`Verified review, ${rating} out of 5 stars`}>
      <Stars value={rating} size={15} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: t.accentSoft }}>
        <Icon name="checkmark.seal.fill" size={13} color={t.accent} />
        <Text size="xs" weight="600" style={{ color: t.accent }}>
          Verified review
        </Text>
      </View>
    </View>
  );
}

/** Location line: a tappable place with a small pin. */
export function LocationLine({ place }: { place: NonNullable<Post["place"]> }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/place/${place.id}`)}
      accessibilityRole="link"
      accessibilityLabel={`Location: ${place.name}${place.city ? `, ${place.city}` : ""}`}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="mappin" size={14} color={t.textMuted} />
      <Text size="sm" numberOfLines={1} style={{ color: t.mode === "dark" ? t.accent : t.text, flexShrink: 1 }}>
        {place.name}
        {place.city ? `, ${place.city}` : ""}
      </Text>
    </Pressable>
  );
}

/** Discover notes in timelines: review line, title (same size as the text, semibold) and place. */
function NoteHeadline({ post }: { post: Post }) {
  if (post.kind !== "note") return null;
  return (
    <View style={{ marginTop: 6, gap: 6 }}>
      {post.review ? <ReviewLine rating={post.review.rating} /> : null}
      {post.title ? (
        <Text weight="600" size="md" style={{ lineHeight: 22 }}>
          {post.title}
        </Text>
      ) : null}
      {post.place ? <LocationLine place={post.place} /> : null}
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

function SocialContext({ icon, text }: { icon: IconSymbol; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, marginLeft: AVATAR - 16 }} accessibilityLabel={text}>
      <View style={{ width: 16, alignItems: "flex-end" }}>
        <Icon name={icon} size={13} color={t.textMuted} />
      </View>
      <Text size="xs" weight="600" muted numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}

const AVATAR = 42;
const GUTTER = 12;

/**
 * A post in a list: no card, just content on the background, separated by hairline dividers.
 * Author line, then title/location/text indented under the name, then full-width media and the action row.
 */
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
  /** Kept for callers; every list now uses the same flat layout. */
  segment?: "first" | "middle";
  surface?: string;
}) {
  const t = useTheme();
  const density = usePrefs((st) => st.density);
  const pad = density === "comfortable" ? 20 : density === "compact" ? 16 : 14;
  const menu = usePostMenu();
  const goProfile = () => {
    track({ type: "click_profile", postId: post.id, surface });
    router.push(`/user/${post.author.handle}`);
  };
  const goPost = () => {
    track({ type: "click_post", postId: post.id, surface });
    router.push(post.kind === "note" ? `/note/${post.id}` : `/post/${post.id}`);
  };

  const context = pinned ? "Pinned" : repostedBy ? `${repostedBy.displayName} reposted` : reason ?? null;
  const contextIcon: IconSymbol = pinned ? "pin" : repostedBy ? "arrow.2.squarepath" : "sparkles";
  const threadLine = { position: "absolute" as const, left: space.lg + AVATAR / 2 - 1, width: 2, backgroundColor: t.border };

  return (
    <Pressable
      onPress={goPost}
      accessibilityHint="Opens the post"
      style={({ pressed }) => ({
        paddingHorizontal: space.lg,
        paddingTop: threadLineAbove ? 4 : pad,
        paddingBottom: threadLineBelow ? 0 : pad - 8,
        backgroundColor: pressed ? t.cardPressed : "transparent",
        borderBottomWidth: threadLineBelow ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: t.border,
      })}
    >
      {threadLineAbove ? <View style={[threadLine, { top: 0, height: 4 }]} /> : null}
      {threadLineBelow ? <View style={[threadLine, { top: pad + AVATAR + 4, bottom: 0 }]} /> : null}
      {context ? <SocialContext icon={contextIcon} text={context} /> : null}
      <View style={{ flexDirection: "row", gap: GUTTER }}>
        <Avatar user={post.author} size={AVATAR} onPress={goProfile} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", minHeight: 22 }}>
            {/* Name and badges take their natural width first; the username and date share what is left,
                and the username is the part that truncates. */}
            <Pressable onPress={goProfile} accessibilityRole="link" style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0 }}>
              <Text weight="600" size="md" numberOfLines={1} style={{ flexShrink: 1 }}>
                {post.author.displayName}
              </Text>
              <UserBadges user={post.author} size={15} />
            </Pressable>
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, flexDirection: "row", alignItems: "center", overflow: "hidden", marginLeft: 5 }}>
              <Text muted size="sm" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }} onPress={goProfile}>
                @{post.author.handle}
              </Text>
              <Text muted size="sm" numberOfLines={1} style={{ flexShrink: 0 }}>
                {"\u00A0· "}
                {formatRelativeTime(post.createdAt)}
                {post.editedAt ? " · Edited" : ""}
              </Text>
            </View>
            <Pressable onPress={() => menu(post)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More options" style={{ width: 32, height: 28, alignItems: "flex-end", justifyContent: "center" }}>
              <Icon name="ellipsis" size={17} color={t.textMuted} />
            </Pressable>
          </View>
          {post.replyTo ? (
            <Text muted size="sm">
              Replying to <Text size="sm" style={{ color: t.accent }}>@{post.replyTo.handle}</Text>
            </Text>
          ) : null}
          {post.paidPartnership ? <PaidPartnership /> : null}
          <NoteHeadline post={post} />
          {post.text ? (
            <View style={{ marginTop: post.kind === "note" ? 6 : 2 }}>
              <RichText text={post.text} postId={post.id} />
              <TranslatePost post={post} />
            </View>
          ) : null}
          {post.poll ? <PollView post={post} /> : null}
          {post.quote ? <QuotedPost post={post.quote} /> : null}
          <NoteCard post={post} />
        </View>
      </View>
      <MediaGrid media={post.media} postId={post.id} surface={surface} sensitive={post.sensitive} />
      <PostActions post={post} />
    </Pressable>
  );
});

export function FeedItemCard({ item, surface, segment }: { item: FeedItem; surface?: string; segment?: "first" | "middle" }) {
  return <PostCard post={item.post} repostedBy={item.repostedBy} reason={item.reason} surface={surface} segment={segment} />;
}
