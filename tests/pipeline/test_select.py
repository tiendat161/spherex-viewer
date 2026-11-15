from pipeline.select import select_frames, spread_order


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


def test_release_preference_can_be_changed():
    from pipeline.select import dedupe_prefer_release
    rows = [row(5, "qr3"), row(5, "dr1"), row(6, "dr2")]
    out = dedupe_prefer_release(rows, preference=("qr3", "dr1"))
    assert sorted(r["uri"].split("/")[3] for r in out) == ["dr2", "qr3"]
    out = dedupe_prefer_release(rows)  # default: dr1 first, unknown releases last
    assert sorted(r["uri"].split("/")[3] for r in out) == ["dr1", "dr2"]


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


def vrow(i, mjd, band):
    r = row(i, mjd=mjd)
    r["energy_bandpassname"] = band
    return r


def three_visits_six_bands():
    """SIMULATED archive rows: 3 visits (days 0, 150, 300) of 4 images, each image in a different band, plus a few more."""
    rows, k = [], 0
    for day in (0, 150, 300):
        for b in range(6):
            rows.append(vrow(k, 60000 + day + b * 0.1, f"SPHEREx-D{b + 1}")); k += 1
    return rows


def test_spread_order_is_a_permutation_of_the_distinct_images_starting_with_the_earliest():
    rows = three_visits_six_bands() + [row(99, "qr3", mjd=60000.0)]
    out = spread_order(rows)
    assert len(out) == len(three_visits_six_bands()) + 1
    assert len({r["uri"] for r in out}) == len(out)
    assert float(out[0]["time_bounds_lower"]) == min(float(r["time_bounds_lower"]) for r in rows)
    assert spread_order(rows) == out  # deterministic
    assert spread_order([]) == [] and len(spread_order([row(1), row(2)])) == 2


def test_any_first_batch_covers_the_dates_and_the_bands():
    out = spread_order(three_visits_six_bands())
    first = out[:8]
    assert len({r["energy_bandpassname"] for r in first}) >= 5  # nearly every band in the first eight
    visits = {round((float(r["time_bounds_lower"]) - 60000) / 150) for r in first}
    assert visits == {0, 1, 2}                                   # and every visit
    # the first 8 in time order would all be one visit; this is not that
    assert [r["uri"] for r in first] != [r["uri"] for r in sorted(out, key=lambda r: float(r["time_bounds_lower"]))[:8]]


def test_one_band_is_spread_over_time():
    rows = [row(i) for i in range(100)]
    first = [float(r["time_bounds_lower"]) for r in spread_order(rows)[:5]]
    assert first[0] == 60000 and first[1] == 60099          # earliest, then the other end
    assert sorted(first) == [60000, 60025, 60050, 60074, 60099] or max(b - a for a, b in zip(sorted(first), sorted(first)[1:])) <= 30
