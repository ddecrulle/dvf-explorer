import { useTranslation } from 'react-i18next';
import { Download, Plus, Minus } from 'lucide-react';
import { ParcelDetails } from './ParcelDetails';
import { useParcelMap } from '../hooks/useParcelMap';
import { exportParcelsCSV } from '../format';
import type {
  Location,
  ParcelSelection,
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
  selected: ParcelSelection | null;
  onSelect: (parcel: ParcelSelection) => void;
  onCloseSelection: () => void;
  hidden: boolean;
  year: number;
  loading: boolean;
  zoomRequired: boolean;
}) {
  const { t } = useTranslation();
  const { mapNode, mapError, cadastreError, parcelZoom, zoomIn, zoomOut } =
    useParcelMap({
      focus,
      onViewport,
      parcels: data.parcels,
      selectedId: selected?.id,
      onPick: onSelect,
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
              : t(parcelZoom ? 'map.pickParcel' : 'map.explore')}
        </span>
      </div>
      {mapError && (
        <div className="map-error" role="status">
          {mapError}
        </div>
      )}
      {cadastreError && (
        <div className="map-error" role="status">
          {t('map.cadastreUnavailable')}
        </div>
      )}
      <div className="map-bottom">
        {parcelZoom && (
          <div className="legend" title={t('parcels.pointNote')}>
            <span>
              <i />
              {t('map.parcelsWithSales')}
            </span>
            <span>
              <i className="selected-parcel" />
              {t('map.selectedParcel')}
            </span>
          </div>
        )}
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
