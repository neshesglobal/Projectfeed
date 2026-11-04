import { router, useLocalSearchParams } from "expo-router";
import { DEFAULT_SEARCH_FILTERS, type SearchFilters } from "@projectfeed/shared";
import { SEARCH_MODES, SearchResultsView, type SearchMode } from "../../src/components/SearchResultsView";
import { IconButton, Screen } from "../../src/components/ui";
import { useInsetsTop } from "../../src/lib/insets";

/** Full-page search results (from the Search tab, or expanded from the hashtag panel). */
export default function SearchResults() {
  const params = useLocalSearchParams<{ q: string; mode?: string; filters?: string }>();
  const top = useInsetsTop();
  return (
    <Screen>
      <SearchResultsView
        initialQuery={params.q ?? ""}
        initialMode={SEARCH_MODES.includes(params.mode as SearchMode) ? (params.mode as SearchMode) : "top"}
        initialFilters={parseFilters(params.filters)}
        topInset={top}
        leading={() => <IconButton name="chevron-back" glass size={20} label="Back" onPress={() => router.back()} />}
      />
    </Screen>
  );
}

function parseFilters(raw: string | undefined): SearchFilters {
  if (!raw) return DEFAULT_SEARCH_FILTERS;
  try {
    return { ...DEFAULT_SEARCH_FILTERS, ...(JSON.parse(raw) as Partial<SearchFilters>) };
  } catch {
    return DEFAULT_SEARCH_FILTERS;
  }
}
