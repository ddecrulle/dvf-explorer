import { calendarDate } from '../format';
import { useTranslation } from 'react-i18next';
import type { Status } from '../types';
import { DataCoverage } from './DataCoverage';

export function PublishedData({
  status,
  years,
}: {
  status: Status;
  years: number[];
}) {
  const { t } = useTranslation();
  const dataset = status.dataset;
  if (!dataset) return null;
  return (
    <>
      <h2>{t('data.ready')}</h2>
      <p>
        {t('data.publishedSummary', {
          source: dataset.source,
          sales: t('coverage.sales', { count: dataset.rows ?? 0 }),
        })}
      </p>
      {dataset.created_at && (
        <p>
          {t('data.publishedDate', { date: calendarDate(dataset.created_at) })}
        </p>
      )}
      <DataCoverage status={status} years={years} />
      <div className="method">
        <h3>{t('data.method')}</h3>
        <p>{t('data.dvfplusMethod')}</p>
        <p>{t('data.dvfplusLimits')}</p>
        <p>{t('data.dvfplusCaution')}</p>
        <a
          href="https://www.data.gouv.fr/datasets/dvf-open-data"
          target="_blank"
          rel="noreferrer"
        >
          {t('data.dvfplusTerms')}
        </a>
      </div>
    </>
  );
}
