import { Ionicons } from "@expo/vector-icons";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { Media } from "@projectfeed/shared";
import { track } from "../lib/events";
import { formatDuration } from "../lib/upload";
import { usePlayback, videoKey } from "../store/playback";
import { radius, useTheme } from "../theme";
import { Text } from "./ui";

/** Plays only while mounted: created when the card becomes the active video, released when it stops. */
function ActivePlayer({ media, postId, surface, onTime }: { media: Media; postId: string; surface: string; onTime: (s: number) => void }) {
  const muted = usePlayback((s) => s.muted);
  const watchedMs = useRef(0);
  const lastTime = useRef(0);
  const player = useVideoPlayer({ uri: media.url }, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.5;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const time = useEvent(player, "timeUpdate", { currentTime: 0, currentLiveTimestamp: null, currentOffsetFromLive: null, bufferedPosition: 0 });

  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (isPlaying) setStarted(true);
  }, [isPlaying]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Start after mount (calling play() inside the setup callback is too early on web).
  useEffect(() => {
    player.play();
  }, [player]);

  useEffect(() => {
    const t = time?.currentTime ?? 0;
    const delta = t - lastTime.current;
    if (delta > 0 && delta < 2) watchedMs.current += delta * 1000; // ignore seeks and loop resets
    lastTime.current = t;
    onTime(t);
  }, [time, onTime]);

  // Report watch time when this card stops playing (scrolled away or unmounted).
  useEffect(
    () => () => {
      if (watchedMs.current >= 500) track({ type: "video_view", postId, surface, durationMs: Math.round(watchedMs.current) });
    },
    [postId, surface],
  );

  return (
    <View style={{ position: "absolute", inset: 0, opacity: started ? 1 : 0 }} pointerEvents="none">
      <VideoView player={player} style={{ width: "100%", height: "100%" }} contentFit="cover" nativeControls={false} />
    </View>
  );
}

/**
 * Inline video in a timeline card: poster + duration badge, autoplays muted when it is the most
 * visible video on screen, and opens the full-screen Reels player on tap.
 */
export function InlineVideo({ media, postId, surface }: { media: Media; postId: string; surface: string }) {
  const t = useTheme();
  const key = videoKey(surface, postId);
  const active = usePlayback((s) => s.activeKey === key);
  const muted = usePlayback((s) => s.muted);
  const toggleMuted = usePlayback((s) => s.toggleMuted);
  const [focused, setFocused] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  if (media.status !== "ready") {
    return (
      <View style={{ marginTop: 10, aspectRatio: 16 / 9, borderRadius: radius.lg, backgroundColor: t.bgInput, alignItems: "center", justifyContent: "center" }}>
        <Text muted>{media.status === "failed" ? "This video couldn't be processed" : "Video processing…"}</Text>
      </View>
    );
  }

  const ratio = Math.min(Math.max(media.width / Math.max(media.height, 1), 0.8), 16 / 9);
  const remaining = Math.max(0, (media.durationMs ?? 0) - elapsed * 1000);

  return (
    <Pressable
      onPress={() => router.push(`/reels/${postId}`)}
      accessibilityRole="button"
      accessibilityLabel={`Video, ${formatDuration(media.durationMs)}. Opens full screen.`}
      style={{ marginTop: 10, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: t.border, backgroundColor: "#000", aspectRatio: ratio }}
    >
      <Image source={{ uri: media.thumbUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} />
      {active && focused ? <ActivePlayer media={media} postId={postId} surface={surface} onTime={setElapsed} /> : null}
      {!active ? (
        <View style={{ position: "absolute", top: "50%", left: "50%", marginLeft: -26, marginTop: -26, width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
        </View>
      ) : null}
      <View style={{ position: "absolute", left: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
        <Text size="xs" weight="700" style={{ color: "#fff" }}>
          {formatDuration(active ? remaining : media.durationMs)}
        </Text>
      </View>
      {active ? (
        <Pressable
          onPress={toggleMuted}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={muted ? "Unmute" : "Mute"}
          style={{ position: "absolute", right: 8, bottom: 8, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 14, padding: 5 }}
        >
          <Ionicons name={muted ? "volume-mute" : "volume-high"} size={16} color="#fff" />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
