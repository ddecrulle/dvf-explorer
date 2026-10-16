"""Import France par flux et remplacement atomique de la seule période republiée."""
import csv, io, json, tempfile, zipfile
from datetime import datetime
from pathlib import Path
import store
from archive import root, digest
from ingest import normalise

def groups(stream,year):
    last=None;group=[]
    for row in csv.DictReader(stream,delimiter='|'):
        if not row.get('Date mutation'):continue
        date=datetime.strptime(row['Date mutation'],'%d/%m/%Y').date()
        if date.year!=year:raise ValueError(f'Année inattendue : {date}')
        key=tuple(row[k] for k in ('Code departement','Identifiant de document','Reference document','Date mutation','Nature mutation','Valeur fonciere','Code commune','No disposition'))
        if last!=key and group:yield group;group=[]
        last=key;group.append(row)
    if group:yield group

def initialise(con):
    con.execute('CREATE TABLE IF NOT EXISTS national_imports (sha VARCHAR, start_date DATE, end_date DATE, imported_at TIMESTAMP DEFAULT current_timestamp, PRIMARY KEY(sha,start_date,end_date))')
    con.execute('CREATE TABLE IF NOT EXISTS parcel_points (id VARCHAR PRIMARY KEY, longitude DOUBLE, latitude DOUBLE)')
    con.execute('CREATE TABLE IF NOT EXISTS geocoding (department VARCHAR PRIMARY KEY, checked_at TIMESTAMP DEFAULT current_timestamp)')

def refresh_imports(con,department=None):
    condition=' WHERE department=?' if department else ''
    params=[department] if department else []
    con.execute('DELETE FROM imports'+condition,params)
    con.execute('''INSERT INTO imports SELECT department,year,count(*),count(longitude),max(source),current_timestamp
                   FROM sales'''+condition+' GROUP BY department,year',params)

def apply_points(con,department=None):
    where='WHERE s.department=?' if department else ''
    params=[department] if department else []
    con.execute('''CREATE OR REPLACE TEMP TABLE located AS
        SELECT s.id,first(p.longitude ORDER BY p.id) AS longitude,first(p.latitude ORDER BY p.id) AS latitude
        FROM sales s, json_each(s.parcels) j JOIN parcel_points p ON p.id=json_extract_string(j.value,'$')
        '''+where+' GROUP BY s.id',params)
    con.execute('UPDATE sales SET longitude=l.longitude,latitude=l.latitude FROM located l WHERE sales.id=l.id')

def import_snapshot(record,progress=print,department=None):
    path=root()/record['path'];year=record['resource']['year'];start,end=record['coverage'];sha=record['sha256']
    if digest(path)!=sha:raise ValueError('Empreinte de l’archive incorrecte : import annulé.')
    with store.LOCK:
        con=store.connect();initialise(con)
        done=con.execute('SELECT 1 FROM national_imports WHERE sha=? AND start_date=? AND end_date=?',[sha,start,end]).fetchone();con.close()
    if done and department is None:return 0
    stage=store.DATA/'staging';stage.mkdir(exist_ok=True)
    count=0
    with tempfile.NamedTemporaryFile('w',dir=stage,suffix='.csv',newline='',delete=False,encoding='utf8') as f:
        target=Path(f.name);writer=csv.writer(f)
        try:
            with zipfile.ZipFile(path) as z:
                name=next(n for n in z.namelist() if n.lower().endswith('.txt'))
                with z.open(name) as raw:
                    for index,group in enumerate(groups(io.TextIOWrapper(raw,encoding='utf-8-sig'),year)):
                        if department and group[0]['Code departement'].zfill(2)!=department:continue
                        entry=normalise(group,index,year,record['resource']['url'],{})
                        if entry:
                            if not start<=entry[1].isoformat()<=end:raise ValueError('Date hors de la couverture annoncée.')
                            writer.writerow(entry);count+=1
                            if count%100000==0:progress(f'{year} · {count:,} ventes préparées')
            f.flush()
            if not count:raise ValueError('Aucune vente reconnue : données précédentes préservées.')
            progress(f'{year} · intégration atomique de {count:,} ventes')
            with store.LOCK:
                con=store.connect();initialise(con)
                try:
                    con.execute('BEGIN')
                    con.execute('CREATE TEMP TABLE incoming AS SELECT * FROM sales WHERE false')
                    con.execute("COPY incoming FROM '"+str(target).replace("'","''")+"' (FORMAT CSV, HEADER FALSE, NULLSTR '')")
                    # Conserver les positions connues des groupes inchangés (mêmes parcelles).
                    con.execute('''UPDATE incoming SET longitude=old.longitude,latitude=old.latitude
                        FROM (SELECT parcels,first(longitude) longitude,first(latitude) latitude
                              FROM sales WHERE longitude IS NOT NULL GROUP BY parcels) old
                        WHERE incoming.parcels=old.parcels''')
                    condition='date BETWEEN ? AND ?';params=[start,end]
                    if department:condition+=' AND department=?';params.append(department)
                    con.execute('DELETE FROM sales WHERE '+condition,params)
                    con.execute('INSERT INTO sales SELECT * FROM incoming')
                    refresh_imports(con)
                    if department is None:
                        con.execute('DELETE FROM national_imports WHERE start_date<=? AND end_date>=?',[end,start])
                        con.execute('INSERT OR REPLACE INTO national_imports VALUES (?,?,?,current_timestamp)',[sha,start,end])
                    con.execute('COMMIT')
                except Exception:
                    con.execute('ROLLBACK');raise
                finally:con.close()
        finally:target.unlink(missing_ok=True)
    return count
