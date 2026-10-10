import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Platform, Pressable, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCount, type FeedItem, type Post, type UserProfile } from "@projectfeed/shared";
import { api, errorMessage } from "../../../src/api/client";
import { useFollow, useProfile, useRelationshipAction, useUserPosts } from "../../../src/api/hooks";
import { LinearGradient } from "expo-linear-gradient";
import { Card } from "../../../src/components/glass";
import { Feed } from "../../../src/components/Feed";
import { MediaTabGrid } from "../../../src/components/MediaTabGrid";
import { SHARE_BASE, openReport } from "../../../src/components/PostCard";
import { useSheet, type SheetOption } from "../../../src/components/Sheet";
import { toast } from "../../../src/components/Toast";
import { Avatar, Button, EmptyState, ErrorView, IconButton, Loading, Screen, Text, TopTabs, VerifiedBadge } from "../../../src/components/ui";
import { useAuth } from "../../../src/store/auth";
import { radius, space, useTheme } from "../../../src/theme";

type Tab = "posts" | "replies" | "media" | "likes";

function FollowButton({ user }: { user: UserProfile }) {
  const follow = useFollow();
  const v = user.viewer!;
  if (v.blocking) return null;
  if (v.following || v.followRequested) {
    return (
      <Button
        title={v.following ? "Following" : "Pending"}
        variant="outline"
        small
        onPress={() => follow.mutate({ user, follow: false })}
      />
    );
  }
  return <Button title={v.followedBy ? "Follow back" : "Follow"} variant="secondary" small onPress={() => follow.mutate({ user, follow: true })} />;
}

