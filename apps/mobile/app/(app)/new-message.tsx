import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import type { Conversation, UserSummary } from "@projectfeed/shared";
import { api, errorMessage } from "../../src/api/client";
import { useSearchUsers } from "../../src/api/hooks";
import { SearchBar } from "../../src/components/SearchBar";
import { toast } from "../../src/components/Toast";
import { Avatar, Button, Header, Screen, Text, UserRow } from "../../src/components/ui";
import { radius, space, useTheme } from "../../src/theme";

export default function NewMessage() {
  const t = useTheme();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const results = useSearchUsers(q.trim());

  const start = async () => {
    setBusy(true);
    try {
      const c = await api<Conversation>("/conversations", { method: "POST", body: { participantIds: selected.map((u) => u.id) } });
      router.replace(`/conversation/${c.id}`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="New message" right={<Button title="Next" small onPress={start} loading={busy} disabled={selected.length === 0} />} />
      <View style={{ padding: space.lg, gap: space.md }}>
        <SearchBar value={q} onChange={setQ} onSubmit={() => {}} autoFocus />
        {selected.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {selected.map((u) => (
              <Pressable
                key={u.id}
                onPress={() => setSelected((s) => s.filter((x) => x.id !== u.id))}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: t.border, borderRadius: radius.pill, padding: 4, paddingRight: space.md }}
                accessibilityLabel={`Remove ${u.displayName}`}
              >
                <Avatar user={u} size={22} />
                <Text size="sm" weight="700">
                  {u.displayName} ✕
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      <FlatList
        data={results.data?.items ?? []}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <UserRow
            user={item}
            onPress={() => setSelected((s) => (s.some((x) => x.id === item.id) ? s : [...s, item]))}
            right={selected.some((x) => x.id === item.id) ? <Text style={{ color: t.accent }}>✓</Text> : null}
          />
        )}
        ListEmptyComponent={
          <Text muted style={{ padding: space.lg }}>
            Search for people by name or @handle. Add more than one person to start a group.
          </Text>
        }
      />
    </Screen>
  );
}
