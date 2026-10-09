import { useState } from "react";
import { Platform, ScrollView, Share } from "react-native";
import { api, errorMessage } from "../../../src/api/client";
import { toast } from "../../../src/components/Toast";
import { Button, Divider, Header, Screen, Text, TextField } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { space } from "../../../src/theme";

export default function Account() {
  const me = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [deletePw, setDeletePw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Header title="Your account" subtitle={me ? `@${me.handle}` : undefined} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}>
        <Text weight="800" size="lg">
          Change password
        </Text>
        <TextField label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
        <TextField label="New password (10+ characters)" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
        <Button
          title="Update password"
          loading={busy === "pw"}
          disabled={!current || next.length < 10}
          onPress={() =>
            run("pw", async () => {
              await api("/me/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
              toast("Password changed. Please log in again.");
              await signOut();
            })
          }
        />
        <Divider style={{ marginVertical: space.md }} />

        <Text weight="800" size="lg">
          Sessions
        </Text>
        <Button
          title="Log out of all other devices"
          variant="outline"
          loading={busy === "sessions"}
          onPress={() =>
            run("sessions", async () => {
              await api("/me/sessions/revoke-all", { method: "POST" });
              toast("All sessions ended. Please log in again.");
              await signOut();
            })
          }
        />
        <Divider style={{ marginVertical: space.md }} />

        <Text weight="800" size="lg">
          Download your data
        </Text>
        <Text muted size="sm">
          Get a copy of your profile, posts, likes, follows and messages (UK GDPR right of access).
        </Text>
        <Button
          title="Export my data"
          variant="outline"
          loading={busy === "export"}
          onPress={() =>
            run("export", async () => {
              const data = await api<unknown>("/me/export");
              const json = JSON.stringify(data, null, 2);
              if (Platform.OS === "web") {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
                a.download = "projectfeed-export.json";
                a.click();
              } else {
                await Share.share({ message: json, title: "Projectfeed data export" });
              }
            })
          }
        />
        <Divider style={{ marginVertical: space.md }} />

        <Text weight="800" size="lg" style={{ color: "#F4212E" }}>
          Delete account
        </Text>
        <Text muted size="sm">
          This permanently deletes your account, posts, likes and messages. Your handle becomes available to others. This cannot be undone.
        </Text>
        <TextField label="Confirm with your password" value={deletePw} onChangeText={setDeletePw} secureTextEntry />
        <Button
          title="Delete my account"
          variant="danger"
          loading={busy === "delete"}
          disabled={!deletePw}
          onPress={() =>
            run("delete", async () => {
              await api("/me/delete", { method: "POST", body: { password: deletePw } });
              await signOut();
            })
          }
        />
      </ScrollView>
    </Screen>
  );
}
