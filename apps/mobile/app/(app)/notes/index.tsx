import { ScrollView, View } from "react-native";
import { errorMessage } from "../../../src/api/client";
import { useNotesQueue } from "../../../src/api/hooks";
import { Card } from "../../../src/components/glass";
import { NoteRating } from "../../../src/components/NoteRating";
import { PostCard } from "../../../src/components/PostCard";
import { EmptyState, ErrorView, Header, Loading, Screen, Text } from "../../../src/components/ui";
import { space } from "../../../src/theme";

/** Community Notes contributor queue: notes waiting for ratings. */
export default function RateNotes() {
  const q = useNotesQueue();
  if (q.isLoading) return <Screen><Header title="Community Notes" /><Loading /></Screen>;
  if (!q.data) return <Screen><Header title="Community Notes" /><ErrorView message={errorMessage(q.error)} /></Screen>;
  return (
    <Screen>
      <Header title="Community Notes" subtitle="Rate notes" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: 80 }}>
        <Text muted size="sm">
          Your ratings decide which notes are shown. A note goes live only when people who usually disagree both find it helpful.
        </Text>
        {q.data.eligibility ? (
          <Card>
            <Text muted size="sm">
              {q.data.eligibility}
            </Text>
          </Card>
        ) : q.data.items.length === 0 ? (
          <EmptyState title="You're all caught up" body="No notes need your rating right now." />
        ) : (
          q.data.items.map(({ post, note }) => (
            <View key={note.id} style={{ gap: space.sm }}>
              <PostCard post={post} surface="notes" />
              <NoteRating note={note} canRate />
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
