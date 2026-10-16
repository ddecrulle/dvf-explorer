import csv, io, json, sys
from datetime import date
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import store, main
from ingest import group_rows, parcel_id
from fastapi.testclient import TestClient

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DATA',tmp_path)
    con=store.connect()
    values=[('near',date(2026,1,5),200000,'A','Commune','16','16358','Maison',100,300,4,.127748,45.67955,'["16358000AB0001"]',1,2026,'https://example.test',False),
            ('complex',date(2026,2,5),400000,'B','Commune','16','16358','Maison',None,600,None,.13,45.68,'["p1","p2"]',2,2026,'https://example.test',True),
            ('far',date(2026,1,5),900000,'C','Autre','16','16000','Appartement',100,None,4,1.5,46,'[]',1,2026,'https://example.test',False),
            ('old',date(2025,1,5),100000,'D','Commune','16','16358','Maison',100,300,4,.127748,45.67955,'[]',1,2025,'https://example.test',False),
            ('unlocated',date(2026,1,5),500000,'E','Commune','16','16358','Maison',100,None,4,None,None,'[]',1,2026,'https://example.test',False)]
    con.executemany('INSERT INTO sales VALUES ('+','.join(['?']*18)+')',values);con.close()
    with TestClient(main.app) as c: yield c

def test_radius_and_stats(client):
    body=client.get('/api/sales').json()
    assert body['total']==2
    assert body['median_price']==300000
    assert body['median_sqm']==2000
    assert body['sqm_count']==1
    assert body['sales'][0]['id']=='complex'

def test_filters_and_year(client):
    body=client.get('/api/sales?price_max=250000&start=2026-01-01&end=2026-01-31&kind=Maison').json()
    assert [r['id'] for r in body['sales']]==['near']
    assert client.get('/api/sales?year=2025').json()['total']==1
    assert client.get('/api/sales?kind=Appartement').json()['total']==0

@pytest.mark.parametrize('query',['radius=-1','lat=100','price_min=300&price_max=100','start=2026-03-01&end=2026-01-01'])
def test_invalid_filters(client,query): assert client.get('/api/sales?'+query).status_code==422

def test_import_validation(client):
    assert client.post('/api/import',json={'department':'../bad','year':2026}).status_code==422
    assert client.get('/api/search?q=a').status_code==422

def stream(rows):
    f=io.StringIO();w=csv.DictWriter(f,fieldnames=list(rows[0]),delimiter='|');w.writeheader();w.writerows(rows);f.seek(0);return f

def test_raw_groups_preserve_parcels_and_separate_dispositions():
    r={'Code departement':'16','Code commune':'358','Identifiant de document':'','Reference document':'','Date mutation':'05/01/2026','Nature mutation':'Vente','Valeur fonciere':'200000,00','No disposition':'1','Prefixe de section':'','Section':'AB','No plan':'1'}
    assert parcel_id(r)=='16358000AB0001'
    groups=group_rows(stream([r,dict(r,**{'No plan':'2'}),dict(r,**{'No disposition':'2'})]),'16',2026)
    assert list(map(len,groups))==[2,1]
    with pytest.raises(ValueError):group_rows(stream([r]),'16',2025)
