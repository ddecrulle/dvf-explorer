"""Reconstruction hors ligne depuis les snapshots, serveur arrêté et base vide."""
import json
import store
from archive import root
from national import import_snapshot
from sync import writer_lock

def rebuild(progress=print):
    with writer_lock():
        with store.LOCK:
            con=store.connect();count=con.execute('SELECT count(*) FROM sales').fetchone()[0];con.close()
        if count:raise RuntimeError('Reconstruction réservée à une base vide. Utiliser un nouveau DVF_DATA_DIR.')
        snapshots=sorted((root()/'snapshots').glob('*.json'))
        if not snapshots:raise RuntimeError('Aucun instantané archivé.')
        for path in snapshots:
            snapshot=json.loads(path.read_text())
            for record in snapshot['resources']:import_snapshot(record,progress)
        progress('Base reconstruite depuis les archives. Géolocalisation à relancer séparément.')

if __name__=='__main__':rebuild()
