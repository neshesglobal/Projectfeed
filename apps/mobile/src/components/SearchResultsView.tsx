import { useEffect, useState } from "react";
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, ZoomIn } from "react-native-reanimated";
import { Pop, RowSkeleton } from "./motion";
import { spring } from "../theme/motion";
import { FlatList, Pressable, View } from "react-native";
import { activeFilterCount, DEFAULT_SEARCH_FILTERS, type SearchFilters } from "@projectfeed/shared";
import { useFollow, useSearchPosts, useSearchUsers } from "../api/hooks";
import { Feed } from "./Feed";
import { SearchBar } from "./SearchBar";
import { SearchFiltersPanel } from "./SearchFiltersPanel";
import { Button, EmptyState, Loading, Text, UserRow } from "./ui";
import { space, useTheme } from "../theme";

export type SearchMode = "top" | "latest" | "people" | "videos" | "photos";
export const SEARCH_MODES: SearchMode[] = ["top", "latest", "people", "videos", "photos"];

const TABS: { key: SearchMode; label: string }[] = [
  { key: "top", label: "Top" },
  { key: "latest", label: "Latest" },
  { key: "people", label: "People" },
  { key: "videos", label: "Videos" },
  { key: "photos", label: "Photos" },
];

/**
 * Search results: the search box, Filters, and the Top / Latest / People / Videos / Photos tabs.
 * Shown as a full page (from the Search tab) and inside the pull-up panel opened by tapping a #hashtag or $cashtag.
 */
export function SearchResultsView({
  initialQuery,
  initialMode = "top",
  initialFilters = DEFAULT_SEARCH_FILTERS,
  leading,
  topInset = 0,
}: {
  initialQuery: string;
  initialMode?: SearchMode;
  initialFilters?: SearchFilters;
  /** Left of the search box: Back on the full page, Expand in the panel. Receives the current state. */
  leading: (state: { q: string; mode: SearchMode; filters: SearchFilters }) => React.ReactNode;
  topInset?: number;
}) {
  const t = useTheme();
  const [q, setQ] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const [showFilters, setShowFilters] = useState(false);
  const posts = useSearchPosts(mode === "people" ? "" : submitted, mode === "people" ? "top" : mode, filters);
  const people = useSearchUsers(mode === "people" ? submitted : "");
  const follow = useFollow();
  const active = activeFilterCount(filters);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: topInset }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.sm }}>
          {leading({ q: submitted, mode, filters })}
          <View style={{ flex: 1 }}>
            <SearchBar value={q} onChange={setQ} onSubmit={() => setSubmitted(q.trim())} onFilter={() => setShowFilters(true)} />
          </View>
          {active > 0 ? (
            <Animated.View entering={ZoomIn.springify().reduceMotion(ReduceMotion.System)} pointerEvents="none" style={{ position: "absolute", right: space.sm, top: space.sm, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: t.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
              <Pop value={active}>
                <Text size="xs" weight="700" style={{ color: t.accentText }} accessibilityLabel={`${active} filters on`}>
                  {active}
                </Text>
              </Pop>
            </Animated.View>
          ) : null}
        </View>
        {/* Five tabs share the width equally (text with an underline), so all fit on a phone. The underline slides. */}
        <SearchTabs mode={mode} onChange={setMode} />
      </View>
      {mode === "people" ? (
        <FlatList
          data={people.data?.items ?? []}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => <UserRow user={item} right={<Button title="Follow" small variant="secondary" onPress={() => follow.mutate({ user: item, follow: true })} />} />}
          ListEmptyComponent={people.isLoading ? <RowSkeleton /> : <EmptyState title={`No people for “${submitted}”`} body="Try searching for something else." />}
        />
      ) : (
        <Feed
          key={`${submitted}:${mode}:${JSON.stringify(filters)}`}
          query={posts}
          surface="search"
          empty={
            <EmptyState
              title={`No results for “${submitted}”`}
              body={active > 0 ? "Try removing some filters." : "Try searching for something else, or check your spelling."}
              action={active > 0 ? <Button title="Clear filters" variant="secondary" onPress={() => setFilters(DEFAULT_SEARCH_FILTERS)} /> : undefined}
            />
          }
        />
      )}
      {showFilters ? (
        <SearchFiltersPanel
          value={filters}
          onClose={() => setShowFilters(false)}
          onApply={(f) => {
            setFilters(f);
            setSubmitted(q.trim() || submitted);
            setShowFilters(false);
          }}
        />
      ) : null}
    </View>
  );
}

function SearchTabs({ mode, onChange }: { mode: SearchMode; onChange: (m: SearchMode) => void }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const idx = TABS.findIndex((x) => x.key === mode);
  const x = useSharedValue(0);
  const slot = w / TABS.length;
  useEffect(() => {
    if (!slot) return;
    const to = idx * slot + slot * 0.15;
    x.value = reduce || x.value === 0 ? to : withSpring(to, spring.snappy);
  }, [idx, slot, reduce, x]);
  const bar = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View accessibilityRole="tablist" onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: t.border }}>
      {TABS.map((tab) => {
        const on = tab.key === mode;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: "center", paddingVertical: space.sm + 2 }}
          >
            <Text weight={on ? "700" : "500"} muted={!on} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
      {slot ? <Animated.View pointerEvents="none" style={[{ position: "absolute", bottom: -1, left: 0, height: 3, width: slot * 0.7, borderRadius: 2, backgroundColor: t.accent }, bar]} /> : null}
    </View>
  );
}
