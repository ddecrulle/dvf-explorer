import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Plus, Minus } from 'lucide-react';
import { ParcelDetails } from './ParcelDetails';
import { useParcelMap } from '../hooks/useParcelMap';
import { exportParcelsCSV } from '../format';
import type {
  Location,
  ParcelSummary,
  ParcelsResponse,
  Viewport,
} from '../types';

export default function ParcelMap({
  focus,
  release,
  onViewport,
  data,
  selected,
  onSelect,
  onCloseSelection,
  hidden,
  year,
  loading,
  zoomRequired,
}: {
  release?: string;
  focus: (Location & { zoom: number }) | null;
  onViewport: (view: Viewport) => void;
  data: ParcelsResponse;
  selected: ParcelSummary | null;
  onSelect: (parcel: ParcelSummary) => void;
  onCloseSelection: () => void;
  hidden: boolean;
  year: number;
  loading: boolean;
  zoomRequired: boolean;
}) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<ParcelSummary[]>([]);
  const { mapNode, mapError, zoomIn, zoomOut } = useParcelMap({
    focus,
    onViewport,
    parcels: data.parcels,
    clusters: data.clusters,
    onPick: (parcels) => {
      if (parcels.length === 1) {
        setChoices([]);
        onSelect(parcels[0]);
      } else setChoices(parcels);
    },
  });
  const period = year || t('common.allYears');
  const rows = data.parcels;
  const exportCSV = () => exportParcelsCSV(rows, year);
  return (
    <section
      className={'map-section ' + (hidden ? 'mobile-hidden' : '')}
      aria-label={t('map.label')}
    >
      <div className="map" ref={mapNode} />
      <div className="map-navigation" role="group" aria-label={t('map.label')}>
        <button
          type="button"
          aria-label={t('map.zoomIn')}
          title={t('map.zoomIn')}
          onClick={zoomIn}
        >
          <Plus size={20} />
        </button>
        <button
          type="button"
          aria-label={t('map.zoomOut')}
          title={t('map.zoomOut')}
          onClick={zoomOut}
        >
          <Minus size={20} />
        </button>
      </div>
      {choices.length > 1 && !selected && (
        <div className="parcel-point-choices">
          <h3>{t('parcels.pointChoices')}</h3>
          {choices.map((parcel) => (
            <button
              key={parcel.id}
              onClick={() => {
                setChoices([]);
                onSelect(parcel);
              }}
            >
              {t('parcels.reference', { id: parcel.id })}
            </button>
          ))}
          <button onClick={() => setChoices([])}>{t('details.close')}</button>
        </div>
      )}
      <div className="map-top">
        <div className="map-caption">
          <span className="live-dot" />
          <strong>{t('parcels.inView')}</strong>
          <span>{period}</span>
        </div>
        <span className="map-action" role="status">
          {zoomRequired
            ? t('map.zoomPrompt')
            : loading
              ? t('map.loading')
              : t('map.explore')}
        </span>
      </div>
      {mapError && (
        <div className="map-error" role="status">
          {mapError}
        </div>
      )}
      <div className="map-bottom">
        <div className="legend" title={t('parcels.pointNote')}>
          <span>
            <i />
            {t('property.house')}
          </span>
          <span>
            <i className="apartment" />
            {t('property.flat')}
          </span>
          <span>
            <i className="other" />
            {t('map.other')}
          </span>
        </div>
        <button className="export" disabled={!rows.length} onClick={exportCSV}>
          <Download size={16} />
          {t('parcels.export')}
        </button>
      </div>
      {selected && (
        <ParcelDetails
          key={selected.id}
          parcel={selected}
          release={release}
          onSelect={onSelect}
          onClose={onCloseSelection}
        />
      )}
    </section>
  );
}
