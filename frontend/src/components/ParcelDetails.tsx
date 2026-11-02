import { useExplorerRoute } from '../routing/useExplorerRoute';
import { MutationNature } from './MutationNature';
import { useParcelAddresses } from '../queries/addresses';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, MapPin, Link2 } from 'lucide-react';
import { historyOptions } from '../queries/history';
import { MutationDetails } from './MutationDetails';
import {
  money,
  date,
  number,
  propertyLabel,
  declaredAddress as saleAddress,
} from '../format';
import type { ParcelSelection } from '../types';

export function ParcelDetails({
  parcel,
  release,
  onSelect,
  onClose,
}: {
  parcel: ParcelSelection;
  release?: string;
  onSelect: (parcel: ParcelSelection) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const addressData = useParcelAddresses([parcel.id]);
  const addresses = addressData.addresses[parcel.id] ?? [];
  const source = Object.values(addressData.sources)[0];
  const router = useExplorerRoute();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const offset = router.route.offset;
  const wantedId = router.route.mutation;
  const history = useQuery(
    historyOptions(parcel.id, release, offset, router.route.mutation),
  );
  const data = history.data;
  const mutation = wantedId
    ? data?.mutations.find((item) => item.id === wantedId)
    : data?.mutations[0];
  const uniqueAddress = addresses.length === 1 ? addresses[0] : undefined;
  const declaredAddress =
    mutation?.parcels.length === 1 ? saleAddress(mutation.address) : undefined;
  const title =
    uniqueAddress?.label ??
    declaredAddress ??
    t('parcels.reference', { id: parcel.id });
  function otherParcel(id: string) {
    if (!mutation) return;
    onSelect({
      ...parcel,
      id,
      city: mutation.city,
      longitude: mutation.longitude ?? parcel.longitude,
      latitude: mutation.latitude ?? parcel.latitude,
    });
  }
  function page(next: number) {
    void router.navigate({ mutation: null, offset: next });
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
          aria-label={t('parcels.copyLink')}
          title={t('parcels.copyLink')}
          onClick={async () => {
            const href = router.selectionLink({
              mutation: mutation?.id ?? null,
              offset: data?.offset ?? 0,
            });
            try {
              await navigator.clipboard.writeText(
                new URL(href, window.location.origin).href,
              );
              setCopied(true);
              setCopyError(false);
            } catch {
              setCopyError(true);
            }
          }}
        >
          <Link2 size={17} />
        </button>
        <button
          className="icon"
          aria-label={t('details.close')}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {copied && (
        <p role="status" className="dpe-notice">
          {t('parcels.linkCopied')}
        </p>
      )}
      {copyError && (
        <p role="status" className="dpe-notice">
          {t('parcels.copyError')}
        </p>
      )}
      <div className="parcel-title">
        <MapPin size={20} />
        <h2>{title}</h2>
      </div>
      <p className="detail-address">
        {uniqueAddress
          ? `${uniqueAddress.postcode} ${uniqueAddress.city}`
          : mutation?.city || parcel.city}
      </p>
      {(uniqueAddress || declaredAddress) && (
        <p className="parcel-reference">
          {t('parcels.reference', { id: parcel.id })}
        </p>
      )}
      <p className="address-provenance">
        {uniqueAddress
          ? t('addresses.currentLabel')
          : declaredAddress
            ? t('addresses.declaredLabel')
            : addresses.length > 1
              ? t('addresses.multipleNote', { count: addresses.length })
              : t('addresses.noExactAddress')}
      </p>
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
          {wantedId && data.mutation_found === false && (
            <p className="dpe-notice" role="status">
              {t('parcels.mutationMissing')}
            </p>
          )}
          {data.total === 0 && (
            <p className="dpe-notice">{t('parcels.noHistory')}</p>
          )}
          <ol
            className="mutation-timeline"
            aria-label={t('parcels.historyTitle')}
          >
            {data.mutations.map((item) => (
              <li key={item.id}>
                <button
                  aria-pressed={mutation?.id === item.id}
                  onClick={() =>
                    void router.navigate({
                      mutation: item.id,
                      offset: data.offset,
                    })
                  }
                >
                  <span>{date(item.date)}</span>
                  <strong>{money(item.price)}</strong>
                  <MutationNature nature={item.mutation_nature} />
                  <span className="mutation-summary">
                    <span>{propertyLabel(item.kind)}</span>
                    <b>
                      {item.surface
                        ? `${number(item.surface)} m²`
                        : t('parcels.surfaceUnknown')}
                    </b>
                  </span>
                  {item.parcels.length > 1 && (
                    <small>
                      {t('parcels.sharedPrice', { count: item.parcels.length })}
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {(data.offset > 0 || data.next_offset != null) && (
            <div className="history-pages">
              <button
                disabled={data.offset === 0}
                onClick={() => page(Math.max(0, data.offset - 50))}
              >
                {t('parcels.previousPage')}
              </button>
              <span>
                {t('parcels.historyPage', {
                  start: data.offset + 1,
                  end: data.offset + data.mutations.length,
                  total: data.total,
                })}
              </span>
              <button
                disabled={data.next_offset == null}
                onClick={() => page(data.next_offset ?? data.offset)}
              >
                {t('parcels.nextPage')}
              </button>
            </div>
          )}
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
                key={parcel.id}
                mutation={mutation}
                release={release}
                parcelId={parcel.id}
                onSelectParcel={otherParcel}
              />
            </>
          )}
        </>
      )}
      <details className="parcel-addresses">
        <summary>
          {t('addresses.title')}
          {addresses.length > 0 ? ` · ${addresses.length}` : ''}
        </summary>
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
      </details>

      <details className="parcel-methodology">
        <summary>{t('parcels.aboutHistory')}</summary>
        <p className="parcel-history-note">{t('parcels.fullHistory')}</p>
        <p className="parcel-history-note">{t('parcels.identityNote')}</p>
      </details>
    </aside>
  );
}
