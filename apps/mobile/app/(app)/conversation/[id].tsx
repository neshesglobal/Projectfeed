import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatRelativeTime, type Conversation, type Message } from "@projectfeed/shared";
import { api, errorMessage } from "../../../src/api/client";
import { useMessages } from "../../../src/api/hooks";
import { uploadWithProgress, waitUntilReady, type LocalAsset } from "../../../src/lib/upload";
import { QuotedPost, openReport } from "../../../src/components/PostCard";
import { useSheet } from "../../../src/components/Sheet";
import { toast } from "../../../src/components/Toast";
import { LinearGradient } from "expo-linear-gradient";
import { Glass } from "../../../src/components/glass";
import { Avatar, Button, Header, IconButton, Loading, Screen, Text } from "../../../src/components/ui";
import { conversationTitle } from "../../../src/lib/format";
import { useAuth } from "../../../src/store/auth";
import { radius, space, useTheme } from "../../../src/theme";

function Bubble({ m, mine, onLongPress }: { m: Message; mine: boolean; onLongPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={300} style={{ alignItems: mine ? "flex-end" : "flex-start", paddingHorizontal: space.lg, marginVertical: 3 }}>
      <View style={{ maxWidth: "80%", gap: 4 }}>
        {m.media.map((med) => (
          <Pressable
            key={med.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={med.type === "video" ? "Play video" : med.altText || "Image"}
            onPress={() =>
              med.type === "video"
                ? router.push({ pathname: "/video-viewer", params: { url: med.url, poster: med.thumbUrl } })
                : router.push({ pathname: "/media-viewer", params: { urls: JSON.stringify([med.url]), index: "0" } })
            }
          >
            <Image source={{ uri: med.thumbUrl }} style={{ width: 220, height: Math.min(360, 220 * (med.height / Math.max(med.width, 1))), borderRadius: radius.lg }} contentFit="cover" />
            {med.type === "video" ? (
              <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="play-circle" size={52} color="rgba(255,255,255,0.9)" />
              </View>
            ) : null}
          </Pressable>
        ))}
        {m.sharedPost ? <QuotedPost post={m.sharedPost} /> : null}
        {m.deleted ? (
          <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.sm }}>
            <Text muted size="sm">
              This message was deleted
            </Text>
          </View>
        ) : m.text ? (
          <LinearGradient
            colors={mine ? t.accentGradient : [t.card, t.card]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              borderRadius: 20,
              borderBottomRightRadius: mine ? 6 : 20,
              borderBottomLeftRadius: mine ? 20 : 6,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderWidth: mine ? 0 : 1,
              borderColor: t.cardBorder,
            }}
          >
            <Text style={{ color: mine ? "#fff" : t.text, lineHeight: 20 }}>{m.text}</Text>
          </LinearGradient>
        ) : null}
        <Text muted size="xs" style={{ alignSelf: mine ? "flex-end" : "flex-start" }}>
          {formatRelativeTime(m.createdAt)}
          {m.editedAt ? " · Edited" : ""}
        </Text>
      </View>
    </Pressable>
  );
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const openSheet = useSheet((s) => s.open);
  const conv = useQuery({ queryKey: ["conversation", id], queryFn: () => api<Conversation>(`/conversations/${id}`) });
  const messages = useMessages(id);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<Message | null>(null);

  // Poll for new messages while the chat is open (WebSocket delivery replaces this later).
  useEffect(() => {
    const h = setInterval(() => void messages.refetch(), 5000);
    return () => clearInterval(h);
  }, [messages]);

  const latestId = messages.data?.pages[0]?.items[0]?.id;
  useEffect(() => {
    if (!latestId) return;
    void api(`/conversations/${id}/read`, { method: "POST" }).then(() => {
      void qc.invalidateQueries({ queryKey: ["unread"] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    });
  }, [latestId, id, qc]);

  const send = useMutation({
    mutationFn: async (input: { text: string; asset?: LocalAsset }) => {
      let mediaIds: string[] = [];
      if (input.asset) {
        toast(input.asset.kind === "video" ? "Uploading video…" : "Uploading photo…");
        const uploaded = await uploadWithProgress(input.asset, () => {});
        mediaIds = [(await waitUntilReady(uploaded)).id];
      }
      return api<Message>(`/conversations/${id}/messages`, { method: "POST", body: { text: input.text, mediaIds } });
    },
    onSuccess: () => {
      void messages.refetch();
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) => toast(errorMessage(e)),
  });

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      try {
        await api(`/messages/${editing.id}`, { method: "PATCH", body: { text: body } });
        setEditing(null);
        setText("");
        void messages.refetch();
      } catch (e) {
        toast(errorMessage(e));
      }
      return;
    }
    setText("");
    send.mutate({ text: body });
  };

  const attach = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 0.9, videoMaxDuration: 600 });
    const a = res.canceled ? null : res.assets[0];
    if (a) {
      send.mutate({
        text: "",
        asset: { uri: a.uri, mimeType: a.mimeType ?? undefined, kind: a.type === "video" ? "video" : "image", durationMs: a.duration ?? null, fileName: a.fileName ?? null },
      });
    }
  };

  const messageMenu = (m: Message) => {
    if (m.deleted) return;
    const mine = m.sender.id === me?.id;
    const opts = [];
    if (mine && Date.now() - new Date(m.createdAt).getTime() < 15 * 60_000 && m.text) {
      opts.push({ label: "Edit", icon: "pencil" as const, onPress: () => { setEditing(m); setText(m.text); } });
    }
    if (mine) {
      opts.push({
        label: "Delete for everyone",
        icon: "trash-outline" as const,
        destructive: true,
        onPress: async () => {
          await api(`/messages/${m.id}`, { method: "DELETE" });
          void messages.refetch();
        },
      });
    } else {
      opts.push({ label: "Report message", icon: "flag-outline" as const, destructive: true, onPress: () => openReport("message", m.id) });
    }
    openSheet(opts);
  };

  const all = messages.data?.pages.flatMap((p) => p.items) ?? [];
  const c = conv.data;
  const other = c?.participants[0];

  return (
    <Screen>
      <Header
        title={c ? conversationTitle(c) : ""}
        subtitle={c && !c.isGroup && other ? `@${other.handle}` : c ? `${c.participants.length + 1} people` : undefined}
        right={
          other && !c?.isGroup ? (
            <Pressable onPress={() => router.push(`/user/${other.handle}`)}>
              <Avatar user={other} size={32} />
            </Pressable>
          ) : (
            <IconButton
              name="exit-outline"
              label="Leave conversation"
              onPress={async () => {
                await api(`/conversations/${id}`, { method: "DELETE" });
                void qc.invalidateQueries({ queryKey: ["conversations"] });
                router.back();
              }}
            />
          )
        }
      />
      {c?.isRequest ? (
        <View style={{ padding: space.lg, gap: space.sm, borderBottomWidth: 1, borderBottomColor: t.border }}>
          <Text>
            {other ? `@${other.handle}` : "Someone"} wants to message you. They won't know you've seen it until you accept.
          </Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Button
              title="Accept"
              small
              onPress={async () => {
                await api(`/conversations/${id}/accept`, { method: "POST" });
                void conv.refetch();
                void qc.invalidateQueries({ queryKey: ["conversations"] });
              }}
            />
            <Button
              title="Delete"
              small
              variant="danger"
              onPress={async () => {
                await api(`/conversations/${id}`, { method: "DELETE" });
                void qc.invalidateQueries({ queryKey: ["conversations"] });
                router.back();
              }}
            />
            {other ? <Button title="Report" small variant="outline" onPress={() => openReport("user", other.id)} /> : null}
          </View>
        </View>
      ) : null}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <FlatList
          data={all}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble m={item} mine={item.sender.id === me?.id} onLongPress={() => messageMenu(item)} />}
          onEndReached={() => messages.hasNextPage && !messages.isFetchingNextPage && void messages.fetchNextPage()}
          ListFooterComponent={messages.isLoading || messages.isFetchingNextPage ? <Loading /> : null}
          contentContainerStyle={{ paddingVertical: space.md }}
        />
        {editing ? (
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>
            <Ionicons name="pencil" size={14} color={t.accent} />
            <Text size="sm" style={{ flex: 1, color: t.accent }}>
              Editing message
            </Text>
            <IconButton name="close" label="Cancel edit" size={16} onPress={() => { setEditing(null); setText(""); }} />
          </View>
        ) : null}
        <Glass radius={radius.xl} style={{ flexDirection: "row", alignItems: "flex-end", gap: space.xs, padding: 6, marginHorizontal: space.sm, marginBottom: insets.bottom + space.sm }}>
          <IconButton name="image-outline" label="Attach photo or video" color={t.accent} onPress={() => void attach()} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Start a message"
            placeholderTextColor={t.textMuted}
            multiline
            accessibilityLabel="Message"
            style={{ flex: 1, paddingHorizontal: space.sm, paddingVertical: 10, color: t.text, maxHeight: 120, fontSize: 15 }}
          />
          <IconButton name="arrow-up-circle" size={30} label="Send" color={text.trim() ? t.accent : t.textMuted} onPress={() => void submit()} disabled={!text.trim() || send.isPending} />
        </Glass>
      </KeyboardAvoidingView>
    </Screen>
  );
}
