import { useCallback, useMemo } from 'react';
import { useRouter, useSearch } from '@tanstack/react-router';
import { explorerSearch, explorerState, type ExplorerRoute } from './search';

/** Domain actions are functional updates, so simultaneous map/form changes compose. */
export function useExplorerRoute() {
  const router = useRouter();
  const search = useSearch({ from: '/' });
  const route = useMemo(() => explorerState(search), [search]);
  const navigate = useCallback(
    (patch: Partial<ExplorerRoute>, replace = false) =>
      router.navigate({
        to: '/',
        search: (previous) =>
          explorerSearch({ ...explorerState(previous), ...patch }),
        replace,
        resetScroll: false,
      }),
    [router],
  );
  const selectionLink = useCallback(
    (patch: Partial<ExplorerRoute>) =>
      router.buildLocation({
        to: '/',
        search: (previous) =>
          explorerSearch({ ...explorerState(previous), ...patch }),
      }).href,
    [router],
  );
  return { route, navigate, selectionLink };
}
