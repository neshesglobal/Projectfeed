import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { api, errorMessage } from "../../../src/api/client";
import { toast } from "../../../src/components/Toast";
import { Button, Divider, EmptyState, Header, IconButton, Screen, Text, TextField } from "../../../src/components/ui";
import { space } from "../../../src/theme";

export default function MutedWords() {
  const q = useQuery({ queryKey: ["muted-words"], queryFn: () => api<{ items: { id: string; word: string }[] }>("/me/muted-words") });
  const [word, setWord] = useState("");

  const add = async () => {
    try {
      await api("/me/muted-words", { method: "POST", body: { word } });
      setWord("");
      void q.refetch();
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <Screen>
      <Header title="Muted words" />
      <View style={{ flexDirection: "row", gap: space.sm, padding: space.lg, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <TextField placeholder="Word, #hashtag or $cashtag" value={word} onChangeText={setWord} autoCapitalize="none" onSubmitEditing={add} />
        </View>
        <Button title="Add" small onPress={add} disabled={!word.trim()} />
      </View>
      <Divider />
      <FlatList
        data={q.data?.items ?? []}
        keyExtractor={(w) => w.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.sm }}>
            <Text style={{ flex: 1 }}>{item.word}</Text>
            <IconButton
              name="trash-outline"
              label={`Unmute ${item.word}`}
              size={18}
              onPress={async () => {
                await api(`/me/muted-words/${item.id}`, { method: "DELETE" });
                void q.refetch();
              }}
            />
          </View>
        )}
        ListEmptyComponent={<EmptyState title="You haven't muted any words" body="Posts containing muted words are hidden from your Home timelines, search and notifications." />}
      />
    </Screen>
  );
}
