// Map links. Showing a map and opening directions in the phone's own Maps app are free on both platforms:
// no paid place-search or directions API is used.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Apple Maps: opens the Maps app on iPhone (and maps.apple.com elsewhere). */
export const appleMapsDirections = (p: LatLng, name?: string) =>
  `https://maps.apple.com/?daddr=${p.lat},${p.lng}${name ? `&q=${encodeURIComponent(name)}` : ""}`;

export const appleMapsPlace = (p: LatLng, name: string) => `https://maps.apple.com/?ll=${p.lat},${p.lng}&q=${encodeURIComponent(name)}`;

/** Google Maps universal URLs: open the Google Maps app on Android when installed, the website otherwise. */
export const googleMapsDirections = (p: LatLng) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

export const googleMapsPlace = (p: LatLng) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

/** Great-circle distance in metres. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const formatDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
