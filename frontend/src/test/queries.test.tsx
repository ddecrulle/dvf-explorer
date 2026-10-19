import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../queries/client';
import { datasetOptions, useDataset, useImportData } from '../queries/dataset';
import { defaultFilters, useParcels } from '../queries/parcels';
import { ApiError } from '../api';
import type { ParcelsResponse, Status, Viewport } from '../types';

const published: Status = {
  dataset: { mode: 'published', source: 'DVF+', release: 'fixed-release' },
  years: [2025, 2024],
  imports: [],
  job: { state: 'idle' },
};
const area: Viewport = {
  west: 0.1,
  east: 0.2,
  south: 45.6,
  north: 45.7,
  zoom: 13,
};
const response = (total: number): ParcelsResponse => ({
  parcels: [],
  total,
  mutations: total,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function setup() {
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retryDelay: 0 },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, wrapper };
}

describe('dataset session', () => {
  it('pins published metadata across remounts, focus, reconnect and elapsed time', async () => {
    const fetch = vi.fn().mockResolvedValue(json(published));
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = setup();
    const first = renderHook(useDataset, { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    vi.useFakeTimers();
    const second = renderHook(useDataset, { wrapper });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(second.result.current.data?.dataset?.release).toBe('fixed-release');
    expect(fetch).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('polls an active legacy import and invalidates sales when it completes', async () => {
    const running: Status = { imports: [], job: { state: 'running' } };
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => json(running))
      .mockImplementation(async () =>
        json({ ...running, job: { state: 'done' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = setup();
    client.setQueryData(['parcels', 'local-area'], response(1));
    const hook = renderHook(useDataset, { wrapper });
    await waitFor(() =>
      expect(hook.result.current.data?.job.state).toBe('running'),
    );
    await waitFor(
      () => expect(hook.result.current.data?.job.state).toBe('done'),
      { timeout: 3500 },
    );
    vi.useFakeTimers();
    expect(hook.result.current.data?.job.state).toBe('done');
    expect(client.getQueryState(['parcels', 'local-area'])?.isInvalidated).toBe(
      true,
    );
    const calls = fetch.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fetch).toHaveBeenCalledTimes(calls);
    client.clear();
  });

  it('starts legacy writes through a mutation and refreshes metadata', async () => {
    const fetch = vi
      .fn()
      .mockImplementation(async (path: string) =>
        json(
          path === '/api/status'
            ? { imports: [], job: { state: 'running' } }
            : { id: 'job' },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = setup();
    client.setQueryData(datasetOptions.queryKey, {
      imports: [],
      job: { state: 'idle' },
    });
    const hook = renderHook(
      () => ({ dataset: useDataset(), mutation: useImportData() }),
      { wrapper },
    );
    await act(async () => {
      await hook.result.current.mutation.mutateAsync({
        token: 'local-token',
        selection: { department: '16', year: 2025 },
      });
    });
    await waitFor(() =>
      expect(hook.result.current.dataset.data?.job.state).toBe('running'),
    );
    expect(fetch.mock.calls[0][0]).toBe('/api/import');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      department: '16',
      year: 2025,
    });
    expect(fetch.mock.calls.some(([path]) => path === '/api/status')).toBe(
      true,
    );
    client.clear();
  });
});

describe('viewport queries', () => {
  it('waits for metadata and always sends its pinned release', async () => {
    const fetch = vi.fn().mockImplementation(async () => json(response(12)));
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = setup();
    const hook = renderHook(
      ({ status }: { status?: Status }) =>
        useParcels(area, defaultFilters, status),
      { wrapper, initialProps: { status: undefined } as { status?: Status } },
    );
    expect(fetch).not.toHaveBeenCalled();
    hook.rerender({ status: published });
    await waitFor(() => expect(hook.result.current.data.total).toBe(12));
    expect(
      new URL(fetch.mock.calls[0][0], 'http://localhost').searchParams.get(
        'release',
      ),
    ).toBe('fixed-release');
    client.clear();
  });

  it('keeps points while panning, aborts superseded requests and reuses a visited area', async () => {
    let lateResponse: ((value: Response) => void) | undefined;
    let obsoleteSignal: AbortSignal | undefined;
    const fetch = vi
      .fn()
      .mockImplementation(async (path: string, init: RequestInit) => {
        const west = new URL(path, 'http://localhost').searchParams.get('west');
        if (west === '0.3') {
          obsoleteSignal = init.signal as AbortSignal;
          return new Promise<Response>((resolve) => {
            lateResponse = resolve;
          });
        }
        return json(response(west === '0.5' ? 50 : 10));
      });
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = setup();
    const hook = renderHook(
      ({ view }) => useParcels(view, defaultFilters, published),
      { wrapper, initialProps: { view: area } },
    );
    await waitFor(() => expect(hook.result.current.data.total).toBe(10));
    hook.rerender({ view: { ...area, west: 0.3, east: 0.4 } });
    expect(hook.result.current.data.total).toBe(10);
    await waitFor(() => expect(obsoleteSignal).toBeDefined());
    hook.rerender({ view: { ...area, west: 0.5, east: 0.6 } });
    await waitFor(() => expect(hook.result.current.data.total).toBe(50));
    expect(obsoleteSignal?.aborted).toBe(true);
    await act(async () => {
      lateResponse?.(json(response(999)));
    });
    expect(hook.result.current.data.total).toBe(50);
    hook.rerender({ view: area });
    await waitFor(() => expect(hook.result.current.data.total).toBe(10));
    expect(fetch).toHaveBeenCalledTimes(3);
    client.clear();
  });

  it('does not request excessively wide areas or invalid filters', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = setup();
    const hook = renderHook(
      ({ view, filters }) => useParcels(view, filters, published),
      {
        wrapper,
        initialProps: { view: { ...area, east: 4 }, filters: defaultFilters },
      },
    );
    expect(hook.result.current.zoomRequired).toBe(true);
    hook.rerender({
      view: area,
      filters: { ...defaultFilters, min: '100', max: '50' },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(hook.result.current.error).toContain('minimum price');
    expect(fetch).not.toHaveBeenCalled();
    client.clear();
  });

  it('compares the entire previous year and preserves property and price filters', async () => {
    const fetch = vi.fn().mockImplementation(async () => json(response(1)));
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = setup();
    renderHook(
      () =>
        useParcels(
          area,
          {
            ...defaultFilters,
            year: 2025,
            kind: 'Maison',
            min: '100',
            start: '2025-01-01',
            end: '2025-03-01',
          },
          published,
        ),
      { wrapper },
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const comparison = fetch.mock.calls
      .map(([path]) => new URL(path, 'http://localhost').searchParams)
      .find((params) => params.get('year') === '2024');
    expect(comparison?.get('start')).toBeNull();
    expect(comparison?.get('end')).toBeNull();
    expect(comparison?.get('kind')).toBe('Maison');
    expect(comparison?.get('price_min')).toBe('100');
    client.clear();
  });

  it('shows API validation errors without retrying and retries transient errors once', async () => {
    const { client } = setup();
    const invalid = vi
      .fn()
      .mockRejectedValue(new ApiError('Invalid bounds', 422));
    await expect(
      client.fetchQuery({ queryKey: ['invalid'], queryFn: invalid }),
    ).rejects.toThrow('Invalid bounds');
    expect(invalid).toHaveBeenCalledTimes(1);
    const transient = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Unavailable', 503))
      .mockResolvedValue(42);
    expect(
      await client.fetchQuery({ queryKey: ['transient'], queryFn: transient }),
    ).toBe(42);
    expect(transient).toHaveBeenCalledTimes(2);
    client.clear();
  });
});
