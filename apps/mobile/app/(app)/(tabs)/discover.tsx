import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDiscover } from "../../../src/api/hooks";
import { Chip, Glass } from "../../../src/components/glass";
import { TabHeader } from "../../../src/components/HomeHeader";
import { NoteGrid } from "../../../src/components/NoteGrid";
import { Button, EmptyState, IconButton, Screen, Text } from "../../../src/components/ui";
import { currentLocation } from "../../../src/lib/maps";
import { radius, space, tabBarSpace, useTheme } from "../../../src/theme";

/** Discover topics: three built-in views, then hashtag topics. */
const TOPICS: { key: string; label: string; icon?: "location" | "star" }[] = [
  { key: "for-you", label: "For you" },
  { key: "nearby", label: "Nearby", icon: "location" },
  { key: "reviews", label: "Reviews", icon: "star" },
  { key: "food", label: "Food" },
  { key: "travel", label: "Travel" },
  { key: "guides", label: "Guides" },
  { key: "shopping", label: "Shopping" },
  { key: "business", label: "Business" },
];

/** Discover: photo-first notes and verified reviews in a two-column grid (RedNote-style). */
export default function Discover() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [topic, setTopic] = useState("for-you");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const feed = useDiscover(topic, coords);

  const choose = async (key: string) => {
    setTopic(key);
    if (key === "nearby" && !coords) {
      const r = await currentLocation();
      if (r.ok) {
        setCoords(r.coords);
        setLocError(null);
      } else setLocError(r.reason);
    }
  };

  const needsLocation = topic === "nearby" && !coords;

  return (
    <Screen>
      <TabHeader title="Discover" right={<IconButton name="add" glass size={20} label="New note" onPress={() => router.push("/compose-note")} />}>
        <Pressable onPress={() => router.push("/discover-search")} accessibilityRole="search" accessibilityLabel="Search notes and reviews" style={{ paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          <Glass radius={radius.pill} style={{ height: 44, flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg }}>
            <Ionicons name="search" size={18} color={t.textMuted} />
            <Text muted>Search places, food, guides…</Text>
          </Glass>
        </Pressable>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
          {TOPICS.map((x) => (
            <Chip
              key={x.key}
              label={x.label}
              active={topic === x.key}
              onPress={() => void choose(x.key)}
              icon={x.icon ? <Ionicons name={x.icon} size={13} color={topic === x.key ? "#fff" : t.textMuted} /> : undefined}
            />
          ))}
        </ScrollView>
      </TabHeader>
      <View style={{ flex: 1 }}>
        {needsLocation ? (
          <EmptyState
            title="See what's near you"
            body={locError ?? "Allow location to see notes and reviews from places around you. Your location is only used for this search and is never shown to anyone."}
            action={<Button title="Use my location" icon="locate" onPress={() => void choose("nearby")} />}
          />
        ) : (
          <NoteGrid
            key={topic}
            query={feed}
            bottomInset={tabBarSpace(insets.bottom) + space.lg}
            empty={
              <EmptyState
                title={topic === "nearby" ? "Nothing nearby yet" : topic === "reviews" ? "No reviews yet" : "No notes yet"}
                body={topic === "nearby" ? "Be the first to post a note or review from around here." : "Share photos or a video with a title — a place, a dish, a guide."}
                action={<Button title="Post a note" icon="add" onPress={() => router.push("/compose-note")} />}
              />
            }
          />
        )}
      </View>
    </Screen>
  );
}
