import copy

import pytest

from pipeline import targets


def test_resolved_targets_and_barnard_cross_check():
    cfg = targets.load_config()
    ts = {t.id: t for t in targets.resolve(cfg)}
    assert set(ts) == {"wise0855", "barnard", "epsindb", "rwaur", "rdra", "m42", "m16", "m31"}  # five challenge targets and three demo targets
    assert (ts["wise0855"].ra, ts["wise0855"].dec) == (133.795129, -7.245147)
    cc = next(t for t in cfg["targets"] if t["id"] == "barnard")["cross_check"]
    assert targets.sep_arcsec(ts["barnard"].ra, ts["barnard"].dec, cc["ra_deg"], cc["dec_deg"]) <= cc["max_sep_arcsec"]
    for t in ts.values():
        assert 0 <= t.ra < 360 and -90 <= t.dec <= 90 and t.position_note


def test_build_stops_when_cross_check_fails():
    cfg = copy.deepcopy(targets.load_config())
    next(t for t in cfg["targets"] if t["id"] == "barnard")["cross_check"]["dec_deg"] += 0.01  # 36 arcsec off
    with pytest.raises(SystemExit):
        targets.resolve(cfg)


def test_propagate_simple():
    ra, dec = targets.propagate(10.0, 0.0, 3600000.0, 0.0, 1.0)  # 1 degree of motion in a year
    assert abs(ra - 11.0) < 1e-9 and dec == 0.0