function ProfileHeader({ user, tab, setTab }: { user: UserProfile; tab: Tab; setTab: (t: Tab) => void }) {
  const t = useTheme();
  const me = useAuth((s) => s.user);
  const isMe = user.id === me?.id;
  const joined = new Date(user.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <View>
      {user.bannerUrl ? (
        <Image source={{ uri: user.bannerUrl }} style={{ height: 150, backgroundColor: t.bgInput }} contentFit="cover" />
      ) : (
        <LinearGradient colors={[...t.accentGradient, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={{ height: 150, opacity: 0.55 }} />
      )}
      <View style={{ paddingHorizontal: space.lg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: -36 }}>
          <View style={{ borderWidth: 3, borderColor: t.glassHighlight, borderRadius: 48, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
            <Avatar user={user} size={80} />
          </View>
          <View style={{ flexDirection: "row", gap: space.sm, paddingBottom: space.xs }}>
            {!isMe && user.viewer && !user.viewer.blocking && !user.viewer.blockedBy ? (
              <IconButton
                name="mail-outline"
                label="Message"
                size={18}
                style={{ borderWidth: 1, borderColor: t.border }}
                onPress={async () => {
                  try {
                    const c = await api<{ id: string }>("/conversations", { method: "POST", body: { participantIds: [user.id] } });
                    router.push(`/conversation/${c.id}`);
                  } catch (e) {
                    toast(errorMessage(e));
                  }
                }}
              />
            ) : null}
            {isMe ? <Button title="Edit profile" variant="outline" small onPress={() => router.push("/edit-profile")} /> : user.viewer ? <FollowButton user={user} /> : null}
          </View>
        </View>
        <View style={{ marginTop: space.md, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text weight="800" size="xl">
              {user.displayName}
            </Text>
            <VerifiedBadge level={user.kycLevel} size={20} />
            {user.isProtected ? <Ionicons name="lock-closed" size={16} color={t.textMuted} style={{ marginLeft: 4 }} /> : null}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text muted>@{user.handle}</Text>
            {user.viewer?.followedBy ? (
              <View style={{ backgroundColor: t.bgInput, borderRadius: 4, paddingHorizontal: 4 }}>
                <Text muted size="xs">
                  Follows you
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {user.bio ? <Text style={{ marginTop: space.md }}>{user.bio}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.lg, rowGap: 4, marginTop: space.md }}>
          {user.company || user.role ? (
            <Text muted>
              <Ionicons name="briefcase-outline" size={14} /> {[user.role, user.company].filter(Boolean).join(" at ")}
            </Text>
          ) : null}
          {user.location ? (
            <Text muted>
              <Ionicons name="location-outline" size={14} /> {user.location}
            </Text>
          ) : null}
          {user.website ? (
            <Text style={{ color: t.accent }} onPress={() => void Linking.openURL(user.website)}>
              <Ionicons name="link-outline" size={14} /> {user.website.replace(/^https?:\/\//, "")}
            </Text>
          ) : null}
          <Text muted>
            <Ionicons name="calendar-outline" size={14} /> Joined {joined}
          </Text>
        </View>
        {user.sectors.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.md }}>
            {user.sectors.map((s) => (
              <View key={s} style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
                <Text size="xs">{s}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Card padding={0} style={{ flexDirection: "row", marginTop: space.lg, marginBottom: space.sm, borderRadius: radius.lg }}>
          {(
            [
              ["Posts", user.postsCount, null],
              ["Following", user.followingCount, "following"],
              ["Followers", user.followersCount, "followers"],
            ] as const
          ).map(([label, n, type], i) => (
            <Pressable
              key={label}
              disabled={!type}
              onPress={() => type && router.push({ pathname: "/connections", params: { userId: user.id, type, handle: user.handle } })}
              style={{ flex: 1, alignItems: "center", paddingVertical: space.md, borderLeftWidth: i ? 1 : 0, borderLeftColor: t.border }}
            >
              <Text weight="800" size="lg">
                {formatCount(n)}
              </Text>
              <Text muted size="xs">
                {label}
              </Text>
            </Pressable>
          ))}
        </Card>
      </View>
      <TopTabs
        tabs={[
          { key: "posts", label: "Posts" },
          { key: "replies", label: "Replies" },
          { key: "media", label: "Media" },
          ...(isMe ? [{ key: "likes" as const, label: "Likes" }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
    </View>
  );
}

function ProfileBody({ user }: { user: UserProfile }) {
  const [tab, setTab] = useState<Tab>("posts");
  const blocked = user.viewer?.blocking || user.viewer?.blockedBy;
  const locked = user.isProtected && user.viewer && !user.viewer.following;
  const posts = useUserPosts(blocked || locked ? undefined : user.id, tab);
  const pinned = useQuery({
    queryKey: ["post", user.pinnedPostId],
    enabled: !!user.pinnedPostId && tab === "posts" && !blocked && !locked,
    queryFn: () => api<Post>(`/posts/${user.pinnedPostId}`),
  });
  const pinnedItem: FeedItem | null = tab === "posts" && pinned.data ? { post: pinned.data, repostedBy: null, reason: "Pinned" } : null;
  const header = <ProfileHeader user={user} tab={tab} setTab={setTab} />;

  if (blocked || locked) {
    return (
      <Feed
        query={posts}
        surface="profile"
        header={header}
        empty={
          user.viewer?.blockedBy ? (
            <EmptyState title="You're blocked" body={`You can't follow or see @${user.handle}'s posts.`} />
          ) : user.viewer?.blocking ? (
            <EmptyState title={`@${user.handle} is blocked`} body="Unblock them from the menu to see their posts." />
          ) : (
            <EmptyState title="These posts are protected" body={`Only approved followers can see @${user.handle}'s posts. Tap Follow to send a request.`} />
          )
        }
      />
    );
  }
  if (tab === "media") {
    return <MediaTabGrid query={posts} header={header} empty={<EmptyState title={`@${user.handle} hasn't posted media yet`} />} />;
  }
  return (
    <Feed
      query={posts}
      surface={`profile:${tab}`}
      header={header}
      pinned={pinnedItem}
      empty={<EmptyState title={tab === "likes" ? "You don't have any likes yet" : `@${user.handle} hasn't posted yet`} />}
    />
  );
}

export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const insets = useSafeAreaInsets();
  const profile = useProfile(handle);
  const me = useAuth((s) => s.user);
  const openSheet = useSheet((s) => s.open);
  const rel = useRelationshipAction();
  const user = profile.data;

  const menu = () => {
    if (!user) return;
    const url = `${SHARE_BASE}/@${user.handle}`;
    const opts: SheetOption[] = [{ label: "Share profile", icon: "share-outline", onPress: () => void Share.share(Platform.OS === "ios" ? { url } : { message: url }) }];
    if (user.id !== me?.id && user.viewer) {
      opts.push(
        { label: "Add/remove from Lists", icon: "list-outline" as const, onPress: () => router.push({ pathname: "/lists", params: { addUserId: user.id } }) },
        {
          label: user.viewer.muting ? `Unmute @${user.handle}` : `Mute @${user.handle}`,
          icon: "volume-mute-outline" as const,
          onPress: () => rel.mutate({ userId: user.id, action: "mute", on: !user.viewer!.muting }, { onSuccess: () => void profile.refetch() }),
        },
        {
          label: user.viewer.blocking ? `Unblock @${user.handle}` : `Block @${user.handle}`,
          icon: "ban-outline" as const,
          onPress: () => {
            const go = () => void rel.mutate({ userId: user.id, action: "block", on: !user.viewer!.blocking }, { onSuccess: () => void profile.refetch() });
            if (user.viewer!.blocking || Platform.OS === "web") return go();
            Alert.alert(`Block @${user.handle}?`, "They will not be able to follow you or view your posts, and you will not see posts or notifications from them.", [
              { text: "Cancel", style: "cancel" },
              { text: "Block", style: "destructive", onPress: go },
            ]);
          },
        },
        { label: `Report @${user.handle}`, icon: "flag-outline" as const, onPress: () => openReport("user", user.id) },
      );
    }
    openSheet(opts);
  };

  return (
    <Screen>
      {profile.isLoading ? (
        <Loading style={{ marginTop: insets.top + 60 }} />
      ) : profile.isError || !user ? (
        <View style={{ paddingTop: insets.top + 60 }}>
          <EmptyState title="This account doesn't exist" body="Try searching for another." />
          {profile.error ? <ErrorView message={errorMessage(profile.error)} /> : null}
        </View>
      ) : (
        <ProfileBody user={user} />
      )}
      <View style={{ position: "absolute", top: insets.top + space.sm, left: space.md, right: space.md, flexDirection: "row", justifyContent: "space-between" }}>
        <IconButton name="chevron-back" label="Back" glass size={20} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        {user ? <IconButton name="ellipsis-horizontal" label="More" glass size={20} onPress={menu} /> : null}
      </View>
    </Screen>
  );
}
