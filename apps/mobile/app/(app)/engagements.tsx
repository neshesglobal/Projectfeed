import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { FeedItem } from "@projectfeed/shared";
import { usePaged } from "../../src/api/hooks";
import { Feed } from "../../src/components/Feed";
import { UserListScreen } from "../../src/components/UserListScreen";
import { Header, Screen, TopTabs } from "../../src/components/ui";

type Tab = "quotes" | "reposts" | "likes";

function Quotes({ postId }: { postId: string }) {
  const q = usePaged<FeedItem>(["quotes", postId], `/posts/${postId}/quotes`);
  return <Feed query={q} surface="quotes" />;
}

export default function Engagements() {
  const { postId, tab: initial } = useLocalSearchParams<{ postId: string; tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(initial ?? "likes");
  const tabs = (
    <View>
      <Header title="Post engagements" />
      <TopTabs
        tabs={[
          { key: "quotes", label: "Quotes" },
          { key: "reposts", label: "Reposts" },
          { key: "likes", label: "Likes" },
        ]}
        value={tab}
        onChange={setTab}
      />
    </View>
  );
  if (tab === "quotes") {
    return (
      <Screen>
        {tabs}
        <Quotes postId={postId} />
      </Screen>
    );
  }
  return (
    <UserListScreen
      key={tab}
      title=""
      header={tabs}
      queryKey={["engagements", postId, tab]}
      path={`/posts/${postId}/${tab}`}
      emptyTitle={tab === "likes" ? "No likes yet" : "No reposts yet"}
      emptyBody={tab === "likes" ? "When someone likes this post, they'll show up here." : "Share someone else's post on your timeline by reposting it."}
    />
  );
}
