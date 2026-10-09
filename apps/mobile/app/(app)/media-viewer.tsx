import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton, Text } from "../../src/components/ui";
import { track } from "../../src/lib/events";

/** Full-screen, swipeable image viewer. */
export default function MediaViewer() {
  const { urls, index, postId } = useLocalSearchParams<{ urls: string; index: string; postId?: string }>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const list: string[] = (() => {
    try {
      return JSON.parse(urls ?? "[]") as string[];
    } catch {
      return [];
    }
  })();
  const start = Number(index ?? 0);
  const [current, setCurrent] = useState(start);

  useEffect(() => {
    if (postId) track({ type: "media_expand", postId, surface: "media_viewer" });
  }, [postId]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FlatList
        data={list}
        horizontal
        pagingEnabled
        initialScrollIndex={start}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(u) => u}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setCurrent(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <Image source={{ uri: item }} style={{ width, height }} contentFit="contain" />}
      />
      <View style={{ position: "absolute", top: insets.top + 8, left: 8, right: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <IconButton name="close" label="Close" color="#fff" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => router.back()} />
        {list.length > 1 ? <Text style={{ color: "#fff" }}>{`${current + 1} / ${list.length}`}</Text> : null}
      </View>
    </View>
  );
}
