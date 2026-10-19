import type { AddressMap } from '../queries/addresses';
import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { ArrowUpRight, Database, Search } from 'lucide-react';
import { ParcelCard } from './ParcelCard';
import { money, number } from '../format';
import type { ParcelSummary, ParcelsResponse } from '../types';

interface Props {
  addresses?: AddressMap;
  data: ParcelsResponse;
  comparison?: ParcelsResponse;
  year: number;
  loading: boolean;
  error: string;
  zoomRequired: boolean;
  published: boolean;
  loaded: boolean;
  pendingLocation: boolean;
  department: string | null;
  selected: ParcelSummary | null;
  onSelect: (parcel: ParcelSummary) => void;
  onImport: () => void;
  onRetry: () => void;
  canRetry: boolean;
}
export function ParcelResults({
  addresses = {},
  data,
  comparison,
  year,
  loading,
  error,
  zoomRequired,
  published,
  loaded,
  pendingLocation,
  department,
  selected,
  onSelect: chooseParcel,
  onImport,
  onRetry,
  canRetry,
}: Props) {
  const { t } = useTranslation();
  const [sort, setSort] = useState('recent');
  const rows = useMemo(
    () =>
      [...data.parcels].sort((a, b) =>
        sort === 'price'
          ? a.latest_price - b.latest_price
          : sort === 'distance'
            ? a.distance - b.distance
            : b.latest_date.localeCompare(a.latest_date),
      ),
    [data.parcels, sort],
  );
  return (
    <>
      <div className="metrics">
        <div>
          <span>{t('parcels.inView')}</span>
          <strong>
            {zoomRequired
              ? t('map.zoomIn')
              : loading
                ? '…'
                : number(data.total)}
          </strong>
        </div>
        <div>
          <span>{t('parcels.medianPrice')}</span>
          <strong>
            {zoomRequired ? '—' : loading ? '…' : money(data.median_price)}
          </strong>
        </div>
      </div>
      {comparison && (
        <div className="comparison">
          {t('results.comparison', {
            year: year - 1,
            sales: t('coverage.sales', { count: comparison.mutations }),
            median: money(comparison.median_price),
          })}
          <span>{t('results.comparisonNote')}</span>
        </div>
      )}
      <div className="results-heading">
        <h2>{t('parcels.listTitle')}</h2>
        <select
          aria-label={t('results.sort')}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="recent">{t('results.recent')}</option>
          <option value="price">{t('results.lowestPrice')}</option>
          <option value="distance">{t('results.nearest')}</option>
        </select>
      </div>
      <div className="results" aria-live="polite" aria-busy={loading}>
        {zoomRequired && <p className="notice">{t('map.zoomNotice')}</p>}
        {error && (
          <div className="notice error" role="alert">
            {error}
            {canRetry && <button onClick={onRetry}>{t('common.retry')}</button>}
          </div>
        )}
        {!zoomRequired && !loaded && !loading && !error && (
          <div className="notice">
            <Database size={19} />
            <strong>
              {published ? t('results.noCoverage') : t('results.preparation')}
            </strong>
            <p>
              {t(
                published
                  ? 'results.coveragePublished'
                  : 'results.coverageLegacy',
                {
                  period: year
                    ? t('results.yearPeriod', { year })
                    : t('results.publishedPeriod'),
                  area: department
                    ? t('results.departmentArea', { department })
                    : t('results.currentArea'),
                },
              )}
            </p>
            {!published && (
              <button
                onClick={() => {
                  onImport();
                }}
              >
                {t('data.importAction')}
                <ArrowUpRight size={15} />
              </button>
            )}
          </div>
        )}
        {!zoomRequired && loaded && !loading && data.total === 0 && !error && (
          <div className="notice">
            <Search size={22} />
            <strong>
              {pendingLocation
                ? t('results.pendingLocation')
                : t('results.empty')}
            </strong>
            <p>{published ? t('results.adjust') : t('results.adjustLegacy')}</p>
          </div>
        )}
        {loading && <p className="loading">{t('results.loading')}</p>}
        {!zoomRequired &&
          rows.map((s) => (
            <ParcelCard
              key={s.id}
              parcel={s}
              addresses={addresses[s.id]}
              selected={selected?.id === s.id}
              onSelect={chooseParcel}
            />
          ))}
        {data.truncated && <p className="notice">{t('parcels.truncated')}</p>}
      </div>
    </>
  );
}
