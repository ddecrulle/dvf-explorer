import { useEffect, useRef } from 'react';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../api';
import type { Status } from '../types';

export const datasetOptions = queryOptions({
  queryKey: ['dataset'],
  queryFn: ({ signal }) => api<Status>('/api/status', { signal }),
  staleTime: Infinity,
  gcTime: Infinity,
  refetchInterval: (query) => {
    const status = query.state.data;
    return status?.dataset?.mode !== 'published' &&
      status?.job.state === 'running'
      ? 2500
      : false;
  },
});

export function useDataset() {
  const client = useQueryClient();
  const query = useQuery(datasetOptions);
  const lastJob = useRef<Status['job']['state'] | undefined>(undefined);
  useEffect(() => {
    const job = query.data?.job.state;
    if (lastJob.current === 'running' && job === 'done') {
      void client.invalidateQueries({ queryKey: ['parcels'] });
      void client.invalidateQueries({ queryKey: ['parcel-history'] });
    }
    lastJob.current = job;
  }, [query.data?.job.state, client]);
  return query;
}

interface ImportRequest {
  department: string;
  year: number;
}
export function useImportData() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      selection,
    }: {
      token: string;
      selection?: ImportRequest;
    }) =>
      api('/api/' + (selection ? 'import' : 'sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: selection ? JSON.stringify(selection) : undefined,
      }),
    onSuccess: async () => {
      client.setQueryData<Status>(datasetOptions.queryKey, (status) =>
        status
          ? { ...status, job: { state: 'running', message: 'Preparing data…' } }
          : status,
      );
      await client.invalidateQueries({ queryKey: datasetOptions.queryKey });
    },
  });
}
