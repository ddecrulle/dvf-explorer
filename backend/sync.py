"""Synchronisation nationale relançable. Un seul écrivain, via l'API en production."""
import argparse, fcntl, json
from contextlib import contextmanager
from datetime import datetime,timezone
import store
from archive import capture,atomic_json,root
from national import import_snapshot
from geocode import geocode_department

@contextmanager
def writer_lock():
    with (store.DATA/'sync.lock').open('a') as f:
        try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Une synchronisation est déjà active.')
        try:yield
        finally:fcntl.flock(f,fcntl.LOCK_UN)

def sync_all(progress=print,geocode=True):
    with writer_lock():
        snapshot=capture(progress)
        # Archive tous les fichiers avant de modifier la base consultable.
        for record in snapshot['resources']:import_snapshot(record,progress)
        errors=[]
        if geocode:
            with store.LOCK:
                con=store.connect();departments=[r[0] for r in con.execute('SELECT DISTINCT department FROM sales ORDER BY department').fetchall()];con.close()
            # La zone initiale reste utilisable dès le début du rapprochement.
            departments.sort(key=lambda d:(d!='16',d))
            for department in departments:
                try:geocode_department(department,progress)
                except Exception as exc:
                    errors.append(f'{department}: {exc}');progress(f'Géolocalisation incomplète · {department}: {exc}')
        result={'completed_at':datetime.now(timezone.utc).isoformat(),'snapshot':snapshot['captured_at'],'geocoded':geocode,'errors':errors}
        atomic_json(root()/'sync-result.json',result)
        if errors:raise RuntimeError('Archives et ventes importées ; cadastre à reprendre : '+' ; '.join(errors))
        progress('Synchronisation nationale terminée. Archives précédentes conservées.')
        return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--no-geocode',action='store_true');args=p.parse_args()
    sync_all(geocode=not args.no_geocode)
