import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Media } from "@projectfeed/shared";
import { Glass } from "./glass";
import { InlineVideo } from "./InlineVideo";
import { Text } from "./ui";
import { radius, space, useTheme } from "../theme";

/**
 * Interstitial for media a moderator labelled sensitive: a heavily blurred preview and a "Show" button.
 * Nothing plays or opens until the viewer chooses to see it.
 */
function SensitiveCover({ media, onReveal }: { media: Media; onReveal: () => void }) {
  const t = useTheme();
  const ratio = Math.min(Math.max(media.width / Math.max(media.height, 1), 0.9), 1.9);
  return (
    <View style={{ borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: t.border, marginTop: 10, aspectRatio: ratio, backgroundColor: t.bgInput }}>
      {media.thumbUrl ? <Image source={{ uri: media.thumbUrl }} blurRadius={60} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.lg }]}>
        <Ionicons name="eye-off-outline" size={26} color="#fff" />
        <Text weight="700" style={{ color: "#fff" }}>
          Sensitive content
        </Text>
        <Text size="sm" style={{ color: "rgba(255,255,255,0.8)", textAlign: "center" }}>
          This media may show graphic or adult content.
        </Text>
        <Pressable onPress={onReveal} accessibilityRole="button" accessibilityLabel="Show sensitive media">
          <Glass radius={radius.pill} style={{ paddingHorizontal: space.lg, paddingVertical: 8, marginTop: 4 }}>
            <Text weight="700" size="sm" style={{ color: "#fff" }}>
              Show
            </Text>
          </Glass>
        </Pressable>
      </View>
    </View>
  );
}

const R = 12;
const GAP = 4;

/** Adaptive photo layout (1, 2, 3, 4 or more) with rounded outer corners. Tapping opens the full-screen viewer. */
export function MediaGrid({ media, postId, surface = "feed", sensitive }: { media: Media[]; postId?: string; surface?: string; sensitive?: boolean }) {
  const t = useTheme();
  const [revealed, setRevealed] = useState(false);
  if (media.length === 0) return null;
  if (sensitive && !revealed) return <SensitiveCover media={media[0]!} onReveal={() => setRevealed(true)} />;
  const first = media[0]!;
  if (first.type === "video" && postId) return <InlineVideo media={first} postId={postId} surface={surface} />;
  const open = (index: number) =>
    router.push({ pathname: "/media-viewer", params: { urls: JSON.stringify(media.map((m) => m.url)), index: String(index), postId: postId ?? "" } });

  const tile = (m: Media, i: number, style: object, more = 0) => (
    <Pressable
      key={m.id}
      onPress={() => open(i)}
      style={[{ overflow: "hidden", backgroundColor: t.bgInput, borderRadius: R }, style]}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${m.altText || (m.type === "gif" ? "GIF" : "Photo")}${media.length > 1 ? `, ${i + 1} of ${media.length}` : ""}${more ? `, and ${more} more` : ""}`}
    >
      {/* GIFs play in the feed (the thumbnail is a still frame). */}
      <Image source={{ uri: m.type === "gif" ? m.url : m.thumbUrl }} placeholder={m.type === "gif" ? { uri: m.thumbUrl } : undefined} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} />
      {m.type === "gif" ? (
        <View style={{ position: "absolute", left: 8, bottom: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.6)" }}>
          <Text weight="700" size="xs" style={{ color: "#fff" }}>
            GIF
          </Text>
        </View>
      ) : null}
      {more ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center" }}>
          <Text weight="600" style={{ color: "#fff", fontSize: 22 }}>
            +{more}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );

  const frame = { marginTop: 10 };

  // One: full width at its own shape (clamped). Two: side by side. Three: one large and two stacked.
  // Four: a 2 × 2 grid. More (notes allow up to 10): the three-up layout with a "+N" count on the last tile.
  if (media.length === 1) {
    const m = media[0]!;
    const ratio = Math.min(Math.max(m.width / Math.max(m.height, 1), 0.8), 1.9);
    return <View style={frame}>{tile(m, 0, { width: "100%", aspectRatio: ratio })}</View>;
  }
  if (media.length === 2) {
    return (
      <View style={[frame, { flexDirection: "row", gap: GAP, aspectRatio: 16 / 10 }]}>
        {media.map((m, i) => tile(m, i, { flex: 1 }))}
      </View>
    );
  }
  if (media.length === 3 || media.length > 4) {
    const extra = media.length - 3;
    return (
      <View style={[frame, { flexDirection: "row", gap: GAP, aspectRatio: 7 / 5 }]}>
        {tile(media[0]!, 0, { flex: 2 })}
        <View style={{ flex: 1, gap: GAP }}>
          {tile(media[1]!, 1, { flex: 1 })}
          {tile(media[2]!, 2, { flex: 1 }, extra > 0 ? extra : 0)}
        </View>
      </View>
    );
  }
  return (
    <View style={[frame, { gap: GAP, aspectRatio: 16 / 10 }]}>
      <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{media.slice(0, 2).map((m, i) => tile(m, i, { flex: 1 }))}</View>
      <View style={{ flex: 1, flexDirection: "row", gap: GAP }}>{media.slice(2, 4).map((m, i) => tile(m, i + 2, { flex: 1 }))}</View>
    </View>
  );
}
