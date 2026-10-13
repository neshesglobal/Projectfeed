import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import type { Media } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { useGifConfig, useGifs, type GifResult } from "../../src/api/hooks";
import { SearchBar } from "../../src/components/SearchBar";
import { toast } from "../../src/components/Toast";
import { EmptyState, ErrorView, Header, Loading, Screen, Text } from "../../src/components/ui";
import { useGifPick } from "../../src/store/gifPick";
import { radius, space, useTheme } from "../../src/theme";

const SUGGESTIONS = ["Thank you", "Wow", "LOL", "Yes", "Party", "Chai", "Cricket", "Namaste", "Deal", "Love"];

/** Search a GIF library (GIPHY or Tenor, via our API) and attach one to the post. */
export default function GifPicker() {
  const t = useTheme();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [attaching, setAttaching] = useState<string | null>(null);
  const config = useGifConfig().data;
  const gifs = useGifs(term);
  const setPicked = useGifPick((s) => s.set);

  // Search as you type, after a short pause.
  useEffect(() => {
    const h = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(h);
  }, [q]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return (gifs.data?.pages ?? []).flatMap((p) => p.items).filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  }, [gifs.data]);

  const choose = async (g: GifResult) => {
    if (attaching) return;
    setAttaching(g.id);
    try {
      const media = await api<Media>("/media/gif", { method: "POST", body: { id: g.id } });
      setPicked(media);
      router.back();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setAttaching(null);
    }
  };

  return (
    <Screen>
      <Header title="GIFs" />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
        <SearchBar value={q} onChange={setQ} onSubmit={() => setTerm(q.trim())} placeholder="Search GIFs" autoFocus />
      </View>
      {!term ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} onPress={() => setQ(s)} accessibilityRole="button" style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: t.bgInput, borderWidth: 1, borderColor: t.cardBorder }}>
              <Text size="sm" weight="600">
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {gifs.isLoading ? (
        <Loading />
      ) : gifs.isError ? (
        <ErrorView message={errorMessage(gifs.error)} onRetry={() => void gifs.refetch()} />
      ) : (
        <FlashList
          data={items}
          masonry
          numColumns={2}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ paddingHorizontal: space.sm, paddingBottom: 60 }}
          onEndReachedThreshold={0.8}
          onEndReached={() => gifs.hasNextPage && !gifs.isFetchingNextPage && void gifs.fetchNextPage()}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void choose(item)}
              accessibilityRole="button"
              accessibilityLabel={item.title || "GIF"}
              style={{ margin: 3, borderRadius: radius.md, overflow: "hidden", backgroundColor: t.bgInput }}
            >
              <Image source={{ uri: item.previewUrl }} placeholder={{ uri: item.stillUrl }} style={{ width: "100%", aspectRatio: item.width / Math.max(item.height, 1) }} contentFit="cover" />
              {attaching === item.id ? (
                <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" }}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={<EmptyState title={term ? `No GIFs for “${term}”` : "No GIFs"} body="Try another word." />}
          ListFooterComponent={gifs.isFetchingNextPage ? <Loading /> : null}
        />
      )}
      {config?.attribution ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingVertical: space.sm, backgroundColor: t.bg }}>
          <Text muted size="xs" weight="700">
            {config.attribution}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}
