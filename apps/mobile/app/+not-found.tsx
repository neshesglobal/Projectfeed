import { router } from "expo-router";
import { Button, EmptyState, Screen } from "../src/components/ui";

export default function NotFound() {
  return (
    <Screen edges={["top"]}>
      <EmptyState title="This page doesn't exist" body="Try searching for something else." action={<Button title="Go home" onPress={() => router.replace("/")} />} />
    </Screen>
  );
}
