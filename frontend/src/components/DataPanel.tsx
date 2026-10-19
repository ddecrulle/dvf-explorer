import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { DataCoverage } from './DataCoverage';
import { PublishedData } from './PublishedData';
import { useState } from 'react';
import { Database, Download } from 'lucide-react';
import type { Status } from '../types';
import { errorMessage } from '../api';
import { useImportData } from '../queries/dataset';

interface Props {
  status: Status;
  availableYears: number[];
  initialDepartment: string;
  initialYear: number;
  onClose: () => void;
}
export function DataPanel({
  status,
  availableYears,
  initialDepartment,
  initialYear,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [adminToken, setAdminToken] = useState('');
  const [dep, setDep] = useState(initialDepartment);
  const [importYear, setImportYear] = useState(initialYear);
  const mutation = useImportData();
  const importError = mutation.error ? errorMessage(mutation.error) : '';
  const busy = mutation.isPending || status.job.state === 'running';
  function doImport() {
    mutation.mutate({
      token: adminToken,
      selection: { department: dep.toUpperCase(), year: importYear },
    });
  }
  function doSync() {
    mutation.mutate({ token: adminToken });
  }
  if (status.dataset?.mode === 'published') {
    return (
      <Modal
        title={t('data.publishedTitle')}
        eyebrow={t('data.official')}
        onClose={onClose}
      >
        <PublishedData status={status} years={availableYears} />
      </Modal>
    );
  }
  return (
    <Modal
      title={t('data.legacyTitle')}
      eyebrow={t('data.transparent')}
      onClose={onClose}
    >
      <h2>{t('data.sourceTitle')}</h2>
      <p>{t('data.legacyIntro')}</p>
      <div className="national-sync">
        <h3>{t('data.archive')}</h3>
        <p>
          {t('data.archiveSummary', {
            count: status.archive?.files ?? 0,
            size: Math.round((status.archive?.bytes ?? 0) / 1e6),
          })}
        </p>
        {status.admin_token_required && (
          <label>
            {t('data.adminToken')}
            <input
              type="password"
              autoComplete="off"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
            />
          </label>
        )}
        <button disabled={busy} onClick={doSync}>
          <Database size={16} />
          {t('data.sync')}
        </button>
        <p>{t('data.syncHelp')}</p>
      </div>
      <DataCoverage status={status} years={availableYears} />
      <h3>{t('data.anotherArea')}</h3>
      <p>{t('data.importHelp')}</p>
      <div className="import-form">
        <label>
          {t('data.department')}
          <input
            value={dep}
            maxLength={3}
            placeholder="16, 75, 2A…"
            onChange={(e) => setDep(e.target.value)}
          />
        </label>
        <label>
          {t('data.year')}
          <select
            value={importYear}
            onChange={(e) => setImportYear(+e.target.value)}
          >
            {availableYears.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !/^([0-9]{2}|2[AB]|97[0-9])$/i.test(dep)}
          onClick={doImport}
        >
          <Download size={16} />
          {t('data.import')}
        </button>
      </div>
      {status.job.message && (
        <p
          className={'notice ' + (status.job.state === 'error' ? 'error' : '')}
          role="status"
        >
          {t(
            status.job.state === 'running'
              ? 'jobs.running'
              : status.job.state === 'done'
                ? 'jobs.done'
                : 'jobs.error',
          )}
        </p>
      )}
      {status.job.message && status.job.state !== 'idle' && (
        <details className="job-details">
          <summary>{t('data.jobDetails')}</summary>
          <p>{status.job.message}</p>
        </details>
      )}
      {importError && (
        <p className="error" role="alert">
          {importError}
        </p>
      )}
      <div className="method">
        <h3>{t('data.method')}</h3>
        <p>{t('data.legacyHistory')}</p>
        <p>{t('data.legacyGrouping')}</p>
        <p>{t('data.legacyLocation')}</p>
        <p>{t('data.legacyCaution')}</p>
        <a
          href="https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres"
          target="_blank"
          rel="noreferrer"
        >
          {t('data.dgfipTerms')}
        </a>{' '}
        ·{' '}
        <a
          href="https://cadastre.data.gouv.fr/datasets/cadastre-etalab"
          target="_blank"
          rel="noreferrer"
        >
          {t('data.cadastre')}
        </a>
      </div>
    </Modal>
  );
}
