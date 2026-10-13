import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCount, type FeedItem, type Page } from "@projectfeed/shared";
import { api } from "../../../src/api/client";
import { useSuggestions, useTrends, useTypeahead } from "../../../src/api/hooks";
import { Fab } from "../../../src/components/Fab";
import { Chip, SectionTitle } from "../../../src/components/glass";
import { TabHeader } from "../../../src/components/HomeHeader";
import { SearchBar } from "../../../src/components/SearchBar";
import { useSheet } from "../../../src/components/Sheet";
import { SuggestionCards } from "../../../src/components/SuggestionCards";
import { Group, Loading, Screen, Text, UserRow } from "../../../src/components/ui";
import { formatDuration } from "../../../src/lib/upload";
import { radius, space, tabBarSpace, useTheme } from "../../../src/theme";

const trendLabel = (tag: string, kind: string) => (kind === "cashtag" ? `$${tag.toUpperCase()}` : `#${tag}`);
/** Broad topics for a general India audience (each opens a hashtag search). */
const TOPICS: [string, string][] = [
  ["India", "#india"],
  ["Business", "#business"],
  ["Cricket", "#cricket"],
  ["Markets", "#markets"],
  ["Food", "#food"],
  ["Tech", "#tech"],
  ["Jobs", "#jobs"],
  ["Travel", "#travel"],
];

function TrendingReels() {
  const t = useTheme();
  const reels = useQuery({ queryKey: ["reels", "explore"], queryFn: () => api<Page<FeedItem>>("/feed/reels?limit=8") });
  const items = reels.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <>
      <SectionTitle title="Trending reels" action="Watch" onAction={() => router.push("/reels")} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md, paddingHorizontal: space.lg }}>
        {items.map(({ post }) => {
          const m = post.media[0]!;
          return (
            <Pressable key={post.id} onPress={() => router.push(`/reels/${post.id}`)} accessibilityRole="button" accessibilityLabel={`Reel by ${post.author.displayName}`}>
              <View style={{ width: 120, height: 200, borderRadius: radius.lg, overflow: "hidden", backgroundColor: t.bgInput, borderWidth: 1, borderColor: t.cardBorder }}>
                <Image source={{ uri: m.thumbUrl }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
                <View style={{ position: "absolute", left: 8, bottom: 8, right: 8 }}>
                  <Text size="xs" weight="700" numberOfLines={1} style={{ color: "#fff", textShadowColor: "#000", textShadowRadius: 4 }}>
                    @{post.author.handle}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Ionicons name="play" size={10} color="#fff" />
                    <Text size="xs" style={{ color: "#fff", textShadowColor: "#000", textShadowRadius: 4 }}>
                      {formatDuration(m.durationMs)} · {formatCount(post.counts.views)}
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

/** Trends (formerly Explore): what's happening now, trending reels and people to follow. */
export default function Trends() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const typeahead = useTypeahead(q);
  const trends = useTrends();
  const suggestions = useSuggestions();
  const openSheet = useSheet((s) => s.open);
  const submit = (query = q) => {
    if (query.trim()) router.push({ pathname: "/search-results", params: { q: query.trim() } });
  };
  const filters = () =>
    openSheet(
      [
        { label: "Posts with photos or video", icon: "images-outline", onPress: () => submit(`${q || "#reels"} filter:media`) },
        { label: "Popular posts (10+ likes)", icon: "flame-outline", onPress: () => submit(`${q || "#gold"} min_faves:10`) },
        { label: "Advanced: from:handle", icon: "at-outline", onPress: () => setQ("from:") },
      ],
      "Search filters",
    );

  return (
    <Screen>
      <TabHeader title="Trends">
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <SearchBar value={q} onChange={setQ} onSubmit={() => submit()} placeholder="Search Projectfeed" onFilter={filters} />
        </View>
      </TabHeader>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: tabBarSpace(insets.bottom) + 40 }}>
        {q.trim() ? (
          <Group style={{ marginTop: space.sm }}>
            {typeahead.data?.tags.map((tag) => (
              <Pressable key={`${tag.kind}:${tag.tag}`} onPress={() => submit(trendLabel(tag.tag, tag.kind))} style={{ padding: space.lg, flexDirection: "row", gap: space.md, alignItems: "center" }}>
                <Ionicons name={tag.kind === "cashtag" ? "trending-up" : "pricetag-outline"} size={18} color={t.accent} />
                <View>
                  <Text weight="700">{trendLabel(tag.tag, tag.kind)}</Text>
                  <Text muted size="sm">
                    {formatCount(tag.postCount)} posts
                  </Text>
                </View>
              </Pressable>
            ))}
            {typeahead.data?.users.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
            <Pressable onPress={() => submit()} style={{ padding: space.lg, flexDirection: "row", gap: space.md, alignItems: "center" }}>
              <Ionicons name="search" size={18} color={t.accent} />
              <Text>
                Search for “<Text weight="700">{q.trim()}</Text>”
              </Text>
            </Pressable>
          </Group>
        ) : (
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
              {TOPICS.map(([label, query]) => (
                <Chip key={label} label={label} onPress={() => submit(query)} />
              ))}
            </ScrollView>

            <SectionTitle title="What's happening" />
            <Group>
              {trends.isLoading ? <Loading /> : null}
              {trends.data?.items.length === 0 ? (
                <Text muted style={{ padding: space.lg }}>
                  No trends yet. Trends appear when several verified people post about the same #tag or $TICKER.
                </Text>
              ) : null}
              {trends.data?.items.slice(0, 6).map((tr, i) => (
                <Pressable
                  key={`${tr.kind}:${tr.tag}`}
                  onPress={() => submit(trendLabel(tr.tag, tr.kind))}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    backgroundColor: pressed ? t.cardPressed : "transparent",
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: t.border,
                  })}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text muted size="sm">
                      {tr.kind === "cashtag" ? "Markets" : "Trending"} · {tr.context}
                    </Text>
                    <Text weight="800" size="lg">
                      {trendLabel(tr.tag, tr.kind)}
                    </Text>
                    <Text muted size="sm">
                      {formatCount(tr.postCount)} posts
                    </Text>
                  </View>
                  <Ionicons name="ellipsis-vertical" size={16} color={t.textMuted} />
                </Pressable>
              ))}
            </Group>

            <TrendingReels />

            <SectionTitle title="Suggested connections" action="See all" onAction={() => router.push("/connect")} />
            <SuggestionCards users={suggestions.data?.items ?? []} />
          </View>
        )}
      </ScrollView>
      <Fab label="Compose post" onPress={() => router.push("/compose")} />
    </Screen>
  );
}
