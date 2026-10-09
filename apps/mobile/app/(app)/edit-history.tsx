import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";
import { api } from "../../src/api/client";
import { Divider, Header, Loading, Screen, Text } from "../../src/components/ui";
import { space } from "../../src/theme";

export default function EditHistory() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const q = useQuery({
    queryKey: ["edits", postId],
    queryFn: () => api<{ current: string; previous: { text: string; replacedAt: string }[] }>(`/posts/${postId}/edits`),
  });
  return (
    <Screen>
      <Header title="Edit history" />
      {q.isLoading || !q.data ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
          <View style={{ gap: 4 }}>
            <Text weight="700">Latest version</Text>
            <Text>{q.data.current}</Text>
          </View>
          {[...q.data.previous].reverse().map((v) => (
            <View key={v.replacedAt} style={{ gap: 4 }}>
              <Divider />
              <Text muted size="sm">
                Replaced {new Date(v.replacedAt).toLocaleString("en-GB")}
              </Text>
              <Text>{v.text}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
