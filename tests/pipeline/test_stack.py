"""Stacking helpers on SIMULATED arrays. No network, no archive data."""
import numpy as np

from pipeline import stack


def test_subtract_background_uses_unflagged_median():
    pix = np.full((4, 4), 5.0, dtype="float32")
    pix[0, 0] = 100.0
    flagged = np.zeros((4, 4), bool)
    flagged[0, 0] = True
    out = stack.subtract_background(pix, flagged)
    assert out[1, 1] == 0.0 and out[0, 0] == 95.0
    allnan = np.full((2, 2), np.nan, dtype="float32")
    assert np.isnan(stack.subtract_background(allnan, np.zeros((2, 2), bool))).all()


def test_band_id():
    assert stack.band_id("SPHEREx-D3") == "D3" and stack.band_id("") == "unknown"


def test_assign_visits_splits_on_gaps_and_cuts_long_runs():
    visit, bounds = stack.assign_visits([100.0, 0.0, 10.0, 105.0])
    assert visit == [1, 0, 0, 1] and bounds == [(0.0, 10.0), (100.0, 105.0)]
    visit, bounds = stack.assign_visits([float(d) for d in range(0, 150, 10)])  # 140 days, no gap: 3 bins
    assert len(bounds) == 3 and visit == sorted(visit)


def test_visits_for_uses_the_full_listing_for_boundaries():
    full = [float(d) for d in range(0, 50, 2)] + [float(d) for d in range(200, 250, 2)]
    sample = [0.0, 48.0, 200.0]                       # 48-day gap inside the first visit of a sparse sample
    assert stack.assign_visits(sample)[0] == [0, 1, 2]
    visit, bounds = stack.visits_for(sample, full)
    assert visit == [0, 0, 1] and bounds == [(0.0, 48.0), (200.0, 200.0)]


def test_combine_clips_an_outlier_and_falls_back_where_everything_is_flagged():
    imgs = [np.ones((3, 3), dtype="float32") for _ in range(8)]
    imgs[0][1, 1] = 500.0                              # e.g. a cosmic ray in one image
    flags = [np.zeros((3, 3), bool) for _ in range(8)]
    for f in flags:
        f[0, 0] = True                                 # always flagged, e.g. a saturated core
    out, nodata = stack.combine(imgs, flags)
    assert abs(out[1, 1] - 1.0) < 1e-6 and out[0, 0] == 1.0
    assert nodata[0, 0] and nodata.sum() == 1


def test_build_stacks_shows_a_source_that_moved_between_visits():
    def item(mjd, band, x):
        pix = np.zeros((20, 20), dtype="float32") + np.random.default_rng(int(mjd)).normal(0, 0.01, (20, 20)).astype("float32")
        pix[10, x] += 5.0
        return {"obs_mjd": mjd, "band": band, "wavelength_um": 1.0 if band == "D1" else 2.0, "pix": pix, "flagged": np.zeros((20, 20), bool)}
    items = [item(t, b, 5) for t in (0.0, 1.0, 2.0) for b in ("D1", "D2")] + [item(t, b, 12) for t in (200.0, 201.0, 202.0) for b in ("D1", "D2")]
    meta, pngs = stack.build_stacks(items, "MJy / sr")
    assert [b["id"] for b in meta["bands"]] == ["all", "D1", "D2"] and len(meta["visits"]) == 2
    assert meta["bands"][0]["wavelength_min_um"] == 1.0 and meta["bands"][0]["wavelength_max_um"] == 2.0
    assert [(e["visit"], e["band"], e["n_images"]) for e in meta["images"]][:2] == [(0, "all", 6), (0, "D1", 3)]
    first, second = [e for e in meta["images"] if e["band"] == "all"]
    assert "diff_url" not in first and second["diff_url"] == "d_all_1.png"
    d = pngs["d_all_1.png"]
    assert d[10, 5] < 30 and d[10, 12] > 225 and abs(int(d[3, 3]) - 128) < 40   # left a hole, appeared elsewhere, rest grey
    assert pngs["s_all_0.png"][10, 5] > 200 and pngs["s_all_1.png"][10, 12] > 200
    urls = stack.with_urls(meta, lambda n: "/x/" + n)
    assert urls["images"][1]["url"].startswith("/x/s_") and meta["images"][1]["url"].startswith("s_")


def test_build_stacks_with_nothing():
    assert stack.build_stacks([], "u") == (None, {})
