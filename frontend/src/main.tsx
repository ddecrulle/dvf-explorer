import './i18n';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './queries/client';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
const client = createQueryClient();
createRoot(root).render(
  <QueryClientProvider client={client}>
    <App />
  </QueryClientProvider>,
);
