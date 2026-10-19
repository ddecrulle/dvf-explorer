import { useState, type ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { AddressSearch } from '../components/AddressSearch';
import { MutationFilters } from '../components/MutationFilters';
import { DataPanel } from '../components/DataPanel';
import { createQueryClient } from '../queries/client';
import { defaultFilters } from '../queries/parcels';
import type { SearchFeature, Status } from '../types';

const feature: SearchFeature = {
  geometry: { coordinates: [0.148, 45.64] },
  properties: { id: 'angouleme', label: 'Angoulême', depcode: '16' },
};
function provider() {
  const client = createQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe('address search', () => {
  it('debounces input and supports keyboard selection', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ features: [feature] })),
      );
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = provider();
    const onChoose = vi.fn();
    render(<AddressSearch onChoose={onChoose} />, { wrapper });
    const input = screen.getByRole('combobox');
    await user.type(input, 'Angoulême');
    await screen.findByRole('option', { name: 'Angoulême' });
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChoose).toHaveBeenCalledWith(feature);
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
    client.clear();
  });

  it('hides old suggestions immediately and ignores an obsolete address response', async () => {
    const user = userEvent.setup();
    let resolveFirst: ((response: Response) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    const fetch = vi
      .fn()
      .mockImplementation(async (path: string, init: RequestInit) => {
        if (path.includes('Ang')) {
          firstSignal = init.signal as AbortSignal;
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        return new Response(
          JSON.stringify({
            features: [
              { ...feature, properties: { id: 'paris', label: 'Paris' } },
            ],
          }),
        );
      });
    vi.stubGlobal('fetch', fetch);
    const { wrapper, client } = provider();
    render(<AddressSearch onChoose={vi.fn()} />, { wrapper });
    const input = screen.getByRole('combobox');
    await user.type(input, 'Ang');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await user.clear(input);
    await user.type(input, 'Paris');
    expect(screen.queryByRole('listbox')).toBeNull();
    await screen.findByRole('option', { name: 'Paris' });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      resolveFirst?.(new Response(JSON.stringify({ features: [feature] })));
    });
    expect(screen.queryByRole('option', { name: 'Angoulême' })).toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    client.clear();
  });
});

describe('filter controls', () => {
  it('updates a year and clears the old date range atomically', async () => {
    const onChange = vi.fn();
    render(
      <MutationFilters
        value={{
          ...defaultFilters,
          start: '2025-01-01',
          end: '2025-12-31',
          kind: 'Maison',
        }}
        onChange={onChange}
        availableYears={[2025, 2024]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Sale year'), {
      target: { value: '2024' },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      ...defaultFilters,
      year: 2024,
      kind: 'Maison',
    });
  });

  it('resets advanced filters while preserving the selected year', async () => {
    const user = userEvent.setup();
    function Form() {
      const [value, setValue] = useState({
        ...defaultFilters,
        year: 2025,
        min: '100',
        max: '500',
        kind: 'Maison',
      });
      return (
        <MutationFilters
          value={value}
          onChange={setValue}
          availableYears={[2025]}
        />
      );
    }
    render(<Form />);
    await user.click(screen.getByLabelText('Show advanced filters'));
    await user.click(screen.getByText('Reset filters'));
    expect(
      (screen.getByLabelText('Min. price (€)') as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByLabelText('Max. price (€)') as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByLabelText('Sale year') as HTMLSelectElement).value,
    ).toBe('2025');
    expect(screen.getByRole('button', { name: /^All$/ }).className).toBe(
      'active',
    );
  });
});

it('opens published coverage without import actions, traps focus and restores it on close', async () => {
  const user = userEvent.setup();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const status: Status = {
    dataset: { mode: 'published', source: 'DVF+ Cerema', rows: 12 },
    imports: [{ year: 2025, department: '16', count: 12, located: 10 }],
    job: { state: 'idle' },
  };
  const { wrapper, client } = provider();
  function Example() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Official data</button>
        {open && (
          <DataPanel
            status={status}
            availableYears={[2025]}
            initialYear={2025}
            initialDepartment="16"
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  render(<Example />, { wrapper });
  const trigger = screen.getByRole('button', { name: 'Official data' });
  await user.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Published sales' })).toBeTruthy();
  expect(screen.getByText('2025 · 1 department')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Import$/ })).toBeNull();
  const close = screen.getByRole('button', { name: 'Close data panel' });
  expect(document.activeElement).toBe(close);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(
    screen.getByRole('link', { name: 'DVF+ publication and terms ↗' }),
  );
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(fetch).not.toHaveBeenCalled();
  client.clear();
});
