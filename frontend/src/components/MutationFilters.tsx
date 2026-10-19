import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  SlidersHorizontal,
  Layers,
  Home,
  Building2,
  Trees,
} from 'lucide-react';
import type { MutationFilters as Filters } from '../queries/parcels';

export function MutationFilters({
  value,
  onChange,
  availableYears,
}: {
  value: Filters;
  onChange: (value: Filters) => void;
  availableYears: number[];
}) {
  const { t } = useTranslation();
  const { year, kind, min, max, start, end } = value;
  const [expanded, setExpanded] = useState(false);
  const update = <K extends keyof Filters>(key: K, field: Filters[K]) =>
    onChange({ ...value, [key]: field });
  return (
    <>
      <div className="filter-top">
        <label>
          {t('filters.year')}
          <select
            value={year}
            onChange={(e) => {
              onChange({ ...value, year: +e.target.value, start: '', end: '' });
            }}
          >
            <option value={0}>{t('common.allYears')}</option>
            {availableYears.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <button
          className={'filter-btn ' + (expanded ? 'active' : '')}
          aria-label={t('filters.advanced')}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal size={19} />
        </button>
      </div>
      <div className="type-tabs">
        {(
          [
            ['', t('filters.all'), Layers],
            ['Maison', t('filters.houses'), Home],
            ['Appartement', t('filters.flats'), Building2],
            ['Terrain / dépendance', t('filters.land'), Trees],
          ] satisfies [string, string, LucideIcon][]
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            className={kind === value ? 'active' : ''}
            onClick={() => update('kind', value)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      {expanded && (
        <div className="advanced">
          <label>
            {t('filters.minPrice')}
            <input
              type="number"
              min="0"
              value={min}
              onChange={(e) => update('min', e.target.value)}
            />
          </label>
          <label>
            {t('filters.maxPrice')}
            <input
              type="number"
              min="0"
              value={max}
              onChange={(e) => update('max', e.target.value)}
            />
          </label>
          <label>
            {t('filters.from')}
            <input
              type="date"
              value={start}
              onChange={(e) => update('start', e.target.value)}
            />
          </label>
          <label>
            {t('filters.to')}
            <input
              type="date"
              value={end}
              onChange={(e) => update('end', e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              onChange({
                ...value,
                min: '',
                max: '',
                start: '',
                end: '',
                kind: '',
              });
            }}
          >
            {t('filters.reset')}
          </button>
        </div>
      )}
    </>
  );
}
