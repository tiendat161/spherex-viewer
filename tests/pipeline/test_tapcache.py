"""Remembered archive searches. SIMULATED rows, a temporary folder, no network."""
import os
import time
from unittest import mock

import pytest

from pipeline import tapcache
from pipeline.live import LiveBuilder
from tests.pipeline.test_build import FakeClient
from tests.pipeline.test_live import RA, DEC, wait

@pytest.fixture(autouse=True)
def fixed_wavelength():
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        yield


ROWS = [{"planeid": "1", "time_bounds_lower": "60000.5", "uri": "ibe/data/spherex/dr1/level2/a.fits"},
        {"planeid": "2", "time_bounds_lower": "60001.5", "uri": "ibe/data/spherex/dr1/level2/b.fits"}]


def test_round_trip_and_matching_to_a_third_of_an_arcsecond(tmp_path):
    assert tapcache.load(tmp_path, 10.0, 20.0) is None
    tapcache.save(tmp_path, 10.0, 20.0, ROWS)
    assert tapcache.load(tmp_path, 10.0, 20.0) == ROWS
    assert tapcache.load(tmp_path, 10.00002, 20.00002) == ROWS      # 0.07 arcsec away: the same search
    assert tapcache.load(tmp_path, 10.001, 20.0) is None            # 3.6 arcsec away: a different one


def test_old_entries_are_ignored_and_empty_answers_are_not_kept(tmp_path):
    tapcache.save(tmp_path, 10.0, 20.0, ROWS)
    assert tapcache.load(tmp_path, 10.0, 20.0, now=time.time() + tapcache.TTL_S + 60) is None
    tapcache.save(tmp_path, 1.0, 2.0, [])
    assert list(tmp_path.glob("1.0000_2.0000*")) == []


def test_a_damaged_file_is_ignored(tmp_path):
    p = tmp_path / "10.0000_20.0000.csv"
    p.write_bytes(b"\xff\xfe\x00not a csv")
    assert tapcache.load(tmp_path, 10.0, 20.0) in (None, [])


def test_default_folder_follows_the_environment(tmp_path):
    old = os.environ.get("SPHEREX_CACHE_DIR")
    os.environ["SPHEREX_CACHE_DIR"] = str(tmp_path)
    try:
        assert tapcache.default_dir() == tmp_path / "tap" / "live"
    finally:
        if old is None:
            del os.environ["SPHEREX_CACHE_DIR"]
        else:
            os.environ["SPHEREX_CACHE_DIR"] = old


class Counting(FakeClient):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.searches = 0

    def tap_rows(self, ra, dec, *a, **k):
        self.searches += 1
        return super().tap_rows(ra, dec, *a, **k)


def test_a_position_searched_before_skips_the_archive_search_even_after_a_restart(tmp_path):
    client = Counting()
    first = LiveBuilder(client, tap_dir=tmp_path).get_or_start(RA, DEC, 0.2, 5)
    wait(first)
    assert client.searches == 1 and any(tmp_path.glob("*.csv"))
    restarted = LiveBuilder(client, tap_dir=tmp_path)  # a new process would start with an empty builder
    again = restarted.get_or_start(RA, DEC, 0.2, 5)
    wait(again)
    assert client.searches == 1 and again.doc()["progress"]["available"] == 50 and again.doc()["status"] == "ready"


def test_without_a_folder_nothing_is_remembered(tmp_path):
    client = Counting()
    a = LiveBuilder(client).get_or_start(RA, DEC, 0.2, 3)
    wait(a)
    b = LiveBuilder(client).get_or_start(RA, DEC, 0.2, 3)
    wait(b)
    assert client.searches == 2


def test_the_folder_is_capped_to_the_newest_entries_and_no_temp_files_are_left(tmp_path):
    with mock.patch.object(tapcache, "MAX_ENTRIES", 3):
        for i in range(5):
            tapcache.save(tmp_path, float(i), 0.0, ROWS)
            os.utime(tapcache._path(tmp_path, float(i), 0.0), (1000 + i, 1000 + i))
    assert {p.name for p in tmp_path.glob("*.csv")} == {tapcache._path(tmp_path, float(i), 0.0).name for i in (2, 3, 4)}
    assert not list(tmp_path.glob("*.part"))
