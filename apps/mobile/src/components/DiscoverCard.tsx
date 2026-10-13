import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { formatCount, type Post } from "@projectfeed/shared";
import { useToggleLike } from "../api/hooks";
import { formatDuration } from "../lib/upload";
import { STAR } from "./Stars";
import { Avatar, Text, UserBadges } from "./ui";
import { radius, space, useTheme } from "../theme";

/** Cover height follows the photo, clamped between 4:3 landscape and 3:4 portrait so the grid stays tidy. */
export function coverRatio(post: Post): number {
  const m = post.media[0];
  if (!m || !m.width || !m.height) return 4 / 3;
  return Math.min(4 / 3, Math.max(3 / 4, m.height / m.width));
}

/** Photo-first card for the Discover masonry grid (RedNote-style): cover, title, author, likes. */
export function DiscoverCard({ post }: { post: Post }) {
  const t = useTheme();
  const like = useToggleLike();
  const cover = post.media[0];
  const isVideo = cover?.type === "video";
  return (
    <Pressable
      onPress={() => router.push(post.kind === "note" ? `/note/${post.id}` : `/post/${post.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${post.title ?? "Note"} by ${post.author.displayName}`}
      style={({ pressed }) => ({
        borderRadius: radius.md,
        overflow: "hidden",
        backgroundColor: pressed ? t.cardPressed : t.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: t.cardBorder,
      })}
    >
      <View style={{ width: "100%", aspectRatio: 1 / coverRatio(post), backgroundColor: t.bgInput }}>
        {cover ? (
          <Image
            source={{ uri: cover.thumbUrl || cover.url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={150}
            blurRadius={post.sensitive ? 40 : 0}
            accessibilityLabel={cover.altText || undefined}
          />
        ) : (
          // Text-only posts saved into a collection get a typographic cover.
          <LinearGradient colors={[t.accentSoft, t.bgInput]} style={[StyleSheet.absoluteFill, { padding: space.md, justifyContent: "center" }]}>
            <Text weight="700" numberOfLines={6} style={{ lineHeight: 20 }}>
              {post.text}
            </Text>
          </LinearGradient>
        )}
        {post.review ? (
          <View style={[s.badge, { left: 8, flexDirection: "row", alignItems: "center", gap: 3 }]}>
            <Ionicons name="star" size={11} color={STAR} />
            <Text size="xs" weight="800" style={{ color: "#fff" }}>
              {post.review.rating}
            </Text>
            <Text size="xs" weight="600" style={{ color: "rgba(255,255,255,0.85)" }}>
              · Verified
            </Text>
          </View>
        ) : null}
        {isVideo ? (
          <View style={[s.badge, { right: 8, flexDirection: "row", alignItems: "center", gap: 3 }]}>
            <Ionicons name="play" size={10} color="#fff" />
            <Text size="xs" weight="700" style={{ color: "#fff" }}>
              {formatDuration(cover.durationMs)}
            </Text>
          </View>
        ) : post.media.length > 1 ? (
          <View style={[s.badge, { right: 8, flexDirection: "row", alignItems: "center", gap: 3 }]}>
            <Ionicons name="images" size={10} color="#fff" />
            <Text size="xs" weight="700" style={{ color: "#fff" }}>
              {post.media.length}
            </Text>
          </View>
        ) : null}
        {post.place ? (
          <LinearGradient colors={["transparent", "rgba(0,0,0,0.6)"]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingTop: 18, paddingBottom: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Ionicons name="location" size={11} color="#fff" />
              <Text size="xs" weight="600" numberOfLines={1} style={{ color: "#fff", flexShrink: 1 }}>
                {post.place.name}
                {post.place.city ? ` · ${post.place.city}` : ""}
              </Text>
            </View>
          </LinearGradient>
        ) : null}
      </View>
      <View style={{ padding: space.sm + 2, gap: space.sm }}>
        <Text weight="700" size="sm" numberOfLines={2} style={{ lineHeight: 18 }}>
          {post.title ?? (cover ? post.text : `@${post.author.handle}`)}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Avatar user={post.author} size={18} />
          <Text size="xs" muted numberOfLines={1} style={{ flexShrink: 1 }}>
            {post.author.displayName}
          </Text>
          <UserBadges user={post.author} size={11} />
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => like.mutate(post)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={post.viewer.liked ? "Unlike" : "Like"}
            style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
          >
            <Ionicons name={post.viewer.liked ? "heart" : "heart-outline"} size={14} color={post.viewer.liked ? t.like : t.textMuted} />
            <Text size="xs" muted>
              {formatCount(post.counts.likes)}
            </Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  badge: { position: "absolute", top: 8, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: "rgba(10,9,17,0.62)" },
});
