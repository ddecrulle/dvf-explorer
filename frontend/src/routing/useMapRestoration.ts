import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { explorerState, validateExplorerSearch } from './search';

/** MapLibre restores the saved camera only on traversal, not on URL replacements
 * caused by its own move events. TanStack owns both history and route resolution.
 */
export function useMapRestoration() {
  const router = useRouter();
  const traversing = useRef(false);
  const [restoration, setRestoration] = useState(() => ({
    route: explorerState(validateExplorerSearch(router.state.location.search)),
    view: explorerState(validateExplorerSearch(router.state.location.search))
      .view,
    revision: 0,
  }));
  useEffect(() => {
    const stopHistory = router.history.subscribe(({ action }) => {
      traversing.current = action.type !== 'PUSH' && action.type !== 'REPLACE';
    });
    const stopResolved = router.subscribe('onResolved', ({ toLocation }) => {
      if (!traversing.current) return;
      traversing.current = false;
      setRestoration((previous) => ({
        route: explorerState(validateExplorerSearch(toLocation.search)),
        view: explorerState(validateExplorerSearch(toLocation.search)).view,
        revision: previous.revision + 1,
      }));
    });
    return () => {
      stopHistory();
      stopResolved();
    };
  }, [router]);
  return restoration;
}
