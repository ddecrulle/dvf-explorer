import { useParcelAddresses } from '../queries/addresses';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, MapPin } from 'lucide-react';
import { historyOptions } from '../queries/history';
import { MutationDetails } from './MutationDetails';
import { money, date } from '../format';
import type { ParcelSummary } from '../types';

export function ParcelDetails({
  parcel,
  release,
  onSelect,
  onClose,
}: {
  parcel: ParcelSummary;
  release?: string;
  onSelect: (parcel: ParcelSummary) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addressData = useParcelAddresses([parcel.id]);
  const addresses = addressData.addresses[parcel.id] ?? [];
  const source = Object.values(addressData.sources)[0];
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const history = useQuery(historyOptions(parcel.id, release, offset));
  const data = history.data;
  const mutation =
    data?.mutations.find((item) => item.id === selectedId) ??
    data?.mutations[0];
  function otherParcel(id: string) {
    if (!mutation) return;
    onSelect({
      ...parcel,
      id,
      latest_mutation_id: mutation.id,
      latest_date: mutation.date,
      latest_price: mutation.price,
      latest_mutation_parcels: mutation.parcels.length,
      matching_mutations: 1,
      surface: mutation.surface,
      kind: mutation.kind,
      city: mutation.city,
      longitude: mutation.longitude ?? parcel.longitude,
      latitude: mutation.latitude ?? parcel.latitude,
    });
  }
  function page(next: number) {
    setSelectedId(null);
    setOffset(next);
  }
  return (
    <aside
      className="detail parcel-detail"
      aria-label={t('parcels.detailTitle', { id: parcel.id })}
    >
      <div className="detail-head">
        <span>{t('parcels.heading')}</span>
        <button
          className="icon"
          aria-label={t('details.close')}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="parcel-title">
        <MapPin size={20} />
        <h2>{addresses[0]?.label ?? parcel.id}</h2>
      </div>
      <p className="detail-address">
        {addresses[0]
          ? `${addresses[0].postcode} ${addresses[0].city}`
          : parcel.city}
      </p>
      {addresses.length > 0 && (
        <p className="parcel-reference">
          {t('parcels.reference', { id: parcel.id })}
        </p>
      )}
      <div className="parcel-addresses">
        <h3>{t('addresses.title')}</h3>
        {addressData.loading ? (
          <p role="status">{t('addresses.loading')}</p>
        ) : addresses.length === 0 ? (
          <p>
            {t(
              addressData.unavailable
                ? 'addresses.unavailable'
                : 'addresses.missing',
            )}
          </p>
        ) : (
          <>
            <ul>
              {addresses.map((a) => (
                <li key={a.id}>
                  {a.label}
                  <small>
                    {a.postcode} {a.city}
                  </small>
                </li>
              ))}
            </ul>
            <p>
              {t('addresses.currentNote')}{' '}
              <a
                href={
                  source?.url ??
                  'https://adresse.data.gouv.fr/outils/telechargements'
                }
                target="_blank"
                rel="noreferrer"
              >
                {t('addresses.source')}
              </a>
            </p>
          </>
        )}
      </div>
      <p className="parcel-history-note">{t('parcels.fullHistory')}</p>
      <p className="parcel-history-note">{t('parcels.pointNote')}</p>
      {history.isPending && (
        <p role="status" className="dpe-notice">
          {t('parcels.loadingHistory')}
        </p>
      )}
      {history.isError && (
        <div role="status" className="dpe-notice">
          <p>{t('parcels.historyError')}</p>
          <button onClick={() => void history.refetch()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {data && (
        <>
          <div className="parcel-history-heading">
            <h3>{t('parcels.historyTitle')}</h3>
            <span>{t('parcels.knownCount', { count: data.total })}</span>
          </div>
          {data.total === 0 && (
            <p className="dpe-notice">{t('parcels.noHistory')}</p>
          )}
          <ol className="mutation-timeline">
            {data.mutations.map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={mutation?.id === item.id}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span>{date(item.date)}</span>
                  <strong>{money(item.price)}</strong>
                  {item.parcels.length > 1 && (
                    <small>
                      {t('parcels.sharedPrice', { count: item.parcels.length })}
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {(offset > 0 || data.next_offset != null) && (
            <div className="history-pages">
              <button
                disabled={offset === 0}
                onClick={() => page(Math.max(0, offset - 50))}
              >
                {t('parcels.previousPage')}
              </button>
              <span>
                {t('parcels.historyPage', {
                  start: offset + 1,
                  end: offset + data.mutations.length,
                  total: data.total,
                })}
              </span>
              <button
                disabled={data.next_offset == null}
                onClick={() => page(data.next_offset ?? offset)}
              >
                {t('parcels.nextPage')}
              </button>
            </div>
          )}
          <p className="parcel-history-note">{t('parcels.identityNote')}</p>
          {mutation && (
            <>
              <div className="selected-mutation-title">
                <h3>{t('parcels.selectedMutation')}</h3>
                <span>{date(mutation.date)}</span>
              </div>
              {mutation.parcels.length > 1 && (
                <p className="mutation-shared-note">
                  {t('parcels.sharedWarning')}
                </p>
              )}
              <MutationDetails
                key={mutation.id}
                mutation={mutation}
                parcelId={parcel.id}
                onSelectParcel={otherParcel}
              />
            </>
          )}
        </>
      )}
    </aside>
  );
}
