import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { bdnbOptions } from '../queries/bdnb';
import { validParcel } from '../queries/dpe';
import { date, calendarDate, number } from '../format';

export function ParcelBdnb({
  parcel,
  saleDate,
}: {
  parcel: string;
  saleDate: string;
}) {
  const { t } = useTranslation();
  const query = useQuery(bdnbOptions(parcel));
  if (!validParcel(parcel)) return null;
  return (
    <section aria-label={t('bdnb.title')}>
      <h3>{t('bdnb.title')}</h3>
      <p className="dpe-notice">{t('bdnb.caution')}</p>
      {query.isPending && <p role="status">{t('bdnb.loading')}</p>}
      {query.isError && (
        <div role="status">
          <p>{t('bdnb.unavailable')}</p>
          <button onClick={() => void query.refetch()}>
            {t('bdnb.retry')}
          </button>
        </div>
      )}
      {query.data && (
        <>
          {query.data.buildings.length === 0 && <p>{t('bdnb.empty')}</p>}
          {query.data.buildings.map((building) => {
            const rep = building.representative;
            const certificate = rep?.ademe;
            const inPeriod =
              certificate?.established_at &&
              certificate.expires_at &&
              certificate.established_at <= saleDate &&
              saleDate <= certificate.expires_at;
            return (
              <article className="dpe-card" key={building.id}>
                <strong>{t('bdnb.building', { id: building.id })}</strong>
                <p>
                  {t(
                    building.main_parcel
                      ? 'bdnb.mainParcel'
                      : 'bdnb.otherParcel',
                  )}
                </p>
                {!rep ? (
                  <p>{t('bdnb.noRepresentative')}</p>
                ) : (
                  <>
                    <p>{t('bdnb.representative')}</p>
                    <p>
                      {t('bdnb.grades', {
                        energy: rep.energy_class ?? '—',
                        climate: rep.climate_class ?? '—',
                      })}
                    </p>
                    {rep.surface != null && (
                      <p>
                        {t('dpe.surface')}: {number(rep.surface)} m²
                      </p>
                    )}
                    {rep.issued_at_bdnb && (
                      <p>
                        {t('bdnb.timestamp')}: {rep.issued_at_bdnb}
                      </p>
                    )}
                    {rep.id && <p>{rep.id}</p>}
                    {certificate ? (
                      <>
                        <p>
                          {t('bdnb.ademeGrades', {
                            energy: certificate.energy_class ?? '—',
                            climate: certificate.climate_class ?? '—',
                          })}
                        </p>
                        <p>{certificate.address}</p>
                        {certificate.established_at && (
                          <p>
                            {t('dpe.established')}:{' '}
                            {date(certificate.established_at)}
                          </p>
                        )}
                        {certificate.expires_at && (
                          <p>
                            {t('dpe.expires')}: {date(certificate.expires_at)}
                          </p>
                        )}
                        <p className="dpe-notice">
                          {t(inPeriod ? 'bdnb.inPeriod' : 'bdnb.outsidePeriod')}
                        </p>
                        <a
                          href={certificate.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('dpe.certificate', { id: rep.id })}
                        </a>
                      </>
                    ) : (
                      <p>
                        {t(
                          rep.ademe_state === 'unavailable'
                            ? 'bdnb.ademeUnavailable'
                            : 'bdnb.ademeMissing',
                        )}
                      </p>
                    )}
                  </>
                )}
              </article>
            );
          })}
          {query.data.truncated && <p>{t('bdnb.truncated')}</p>}
          {query.data.ademe_unavailable && (
            <button onClick={() => void query.refetch()}>
              {t('bdnb.retry')}
            </button>
          )}
          <p className="dpe-checked">
            {t('dpe.checked', { date: calendarDate(query.data.fetched_at) })}
          </p>
        </>
      )}
      <a
        href="https://www.bdnb.io/documentation/methode_traitement_dpe/"
        target="_blank"
        rel="noreferrer"
      >
        {t('bdnb.source')}
      </a>
    </section>
  );
}
