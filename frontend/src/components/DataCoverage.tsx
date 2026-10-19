import { useTranslation } from 'react-i18next';
import type { Status } from '../types';

export function DataCoverage({
  status,
  years,
}: {
  status: Status;
  years: number[];
}) {
  const { t } = useTranslation();
  const coverage = new Map<
    number,
    { count: number; located: number; departments: Set<string> }
  >();
  for (const item of status.imports) {
    const current = coverage.get(item.year) ?? {
      count: 0,
      located: 0,
      departments: new Set<string>(),
    };
    current.count += item.count;
    current.located += item.located;
    current.departments.add(item.department);
    coverage.set(item.year, current);
  }
  return (
    <div className="imported">
      {years.map((year) => {
        const item = coverage.get(year);
        return (
          <div key={year}>
            <strong>
              {year} ·{' '}
              {t('coverage.departments', {
                count: item?.departments.size ?? 0,
              })}
            </strong>
            <span>
              {t('coverage.sales', { count: item?.count ?? 0 })} ·{' '}
              {t('coverage.located', { count: item?.located ?? 0 })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
