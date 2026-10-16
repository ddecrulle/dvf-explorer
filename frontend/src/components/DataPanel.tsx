import { useState, useEffect, useRef } from 'react';
import { Database, Download, X } from 'lucide-react';
import type { Status } from '../types';
import { api, errorMessage } from '../api';

interface Props {
  status: Status;
  availableYears: number[];
  dep: string;
  setDep: (value: string) => void;
  importYear: number;
  setImportYear: (value: number) => void;
  onClose: () => void;
  onStarted: (message: string) => void;
}
export function DataPanel({
  status,
  availableYears,
  dep,
  setDep,
  importYear,
  setImportYear,
  onClose,
  onStarted,
}: Props) {
  const modalRef = useRef<HTMLElement>(null);
  const [adminToken, setAdminToken] = useState('');
  const [importError, setImportError] = useState('');
  const coverage = availableYears.map((y) => ({
    year: y,
    count: status.imports
      .filter((i) => i.year === y)
      .reduce((n, i) => n + i.count, 0),
    located: status.imports
      .filter((i) => i.year === y)
      .reduce((n, i) => n + i.located, 0),
    departments: status.imports.filter((i) => i.year === y).length,
  }));
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    modalRef.current?.querySelector('button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = [
          ...(modalRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a,input,select',
          ) ?? []),
        ];
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [onClose]);
  async function doImport() {
    setImportError('');
    try {
      await api('/api/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': adminToken,
        },
        body: JSON.stringify({
          department: dep.toUpperCase(),
          year: Number(importYear),
        }),
      });
      onStarted('Preparing import…');
    } catch (e) {
      setImportError(errorMessage(e));
    }
  }
  async function doSync() {
    setImportError('');
    try {
      await api('/api/sync', {
        method: 'POST',
        headers: { 'X-Admin-Token': adminToken },
      });
      onStarted('Archiving and syncing nationwide data…');
    } catch (e) {
      setImportError(errorMessage(e));
    }
  }
  return (
    <div className="modal-backdrop" onClick={() => onClose()}>
      <section
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Data and imports"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-head">
          <span>TRANSPARENT DATA</span>
          <button
            className="icon"
            aria-label="Close data panel"
            onClick={() => onClose()}
          >
            <X />
          </button>
        </div>
        <h2>Straight from the source.</h2>
        <p>
          Official DGFiP files are archived and located using Etalab cadastral
          parcels. During sync, sales appear on the map as parcels are matched.
        </p>
        <div className="national-sync">
          <h3>Permanent national archive</h3>
          <p>
            {status.archive?.files || 0} files in the latest archived
            publication · {Math.round((status.archive?.bytes || 0) / 1e6)} MB.
            Previous versions remain in storage.
          </p>
          {status.admin_token_required && (
            <label>
              Administration token
              <input
                type="password"
                autoComplete="off"
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
              />
            </label>
          )}
          <button disabled={status.job.state === 'running'} onClick={doSync}>
            <Database size={16} />
            Sync all of France
          </button>
          <p>
            Archive every published year, apply corrections and match parcels.
            Restart an interrupted sync to resume.
          </p>
        </div>
        <div className="imported">
          {coverage.map((i) => (
            <div key={i.year}>
              <strong>
                {i.year} · {i.departments} departments
              </strong>
              <span>
                {i.count.toLocaleString('en-GB')} sales ·{' '}
                {i.located.toLocaleString('en-GB')} located
              </span>
            </div>
          ))}
        </div>
        <h3>Explore another area</h3>
        <p>
          Targeted import and parcel matching. National files are archived
          before importing. Use nationwide sync for complete coverage.
        </p>
        <div className="import-form">
          <label>
            Department
            <input
              value={dep}
              maxLength={3}
              placeholder="16, 75, 2A…"
              onChange={(e) => setDep(e.target.value)}
            />
          </label>
          <label>
            Year
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
            disabled={
              status.job.state === 'running' ||
              !/^([0-9]{2}|2[AB]|97[0-9])$/i.test(dep)
            }
            onClick={doImport}
          >
            <Download size={16} />
            Import
          </button>
        </div>
        {status.job.message && (
          <p
            className={
              'notice ' + (status.job.state === 'error' ? 'error' : '')
            }
            role="status"
          >
            {status.job.message}
          </p>
        )}
        {importError && (
          <p className="error" role="alert">
            {importError}
          </p>
        )}
        <div className="method">
          <h3>Understanding the figures</h3>
          <p>
            Archived years remain available after they leave the official
            publication. Each new release replaces only its stated coverage
            period; versions are never added together. Coverage may be partial
            and late registrations may be missing.
          </p>
          <p>
            The raw file has no unique transaction identifier. Adjacent rows
            sharing a date, amount, municipality and disposition are grouped;
            distinct sales may remain ambiguous. The median describes these
            groups and is not a market valuation.
          </p>
          <p>
            Sales without a matched parcel remain in import counts but do not
            appear on the map. Price/m² is calculated only for simple groups.
            Identical building areas can remain ambiguous. Near a department
            boundary, also import neighbouring departments.
          </p>
          <p>
            DVF does not cover Alsace, Moselle or Mayotte. Do not use these data
            to re-identify people.
          </p>
          <a
            href="https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres"
            target="_blank"
            rel="noreferrer"
          >
            DGFiP publication and terms ↗
          </a>{' '}
          ·{' '}
          <a
            href="https://cadastre.data.gouv.fr/datasets/cadastre-etalab"
            target="_blank"
            rel="noreferrer"
          >
            Etalab cadastre ↗
          </a>
        </div>
      </section>
    </div>
  );
}
