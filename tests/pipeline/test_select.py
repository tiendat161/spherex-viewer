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


from pipeline.select import select_per_wavelength


def fr(wl, flag=0.1, mjd=60000.0):
    return {"wavelength_um": wl, "flag_fraction": flag, "obs_mjd": mjd}


def test_one_frame_per_band_lowest_flag_wins():
    out = select_per_wavelength([fr(1.0392, 0.2, 1), fr(1.0403, 0.05, 2), fr(2.5, 0.1, 3)], cap=102)
    assert [f["wavelength_um"] for f in out] == [1.0403, 2.5]


def test_bands_chain_within_tolerance():
    # 0.0015 steps chain into one band even though the ends are 0.006 apart
    out = select_per_wavelength([fr(1.000), fr(1.0015), fr(1.003), fr(1.0045), fr(1.006)], cap=102)
    assert len(out) == 1


def test_cap_drops_the_most_flagged_bands_and_keeps_wavelength_order():
    frames = [fr(1.0, 0.5), fr(2.0, 0.1), fr(3.0, 0.2), fr(4.0, 0.9)]
    out = select_per_wavelength(frames, cap=2)
    assert [f["wavelength_um"] for f in out] == [2.0, 3.0]


def test_empty_input():
    assert select_per_wavelength([], cap=102) == []
