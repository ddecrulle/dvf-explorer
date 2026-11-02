import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
  type RouteComponent,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import App from './App';
import { changeLanguage, i18n } from './i18n';
import { validateExplorerSearch } from './routing/search';
import { useExplorerRoute } from './routing/useExplorerRoute';

function ExplorerPage() {
  const { route, navigate } = useExplorerRoute();
  useEffect(() => {
    if (route.language) void changeLanguage(route.language);
    else
      void navigate(
        { language: i18n.resolvedLanguage === 'en' ? 'en' : 'fr' },
        true,
      );
  }, [route.language, navigate]);
  return <App />;
}

export function createExplorerRouter(
  history?: RouterHistory,
  component: RouteComponent = ExplorerPage,
) {
  const rootRoute = createRootRoute({ component: Outlet });
  const explorerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: validateExplorerSearch,
    component,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([explorerRoute]),
    history,
    search: { strict: true },
    defaultPendingMs: 0,
    scrollRestoration: false,
  });
}
export type ExplorerRouter = ReturnType<typeof createExplorerRouter>;
declare module '@tanstack/react-router' {
  interface Register {
    router: ExplorerRouter;
  }
}
