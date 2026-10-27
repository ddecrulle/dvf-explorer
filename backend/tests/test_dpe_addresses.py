"""Declared sale addresses must resolve exactly, without a nearest-address guess."""

import sys
from datetime import date
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dpe_addresses
import store
from test_parcels import add

PARCEL = "16358000AZ0386"
AT = date(2022, 11, 10)
BAN = "16358_0032_00005"


@pytest.fixture
def declared_sale(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    con = store.connect()
    add(
        con,
        "sale",
        2022,
        290200,
        [PARCEL],
        date=AT,
        citycode="16358",
        address="5 IMP JACQUES BREL",
    )
    con.close()
    return tmp_path


def feature(**updates):
    return {
        "properties": dict(
            id=BAN,
            name="5 Impasse Jacques Brel",
            citycode="16358",
            type="housenumber",
            score=0.49,
        )
        | updates
    }


def resolve(features, calls=None):
    def handler(request):
        if calls is not None:
            calls.append(request)
        return httpx.Response(200, json={"features": features})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return dpe_addresses.lookup(PARCEL, AT, client, "pinned")


def test_exact_declared_address_resolves_despite_low_geocoding_score(declared_sale):
    calls = []
    assert resolve([feature()], calls) == [BAN]
    assert calls[0].url.params["q"] == "5 IMP JACQUES BREL"
    assert calls[0].url.params["citycode"] == "16358"
    assert dpe_addresses.sale_address(PARCEL, date(2022, 11, 9)) is None
    assert dpe_addresses.sale_address("16358000AZ0387", AT) is None


@pytest.mark.parametrize(
    "changes",
    [
        {"name": "6 Impasse Jacques Brel"},
        {"name": "5 Impasse Marcel Ayme"},
        {"citycode": "16015"},
        {"type": "street"},
        {"id": "16358_0032"},
    ],
)
def test_approximate_or_wrong_candidates_are_rejected(declared_sale, changes):
    assert resolve([feature(**changes)]) == []


def test_ambiguous_ban_identifiers_are_not_chosen_arbitrarily(declared_sale):
    assert resolve([feature(), feature(id="16358_9999_00005")]) == []


def test_shared_or_conflicting_sales_do_not_supply_a_parcel_address(declared_sale):
    con = store.connect()
    con.execute('UPDATE sales SET parcels=\'["16358000AZ0386","16358000AZ0387"]\'')
    con.close()
    calls = []
    assert resolve([feature()], calls) == [] and calls == []
    con = store.connect()
    con.execute("UPDATE sales SET parcels='[\"16358000AZ0386\"]'")
    add(
        con,
        "conflicting",
        2022,
        290200,
        [PARCEL],
        date=AT,
        citycode="16358",
        address="7 IMP JACQUES BREL",
    )
    con.close()
    assert resolve([feature()], calls) == [] and calls == []
