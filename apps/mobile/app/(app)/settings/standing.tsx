import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import type { ModerationNotice } from "@projectfeed/shared";
import { errorMessage } from "../../../src/api/client";
import { useAppeal, useMarkNoticesRead, useStanding } from "../../../src/api/hooks";
import { Card } from "../../../src/components/glass";
import { toast } from "../../../src/components/Toast";
import { Button, EmptyState, ErrorView, Header, Loading, Screen, Text, TextField, type IconName } from "../../../src/components/ui";
import { radius, space, useTheme } from "../../../src/theme";

const ACTION_COPY: Record<ModerationNotice["action"], { title: string; icon: IconName; good?: boolean }> = {
  remove_post: { title: "Post removed", icon: "trash-outline" },
  restore_post: { title: "Post restored", icon: "refresh-outline", good: true },
  label_sensitive: { title: "Media marked as sensitive", icon: "eye-off-outline" },
  unlabel_sensitive: { title: "Sensitive label removed", icon: "eye-outline", good: true },
  limit_reach: { title: "Post visibility limited", icon: "trending-down-outline" },
  unlimit_reach: { title: "Visibility limit lifted", icon: "trending-up-outline", good: true },
  warn: { title: "Warning", icon: "warning-outline" },
  suspend: { title: "Account suspended", icon: "pause-circle-outline" },
  unsuspend: { title: "Suspension lifted", icon: "play-circle-outline", good: true },
  freeze: { title: "Account under review", icon: "time-outline" },
  unfreeze: { title: "Review complete", icon: "checkmark-circle-outline", good: true },
  ban: { title: "Account permanently suspended", icon: "close-circle-outline" },
  unban: { title: "Account reinstated", icon: "checkmark-circle-outline", good: true },
};

const humanReason = (code: string) => code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function NoticeCard({ n }: { n: ModerationNotice }) {
  const t = useTheme();
  const appeal = useAppeal();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const copy = ACTION_COPY[n.action];
  const tone = copy.good ? t.success : t.danger;

  const submit = () =>
    appeal.mutate(
      { actionId: n.actionId, text },
      {
        onSuccess: () => {
          setOpen(false);
          toast("Appeal sent. A different moderator will review it.");
        },
        onError: (e) => toast(errorMessage(e)),
      },
    );

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: copy.good ? t.accentSoft : "rgba(255,90,106,0.14)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={copy.icon} size={17} color={tone} />
        </View>
        <View style={{ flex: 1 }}>
          <Text weight="700">{copy.title}</Text>
          <Text muted size="sm">
            {formatDate(n.createdAt)}
            {n.reasonCode && !copy.good ? ` · ${humanReason(n.reasonCode)}` : ""}
          </Text>
        </View>
        {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.accent }} /> : null}
      </View>

      {n.statement ? <Text>{n.statement}</Text> : null}
      {n.postExcerpt ? (
        <View style={{ backgroundColor: t.bgInput, borderRadius: radius.md, padding: space.md }}>
          <Text muted size="sm" numberOfLines={4}>
            “{n.postExcerpt}”
          </Text>
        </View>
      ) : null}
      {n.expiresAt ? (
        <Text muted size="sm">
          Ends {formatDate(n.expiresAt)}
        </Text>
      ) : null}

      {n.appeal ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
          <Ionicons
            name={n.appeal.status === "open" ? "hourglass-outline" : n.appeal.status === "overturned" ? "checkmark-circle" : "remove-circle-outline"}
            size={16}
            color={n.appeal.status === "overturned" ? t.success : t.textMuted}
            style={{ marginTop: 2 }}
          />
          <Text muted size="sm" style={{ flex: 1 }}>
            {n.appeal.status === "open"
              ? "Appeal under review"
              : n.appeal.status === "overturned"
                ? `Appeal successful${n.appeal.decisionNote ? `: ${n.appeal.decisionNote}` : ""}`
                : `Appeal reviewed — decision upheld${n.appeal.decisionNote ? `: ${n.appeal.decisionNote}` : ""}`}
          </Text>
        </View>
      ) : null}

      {n.canAppeal && !open ? <Button title="Appeal this decision" variant="secondary" small onPress={() => setOpen(true)} /> : null}
      {open ? (
        <View style={{ gap: space.sm }}>
          <TextField
            label="Why was this decision wrong?"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
            style={{ minHeight: 96, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button title="Cancel" variant="secondary" small onPress={() => setOpen(false)} />
            <Button title="Send appeal" small loading={appeal.isPending} disabled={text.trim().length < 10} onPress={submit} />
          </View>
        </View>
      ) : null}
      {n.postId && n.action === "restore_post" ? <Button title="View post" variant="secondary" small onPress={() => router.push(`/post/${n.postId}`)} /> : null}
    </Card>
  );
}

/** Account status: suspension state, strikes and every statement of reasons, with appeals. */
export default function Standing() {
  const t = useTheme();
  const standing = useStanding();
  const markRead = useMarkNoticesRead();
  const unread = standing.data?.unread ?? 0;

  useEffect(() => {
    // Reading the screen acknowledges the notices (after a beat, so the unread dots are seen).
    if (unread === 0) return;
    const timer = setTimeout(() => markRead.mutate(), 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  if (standing.isLoading) return <Screen><Header title="Account status" /><Loading /></Screen>;
  if (!standing.data) return <Screen><Header title="Account status" /><ErrorView message={errorMessage(standing.error)} /></Screen>;
  const s = standing.data;
  const banner =
    s.status === "suspended"
      ? { icon: "pause-circle" as IconName, color: t.danger, title: "Your account is suspended", body: `You can read and browse, but you can't post, reply, like, follow or message${s.suspendedUntil ? ` until ${formatDate(s.suspendedUntil)}` : ""}. You can appeal below.` }
      : s.status === "frozen"
        ? { icon: "time" as IconName, color: t.verified, title: "Your account is under review", body: "Some features are paused while we complete a review. You can still read and browse." }
        : { icon: "checkmark-circle" as IconName, color: t.success, title: "Your account is in good standing", body: s.strikes > 0 ? `${s.strikes} active ${s.strikes === 1 ? "strike" : "strikes"}. Strikes count towards suspensions.` : "No strikes. Thanks for keeping Projectfeed professional." };

  return (
    <Screen>
      <Header title="Account status" />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 80 }}>
        <Card style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
          <Ionicons name={banner.icon} size={28} color={banner.color} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text weight="800" size="lg">
              {banner.title}
            </Text>
            <Text muted>{banner.body}</Text>
          </View>
        </Card>
        {s.notices.length === 0 ? (
          <EmptyState title="No moderation decisions" body="If we ever act on your posts or account, you'll see the reason here and can appeal." />
        ) : (
          <>
            <Text muted size="sm" weight="600" style={{ marginLeft: 4, marginTop: space.sm }}>
              DECISIONS
            </Text>
            {s.notices.map((n) => (
              <NoticeCard key={n.id} n={n} />
            ))}
          </>
        )}
        <Text muted size="xs" style={{ marginTop: space.md, textAlign: "center" }}>
          Appeals are reviewed by a different moderator from the one who made the decision. You can appeal within 90 days.
        </Text>
      </ScrollView>
    </Screen>
  );
}
