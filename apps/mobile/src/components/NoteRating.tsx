import { View } from "react-native";
import type { CommunityNote } from "@projectfeed/shared";
import { errorMessage } from "../api/client";
import { useNoteAction } from "../api/hooks";
import { Card, Chip } from "./glass";
import { toast } from "./Toast";
import { Text } from "./ui";
import { space, useTheme } from "../theme";

const STATUS: Record<CommunityNote["status"], string> = {
  needs_ratings: "Needs more ratings",
  helpful: "Shown on the post",
  not_helpful: "Not shown: rated not helpful",
};

/** A note with its status and the viewer's Helpful / Somewhat / Not helpful rating. */
export function NoteRating({ note, canRate }: { note: CommunityNote; canRate: boolean }) {
  const t = useTheme();
  const act = useNoteAction();
  const rate = (helpful: "yes" | "somewhat" | "no") =>
    act.mutate({ path: `/notes/${note.id}/rate`, body: { helpful } }, { onSuccess: () => toast("Thanks — rating saved"), onError: (e) => toast(errorMessage(e)) });
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
        <Text size="xs" weight="700" style={{ color: note.classification === "misleading" ? t.danger : t.success }}>
          {note.classification === "misleading" ? "SAYS THE POST IS MISLEADING" : "SAYS THE POST IS NOT MISLEADING"}
        </Text>
        <Text muted size="xs">
          {STATUS[note.status]}
        </Text>
      </View>
      <Text>{note.text}</Text>
      {note.sources.map((s) => (
        <Text key={s} size="sm" style={{ color: t.accent }} numberOfLines={1}>
          {s}
        </Text>
      ))}
      {note.isMine ? (
        <Text muted size="sm">
          Your note · {note.ratingCount} {note.ratingCount === 1 ? "rating" : "ratings"}
        </Text>
      ) : canRate ? (
        <>
          <Text muted size="sm">
            Is this note helpful?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Chip label="Helpful" active={note.myRating === "yes"} onPress={() => rate("yes")} />
            <Chip label="Somewhat" active={note.myRating === "somewhat"} onPress={() => rate("somewhat")} />
            <Chip label="Not helpful" active={note.myRating === "no"} onPress={() => rate("no")} />
          </View>
        </>
      ) : null}
    </Card>
  );
}
