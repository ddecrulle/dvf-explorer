import type { ParcelAddress } from '../queries/addresses';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, ArrowUpRight } from 'lucide-react';
import type { ParcelSummary } from '../types';
import { date, money, propertyLabel } from '../format';

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
            {addresses[0]?.label ?? t('parcels.reference', { id: parcel.id })}
          </strong>
        </div>
        <div className="address">
          {addresses[0]
            ? `${addresses[0].postcode} ${addresses[0].city}`
            : parcel.city}{' '}
          · {propertyLabel(parcel.kind)}
        </div>
        {addresses.length > 0 && (
          <div className="parcel-reference">
            {parcel.id}
            {addresses.length > 1 &&
              ` · ${t('addresses.count', { count: addresses.length })}`}
          </div>
        )}
        <div className="sale-meta">
          {t('parcels.matchingCount', { count: parcel.matching_mutations })}
        </div>
        <div className="parcel-latest">
          <span>{date(parcel.latest_date)}</span>
          <strong>{money(parcel.latest_price)}</strong>
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
