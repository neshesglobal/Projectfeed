import { useLocalSearchParams } from "expo-router";
import { UserListScreen } from "../../src/components/UserListScreen";

export default function ListMembers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <UserListScreen title="Members" queryKey={["listMembers", id]} path={`/lists/${id}/members`} emptyTitle="No members yet" />;
}
