import json, math, threading
from pathlib import Path
from datetime import date
from typing import Literal
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from store import LOCK, ROOT, connect, records
from ingest import import_data

@asynccontextmanager
async def lifespan(app):
    with LOCK: connect().close()
    yield
app=FastAPI(title='DVF Explorer', lifespan=lifespan)
job={'state':'idle','message':''}
job_lock=threading.Lock()

@app.get('/api/status')
def status():
    with LOCK:
        con=connect()
        try: imports=records(con,'SELECT * FROM imports ORDER BY year DESC, department')
        finally: con.close()
    with job_lock: task=dict(job)
    return {'imports':imports,'job':task}

@app.get('/api/search')
async def search(q: str=Query(min_length=3,max_length=200)):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response=await client.get('https://data.geopf.fr/geocodage/search',params={'q':q,'limit':6})
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError,ValueError): raise HTTPException(502,'Le service de recherche IGN est momentanément indisponible.')

@app.get('/api/sales')
def sales(lon:float=Query(default=0.148008,ge=-180,le=180),lat:float=Query(default=45.644105,ge=-85,le=85),
          radius:float=Query(default=3,ge=.2,le=30),year:int=Query(default=2026,ge=2014,le=2100),
          kind:str='',price_min:float=Query(default=0,ge=0),price_max:float=Query(default=100000000,ge=0),
          start:date|None=None,end:date|None=None):
    if price_max<price_min or (start and end and start>end): raise HTTPException(422,'Bornes de filtre incohérentes.')
    where='year=? AND price BETWEEN ? AND ? AND longitude IS NOT NULL'
    params=[year,price_min,price_max]
    if kind: where+=' AND kind=?'; params.append(kind)
    if start: where+=' AND date>=?'; params.append(start)
    if end: where+=' AND date<=?'; params.append(end)
    # Préfiltre géographique puis distance de grand cercle pour le rayon exact.
    where+=' AND latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?'
    delta=radius/110; dx=delta/max(.01,math.cos(math.radians(lat)))
    params.extend([lat-delta,lat+delta,lon-dx,lon+dx])
    with LOCK:
        con=connect()
        try: rows=records(con,'SELECT * FROM sales WHERE '+where,params)
        finally: con.close()
    def distance(row):
        a=math.sin(math.radians(row['latitude']-lat)/2)**2+math.cos(math.radians(lat))*math.cos(math.radians(row['latitude']))*math.sin(math.radians(row['longitude']-lon)/2)**2
        return 6371*2*math.asin(min(1,math.sqrt(a)))
    rows=[dict(r,distance=round(distance(r),3),parcels=json.loads(r['parcels'])) for r in rows if distance(r)<=radius]
    rows.sort(key=lambda r:(r['date'],r['id']),reverse=True)
    prices=sorted(r['price'] for r in rows)
    def median(v): return (v[(len(v)-1)//2]+v[len(v)//2])/2 if v else None
    unit=sorted(r['price']/r['surface'] for r in rows if not r['multi'] and r['surface'] and r['kind'] in ('Maison','Appartement'))
    return {'sales':rows[:3000],'total':len(rows),'truncated':len(rows)>3000,'median_price':median(prices),'median_sqm':median(unit),'sqm_count':len(unit)}

class ImportRequest(BaseModel):
    department:str=Field(pattern=r'^(\d{2}|2[AB]|97\d)$')
    year:int=Field(ge=2014,le=2100)

@app.post('/api/import',status_code=202)
def start_import(request:ImportRequest):
    with job_lock:
        if job['state']=='running': raise HTTPException(409,'Un import est déjà en cours.')
        job.update(state='running',message='Préparation…')
    def progress(message):
        with job_lock: job['message']=message
    def run():
        try:
            import_data(request.department,request.year,progress)
            with job_lock: job['state']='done'
        except Exception as exc:
            with job_lock: job.update(state='error',message=f'Import interrompu : {exc}')
    threading.Thread(target=run,daemon=True).start()
    return {'message':'Import démarré'}

DIST=ROOT/'frontend'/'dist'
if DIST.exists():
    app.mount('/assets',StaticFiles(directory=DIST/'assets'),name='assets')
    @app.get('/')
    def index(): return FileResponse(DIST/'index.html',headers={'X-Robots-Tag':'noindex, nofollow'})
