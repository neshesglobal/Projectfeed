import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { View } from "react-native";
import type { PlaceSummary } from "@projectfeed/shared";
import { openDirections, openInMaps } from "../lib/maps";
import { Card } from "./glass";
import { MapPreview } from "./maps/MapPreview";
import { Button, Text } from "./ui";
import { space, useTheme } from "../theme";

/** Location section on a note: the map, the place name, and directions in the phone's own Maps app. */
export function PlaceCard({ place }: { place: PlaceSummary }) {
  const t = useTheme();
  return (
    <Card padding={space.sm} style={{ gap: space.sm }}>
      <MapPreview lat={place.lat} lng={place.lng} name={place.name} height={150} radius={14} onPress={() => openInMaps(place)} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: 4 }}>
        <Ionicons name="location" size={18} color={t.accent} />
        <View style={{ flex: 1 }}>
          <Text weight="700" numberOfLines={1} onPress={() => router.push(`/place/${place.id}`)}>
            {place.name}
          </Text>
          {place.city ? (
            <Text size="xs" muted numberOfLines={1}>
              {place.city}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button small title="Directions" icon="navigate" onPress={() => openDirections(place)} style={{ flex: 1 }} />
        <Button small variant="outline" title="All reviews" onPress={() => router.push(`/place/${place.id}`)} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
