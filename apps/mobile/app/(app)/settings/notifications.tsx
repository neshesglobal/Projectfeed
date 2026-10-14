import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ScrollView, Switch, View } from "react-native";
import type { PushPrefs } from "@projectfeed/shared";
import { api, errorMessage } from "../../../src/api/client";
import { toast } from "../../../src/components/Toast";
import { Button, Group, Header, Loading, Screen, Text } from "../../../src/components/ui";
import { enablePush, openSystemSettings, refreshPush, usePush } from "../../../src/lib/push";
import { space, useTheme } from "../../../src/theme";

const ROWS: { key: keyof PushPrefs; title: string; body?: string }[] = [
  { key: "replies", title: "Replies" },
  { key: "mentions", title: "Mentions" },
  { key: "quotes", title: "Quotes" },
  { key: "likes", title: "Likes", body: "At most one notification per post every 10 minutes" },
  { key: "reposts", title: "Reposts" },
  { key: "follows", title: "New followers and follow requests" },
  { key: "messages", title: "Direct messages" },
  { key: "messagePreviews", title: "Show message previews", body: "Off: notifications say who wrote, not what they wrote" },
];

function Toggle({ title, body, value, disabled, onChange, first }: { title: string; body?: string; value: boolean; disabled?: boolean; onChange: (v: boolean) => void; first?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", padding: space.lg, gap: space.md, borderTopWidth: first ? 0 : 1, borderTopColor: t.border, opacity: disabled ? 0.45 : 1 }}>
      <View style={{ flex: 1 }}>
        <Text>{title}</Text>
        {body ? (
          <Text muted size="sm">
            {body}
          </Text>
        ) : null}
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: t.accent }} accessibilityLabel={title} />
    </View>
  );
}

export default function NotificationSettings() {
  const qc = useQueryClient();
  const { permission, problem } = usePush();
  const prefs = useQuery({ queryKey: ["push-settings"], queryFn: () => api<PushPrefs>("/me/push-settings") });
  const update = useMutation({
    mutationFn: (patch: Partial<PushPrefs>) => api<PushPrefs>("/me/push-settings", { method: "PATCH", body: patch }),
    onMutate: (patch) => qc.setQueryData<PushPrefs>(["push-settings"], (p) => (p ? { ...p, ...patch } : p)),
    onSuccess: (p) => qc.setQueryData(["push-settings"], p),
    onError: (e) => {
      toast(errorMessage(e));
      void qc.invalidateQueries({ queryKey: ["push-settings"] });
    },
  });

  // Coming back from iOS Settings may have changed the permission.
  useFocusEffect(useCallback(() => void refreshPush(), []));

  const p = prefs.data;
  return (
    <Screen>
      <Header title="Notifications" />
      <ScrollView contentContainerStyle={{ paddingTop: space.sm, paddingBottom: 60, gap: space.lg }}>
        {permission === "unsupported" ? (
          <Text muted style={{ paddingHorizontal: space.lg }}>
            Push notifications work in the iPhone and Android apps.
          </Text>
        ) : permission !== "granted" ? (
          <Group style={{ padding: space.lg, gap: space.md }}>
            <Text weight="700">Notifications are off on this device</Text>
            <Text muted size="sm">
              {permission === "denied"
                ? "Turn them on for Projectfeed in your phone's Settings."
                : "Get notified when people reply, mention you, follow you or message you."}
            </Text>
            <Button
              title={permission === "denied" ? "Open Settings" : "Turn on notifications"}
              onPress={() => (permission === "denied" ? openSystemSettings() : void enablePush())}
            />
          </Group>
        ) : null}
        {__DEV__ && problem ? (
          <Text muted size="sm" style={{ paddingHorizontal: space.lg }}>
            Developer note: {problem}
          </Text>
        ) : null}
        {!p ? (
          <Loading />
        ) : (
          <>
            <Group>
              <Toggle first title="Push notifications" body="Master switch for this account on all your devices" value={p.enabled} onChange={(v) => update.mutate({ enabled: v })} />
            </Group>
            <Group>
              {ROWS.map((r, i) => (
                <Toggle
                  key={r.key}
                  first={i === 0}
                  title={r.title}
                  body={r.body}
                  value={p[r.key]}
                  disabled={!p.enabled || (r.key === "messagePreviews" && !p.messages)}
                  onChange={(v) => update.mutate({ [r.key]: v })}
                />
              ))}
            </Group>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
