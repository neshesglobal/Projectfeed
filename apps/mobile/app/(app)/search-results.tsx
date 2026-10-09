import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { useInsetsTop } from "../../src/lib/insets";
import { useFollow, useSearchPosts, useSearchUsers } from "../../src/api/hooks";
import { Feed } from "../../src/components/Feed";
import { SearchBar } from "../../src/components/SearchBar";
import { Button, EmptyState, IconButton, Loading, Screen, TopTabs, UserRow } from "../../src/components/ui";
import { space, useTheme } from "../../src/theme";

type Mode = "top" | "latest" | "people" | "media";

export default function SearchResults() {
  const params = useLocalSearchParams<{ q: string }>();
  const t = useTheme();
  const top = useInsetsTop();
  const [q, setQ] = useState(params.q ?? "");
  const [submitted, setSubmitted] = useState(params.q ?? "");
  const [mode, setMode] = useState<Mode>("top");
  const posts = useSearchPosts(mode === "people" ? "" : submitted, mode === "people" ? "top" : mode);
  const people = useSearchUsers(mode === "people" ? submitted : "");
  const follow = useFollow();

  return (
    <Screen>
      <View style={{ paddingTop: top, backgroundColor: t.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }}>
          <IconButton name="arrow-back" label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <SearchBar value={q} onChange={setQ} onSubmit={() => setSubmitted(q.trim())} />
          </View>
        </View>
        <TopTabs
          tabs={[
            { key: "top", label: "Top" },
            { key: "latest", label: "Latest" },
            { key: "people", label: "People" },
            { key: "media", label: "Media" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </View>
      {mode === "people" ? (
        <FlatList
          data={people.data?.items ?? []}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => <UserRow user={item} right={<Button title="Follow" small variant="secondary" onPress={() => follow.mutate({ user: item, follow: true })} />} />}
          ListEmptyComponent={people.isLoading ? <Loading /> : <EmptyState title={`No results for “${submitted}”`} body="Try searching for something else." />}
        />
      ) : (
        <Feed
          key={`${submitted}:${mode}`}
          query={posts}
          surface="search"
          empty={<EmptyState title={`No results for “${submitted}”`} body="Try searching for something else, or check your spelling." />}
        />
      )}
    </Screen>
  );
}
