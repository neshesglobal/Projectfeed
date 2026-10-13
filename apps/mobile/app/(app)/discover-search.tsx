import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSearchNotes } from "../../src/api/hooks";
import { Chip } from "../../src/components/glass";
import { NoteGrid } from "../../src/components/NoteGrid";
import { SearchBar } from "../../src/components/SearchBar";
import { EmptyState, IconButton, Screen, Text } from "../../src/components/ui";
import { useInsetsTop } from "../../src/lib/insets";
import { space } from "../../src/theme";

const SUGGESTED = ["#food", "#streetfood", "#chai", "#travel", "#monsoon", "#cafe", "#trek", "#guides"];

/** Search Discover notes, with related hashtags from the results. */
export default function DiscoverSearch() {
  const params = useLocalSearchParams<{ q?: string }>();
  const top = useInsetsTop();
  const [q, setQ] = useState(params.q ?? "");
  const [submitted, setSubmitted] = useState(params.q ?? "");
  const results = useSearchNotes(submitted);
  const related = (results.data?.pages[0]?.related as string[] | undefined) ?? [];
  const run = (v: string) => {
    setQ(v);
    setSubmitted(v.trim());
  };
  const chips = submitted ? related : SUGGESTED;

  return (
    <Screen>
      <View style={{ paddingTop: top }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }}>
          <IconButton name="chevron-back" glass size={20} label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <SearchBar value={q} onChange={setQ} onSubmit={() => run(q)} autoFocus={!params.q} placeholder="Search places, food, guides…" />
          </View>
        </View>
        {chips.length ? (
          <>
            <Text muted size="xs" weight="700" style={{ paddingHorizontal: space.lg, paddingTop: space.xs, letterSpacing: 0.6 }}>
              {submitted ? "RELATED" : "POPULAR"}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}>
              {chips.map((c) => (
                <Chip key={c} label={c} onPress={() => run(c)} />
              ))}
            </ScrollView>
          </>
        ) : null}
      </View>
      {submitted ? (
        <NoteGrid
          key={submitted}
          query={results}
          empty={<EmptyState title={`No notes for “${submitted}”`} body="Try a place, a dish or a city — notes in every Indian language are searched." />}
        />
      ) : (
        <EmptyState title="Search Discover" body="Find notes and verified reviews: cafés, street food, treks, shops, guides." />
      )}
    </Screen>
  );
}
