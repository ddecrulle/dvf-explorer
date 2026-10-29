import { translateMessage } from '../messages';
import { useTranslation } from 'react-i18next';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Search, X } from 'lucide-react';
import { validParcel } from '../queries/dpe';
import { api } from '../api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { SearchFeature, SearchResponse } from '../types';

export function AddressSearch({
  onChoose,
}: {
  onChoose: (feature: SearchFeature) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = useDebouncedValue(text.trim(), 300);
  const id = useId();
  const search = useQuery({
    queryKey: ['addresses', query],
    queryFn: ({ signal }) =>
      api<SearchResponse>('/api/search?q=' + encodeURIComponent(query), {
        signal,
      }),
    enabled: open && query.length >= 3 && query === text.trim(),
    staleTime: 5 * 60 * 1000,
  });
  const visible = open && text.trim() === query && query.length >= 3;
  const suggestions = visible ? (search.data?.features ?? []) : [];
  const message = visible
    ? translateMessage(search.error?.message || '') ||
      (search.isSuccess && !suggestions.length
        ? t(
            validParcel(query.replace(/[\s-]+/g, '').toUpperCase())
              ? 'search.parcelEmpty'
              : 'search.empty',
          )
        : '')
    : '';
  const expanded = visible && (suggestions.length > 0 || !!message);
  function choose(feature: SearchFeature) {
    onChoose(feature);
    setText('');
    setOpen(false);
    setActive(-1);
  }
  return (
    <div
      className="search-box"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Search size={19} />
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-controls={id}
        aria-expanded={expanded}
        aria-activedescendant={
          suggestions[active] ? `${id}-${active}` : undefined
        }
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (
            (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
            suggestions.length
          ) {
            event.preventDefault();
            setActive(
              (index) =>
                (index +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  suggestions.length) %
                suggestions.length,
            );
          }
          if (event.key === 'Enter') {
            const chosen =
              suggestions[active] ??
              (suggestions.length === 1 ? suggestions[0] : undefined);
            if (chosen) {
              event.preventDefault();
              choose(chosen);
            }
          }
        }}
      />
      {text && (
        <button
          className="icon"
          aria-label={t('search.clear')}
          onClick={() => {
            setText('');
            setActive(-1);
          }}
        >
          <X size={16} />
        </button>
      )}
      {expanded && (
        <div
          className="suggestions"
          id={id}
          role="listbox"
          aria-label={t('search.addresses')}
        >
          {suggestions.map((feature, index) => (
            <button
              id={`${id}-${index}`}
              role="option"
              aria-selected={active === index}
              key={feature.properties.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(feature)}
            >
              <MapPin size={16} />
              {feature.properties.label}
            </button>
          ))}
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </div>
  );
}
