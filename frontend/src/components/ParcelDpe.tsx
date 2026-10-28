import { useState } from 'react';
import { bdnbOptions } from '../queries/bdnb';
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

type CardDiagnostic = Omit<
  Diagnostic,
  | 'energy_class'
  | 'climate_class'
  | 'established_at'
  | 'expires_at'
  | 'url'
  | 'match'
> & {
  energy_class: string | null;
  climate_class: string | null;
  established_at: string | null;
  expires_at: string | null;
  url: string | null;
  match: Diagnostic['match'] | 'representative';
  note?: string;
};

function DiagnosticCard({ diagnostic }: { diagnostic: CardDiagnostic }) {
  const { t } = useTranslation();
  return (
    <article className="dpe-card">
      <div className="dpe-labels">
        <span
          className="dpe-grade"
          data-grade={diagnostic.energy_class ?? '—'}
          aria-label={
            diagnostic.energy_class
              ? t('dpe.energyGrade', { grade: diagnostic.energy_class })
              : t('dpe.energyUnknown')
          }
        >
          {diagnostic.energy_class ?? '—'}
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
            diagnostic.match === 'representative'
              ? 'dpe.representative'
              : diagnostic.match === 'probable'
                ? 'dpe.probable'
                : diagnostic.match === 'address'
                  ? diagnostic.location_method === 'dvf_address'
                    ? 'dpe.declaredAddressOnly'
                    : 'dpe.addressOnly'
                  : 'dpe.parcelOnly',
          )}
        </span>
      </div>
      {diagnostic.address && (
        <p className="dpe-address">{diagnostic.address}</p>
      )}
      {diagnostic.note && <p className="dpe-notice">{diagnostic.note}</p>}
      {diagnostic.match === 'address' && (
        <p className="dpe-notice">
          {t(
            diagnostic.location_method === 'dvf_address'
              ? 'dpe.declaredAddressMatchNote'
              : 'dpe.addressMatchNote',
          )}
        </p>
      )}
      <dl className="dpe-facts">
        {diagnostic.established_at && (
          <div>
            <dt>{t('dpe.established')}</dt>
            <dd>{date(diagnostic.established_at)}</dd>
          </div>
        )}
        {diagnostic.expires_at && (
          <div>
            <dt>{t('dpe.expires')}</dt>
            <dd>{date(diagnostic.expires_at)}</dd>
          </div>
        )}
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
      {diagnostic.url && (
        <a href={diagnostic.url} target="_blank" rel="noreferrer">
          {t('dpe.certificate', { id: diagnostic.id })}
          <ArrowUpRight size={13} />
        </a>
      )}
    </article>
  );
}

