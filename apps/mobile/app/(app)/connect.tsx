import { useFollow } from "../../src/api/hooks";
import { UserListScreen } from "../../src/components/UserListScreen";
import { Button } from "../../src/components/ui";

export default function Connect() {
  const follow = useFollow();
  return (
    <UserListScreen
      title="Connect"
      subtitle="Suggested for you"
      queryKey={["suggestions", "connect"]}
      path="/users/suggestions?limit=30"
      emptyTitle="No suggestions right now"
      right={(u, refetch) => <Button title="Follow" small variant="secondary" onPress={() => follow.mutate({ user: u, follow: true }, { onSuccess: refetch })} />}
    />
  );
}
