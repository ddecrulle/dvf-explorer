"""Import des fichiers DGFiP bruts, coordonnées issues du cadastre Etalab."""
import argparse, csv, gzip, hashlib, io, json, re, zipfile
from datetime import datetime
import httpx
from shapely.geometry import shape
from store import DATA, LOCK, connect
CATALOG = 'https://www.data.gouv.fr/api/1/datasets/demandes-de-valeurs-foncieres/'

def download(url, target):
    if target.exists(): return
    temporary = target.with_suffix(target.suffix + '.part')
    try:
        with httpx.stream('GET', url, follow_redirects=True, timeout=180) as response:
            response.raise_for_status()
            with temporary.open('wb') as output:
                for chunk in response.iter_bytes(): output.write(chunk)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)

def number(value):
    return float(value.replace(',', '.')) if value and value.strip() else None

def parcel_id(row):
    dep = row['Code departement'].zfill(2)
    city = dep + row['Code commune'].zfill(3)
    return city + (row['Prefixe de section'] or '0').zfill(3) + row['Section'].zfill(2) + row['No plan'].zfill(4)

def group_rows(stream, department, year):
    groups, current, last = [], [], None
    for row in csv.DictReader(stream, delimiter='|'):
        if row['Code departement'].zfill(2) != department: continue
        date = datetime.strptime(row['Date mutation'], '%d/%m/%Y').date()
        if date.year != year: raise ValueError(f'Le fichier contient une vente de {date.year}, au lieu de {year}.')
        # Sans identifiant de mutation public : regroupement contigu conservateur.
        key = (row['Identifiant de document'], row['Reference document'], row['Date mutation'],
               row['Nature mutation'], row['Valeur fonciere'], row['Code commune'], row['No disposition'])
        if key != last and current:
            groups.append(current); current = []
        current.append(row); last = key
    if current: groups.append(current)
    return groups

def import_data(department='16', year=2026, progress=lambda message: print(message, flush=True)):
    if not re.fullmatch(r'(\d{2}|2[AB]|97\d)', department): raise ValueError('Département invalide')
    progress('Recherche de la publication officielle…')
    metadata = httpx.get(CATALOG, timeout=40, follow_redirects=True).raise_for_status().json()
    candidates = [r for r in metadata['resources'] if re.search(rf'\b{year}\b', r['title']) and 'fonci' in r['title'].lower() and r['url'].endswith('.zip')]
    if len(candidates) != 1: raise ValueError(f'Aucun fichier officiel unique disponible pour {year}.')
    resource = candidates[0]
    archive = DATA / f"{resource['id']}-{resource.get('last_modified', '')[:10]}.zip"
    progress(f'Téléchargement de {resource["title"]}…')
    download(resource['url'], archive)
    with zipfile.ZipFile(archive) as z:
        name = next(n for n in z.namelist() if n.lower().endswith('.txt'))
        with z.open(name) as f:
            groups = group_rows(io.TextIOWrapper(f, encoding='utf-8-sig'), department, year)
    progress(f'{len(groups)} groupes de dispositions ; rapprochement cadastral…')
    needed = {parcel_id(r) for g in groups for r in g}
    coords = {}
    cad = DATA / f'cadastre-{department}.json.gz'
    download(f'https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/departements/{department}/cadastre-{department}-parcelles.json.gz', cad)
    with gzip.open(cad, 'rt') as f:
        features = json.load(f)['features']
    for feature in features:
        ident = feature['properties']['id']
        if ident in needed and feature.get('geometry'):
            point = shape(feature['geometry']).representative_point()
            coords[ident] = (point.x, point.y)
    del features
    entries = []
    for index, group in enumerate(groups):
        row = group[0]
        if row['Nature mutation'] != 'Vente': continue
        price = number(row['Valeur fonciere'])
        if price is None or price <= 0: continue
        parcels = sorted({parcel_id(r) for r in group})
        points = [coords[p] for p in parcels if p in coords]
        kinds = {r['Type local'] for r in group if r['Type local'] and r['Type local'] != 'Dépendance'}
        kind = next(iter(kinds)) if len(kinds) == 1 else ('Mixte' if kinds else 'Terrain / dépendance')
        # Les locaux peuvent être répétés sur les lignes de cultures/lot : pas de somme aveugle.
        buildings = {(parcel_id(r),r['Type local'],r['Surface reelle bati'],r['Nombre pieces principales']) for r in group if number(r['Surface reelle bati'])}
        simple = len(buildings) == 1 and len(parcels) == 1
        surface = number(next(iter(buildings))[2]) if simple else None
        rooms = int(number(next(iter(buildings))[3]) or 0) if simple else None
        lands = {(parcel_id(r), r['Nature culture'], r['Nature culture speciale'], r['Surface terrain']) for r in group}
        land = sum(number(t[3]) or 0 for t in lands) or None
        address = ' '.join(row[k] for k in ['No voie','B/T/Q','Type de voie','Voie'] if row[k]) or 'Adresse non renseignée'
        ident = hashlib.sha256(f'{department}:{year}:{index}:{group}'.encode()).hexdigest()[:20]
        # Un point de parcelle réel, pas un centroïde qui pourrait se trouver hors des biens.
        lon, lat = points[0] if points else (None, None)
        entries.append((ident, datetime.strptime(row['Date mutation'],'%d/%m/%Y').date(), price, address,
                        row['Commune'],department,department+row['Code commune'].zfill(3),kind,surface,land,
                        rooms,lon,lat,json.dumps(parcels),len(group),year,resource['url'],not simple))
    with LOCK:
        con = connect()
        try:
            con.execute('BEGIN')
            con.execute('DELETE FROM sales WHERE department=? AND year=?',[department,year])
            if entries: con.executemany('INSERT INTO sales VALUES ('+','.join(['?']*18)+')',entries)
            con.execute('INSERT OR REPLACE INTO imports VALUES (?,?,?,?,?,current_timestamp)',
                        [department,year,len(entries),sum(e[11] is not None for e in entries),resource['url']])
            con.execute('COMMIT')
        except Exception:
            con.execute('ROLLBACK'); raise
        finally: con.close()
    progress(f'Import terminé : {len(entries)} ventes, {sum(e[11] is not None for e in entries)} localisées.')
    return len(entries)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--department',default='16'); parser.add_argument('--year',type=int,default=2026)
    args=parser.parse_args(); import_data(args.department,args.year)
