import { useLocalSearchParams } from "expo-router";
import { UserListScreen } from "../../src/components/UserListScreen";

export default function Connections() {
  const { userId, type, handle } = useLocalSearchParams<{ userId: string; type: "followers" | "following"; handle: string }>();
  return (
    <UserListScreen
      title={type === "followers" ? "Followers" : "Following"}
      subtitle={`@${handle}`}
      queryKey={["connections", userId, type]}
      path={`/users/${userId}/${type}?limit=100`}
      emptyTitle={type === "followers" ? "No followers yet" : "Not following anyone yet"}
    />
  );
}
