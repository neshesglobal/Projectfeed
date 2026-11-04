import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { SearchResultsView } from "../../src/components/SearchResultsView";
import { IconButton } from "../../src/components/ui";
import { space, useTheme } from "../../src/theme";

/**
 * Tapping a #hashtag or $cashtag opens its results in a pull-up panel over the post you were reading.
 * It is a native sheet: drag the handle between about half, most and all of the screen, or swipe down to close.
 * The expand button opens the same search, with its tab and filters, as a full page.
 */
export default function TagSheet() {
  const { q } = useLocalSearchParams<{ q: string }>();
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: space.md }}>
      <SearchResultsView
        initialQuery={q ?? ""}
        leading={(s) => (
          <IconButton
            name="expand-outline"
            glass
            size={20}
            label="Open full screen"
            onPress={() => router.replace({ pathname: "/search-results", params: { q: s.q, mode: s.mode, filters: JSON.stringify(s.filters) } })}
          />
        )}
      />
    </View>
  );
}
