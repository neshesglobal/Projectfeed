import { useQueryClient } from "@tanstack/react-query";
import { View } from "react-native";
import { api } from "../../src/api/client";
import { UserListScreen } from "../../src/components/UserListScreen";
import { Button } from "../../src/components/ui";
import { space } from "../../src/theme";

export default function FollowRequests() {
  const qc = useQueryClient();
  const act = async (id: string, action: "accept" | "deny", refetch: () => void) => {
    await api(`/me/follow-requests/${id}/${action}`, { method: "POST" });
    refetch();
    void qc.invalidateQueries({ queryKey: ["me"] });
  };
  return (
    <UserListScreen
      title="Follow requests"
      queryKey={["follow-requests"]}
      path="/me/follow-requests"
      emptyTitle="No follow requests"
      emptyBody="When your account is protected, people who want to follow you appear here for approval."
      right={(u, refetch) => (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button title="Accept" small onPress={() => void act(u.id, "accept", refetch)} />
          <Button title="Decline" small variant="outline" onPress={() => void act(u.id, "deny", refetch)} />
        </View>
      )}
    />
  );
}
