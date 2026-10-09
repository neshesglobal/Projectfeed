import { Pressable, View } from "react-native";
import type { Post } from "@projectfeed/shared";
import { useVote } from "../api/hooks";
import { radius, space, useTheme } from "../theme";
import { Text } from "./ui";

function timeLeft(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "Final results";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h} hours left`;
  return `${Math.max(1, Math.floor(ms / 60_000))} minutes left`;
}

export function PollView({ post }: { post: Post }) {
  const t = useTheme();
  const vote = useVote();
  const poll = post.poll!;
  const showResults = poll.closed || poll.viewerVote !== null;
  const max = Math.max(...poll.options.map((o) => o.votes));

  return (
    <View style={{ marginTop: space.md, gap: space.sm }}>
      {poll.options.map((o, i) => {
        const pct = poll.totalVotes ? Math.round((o.votes / poll.totalVotes) * 100) : 0;
        if (!showResults) {
          return (
            <Pressable
              key={i}
              onPress={() => vote.mutate({ post, optionIndex: i })}
              disabled={vote.isPending}
              accessibilityRole="button"
              style={{ borderWidth: 1, borderColor: t.accent, borderRadius: radius.pill, paddingVertical: 8, alignItems: "center" }}
            >
              <Text weight="700" style={{ color: t.accent }}>
                {o.label}
              </Text>
            </Pressable>
          );
        }
        const winner = o.votes === max && max > 0;
        return (
          <View key={i} style={{ height: 34, justifyContent: "center", borderRadius: radius.sm, overflow: "hidden" }}>
            <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, backgroundColor: winner ? t.accent : t.bgInput, opacity: winner ? 0.45 : 1, borderRadius: radius.sm }} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.md }}>
              <Text weight={winner ? "700" : "400"}>
                {o.label}
                {poll.viewerVote === i ? "  ✓" : ""}
              </Text>
              <Text weight={winner ? "700" : "400"}>{pct}%</Text>
            </View>
          </View>
        );
      })}
      <Text muted size="sm">
        {poll.totalVotes} {poll.totalVotes === 1 ? "vote" : "votes"} · {timeLeft(poll.endsAt)}
      </Text>
    </View>
  );
}
