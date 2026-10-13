import type { LatLng } from "@projectfeed/shared";

export interface MapPreviewProps {
  lat: number;
  lng: number;
  name: string;
  height?: number;
  radius?: number;
  onPress?: () => void;
}

export interface MapPickerProps {
  lat: number;
  lng: number;
  height?: number;
  onChange: (p: LatLng) => void;
}
