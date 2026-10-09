import { Platform } from "react-native";
import type { Media } from "@projectfeed/shared";
import { API_URL, ApiError, api } from "../api/client";
import { useAuth } from "../store/auth";

export interface LocalAsset {
  uri: string;
  mimeType?: string;
  kind: "image" | "video";
  width?: number;
  height?: number;
  durationMs?: number | null;
  fileName?: string | null;
}

/**
 * Upload with progress. fetch() has no upload-progress events in React Native,
 * so this uses XMLHttpRequest, which does on iOS, Android and web.
 */
export async function uploadWithProgress(asset: LocalAsset, onProgress: (fraction: number) => void, altText = ""): Promise<Media> {
  const form = new FormData();
  form.append("altText", altText); // fields must precede the file part
  const type = asset.mimeType ?? (asset.kind === "video" ? "video/mp4" : "image/jpeg");
  const name = asset.fileName ?? `upload.${type.split("/")[1] ?? "bin"}`;
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri: asset.uri, name, type } as unknown as Blob);
  }

  const send = (token: string | null) =>
    new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_URL}/v1/media`);
      if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.min(0.99, e.loaded / e.total));
      };
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* non-JSON error page */
        }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new ApiError(0, "NETWORK", "Upload failed. Check your connection."));
      xhr.send(form);
    });

  let res = await send(useAuth.getState().accessToken);
  if (res.status === 401) {
    // Access token expired mid-compose: any authenticated call refreshes it, then retry once.
    await api("/me").catch(() => {});
    res = await send(useAuth.getState().accessToken);
  }
  if (res.status >= 300) {
    const err = (res.body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "UPLOAD_FAILED", err?.message ?? "Upload failed");
  }
  onProgress(1);
  return res.body as Media;
}

/** Poll a processing video until it is ready (or fails). */
export async function waitUntilReady(media: Media, onUpdate?: (m: Media) => void, timeoutMs = 15 * 60_000): Promise<Media> {
  let current = media;
  const started = Date.now();
  while (current.status === "processing") {
    if (Date.now() - started > timeoutMs) throw new ApiError(0, "TIMEOUT", "Video processing is taking too long");
    await new Promise((r) => setTimeout(r, 1500));
    current = await api<Media>(`/media/${media.id}`);
    onUpdate?.(current);
  }
  if (current.status === "failed") throw new ApiError(422, "MEDIA_FAILED", current.error ?? "Could not process this video");
  return current;
}

export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
