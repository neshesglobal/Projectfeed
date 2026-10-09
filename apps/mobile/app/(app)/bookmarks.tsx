import { useBookmarks } from "../../src/api/hooks";
import { Feed } from "../../src/components/Feed";
import { EmptyState, Header, Screen } from "../../src/components/ui";
import { useAuth } from "../../src/store/auth";

export default function Bookmarks() {
  const q = useBookmarks();
  const me = useAuth((s) => s.user);
  return (
    <Screen>
      <Header title="Bookmarks" subtitle={me ? `@${me.handle}` : undefined} />
      <Feed query={q} surface="bookmarks" empty={<EmptyState title="Save posts for later" body="Bookmark posts to easily find them again in the future." />} />
    </Screen>
  );
}
