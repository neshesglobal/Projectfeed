import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import type { Media } from "@projectfeed/shared";
import { radius, useTheme } from "../theme";

/** X-style 1–4 image grid with rounded outer corners. Tapping opens the full-screen viewer. */
export function MediaGrid({ media, postId }: { media: Media[]; postId?: string }) {
  const t = useTheme();
  if (media.length === 0) return null;
  const open = (index: number) =>
    router.push({ pathname: "/media-viewer", params: { urls: JSON.stringify(media.map((m) => m.url)), index: String(index), postId: postId ?? "" } });

  const tile = (m: Media, i: number, style: object) => (
    <Pressable key={m.id} onPress={() => open(i)} style={[{ overflow: "hidden", backgroundColor: t.bgInput }, style]} accessibilityRole="imagebutton" accessibilityLabel={m.altText || "Image"}>
      <Image source={{ uri: m.thumbUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" transition={150} />
    </Pressable>
  );

  const frame = { borderRadius: radius.lg, overflow: "hidden" as const, borderWidth: 1, borderColor: t.border, marginTop: 10 };

  if (media.length === 1) {
    const m = media[0]!;
    const ratio = Math.min(Math.max(m.width / Math.max(m.height, 1), 0.75), 2);
    return <View style={frame}>{tile(m, 0, { width: "100%", aspectRatio: ratio })}</View>;
  }
  const gap = 2;
  if (media.length === 2) {
    return (
      <View style={[frame, { flexDirection: "row", gap, aspectRatio: 16 / 9 }]}>
        {media.map((m, i) => tile(m, i, { flex: 1 }))}
      </View>
    );
  }
  if (media.length === 3) {
    return (
      <View style={[frame, { flexDirection: "row", gap, aspectRatio: 16 / 9 }]}>
        {tile(media[0]!, 0, { flex: 1 })}
        <View style={{ flex: 1, gap }}>{media.slice(1).map((m, i) => tile(m, i + 1, { flex: 1 }))}</View>
      </View>
    );
  }
  return (
    <View style={[frame, { gap, aspectRatio: 16 / 9 }]}>
      <View style={{ flex: 1, flexDirection: "row", gap }}>{media.slice(0, 2).map((m, i) => tile(m, i, { flex: 1 }))}</View>
      <View style={{ flex: 1, flexDirection: "row", gap }}>{media.slice(2, 4).map((m, i) => tile(m, i + 2, { flex: 1 }))}</View>
    </View>
  );
}
