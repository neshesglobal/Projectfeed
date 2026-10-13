import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePlace, usePlaceNotes } from "../../../src/api/hooks";
import { errorMessage } from "../../../src/api/client";
import { Chip } from "../../../src/components/glass";
import { MapPreview } from "../../../src/components/maps/MapPreview";
import { NoteGrid } from "../../../src/components/NoteGrid";
import { Stars, STAR } from "../../../src/components/Stars";
import { Button, EmptyState, ErrorView, Header, IconButton, Loading, Screen, Text } from "../../../src/components/ui";
import { openDirections, openInMaps } from "../../../src/lib/maps";
import { radius, space, useTheme } from "../../../src/theme";

/** A place: the map, its verified-review rating, directions, and every note posted there. */
export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const place = usePlace(id);
  const [reviewsOnly, setReviewsOnly] = useState(false);
  const notes = usePlaceNotes(id, reviewsOnly);

  if (place.isLoading) {
    return (
      <Screen>
        <Header title="Place" />
        <Loading />
      </Screen>
    );
  }
  if (place.isError || !place.data) {
    return (
      <Screen>
        <Header title="Place" />
        <ErrorView message={place.error ? errorMessage(place.error) : "This place isn't available"} />
      </Screen>
    );
  }
  const p = place.data;
  const subtitle = [p.category, p.address, p.city].filter(Boolean).join(" · ");

  const header = (
    <View style={{ marginHorizontal: -space.sm, marginBottom: space.sm }}>
      <View>
        <MapPreview lat={p.lat} lng={p.lng} name={p.name} height={240 + insets.top} radius={0} onPress={() => openInMaps(p)} />
        <IconButton
          name="chevron-back"
          glass
          size={20}
          label="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/discover"))}
          style={{ position: "absolute", top: insets.top + 4, left: space.md }}
        />
      </View>
      <View style={{ marginTop: -28, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: t.bg, borderTopWidth: 1, borderColor: t.cardBorder, padding: space.lg, gap: space.md }}>
        <View>
          <Text weight="800" size="xxl">
            {p.name}
          </Text>
          {subtitle ? (
            <Text muted size="sm" style={{ marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          {p.rating !== null ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="star" size={20} color={STAR} />
                <Text weight="800" size="xl" style={{ color: STAR }}>
                  {p.rating.toFixed(1)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Stars value={p.rating} size={12} />
                  <Text size="sm" weight="600">
                    {p.reviewCount} verified review{p.reviewCount === 1 ? "" : "s"}
                  </Text>
                </View>
                <Text muted size="xs">
                  Every reviewer has passed an ID check
                </Text>
              </View>
            </>
          ) : (
            <Text muted size="sm" style={{ flex: 1 }}>
              No reviews yet · {p.noteCount} note{p.noteCount === 1 ? "" : "s"}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button small title="Directions" icon="navigate" onPress={() => openDirections(p)} style={{ flex: 1 }} />
          <Button small variant="outline" title="Write review" icon="star-outline" onPress={() => router.push({ pathname: "/compose-note", params: { placeId: p.id, review: "1" } })} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
          <Chip label="All notes" active={!reviewsOnly} onPress={() => setReviewsOnly(false)} />
          <Chip label="Reviews" active={reviewsOnly} onPress={() => setReviewsOnly(true)} />
        </View>
      </View>
    </View>
  );

  return (
    <Screen>
      <NoteGrid
        key={String(reviewsOnly)}
        query={notes}
        header={header}
        bottomInset={insets.bottom + space.xxl}
        empty={
          <EmptyState
            title={reviewsOnly ? "No reviews yet" : "No notes yet"}
            body="Been here? Share photos or a video and rate it."
            action={<Button title="Write a review" onPress={() => router.push({ pathname: "/compose-note", params: { placeId: p.id, review: "1" } })} />}
          />
        }
      />
    </Screen>
  );
}
