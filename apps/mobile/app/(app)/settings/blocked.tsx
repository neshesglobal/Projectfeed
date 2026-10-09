import { useRelationshipAction } from "../../../src/api/hooks";
import { UserListScreen } from "../../../src/components/UserListScreen";
import { Button } from "../../../src/components/ui";

export default function Blocked() {
  const rel = useRelationshipAction();
  return (
    <UserListScreen
      title="Blocked accounts"
      queryKey={["blocked"]}
      path="/me/blocked"
      emptyTitle="Block unwanted accounts"
      emptyBody="When you block someone, they won't be able to follow or message you, and you won't see notifications from them."
      right={(u, refetch) => <Button title="Unblock" small variant="danger" onPress={() => rel.mutate({ userId: u.id, action: "block", on: false }, { onSuccess: refetch })} />}
    />
  );
}
