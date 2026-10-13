import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { errorMessage } from "../../../src/api/client";
import { useNoteAction, usePostNotes, useThread } from "../../../src/api/hooks";
import { Card, Chip } from "../../../src/components/glass";
import { NoteRating } from "../../../src/components/NoteRating";
import { PostCard } from "../../../src/components/PostCard";
import { toast } from "../../../src/components/Toast";
import { Button, ErrorView, Header, Loading, Screen, Text, TextField } from "../../../src/components/ui";
import { space } from "../../../src/theme";

/** Community Notes on one post: read and rate existing notes, or write one. */
export default function PostNotes() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const thread = useThread(postId);
  const q = usePostNotes(postId);
  const act = useNoteAction();
  const [classification, setClassification] = useState<"misleading" | "not_misleading">("misleading");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");

  if (q.isLoading || thread.isLoading) return <Screen><Header title="Community Notes" /><Loading /></Screen>;
  if (!q.data) return <Screen><Header title="Community Notes" /><ErrorView message={errorMessage(q.error)} /></Screen>;
  const d = q.data;
  const hasMine = d.notes.some((n) => n.isMine);

  return (
    <Screen>
      <Header title="Community Notes" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}>
        {thread.data ? <PostCard post={thread.data.post} surface="notes" /> : null}
        <Text muted size="sm">
          Notes add context to posts. A note is shown only when people who usually disagree with each other both rate it helpful, so no single group decides what's true.
        </Text>
        {d.eligibility ? (
          <Card>
            <Text muted size="sm">
              {d.eligibility}
            </Text>
          </Card>
        ) : null}
        {d.notes.length === 0 ? (
          <Text muted style={{ textAlign: "center", marginVertical: space.md }}>
            No notes on this post yet.
          </Text>
        ) : (
          d.notes.map((n) => <NoteRating key={n.id} note={n} canRate={d.canRate} />)
        )}
        {d.canWrite && !hasMine ? (
          <Card style={{ gap: space.md }}>
            <Text weight="800">Write a note</Text>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Chip label="Misleading" active={classification === "misleading"} onPress={() => setClassification("misleading")} />
              <Chip label="Not misleading" active={classification === "not_misleading"} onPress={() => setClassification("not_misleading")} />
            </View>
            <TextField label="Context readers should know" value={text} onChangeText={setText} multiline maxLength={500} style={{ minHeight: 100, textAlignVertical: "top" }} />
            <TextField label={classification === "misleading" ? "Source link (required)" : "Source link (optional)"} value={source} onChangeText={setSource} autoCapitalize="none" keyboardType="url" />
            <Text muted size="xs">
              Stick to facts with a reliable source. Notes are rated by other contributors before anyone sees them.
            </Text>
            <Button
              title="Submit note"
              loading={act.isPending}
              disabled={text.trim().length < 20 || (classification === "misleading" && !source.trim())}
              onPress={() =>
                act.mutate(
                  { path: `/posts/${postId}/notes`, body: { classification, text, sources: source.trim() ? [source.trim()] : [] } },
                  { onSuccess: () => (toast("Note submitted for rating"), setText(""), setSource("")), onError: (e) => toast(errorMessage(e)) },
                )
              }
            />
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
