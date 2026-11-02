import './i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './queries/client';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { createExplorerRouter } from './router';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
const client = createQueryClient();
const router = createExplorerRouter();
createRoot(root).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
