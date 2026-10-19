import { ParcelDpe } from './ParcelDpe';
import { useTranslation } from 'react-i18next';
import { Home, ArrowUpRight } from 'lucide-react';
import type { Mutation } from '../types';
import { money, date, number, propertyLabel } from '../format';

export function MutationDetails({
  mutation: sale,
  parcelId,
  onSelectParcel,
}: {
  mutation: Mutation;
  parcelId: string;
  onSelectParcel: (id: string) => void;
}) {
  const { t } = useTranslation();
  const dvfplus = sale.id.startsWith('dvfplus:');
  return (
    <section
      className="mutation-detail"
      aria-label={t('parcels.mutationDetails')}
    >
      <div className="detail-type">
        <Home size={19} />
        {propertyLabel(sale.kind)}
      </div>
      <h2>{money(sale.price)}</h2>
      <p className="detail-address">
        {sale.address ? sale.address : t('details.noAddress')}
        <br />
        {sale.city}
      </p>
      <div className="detail-grid">
        <div>
          <span>{t('details.date')}</span>
          <strong>{date(sale.date)}</strong>
        </div>
        <div>
          <span>{t('details.surface')}</span>
          <strong>
            {sale.surface
              ? `${number(sale.surface)} m²`
              : t('details.notConsolidated')}
          </strong>
        </div>
        <div>
          <span>{t('details.land')}</span>
          <strong>
            {sale.land ? `${number(sale.land)} m²` : t('details.notProvided')}
          </strong>
        </div>
        <div>
          <span>{t('details.pricePerSqm')}</span>
          <strong>
            {sale.surface && !sale.multi
              ? money(sale.price / sale.surface)
              : t('details.notCalculated')}
          </strong>
        </div>
      </div>
      <div className="parcel">
        <span>{t('details.parcelsTitle', { count: sale.parcels.length })}</span>
        {sale.parcels.map((p) => (
          <button
            className="parcel-reference"
            key={p}
            disabled={p === parcelId}
            onClick={() => onSelectParcel(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <ParcelDpe key={sale.id} sale={sale} parcel={parcelId} />
      <p className="detail-note">
        {dvfplus ? t('details.dvfplusAmount') : t('details.legacyAmount')}
        {sale.multi ? t('details.complex') : ''}
        {dvfplus ? t('details.dvfplusMethod') : t('details.legacyMethod')}
      </p>
      <a href={sale.source} target="_blank" rel="noreferrer">
        {dvfplus ? t('details.dvfplusLink') : t('details.legacyLink')}{' '}
        <ArrowUpRight size={16} />
      </a>
    </section>
  );
}
