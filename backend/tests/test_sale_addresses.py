"""Do not infer a house address from the nearest address or another sale."""

import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sale_addresses
import store
from test_parcels import add, P1, P2


def test_exact_declared_addresses_without_ambiguous_or_cross_sale_matches(tmp_path):
    target, raw = tmp_path / "worker.duckdb", tmp_path / "raw.duckdb"
    con = duckdb.connect(str(raw))
    store.create_schema(con)
    add(con, "legacy", 2022, 290200, [P1], address="5 IMP JACQUES BREL")
    add(con, "other-date", 2023, 290200, [P1], address="8 RUE AUTRE")
    add(con, "ambiguous-a", 2024, 290200, [P1], address="5 IMP JACQUES BREL")
    add(con, "ambiguous-b", 2024, 290200, [P1], address="8 RUE AUTRE")
    add(con, "shared", 2025, 400000, [P1, P2], address="9 RUE TEST")
    con.close()
    con = duckdb.connect(str(target))
    store.create_schema(con)
    for identifier, year, price, parcels in [
        ("good", 2022, 290200, [P1]),
        ("wrong-price", 2022, 290201, [P1]),
        ("wrong-parcel", 2022, 290200, [P2]),
        ("wrong-date", 2021, 290200, [P1]),
        ("ambiguous", 2024, 290200, [P1]),
        ("shared", 2025, 400000, [P2, P1]),
        ("wrong-commune", 2022, 290200, [P1]),
        ("existing", 2022, 290200, [P1]),
    ]:
        add(con, "dvfplus:" + identifier, year, price, parcels)
    con.execute("UPDATE sales SET citycode='other' WHERE id='dvfplus:wrong-commune'")
    con.execute(
        "UPDATE sales SET address='Existing address' WHERE id='dvfplus:existing'"
    )
    con.close()
    assert sale_addresses.enrich(target, raw) == 2
    assert sale_addresses.enrich(target, raw) == 0
    con = duckdb.connect(str(target), read_only=True)
    result = dict(con.execute("SELECT id,address FROM sales").fetchall())
    assert result.pop("dvfplus:good") == "5 IMP JACQUES BREL"
    assert result.pop("dvfplus:shared") == "9 RUE TEST"
    assert result.pop("dvfplus:existing") == "Existing address"
    assert all(value == "" for value in result.values())
    con.close()
