import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import type { Collection } from "@projectfeed/shared";
import { errorMessage } from "../../../src/api/client";
import { useMyCollections } from "../../../src/api/hooks";
import { Button, EmptyState, ErrorView, Header, Loading, Screen, Text } from "../../../src/components/ui";
import { radius, space, useTheme } from "../../../src/theme";

/** Four-up cover mosaic for a collection. */
export function CollectionCover({ c, size }: { c: Collection; size: number }) {
  const t = useTheme();
  const half = (size - 2) / 2;
  if (c.covers.length < 4) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius.md, overflow: "hidden", backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
        {c.covers[0] ? <Image source={{ uri: c.covers[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="folder-open-outline" size={size / 3} color={t.accent} />}
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius.md, overflow: "hidden", flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
      {c.covers.slice(0, 4).map((u) => (
        <Image key={u} source={{ uri: u }} style={{ width: half, height: half }} contentFit="cover" />
      ))}
    </View>
  );
}

export default function Collections() {
  const t = useTheme();
  const q = useMyCollections();
  const items = q.data?.items ?? [];
  return (
    <Screen>
      <Header title="Collections" subtitle="Your saved notes and posts, organised" />
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorView message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={items}
          numColumns={2}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: space.md, gap: space.lg, paddingBottom: 80 }}
          columnWrapperStyle={{ gap: space.md }}
          ListHeaderComponent={
            <Pressable onPress={() => router.push("/bookmarks")} accessibilityRole="button" style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingBottom: space.sm }}>
              <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: t.accentSoft, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="bookmark" size={22} color={t.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text weight="700">All saves</Text>
                <Text muted size="xs">
                  Everything you've saved
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/collections/${item.id}`)} accessibilityRole="button" style={{ flex: 1, maxWidth: "50%", gap: 6 }}>
              <CollectionCover c={item} size={160} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {item.name}
                </Text>
                {item.isPrivate ? <Ionicons name="lock-closed" size={12} color={t.textMuted} /> : null}
              </View>
              <Text muted size="xs">
                {item.itemCount} saved
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              title="No collections yet"
              body="Tap Save on a note to start one — a trip, a food list, a shopping guide."
              action={<Button title="Browse Discover" onPress={() => router.push("/discover")} />}
            />
          }
        />
      )}
    </Screen>
  );
}
