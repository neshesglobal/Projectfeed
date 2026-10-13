import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, View } from "react-native";
import MapView, { Marker } from "react-native-maps";
import type { MapPickerProps, MapPreviewProps } from "./types";
import { useTheme } from "../../theme";

/**
 * Map display: Apple Maps (MapKit) on iPhone, Google Maps SDK on Android. Both are free for display.
 * Non-interactive in cards (lite mode on Android renders a static bitmap, which is cheap in lists).
 */
export function MapPreview({ lat, lng, name, height = 160, radius = 16, onPress }: MapPreviewProps) {
  const region = { latitude: lat, longitude: lng, latitudeDelta: 0.008, longitudeDelta: 0.008 };
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Map of ${name}`} style={{ height, borderRadius: radius, overflow: "hidden" }}>
      <View pointerEvents="none" style={{ flex: 1 }}>
        <MapView
          style={{ flex: 1 }}
          initialRegion={region}
          liteMode={Platform.OS === "android"}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsPointsOfInterests
        >
          <Marker coordinate={{ latitude: lat, longitude: lng }} title={name} />
        </MapView>
      </View>
    </Pressable>
  );
}

/** Drag the map under a fixed centre pin to place a new spot precisely. */
export function MapPicker({ lat, lng, height = 260, onChange }: MapPickerProps) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: 16, overflow: "hidden" }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
        showsUserLocation
        onRegionChangeComplete={(r) => onChange({ lat: r.latitude, lng: r.longitude })}
      />
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="location" size={40} color={t.accent} style={{ marginBottom: 36 }} />
      </View>
    </View>
  );
}
