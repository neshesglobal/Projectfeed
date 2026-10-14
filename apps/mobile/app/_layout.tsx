import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ApiError } from "../src/api/client";
import { SheetHost } from "../src/components/Sheet";
import { ToastHost } from "../src/components/Toast";
import { Loading } from "../src/components/ui";
import { startEventLoop } from "../src/lib/events";
import { useAuth } from "../src/store/auth";
import { usePrefs } from "../src/store/prefs";
import { useTheme } from "../src/theme";

// Web only: browsers draw a focus outline round text fields, which the iOS and Android apps never show.
// The fields already show focus with the text cursor, so match the native look.
if (Platform.OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = "input:focus, textarea:focus { outline: none; }";
  document.head.appendChild(style);
}

// On native, tell TanStack Query when the app is foregrounded so polling (refetchInterval) pauses in the
// background and stale queries refresh on return. The web already uses the page's visibility.
if (Platform.OS !== "web") {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => sub.remove();
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

export default function RootLayout() {
  const t = useTheme();
  const status = useAuth((s) => s.status);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([useAuth.getState().hydrate(), usePrefs.getState().hydrate()]).then(() => setReady(true));
    startEventLoop();
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg);
  }, [t.bg]);

  // Signing out must not leave the previous account's data in memory.
  useEffect(() => {
    if (status === "signedOut") queryClient.clear();
  }, [status]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style={t.statusBar} />
          {!ready || status === "loading" ? (
            <Loading style={{ flex: 1, justifyContent: "center", backgroundColor: t.bg }} />
          ) : (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
              <Stack.Protected guard={status === "signedIn"}>
                <Stack.Screen name="(app)" />
              </Stack.Protected>
              <Stack.Protected guard={status !== "signedIn"}>
                <Stack.Screen name="(auth)" />
              </Stack.Protected>
            </Stack>
          )}
          <SheetHost />
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
