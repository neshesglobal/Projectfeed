import { Ionicons } from "@expo/vector-icons";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, FlatList, Platform, Pressable, Share, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCount, type FeedItem, type Page, type Post } from "@projectfeed/shared";
import { api, errorMessage } from "../api/client";
import { qs, useFollow, useToggleBookmark, useToggleLike, useToggleRepost } from "../api/hooks";
import { postVisible, track } from "../lib/events";
import { useAuth } from "../store/auth";
import { usePlayback } from "../store/playback";
import { Glass } from "./glass";
import { SHARE_BASE } from "./PostCard";
import { RichText } from "./RichText";
import { Avatar, Button, Text, UserBadges } from "./ui";

const WHITE = "#FFFFFF";
const LIKE = "#F91880";
const SHADOW = { textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };

function RailButton({ icon, label, count, color = WHITE, onPress }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; count?: number; color?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={({ pressed }) => ({ alignItems: "center", gap: 4, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
      <Glass radius={26} tint="rgba(20,14,40,0.35)" style={{ width: 50, height: 50, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={icon} size={26} color={color} />
      </Glass>
      <Text size="xs" weight="700" style={{ color: WHITE, ...SHADOW }}>
        {count !== undefined ? formatCount(count) : label}
      </Text>
    </Pressable>
  );
}

/** Player for one reel; mounted only for the active reel and its neighbours (preloading). */
function ReelPlayer({ post, active, paused, onProgress }: { post: Post; active: boolean; paused: boolean; onProgress: (fraction: number) => void }) {
  const media = post.media[0]!;
  const muted = usePlayback((s) => s.muted);
  const watchedMs = useRef(0);
  const lastTime = useRef(0);
  const player = useVideoPlayer({ uri: media.url }, (p) => {
    p.loop = true;
    p.muted = muted;
    p.timeUpdateEventInterval = 0.25;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const time = useEvent(player, "timeUpdate", { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });

  // Keep the poster visible until the first frame plays, so there's no black flash.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (isPlaying) setStarted(true);
  }, [isPlaying]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  useEffect(() => {
    if (active && !paused) player.play();
    else player.pause();
  }, [active, paused, player]);

  // Leaving a reel rewinds it and reports how long it was watched (the main Reels ranking signal).
  useEffect(() => {
    if (active) return;
    if (watchedMs.current >= 500) {
      track({ type: "video_view", postId: post.id, surface: "reels", durationMs: Math.round(watchedMs.current) });
    }
    watchedMs.current = 0;
    lastTime.current = 0;
    player.currentTime = 0;
  }, [active, player, post.id]);

  useEffect(
    () => () => {
      if (watchedMs.current >= 500) track({ type: "video_view", postId: post.id, surface: "reels", durationMs: Math.round(watchedMs.current) });
    },
    [post.id],
  );

  useEffect(() => {
    const t = time?.currentTime ?? 0;
    const delta = t - lastTime.current;
    if (active && delta > 0 && delta < 2) watchedMs.current += delta * 1000;
    lastTime.current = t;
    const dur = (media.durationMs ?? 0) / 1000;
    if (active && dur > 0) onProgress(Math.min(1, t / dur));
  }, [time, active, media.durationMs, onProgress]);

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: started ? 1 : 0 }} pointerEvents="none">
      <VideoView player={player} style={{ width: "100%", height: "100%" }} contentFit="contain" nativeControls={false} />
    </View>
  );
}

const ReelItem = memo(function ReelItem({ post, height, active, near, bottomInset }: { post: Post; height: number; active: boolean; near: boolean; bottomInset: number }) {
  const me = useAuth((s) => s.user);
  const like = useToggleLike();
  const repost = useToggleRepost();
  const bookmark = useToggleBookmark();
  const follow = useFollow();
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [followed, setFollowed] = useState(false);
  const lastTap = useRef(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heart = useRef(new Animated.Value(0)).current;
  const media = post.media[0]!;

  useEffect(() => {
    if (active) {
      postVisible(post.id, "reels", 0);
      setPaused(false);
    }
  }, [active, post.id]);

  const burstHeart = () => {
    heart.setValue(0);
    Animated.sequence([
      Animated.spring(heart, { toValue: 1, useNativeDriver: true, friction: 4 }),
      Animated.timing(heart, { toValue: 0, duration: 250, delay: 300, useNativeDriver: true }),
    ]).start();
  };

  // Single tap pauses/resumes; double tap likes (never unlikes), as on every short-video app.
  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      lastTap.current = 0;
      burstHeart();
      if (!post.viewer.liked) like.mutate(post);
      return;
    }
    lastTap.current = now;
    singleTapTimer.current = setTimeout(() => setPaused((p) => !p), 280);
  };

  const share = () => {
    track({ type: "share", postId: post.id, surface: "reels" });
    const url = `${SHARE_BASE}/@${post.author.handle}/post/${post.id}`;
    void Share.share(Platform.OS === "ios" ? { url } : { message: url });
  };

  const isMe = me?.id === post.author.id;

  return (
    <View style={{ height, backgroundColor: "#000" }}>
      <Pressable onPress={onTap} style={{ flex: 1 }} accessibilityLabel={paused ? "Play video" : "Pause video"}>
        <Image source={{ uri: media.thumbUrl }} style={{ position: "absolute", width: "100%", height: "100%" }} contentFit="contain" />
        {near ? <ReelPlayer post={post} active={active} paused={paused} onProgress={setProgress} /> : null}
        {paused && active ? (
          <View style={{ position: "absolute", top: "50%", left: "50%", marginLeft: -36, marginTop: -36 }} pointerEvents="none">
            <Ionicons name="play" size={72} color="rgba(255,255,255,0.85)" />
          </View>
        ) : null}
        <Animated.View
          pointerEvents="none"
          style={{ position: "absolute", top: "50%", left: "50%", marginLeft: -60, marginTop: -60, opacity: heart, transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.1] }) }] }}
        >
          <Ionicons name="heart" size={120} color={LIKE} />
        </Animated.View>
      </Pressable>

      {/* Right action rail */}
      <View style={{ position: "absolute", right: 12, bottom: bottomInset + 90, alignItems: "center", gap: 20 }}>
        <View style={{ alignItems: "center" }}>
          <Avatar user={post.author} size={46} onPress={() => router.push(`/user/${post.author.handle}`)} />
          {!isMe && !followed ? (
            <Pressable
              onPress={() => {
                setFollowed(true);
                follow.mutate({ user: post.author, follow: true });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Follow @${post.author.handle}`}
              style={{ marginTop: -10, width: 22, height: 22, borderRadius: 11, backgroundColor: LIKE, alignItems: "center", justifyContent: "center" }}
            >
              <Ionicons name="add" size={16} color={WHITE} />
            </Pressable>
          ) : null}
        </View>
        <RailButton icon={post.viewer.liked ? "heart" : "heart-outline"} color={post.viewer.liked ? LIKE : WHITE} label="Like" count={post.counts.likes} onPress={() => like.mutate(post)} />
        <RailButton icon="chatbubble-ellipses-outline" label="Reply" count={post.counts.replies} onPress={() => router.push(`/post/${post.id}`)} />
        <RailButton icon="repeat" color={post.viewer.reposted ? "#00BA7C" : WHITE} label="Repost" count={post.counts.reposts} onPress={() => repost.mutate(post)} />
        <RailButton icon={post.viewer.bookmarked ? "bookmark" : "bookmark-outline"} label="Save" onPress={() => bookmark.mutate(post)} />
        <RailButton icon="paper-plane-outline" label="Share" onPress={share} />
      </View>

      {/* Author and caption */}
      <View style={{ position: "absolute", left: 14, right: 80, bottom: bottomInset + 26, gap: 6 }} pointerEvents="box-none">
        <Pressable onPress={() => router.push(`/user/${post.author.handle}`)} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text weight="800" style={{ color: WHITE, ...SHADOW }}>
            {post.author.displayName}
          </Text>
          <UserBadges user={post.author} />
          <Text size="sm" style={{ color: "rgba(255,255,255,0.8)", ...SHADOW }}>
            {" "}@{post.author.handle}
          </Text>
        </Pressable>
        {post.text ? (
          <Pressable onPress={() => setExpanded((e) => !e)}>
            <RichText text={post.text} color={WHITE} numberOfLines={expanded ? undefined : 2} postId={post.id} />
          </Pressable>
        ) : null}
        <Text size="xs" style={{ color: "rgba(255,255,255,0.7)", ...SHADOW }}>
          {formatCount(post.counts.views)} views
        </Text>
      </View>

      {/* Progress */}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: bottomInset + 8, height: 2, backgroundColor: "rgba(255,255,255,0.25)" }}>
        <View style={{ width: `${active ? progress * 100 : 0}%`, height: 2, backgroundColor: WHITE }} />
      </View>
    </View>
  );
});

/** Full-screen vertical video feed. `startId` pins the reel opened from a timeline to the front. */
export function ReelsViewer({ startId, bottomInset = 0, header }: { startId?: string; bottomInset?: number; header?: React.ReactNode }) {
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(true);
  const muted = usePlayback((s) => s.muted);
  const toggleMuted = usePlayback((s) => s.toggleMuted);
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const q = useInfiniteQuery({
    queryKey: ["reels", startId ?? "tab"],
    initialPageParam: "",
    queryFn: ({ pageParam }) => api<Page<FeedItem>>(`/feed/reels${qs({ startId, cursor: pageParam, limit: 10 })}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!height) return;
    const i = Math.round(e.nativeEvent.contentOffset.y / height);
    if (i !== index && i >= 0 && i < items.length) setIndex(i);
  };

  useEffect(() => {
    if (items.length - index < 4 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [index, items.length, q]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }} onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}>
      {q.isLoading || !height ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={WHITE} />
        </View>
      ) : q.isError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ color: WHITE, textAlign: "center" }}>{errorMessage(q.error)}</Text>
          <Button title="Retry" small onPress={() => void q.refetch()} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Ionicons name="film-outline" size={56} color={WHITE} />
          <Text weight="800" size="xl" style={{ color: WHITE, textAlign: "center" }}>
            No reels yet
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.7)", textAlign: "center" }}>Post a video and it will show up here for people to discover.</Text>
          <Button title="Post a video" onPress={() => router.push({ pathname: "/compose", params: { pick: "video" } })} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.post.id}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={height}
          snapToAlignment="start"
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          removeClippedSubviews
          renderItem={({ item, index: i }) => (
            <ReelItem post={item.post} height={height} active={focused && i === index} near={Math.abs(i - index) <= 1} bottomInset={bottomInset} />
          )}
        />
      )}
      <View style={{ position: "absolute", top: insets.top + 6, left: 8, right: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }} pointerEvents="box-none">
        {header ?? <View />}
        <Pressable onPress={toggleMuted} accessibilityRole="button" accessibilityLabel={muted ? "Unmute" : "Mute"} hitSlop={10}>
          <Glass radius={22} tint="rgba(20,14,40,0.35)" style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name={muted ? "volume-mute" : "volume-high"} size={20} color={WHITE} />
          </Glass>
        </Pressable>
      </View>
    </View>
  );
}
