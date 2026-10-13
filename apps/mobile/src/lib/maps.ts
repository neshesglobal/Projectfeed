import * as Location from "expo-location";
import { Linking, Platform } from "react-native";
import { appleMapsDirections, appleMapsPlace, googleMapsDirections, googleMapsPlace, type LatLng } from "@projectfeed/shared";

/** Directions in the phone's own Maps app: Apple Maps on iPhone, Google Maps on Android and the web. Free on both. */
export function openDirections(p: LatLng & { name?: string }) {
  void Linking.openURL(Platform.OS === "ios" ? appleMapsDirections(p, p.name) : googleMapsDirections(p));
}

export function openInMaps(p: LatLng & { name: string }) {
  void Linking.openURL(Platform.OS === "ios" ? appleMapsPlace(p, p.name) : googleMapsPlace(p));
}

export const mapsAppName = Platform.OS === "ios" ? "Apple Maps" : "Google Maps";

export type LocationResult = { ok: true; coords: LatLng } | { ok: false; reason: string };

/** Current position with a when-in-use permission prompt. Coarse accuracy is enough for "near me". */
export async function currentLocation(): Promise<LocationResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: "Allow location access in Settings to see places near you" };
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
    const pos = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { ok: true, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  } catch {
    return { ok: false, reason: "Couldn't get your location. Check that location services are on." };
  }
}

/** City and country from the device's free geocoder (Apple or Google, via the OS). Empty on failure or on the web. */
export async function cityAt(p: LatLng): Promise<{ city: string; country?: string; address: string }> {
  if (Platform.OS === "web") return { city: "", address: "" };
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: p.lat, longitude: p.lng });
    if (!r) return { city: "", address: "" };
    const address = [r.name !== r.street ? r.name : null, r.street, r.district].filter(Boolean).join(", ");
    return { city: r.city ?? r.subregion ?? r.region ?? "", country: r.isoCountryCode ?? undefined, address };
  } catch {
    return { city: "", address: "" };
  }
}
