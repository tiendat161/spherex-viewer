"""Finished live series kept on disk across a restart (T22). SIMULATED cutouts, a temporary folder, no network."""
import json
import os
import time
from unittest import mock

import pytest
from jsonschema import Draft202012Validator

from pipeline import livestore
from pipeline.live import LiveBuilder, LiveSeries
from tests.pipeline.test_build import FakeClient
from tests.pipeline.test_live import RA, DEC, SERIES, wait


@pytest.fixture(autouse=True)
def fixed_wavelength():
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        yield


def built(store, n=8, ra=RA, dec=DEC, **kw):
    b = LiveBuilder(FakeClient(), store_dir=store, **kw)
    job = b.get_or_start(ra, dec, 0.2, n)
    wait(job)
    b._pool.shutdown(wait=True)  # the save happens after the run, in the same worker
    return b, job


def test_a_restarted_builder_shows_the_same_series_without_the_archive(tmp_path):
    _, job = built(tmp_path, 8)
    before = job.doc()
    b2 = LiveBuilder(client=None, store_dir=tmp_path)  # no client: nothing may be fetched
    got = b2.find_at(RA, DEC, 0.2)
    assert got is not None and got.id == job.id
    after = got.doc()
    assert not list(SERIES.iter_errors(after))
    assert after == before  # frames, flux, stretch, stacks, urls: the same document
    assert all(got.png(f"{f['index']:02d}.png") == job.png(f"{f['index']:02d}.png") for f in after["frames"])
    st = after["stacks"]["images"][0]["url"].split("/")[-1].split("?")[0]
    assert got.png(st) == job.png(st) and st != ""
    assert got.pix_dropped and got.status == "ready"


def test_a_restored_series_is_rebuilt_when_asked_for_more_or_to_measure(tmp_path):
    built(tmp_path, 8)
    b2 = LiveBuilder(FakeClient(), store_dir=tmp_path)
    old = b2.find_at(RA, DEC, 0.2)
    assert old.spectrum(RA, DEC)["status"] == "error"  # no pixels yet
    new = b2.revive(old)
    assert new is not old and b2.find_at(RA, DEC, 0.2) is new
    wait(new)
    assert len(new.spectrum(RA, DEC)["frames"]) == 8 and not new.pix_dropped
    assert b2.revive(new) is new  # pixels are there: nothing to do
    b3 = LiveBuilder(FakeClient(), store_dir=tmp_path)  # extending goes through the same rebuild
    j = b3.get_or_start(RA, DEC, 0.2, 12)
    wait(j)
    assert j.doc()["progress"]["done"] == 12


def test_only_finished_series_are_kept_and_the_newest_max_kept(tmp_path):
    b = LiveBuilder(FakeClient(), store_dir=tmp_path, max_kept=2)
    jobs = []
    for ra in (10.0, 20.0, 30.0):
        jobs.append(b.get_or_start(ra, DEC, 0.2, 4))
        wait(jobs[-1])
        b._pool.shutdown(wait=True)
        b._pool = type(b._pool)(2)
    kept = {p.name for p in tmp_path.glob("live*")}
    assert len(kept) == 2 and jobs[0].id not in kept
    assert LiveSeries(RA, DEC, 0.2, 4).snapshot() is None  # not ready: not saved


def test_old_damaged_and_foreign_entries_are_ignored(tmp_path):
    _, job = built(tmp_path, 4)
    d = tmp_path / job.id
    assert len(livestore.load_all(tmp_path, 30)) == 1
    assert livestore.load_all(tmp_path, 30, now=time.time() + livestore.TTL_S + 10) == []  # too old
    (d / "meta.json").write_text("{not json")
    assert livestore.load_all(tmp_path, 30) == []
    (d / "meta.json").write_text(json.dumps({"format": 99, "id": job.id}))
    assert livestore.load_all(tmp_path, 30) == []
    (tmp_path / "liveABCDEF").mkdir()  # not a series folder name
    assert LiveBuilder(None, store_dir=tmp_path).find_at(RA, DEC, 0.2) is None


def test_a_meta_of_an_unexpected_shape_does_not_stop_the_builder(tmp_path):
    _, job = built(tmp_path, 4)
    meta = json.loads((tmp_path / job.id / "meta.json").read_text())
    del meta["stretch"]
    (tmp_path / job.id / "meta.json").write_text(json.dumps(meta))
    assert LiveBuilder(None, store_dir=tmp_path).find_at(RA, DEC, 0.2) is None


def test_no_store_dir_means_nothing_is_written(tmp_path):
    b = LiveBuilder(FakeClient())
    wait(b.get_or_start(RA, DEC, 0.2, 4))
    assert list(tmp_path.iterdir()) == []
