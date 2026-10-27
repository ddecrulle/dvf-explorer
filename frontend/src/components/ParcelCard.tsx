import type { ParcelAddress } from '../queries/addresses';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, ArrowUpRight } from 'lucide-react';
import type { ParcelSummary } from '../types';
import { date, money, number, propertyLabel, declaredAddress } from '../format';

export const ParcelCard = memo(function ParcelCard({
  parcel,
  addresses = [],
  selected,
  onSelect,
}: {
  parcel: ParcelSummary;
  addresses?: ParcelAddress[];
  selected: boolean;
  onSelect: (parcel: ParcelSummary) => void;
}) {
  const { t } = useTranslation();
  const address = addresses.length === 1 ? addresses[0] : undefined;
  const saleAddress =
    parcel.latest_mutation_parcels === 1
      ? declaredAddress(parcel.latest_address)
      : undefined;
  return (
    <button
      className={'sale-card parcel-card ' + (selected ? 'selected' : '')}
      onClick={() => onSelect(parcel)}
    >
      <div className="sale-symbol">
        <MapPin size={20} />
      </div>
      <div className="sale-main">
        <div className="sale-line">
          <strong>
            {address?.label ??
              saleAddress ??
              t('parcels.reference', { id: parcel.id })}
          </strong>
        </div>
        <div className="address">
          {address ? `${address.postcode} ${address.city}` : parcel.city} ·{' '}
          {propertyLabel(parcel.kind)}
        </div>
        {(addresses.length > 0 || saleAddress) && (
          <div className="parcel-reference">
            {parcel.id}
            {addresses.length > 1 &&
              ` · ${t('addresses.count', { count: addresses.length })}`}
          </div>
        )}
        {saleAddress && !address && (
          <div className="sale-meta">{t('addresses.declaredLabel')}</div>
        )}
        <div className="sale-meta">
          {t('parcels.matchingCount', { count: parcel.matching_mutations })}
        </div>
        <div className="parcel-latest">
          <span>{date(parcel.latest_date)}</span>
          <strong>{money(parcel.latest_price)}</strong>
          <span className="parcel-surface">
            {parcel.surface
              ? `${number(parcel.surface)} m²`
              : t('parcels.surfaceUnknown')}
          </span>
          <ArrowUpRight size={13} />
        </div>
        {parcel.latest_mutation_parcels > 1 && (
          <div className="parcel-shared">
            {t('parcels.sharedPrice', {
              count: parcel.latest_mutation_parcels,
            })}
          </div>
        )}
      </div>
    </button>
  );
});
