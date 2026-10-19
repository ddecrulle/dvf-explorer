import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import {
  dpeOptions,
  validParcel,
  type Diagnostic,
  type DpeContext,
} from '../queries/dpe';
import { date, calendarDate, number } from '../format';

function DiagnosticCard({ diagnostic }: { diagnostic: Diagnostic }) {
  const { t } = useTranslation();
  return (
    <article className="dpe-card">
      <div className="dpe-labels">
        <span
          className="dpe-grade"
          data-grade={diagnostic.energy_class}
          aria-label={t('dpe.energyGrade', { grade: diagnostic.energy_class })}
        >
          {diagnostic.energy_class}
        </span>
        <div>
          <strong>{t('dpe.energy')}</strong>
          <span>
            {diagnostic.climate_class
              ? t('dpe.climateGrade', { grade: diagnostic.climate_class })
              : t('dpe.climateUnknown')}
          </span>
        </div>
        <span className={'dpe-match ' + diagnostic.match}>
          {t(
            diagnostic.match === 'probable' ? 'dpe.probable' : 'dpe.parcelOnly',
          )}
        </span>
      </div>
      <p className="dpe-address">{diagnostic.address}</p>
      <dl className="dpe-facts">
        <div>
          <dt>{t('dpe.established')}</dt>
          <dd>{date(diagnostic.established_at)}</dd>
        </div>
        <div>
          <dt>{t('dpe.expires')}</dt>
          <dd>{date(diagnostic.expires_at)}</dd>
        </div>
        {diagnostic.surface != null && (
          <div>
            <dt>{t('dpe.surface')}</dt>
            <dd>{number(diagnostic.surface)} m²</dd>
          </div>
        )}
        {diagnostic.kind && (
          <div>
            <dt>{t('dpe.buildingType')}</dt>
            <dd>
              {t(
                diagnostic.kind === 'maison'
                  ? 'property.house'
                  : diagnostic.kind === 'appartement'
                    ? 'property.flat'
                    : 'dpe.building',
              )}
            </dd>
          </div>
        )}
        {diagnostic.consumption != null && (
          <div>
            <dt>{t('dpe.consumption')}</dt>
            <dd>
              {number(diagnostic.consumption)} {t('dpe.energyUnit')}
            </dd>
          </div>
        )}
        {diagnostic.emissions != null && (
          <div>
            <dt>{t('dpe.emissions')}</dt>
            <dd>
              {number(diagnostic.emissions)} {t('dpe.emissionsUnit')}
            </dd>
          </div>
        )}
      </dl>
      <a href={diagnostic.url} target="_blank" rel="noreferrer">
        {t('dpe.certificate', { id: diagnostic.id })}
        <ArrowUpRight size={13} />
      </a>
    </article>
  );
}

function SelectedParcelDpe({
  parcel,
  sale,
}: {
  parcel: string;
  sale: DpeContext;
}) {
  const { t } = useTranslation();
  const query = useQuery(dpeOptions(parcel, sale));
  const [visible, setVisible] = useState(3);
  const data = query.data;
  if (!validParcel(parcel))
    return <p className="dpe-notice">{t('dpe.invalidParcel')}</p>;
  if (query.isPending)
    return (
      <p className="dpe-notice" role="status">
        {t('dpe.loading')}
      </p>
    );
  if (query.isError)
    return (
      <div className="dpe-notice" role="status">
        <p>{t('dpe.unavailable')}</p>
        <button onClick={() => void query.refetch()}>
          {t('common.retry')}
        </button>
      </div>
    );
  return (
    <>
      {data?.state === 'before_coverage' && (
        <p className="dpe-notice">{t('dpe.beforeCoverage')}</p>
      )}
      {data?.state === 'parcel_unavailable' && (
        <p className="dpe-notice">{t('dpe.parcelUnavailable')}</p>
      )}
      {data?.state === 'area_too_large' && (
        <p className="dpe-notice">{t('dpe.areaTooLarge')}</p>
      )}
      {data?.state === 'ok' && (
        <>
          <p className="dpe-notice">
            {t('dpe.scope', { date: date(sale.date) })}
          </p>
          {data.diagnostics.length === 0 && (
            <p className="dpe-empty">{t('dpe.notFound')}</p>
          )}
          {data.diagnostics.slice(0, visible).map((diagnostic) => (
            <DiagnosticCard key={diagnostic.id} diagnostic={diagnostic} />
          ))}
          {visible < data.diagnostics.length && (
            <button
              className="dpe-more"
              onClick={() => setVisible(visible + 5)}
            >
              {t('dpe.showMore', { count: data.diagnostics.length - visible })}
            </button>
          )}
          {data.truncated && <p className="dpe-notice">{t('dpe.truncated')}</p>}
          <p className="dpe-notice">{t('dpe.caution')}</p>
        </>
      )}
      {data?.fetched_at && (
        <p className="dpe-checked">
          {t('dpe.checked', { date: calendarDate(data.fetched_at) })}
        </p>
      )}
    </>
  );
}

export function ParcelDpe({
  sale,
  parcel: fixedParcel,
}: {
  sale: DpeContext;
  parcel?: string;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState(sale.parcels[0] ?? '');
  const parcel =
    fixedParcel ??
    (sale.parcels.includes(chosen) ? chosen : (sale.parcels[0] ?? ''));
  return (
    <section className="parcel-dpe" aria-label={t('dpe.title')}>
      <h3>{t('dpe.title')}</h3>
      {!fixedParcel && sale.parcels.length > 1 && (
        <label>
          {t('dpe.parcel')}
          <select
            value={parcel}
            onChange={(event) => setChosen(event.target.value)}
          >
            {sale.parcels.map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
      )}
      <SelectedParcelDpe key={parcel + sale.id} parcel={parcel} sale={sale} />
      <a
        className="dpe-source"
        href="https://data.ademe.fr/datasets/dpe03existant"
        target="_blank"
        rel="noreferrer"
      >
        {t('dpe.source')}
        <ArrowUpRight size={13} />
      </a>
    </section>
  );
}
