import { Home, Building2, Trees, ArrowUpRight } from 'lucide-react';
import type { Sale } from '../types';
import { money, date, propertyLabel } from '../format';

interface Props {
  sale: Sale;
  selected: boolean;
  onSelect: (sale: Sale) => void;
}
export function SaleCard({ sale: s, selected, onSelect }: Props) {
  return (
    <button
      className={'sale-card ' + (selected ? 'selected' : '')}

      onClick={() => onSelect(s)}
    >
      <div className="sale-symbol">
        {s.kind === 'Maison' ? (
          <Home size={20} />
        ) : s.kind === 'Appartement' ? (
          <Building2 size={20} />
        ) : (
          <Trees size={20} />
        )}
      </div>
      <div className="sale-main">
        <div className="sale-line">
          <span className="sale-kind">{propertyLabel(s.kind)}</span>
          <strong>{money(s.price)}</strong>
        </div>
        <div className="address">
          {(s.address || s.city || s.citycode).toLocaleLowerCase('en-GB')}
        </div>
        <div className="sale-meta">
          {s.surface ? `${s.surface} m² · ` : ''}
          {s.address
            ? s.city.toLocaleLowerCase('en-GB')
            : `${s.parcels.length} cadastral ${s.parcels.length === 1 ? 'parcel' : 'parcels'}`}
        </div>
        <div className="sale-bottom">
          <span>{date(s.date)}</span>
          <span>
            {s.distance.toLocaleString('en-GB', {
              maximumFractionDigits: 1,
            })}{' '}
            km <ArrowUpRight size={13} />
          </span>
        </div>
      </div>
    </button>
  );
}
