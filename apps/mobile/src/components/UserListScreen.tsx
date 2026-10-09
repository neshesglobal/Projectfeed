import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FlatList, RefreshControl } from "react-native";
import type { Page, UserSummary } from "@projectfeed/shared";
import { api, errorMessage } from "../api/client";
import { useTheme } from "../theme";
import { EmptyState, ErrorView, Header, Loading, Screen, UserRow } from "./ui";

/** Shared screen for any list of accounts (followers, likes, blocked, requests…). */
export function UserListScreen({
  title,
  subtitle,
  queryKey,
  path,
  right,
  emptyTitle,
  emptyBody,
  header,
}: {
  title: string;
  subtitle?: string;
  queryKey: readonly unknown[];
  path: string;
  right?: (u: UserSummary, refetch: () => void) => ReactNode;
  emptyTitle: string;
  emptyBody?: string;
  header?: ReactNode;
}) {
  const t = useTheme();
  const q = useQuery({ queryKey, queryFn: () => api<Page<UserSummary>>(path) });
  return (
    <Screen>
      {header ?? <Header title={title} subtitle={subtitle} />}
      <FlatList
        data={q.data?.items ?? []}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => <UserRow user={item} right={right?.(item, () => void q.refetch())} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.accent} />}
        ListEmptyComponent={
          q.isLoading ? <Loading /> : q.isError ? <ErrorView message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : <EmptyState title={emptyTitle} body={emptyBody} />
        }
      />
    </Screen>
  );
}