function SelectedParcelDpe({
  parcel,
  sale,
  release,
}: {
  parcel: string;
  release?: string;
  sale: DpeContext;
}) {
  const { t } = useTranslation();
  const query = useQuery(dpeOptions(parcel, sale, release));
  const buildingQuery = useQuery(bdnbOptions(parcel));
  const [visible, setVisible] = useState(3);
  const data = query.data;
  const buildings = buildingQuery.data;
  const diagnostics: CardDiagnostic[] = [...(data?.diagnostics ?? [])];
  const seen = new Set(diagnostics.map((item) => item.id));
  for (const building of buildings?.buildings ?? []) {
    const rep = building.representative;
    if (!rep) continue;
    const id = rep.id ?? 'building:' + building.id;
    if (seen.has(id)) continue;
    seen.add(id);
    const certificate = rep.ademe;
    const inPeriod =
      certificate?.established_at &&
      certificate.expires_at &&
      certificate.established_at <= sale.date &&
      sale.date <= certificate.expires_at;
    diagnostics.push({
      id,
      energy_class: certificate ? certificate.energy_class : rep.energy_class,
      climate_class: certificate
        ? certificate.climate_class
        : rep.climate_class,
      established_at: certificate?.established_at ?? null,
      expires_at: certificate?.expires_at ?? null,
      modified_at: null,
      kind: certificate?.kind ?? rep.kind,
      surface: certificate?.surface ?? rep.surface,
      address: certificate?.address ?? '',
      consumption: null,
      emissions: null,
      match: 'representative',
      url: certificate?.url ?? null,
      note: t(
        !certificate
          ? 'dpe.representativeUnverified'
          : inPeriod
            ? 'dpe.representativeNote'
            : 'dpe.representativeOutsidePeriod',
      ),
    });
  }
  const fetchedAt = data?.fetched_at ?? buildings?.fetched_at;
  if (!validParcel(parcel))
    return <p className="dpe-notice">{t('dpe.invalidParcel')}</p>;
  return (
    <>
      {(query.isPending || buildingQuery.isPending) && (
        <p className="dpe-notice" role="status">
          {t('dpe.loading')}
        </p>
      )}
      {query.isError && (
        <div className="dpe-notice" role="status">
          <p>{t('dpe.unavailable')}</p>
          <button onClick={() => void query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {buildingQuery.isError && (
        <div className="dpe-notice" role="status">
          <p>{t('dpe.additionalUnavailable')}</p>
          <button onClick={() => void buildingQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {diagnostics.length === 0 && data?.state === 'before_coverage' && (
        <p className="dpe-notice">{t('dpe.beforeCoverage')}</p>
      )}
      {diagnostics.length === 0 && data?.state === 'parcel_unavailable' && (
        <p className="dpe-notice">{t('dpe.parcelUnavailable')}</p>
      )}
      {diagnostics.length === 0 && data?.state === 'area_too_large' && (
        <p className="dpe-notice">{t('dpe.areaTooLarge')}</p>
      )}
      {diagnostics.length > 0 && (
        <p className="dpe-notice">
          {t(
            diagnostics.some((item) => item.match === 'representative')
              ? 'dpe.combinedScope'
              : 'dpe.scope',
            { date: date(sale.date) },
          )}
        </p>
      )}
      {data?.state === 'ok' &&
        diagnostics.length === 0 &&
        !buildingQuery.isPending && (
          <p className="dpe-empty">{t('dpe.notFound')}</p>
        )}
      {diagnostics.slice(0, visible).map((diagnostic) => (
        <DiagnosticCard key={diagnostic.id} diagnostic={diagnostic} />
      ))}
      {visible < diagnostics.length && (
        <button className="dpe-more" onClick={() => setVisible(visible + 5)}>
          {t('dpe.showMore', { count: diagnostics.length - visible })}
        </button>
      )}
      {(data?.truncated || buildings?.truncated) && (
        <p className="dpe-notice">{t('dpe.truncated')}</p>
      )}
      {data?.address_lookup_unavailable && (
        <div className="dpe-notice">
          <p>{t('dpe.addressLookupUnavailable')}</p>
          <button onClick={() => void query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {data?.declared_address_lookup_unavailable && (
        <div className="dpe-notice">
          <p>{t('dpe.declaredAddressLookupUnavailable')}</p>
          <button onClick={() => void query.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {buildings?.ademe_unavailable && (
        <div className="dpe-notice">
          <p>{t('dpe.additionalUnavailable')}</p>
          <button onClick={() => void buildingQuery.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {diagnostics.length > 0 && (
        <p className="dpe-notice">{t('dpe.caution')}</p>
      )}
      {fetchedAt && (
        <p className="dpe-checked">
          {t('dpe.checked', { date: calendarDate(fetchedAt) })}
        </p>
      )}
    </>
  );
}

export function ParcelDpe({
  sale,
  parcel: fixedParcel,
  release,
}: {
  sale: DpeContext;
  parcel?: string;
  release?: string;
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
      <SelectedParcelDpe
        key={parcel + sale.id}
        parcel={parcel}
        sale={sale}
        release={release}
      />
      <a
        className="dpe-source"
        href="https://data.ademe.fr/datasets/dpe03existant"
        target="_blank"
        rel="noreferrer"
      >
        {t('dpe.source')}
        <ArrowUpRight size={13} />
      </a>
      {' · '}
      <a
        className="dpe-source"
        href="https://www.bdnb.io/documentation/methode_traitement_dpe/"
        target="_blank"
        rel="noreferrer"
      >
        BDNB / CSTB
        <ArrowUpRight size={13} />
      </a>
    </section>
  );
}
