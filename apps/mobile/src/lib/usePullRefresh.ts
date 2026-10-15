import { useCallback, useState } from "react";

/**
 * Pull-to-refresh state that reflects only the user's pull, not background refetches.
 * Binding RefreshControl to a query's isRefetching made the spinner appear on every poll and focus refetch,
 * and on iOS it could stick when the flag flipped on and off quickly.
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  }, [refetch]);
  return { refreshing, onRefresh };
}
