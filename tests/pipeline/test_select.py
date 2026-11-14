from pipeline.select import select_frames


def row(i, rel="dr1", mjd=None):
    return {"time_bounds_lower": str(mjd if mjd is not None else 60000 + i),
            "uri": f"ibe/data/spherex/{rel}/level2/w/v/3/level2_OBS{i:04d}_spx_v.fits"}


def test_fewer_than_max_returns_all_in_time_order():
    rows = [row(3), row(1), row(2)]
    assert [r["time_bounds_lower"] for r in select_frames(rows, 40)] == ["60001", "60002", "60003"]


def test_even_spacing_includes_first_and_last():
    rows = [row(i) for i in range(258)]
    sel = select_frames(rows, 40)
    assert len(sel) == 40
    assert sel[0] is not None and sel[0]["time_bounds_lower"] == "60000" and sel[-1]["time_bounds_lower"] == "60257"
    mjds = [float(r["time_bounds_lower"]) for r in sel]
    assert mjds == sorted(mjds)
    gaps = [b - a for a, b in zip(mjds, mjds[1:])]
    assert max(gaps) - min(gaps) <= 1


def test_prefers_dr1_when_same_observation_in_both_releases():
    a = row(5, "qr3")
    b = row(5, "dr1")
    sel = select_frames([a, b], 40)
    assert len(sel) == 1 and "/dr1/" in sel[0]["uri"]
