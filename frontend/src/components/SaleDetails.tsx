import { Home, X, ArrowUpRight } from 'lucide-react';
import type { Sale } from '../types';
import { money, date, propertyLabel } from '../format';

interface Props {
  sale: Sale;
  onClose: () => void;
}
export function SaleDetails({ sale, onClose }: Props) {
  const dvfplus = sale.id.startsWith('dvfplus:');
  return (
    <aside className="detail">
      <div className="detail-head">
        <span>SALE DETAILS</span>
        <button className="icon" aria-label="Close details" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="detail-type">
        <Home size={19} />
        {propertyLabel(sale.kind)}
      </div>
      <h2>{money(sale.price)}</h2>
      <p className="detail-address">
        {sale.address
          ? sale.address.toLocaleLowerCase('en-GB')
          : 'Street address not provided'}
        <br />
        {sale.city.toLocaleLowerCase('en-GB')}
      </p>
      <div className="detail-grid">
        <div>
          <span>Sale date</span>
          <strong>{date(sale.date)}</strong>
        </div>
        <div>
          <span>Floor area</span>
          <strong>
            {sale.surface ? `${sale.surface} m²` : 'Not consolidated'}
          </strong>
        </div>
        <div>
          <span>Declared land area</span>
          <strong>
            {sale.land
              ? `${sale.land.toLocaleString('en-GB')} m²`
              : 'Not provided'}
          </strong>
        </div>
        <div>
          <span>Price / m² of floor area</span>
          <strong>
            {sale.surface && !sale.multi
              ? money(sale.price / sale.surface)
              : 'Not calculated'}
          </strong>
        </div>
      </div>
      <div className="parcel">
        <span>Cadastral parcels ({sale.parcels.length})</span>
        {sale.parcels.map((p) => (
          <code key={p}>{p}</code>
        ))}
      </div>
      <p className="detail-note">
        {dvfplus
          ? 'Declared amount for the transaction, which may include several properties. The point uses the location supplied by Cerema. '
          : 'Declared amount for the disposition, which may include several properties. The point represents one parcel. '}
        {sale.multi
          ? 'Complex sale: floor area and price/m² are not consolidated. '
          : ''}
        {dvfplus
          ? 'Transactions use the public DVF+ identifier; please read the methodology notes.'
          : 'Grouping is inferred from the raw file; please read the methodology notes.'}
      </p>
      <a href={sale.source} target="_blank" rel="noreferrer">
        {dvfplus ? 'Official DVF+ publication' : 'Official DGFiP file'}{' '}
        <ArrowUpRight size={16} />
      </a>
    </aside>
  );
}
