import { useRelationshipAction } from "../../../src/api/hooks";
import { UserListScreen } from "../../../src/components/UserListScreen";
import { Button } from "../../../src/components/ui";

export default function Muted() {
  const rel = useRelationshipAction();
  return (
    <UserListScreen
      title="Muted accounts"
      queryKey={["muted"]}
      path="/me/muted"
      emptyTitle="Mute unwanted accounts"
      emptyBody="Posts from muted accounts won't show up in your Home timeline. They won't know you've muted them."
      right={(u, refetch) => <Button title="Unmute" small variant="outline" onPress={() => rel.mutate({ userId: u.id, action: "mute", on: false }, { onSuccess: refetch })} />}
    />
  );
}
