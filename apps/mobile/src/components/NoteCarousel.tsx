import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { Post } from "@projectfeed/shared";
import { usePlayback, videoKey } from "../store/playback";
import { coverRatio } from "./DiscoverCard";
import { InlineVideo } from "./InlineVideo";
import { useTheme } from "../theme";

/** Full-width, swipeable photos (RedNote-style) or a single video, with page dots. */
export function NoteCarousel({ post, width }: { post: Post; width: number }) {
  const t = useTheme();
  const [page, setPage] = useState(0);
  const height = Math.round(width * coverRatio(post));
  const first = post.media[0];

  // A note's video plays as soon as the note opens.
  useEffect(() => {
    if (first?.type !== "video") return;
    const key = videoKey("note", post.id);
    usePlayback.getState().setActive(key);
    return () => {
      if (usePlayback.getState().activeKey === key) usePlayback.getState().setActive(null);
    };
  }, [first?.type, post.id]);

  if (!first) return null;
  if (first.type === "video") {
    return (
      <View style={{ width, backgroundColor: "#000" }}>
        <InlineVideo media={first} postId={post.id} surface="note" />
      </View>
    );
  }
  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      >
        {post.media.map((m, i) => (
          <Pressable
            key={m.id}
            onPress={() => router.push({ pathname: "/media-viewer", params: { urls: JSON.stringify(post.media.map((x) => x.url)), postId: post.id, index: String(i) } })}
            accessibilityRole="imagebutton"
            accessibilityLabel={m.altText || `Photo ${i + 1} of ${post.media.length}`}
          >
            <Image source={{ uri: m.url }} placeholder={{ uri: m.thumbUrl }} style={{ width, height, backgroundColor: t.bgInput }} contentFit="cover" transition={150} blurRadius={post.sensitive ? 40 : 0} />
          </Pressable>
        ))}
      </ScrollView>
      {post.media.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 5, paddingTop: 10 }}>
          {post.media.map((m, i) => (
            <View key={m.id} style={{ width: i === page ? 16 : 6, height: 6, borderRadius: 3, backgroundColor: i === page ? t.accent : t.textMuted, opacity: i === page ? 1 : 0.4 }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
