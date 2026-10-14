// Push notifications: permission, device token registration, taps that open the right screen, and the app badge.
// Delivery itself happens on the server (apps/api/src/services/push.ts) through Expo's push service.

import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Linking, Platform } from "react-native";
import { create } from "zustand";
import { api } from "../api/client";
import { useUnreadCounts } from "../api/hooks";
import { useAuth } from "../store/auth";
import { kv } from "./storage";

export type PushPermission = "granted" | "denied" | "undetermined" | "unsupported";

interface PushState {
  permission: PushPermission;
  /** This device's Expo push token once registered with the server. */
  token: string | null;
  /** Why registration failed, for the settings screen (e.g. no EAS project in a development build). */
  problem: string | null;
}

export const usePush = create<PushState>(() => ({
  permission: Platform.OS === "web" ? "unsupported" : "undetermined",
  token: null,
  problem: null,
}));

const supported = Platform.OS === "ios" || Platform.OS === "android";
const DISMISSED_KEY = "pf.push.promptDismissed";

if (supported) {
  // While the app is open, show the banner (the Activity and Messages lists refresh underneath it).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
  });
}

async function readPermission(): Promise<PushPermission> {
  if (!supported) return "unsupported";
  const p = await Notifications.getPermissionsAsync();
  const permission: PushPermission = p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
  usePush.setState({ permission });
  return permission;
}

/** Gets this device's token and gives it to the server. Safe to call on every launch: tokens can change. */
async function register(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Notifications",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    usePush.setState({ problem: "This build has no EAS project ID. Run `eas init` in apps/mobile, then rebuild." });
    return;
  }
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api("/me/push-tokens", { method: "PUT", body: { token, platform: Platform.OS } });
    usePush.setState({ token, problem: null });
  } catch (e) {
    usePush.setState({ problem: e instanceof Error ? e.message : String(e) });
  }
}

/** Shows the system permission prompt (once; after that only Settings can change it) and registers. */
export async function enablePush(): Promise<PushPermission> {
  if (!supported) return "unsupported";
  let permission = await readPermission();
  if (permission === "undetermined") {
    await Notifications.requestPermissionsAsync();
    permission = await readPermission();
  }
  if (permission === "granted") await register();
  return permission;
}

/** Re-reads the permission (it can change in the phone's Settings) and registers if it is now granted. */
export async function refreshPush(): Promise<void> {
  if ((await readPermission()) === "granted") await register();
}

/** Opens this app's page in iOS/Android Settings, where notifications can be turned back on. */
export const openSystemSettings = () => void Linking.openSettings();

function clearPushToken(): void {
  usePush.setState({ token: null });
  if (supported) void Notifications.setBadgeCountAsync(0).catch(() => {});
}

// However the session ends (Log out, signing out everywhere, deleting the account, an expired session),
// this device stops receiving the account's notifications.
useAuth.subscribe((s, prev) => {
  if (prev.status !== "signedIn" || s.status !== "signedOut") return;
  const token = usePush.getState().token;
  if (token) void api("/auth/logout", { method: "POST", body: { pushToken: token }, auth: false }).catch(() => {});
  clearPushToken();
});

export const pushPrompt = {
  dismissed: async () => (await kv.get(DISMISSED_KEY)) === "1",
  dismiss: () => kv.set(DISMISSED_KEY, "1"),
};

function open(response: Notifications.NotificationResponse | null) {
  const url = response?.notification.request.content.data?.url;
  if (typeof url === "string" && url.startsWith("/")) router.push(url as never);
}

/** Mounted once inside the signed-in app. */
export function usePushNotifications(): void {
  const qc = useQueryClient();
  const unread = useUnreadCounts().data;

  useEffect(() => {
    if (!supported) return;
    void refreshPush();

    // A tap on a notification opens its post, profile or conversation, including from a cold start.
    let handled: string | null = null;
    const openOnce = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.notification.request.identifier === handled) return;
      handled = r.notification.request.identifier;
      open(r);
    };
    void Notifications.getLastNotificationResponseAsync().then(openOnce);
    const tapped = Notifications.addNotificationResponseReceivedListener(openOnce);
    // Something arrived while the app is open: refresh the lists and badges behind it.
    const received = Notifications.addNotificationReceivedListener(() => {
      void qc.invalidateQueries({ queryKey: ["unread"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    });
    return () => {
      tapped.remove();
      received.remove();
    };
  }, [qc]);

  // Keep the app icon badge in step with what the app shows as unread.
  useEffect(() => {
    if (!supported || !unread) return;
    void Notifications.setBadgeCountAsync(unread.notifications + unread.messages).catch(() => {});
  }, [unread]);
}
