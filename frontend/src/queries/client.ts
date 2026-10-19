import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: (count, error) =>
          count < 1 && (!(error instanceof ApiError) || error.status >= 500),
      },
      mutations: { retry: false },
    },
  });
}
