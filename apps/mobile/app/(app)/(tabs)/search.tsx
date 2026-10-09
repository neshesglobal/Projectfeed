import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { formatCount } from "@projectfeed/shared";
import { useFollow, useSuggestions, useTrends, useTypeahead } from "../../../src/api/hooks";
import { Fab } from "../../../src/components/Fab";
import { TabHeader } from "../../../src/components/HomeHeader";
import { SearchBar } from "../../../src/components/SearchBar";
import { Button, Divider, Loading, Screen, Text, UserRow } from "../../../src/components/ui";
import { space } from "../../../src/theme";

const trendLabel = (tag: string, kind: string) => (kind === "cashtag" ? `$${tag.toUpperCase()}` : `#${tag}`);

export default function Search() {
  const [q, setQ] = useState("");
  const typeahead = useTypeahead(q);
  const trends = useTrends();
  const suggestions = useSuggestions();
  const follow = useFollow();
  const submit = (query = q) => {
    if (query.trim()) router.push({ pathname: "/search-results", params: { q: query.trim() } });
  };

  return (
    <Screen>
      <TabHeader right={<Ionicons name="settings-outline" size={22} onPress={() => router.push("/settings")} accessibilityLabel="Settings" color="#888" />}>
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <SearchBar value={q} onChange={setQ} onSubmit={() => submit()} />
        </View>
        <Divider />
      </TabHeader>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 120 }}>
        {q.trim() ? (
          <View>
            {typeahead.data?.tags.map((tag) => (
              <Pressable key={`${tag.kind}:${tag.tag}`} onPress={() => submit(trendLabel(tag.tag, tag.kind))} style={{ padding: space.lg }}>
                <Text weight="700">{trendLabel(tag.tag, tag.kind)}</Text>
                <Text muted size="sm">
                  {formatCount(tag.postCount)} posts
                </Text>
              </Pressable>
            ))}
            {typeahead.data?.users.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
            <Pressable onPress={() => submit()} style={{ padding: space.lg }}>
              <Text>
                Search for “<Text weight="700">{q.trim()}</Text>”
              </Text>
            </Pressable>
          </View>
        ) : (
          <View>
            <Text weight="800" size="xl" style={{ padding: space.lg }}>
              Trends for you
            </Text>
            {trends.isLoading ? <Loading /> : null}
            {trends.data?.items.length === 0 ? (
              <Text muted style={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
                No trends yet. Trends appear when several people post about the same #tag or $TICKER.
              </Text>
            ) : null}
            {trends.data?.items.map((tr, i) => (
              <Pressable key={`${tr.kind}:${tr.tag}`} onPress={() => submit(trendLabel(tr.tag, tr.kind))} style={({ pressed }) => ({ paddingHorizontal: space.lg, paddingVertical: space.md, opacity: pressed ? 0.7 : 1 })}>
                <Text muted size="sm">
                  {i + 1} · {tr.context}
                </Text>
                <Text weight="700">{trendLabel(tr.tag, tr.kind)}</Text>
                <Text muted size="sm">
                  {formatCount(tr.postCount)} posts
                </Text>
              </Pressable>
            ))}
            <Divider style={{ marginTop: space.md }} />
            <Text weight="800" size="xl" style={{ padding: space.lg }}>
              Who to follow
            </Text>
            {suggestions.data?.items.map((u) => (
              <UserRow key={u.id} user={u} right={<Button title="Follow" small variant="secondary" onPress={() => follow.mutate({ user: u, follow: true })} />} />
            ))}
          </View>
        )}
      </ScrollView>
      <Fab label="Compose post" onPress={() => router.push("/compose")} />
    </Screen>
  );
}
