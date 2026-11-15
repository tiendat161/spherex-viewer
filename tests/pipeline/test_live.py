"""Live series with a fake IRSA client and SIMULATED cutouts. No network."""
import json
import time
from pathlib import Path
from unittest import mock

import pytest
from jsonschema import Draft202012Validator

from pipeline.irsa import IrsaError
from pipeline.live import LiveBuilder, LiveBusy, LiveSeries
from tests.pipeline.test_build import FakeClient

ROOT = Path(__file__).resolve().parents[2]
SERIES = Draft202012Validator(json.loads((ROOT / "contracts" / "series.schema.json").read_text()))
RA, DEC = 10.0, 10.0
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture(autouse=True)
def fixed_wavelength():
    with mock.patch("pipeline.cutout.wavelength_um_at", return_value=2.5):
        yield


def valid(doc):
    assert not list(SERIES.iter_errors(doc)), list(SERIES.iter_errors(doc))


def test_run_ends_ready_with_gaps_for_failed_frames():
    job = LiveSeries(RA, DEC, 0.2, 40)
    valid(job.doc())
    assert job.doc()["status"] == "loading" and job.doc()["progress"]["total"] == 0
    job.run(FakeClient(fail=("OBS0000",)))  # index 0 is always selected
    doc = job.doc()
    valid(doc)
    p = doc["progress"]
    assert doc["status"] == "ready" and doc["data_origin"] == "real"
    assert (p["done"], p["failed"], p["total"]) == (39, 1, 40) and len(doc["frames"]) == 39
    assert 0 not in [f["index"] for f in doc["frames"]]
    assert doc["grid"]["center"] == {"ra": RA, "dec": DEC} and doc["grid"]["shape"] == [116, 116]
    assert doc["stretch"]["vmax"] > doc["stretch"]["vmin"] and doc["stretch"]["unit"] == "MJy / sr"
    assert job.png("01.png").startswith(PNG_MAGIC) and job.png("00.png") is None
    assert all(f["url"] == f"/api/frames/{job.id}/{f['index']:02d}.png?v={job.gen}" for f in doc["frames"])


def test_partial_docs_while_loading_are_valid_and_urls_follow_the_stretch_generation():
    job = LiveSeries(RA, DEC, 0.2, 40)
    seen = []

    class Watching(FakeClient):
        def fetch_cutout(self, *a):
            seen.append(job.doc())
            return super().fetch_cutout(*a)

    job.run(Watching())
    for d in seen:
        valid(d)
        assert d["status"] == "loading" and d["progress"]["done"] == len(d["frames"])
        assert (d["stretch"] is None) == (len(d["frames"]) == 0)
    assert max(len(d["frames"]) for d in seen) > 0
    assert 1 < job.gen <= 8  # 1, 2, 4, 8, 16, 32 and the final pass; not once per frame


def test_fewer_images_than_cap_uses_them_all():
    job = LiveSeries(RA, DEC, 0.2, 40)
    job.run(FakeClient(n=3))
    assert job.doc()["progress"] == {"done": 3, "total": 3, "failed": 0, "available": 3, "search": "tap"}


@pytest.mark.parametrize("client, text", [
    (FakeClient(n=0), "no images covering"),
    (FakeClient(n=5, fail=("OBS",)), "None of the 5 images"),
])
def test_errors_are_schema_valid(client, text):
    job = LiveSeries(RA, DEC, 0.2, 40)
    job.run(client)
    doc = job.doc()
    valid(doc)
    assert doc["status"] == "error" and text in doc["error"]["message"]


def test_tap_and_sia2_failure_is_an_error():
    class Down(FakeClient):
        def tap_rows(self, ra, dec, *a, **k):
            raise IrsaError("TAP query failed after retries: HTTP 503")
        def sia_rows(self, ra, dec, *a, **k):
            raise IrsaError("SIA2 query failed after retries: HTTP 503")
    job = LiveSeries(RA, DEC, 0.2, 40)
    job.run(Down())
    assert job.doc()["status"] == "error" and "503" in job.doc()["error"]["message"]


def wait(job, seconds=30):
    end = time.time() + seconds
    while not job.finished and time.time() < end:
        time.sleep(0.02)
    assert job.finished


def test_builder_shares_a_job_within_one_arcsec_per_field_of_view():
    client = FakeClient()
    b = LiveBuilder(client)
    j1 = b.get_or_start(RA, DEC, 0.2, 40)
    assert b.get_or_start(RA, DEC, 0.5, 40) is not j1  # another field of view is another series
    j2 = b.get_or_start(RA + 0.5 / 3600, DEC, 0.2, 40)
    j3 = b.get_or_start(RA + 5 / 3600, DEC, 0.2, 40)
    assert j1 is j2 and j3 is not j1 and j1.cap == 40
    assert b.find(j1.id) is j1 and b.find("livenope") is None
    wait(j1), wait(j3)
    assert j1.doc()["progress"]["total"] == 40
    assert b.get_or_start(RA, DEC, 0.2, 40) is j1  # a finished series is reused, not rebuilt
    assert b.get_or_start(RA, DEC, 0.2, 10) is j1 and j1.doc()["progress"]["total"] == 40  # fewer asked: it keeps what it has
    assert b.get_or_start(RA, DEC, 0.2, 500).cap == 102  # the ceiling


class Counting(FakeClient):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.searches = 0

    def tap_rows(self, ra, dec, *a, **k):
        self.searches += 1
        return super().tap_rows(ra, dec, *a, **k)


def test_first_batch_then_more_keeps_the_frames_and_fetches_only_the_new_ones():
    client = Counting()
    b = LiveBuilder(client)
    j = b.get_or_start(RA, DEC, 0.2, 8)
    wait(j)
    d1 = j.doc()
    valid(d1)
    assert d1["status"] == "ready" and d1["progress"] == {"done": 8, "total": 8, "failed": 0, "available": 50, "search": "tap"}
    first_urls = {f["index"]: f["url"].split("?")[0] for f in d1["frames"]}
    assert len(client.fetched) == 8 and "stacks" in d1

    assert b.get_or_start(RA, DEC, 0.2, 20) is j  # the same series, extended
    d2 = j.doc()
    valid(d2)
    assert d2["status"] == "loading" and "stacks" in d2  # the stacks of the first 8 stay until the new ones are built
    wait(j)
    d3 = j.doc()
    valid(d3)
    assert d3["status"] == "ready" and d3["progress"] == {"done": 20, "total": 20, "failed": 0, "available": 50, "search": "tap"}
    assert len(client.fetched) == 20 and len(set(client.fetched)) == 20 and client.searches == 1  # nothing fetched twice, one search
    assert {f["index"]: f["url"].split("?")[0] for f in d3["frames"] if f["index"] in first_urls} == first_urls  # same indices and ids
    assert all(j.png(f"{i:02d}.png").startswith(PNG_MAGIC) for i in range(20))
    assert sum(len(v) for v in [d3["stacks"]["images"]]) > 0


def test_asking_for_more_while_still_loading_is_picked_up_by_the_running_worker():
    import threading
    gate = threading.Event()

    class Held(Counting):
        def fetch_cutout(self, *a):
            gate.wait(10)
            return super().fetch_cutout(*a)

    client = Held()
    b = LiveBuilder(client)
    j = b.get_or_start(RA, DEC, 0.2, 6)
    time.sleep(0.1)
    assert b.get_or_start(RA, DEC, 0.2, 14) is j and j.doc()["status"] == "loading"
    gate.set()
    wait(j)
    assert j.doc()["progress"] == {"done": 14, "total": 14, "failed": 0, "available": 50, "search": "tap"} and len(set(client.fetched)) == 14


def test_a_series_that_let_go_of_its_pixels_is_rebuilt_without_searching_again():
    client = Counting()
    b = LiveBuilder(client, hot_pixel_bytes=1)  # a budget so small that only the most recent series keeps its pixels
    a = b.get_or_start(1.0, 1.0, 0.2, 5)
    wait(a)
    c = b.get_or_start(2.0, 2.0, 0.2, 5)
    wait(c)
    b._trim()
    assert c.pix_dropped is False and a.pix_dropped is True and a.pixel_bytes() == 0
    assert a.doc()["progress"]["done"] == 5 and a.png("00.png") is not None  # it can still be shown
    assert client.searches == 2
    again = b.get_or_start(1.0, 1.0 + 0.5 / 3600, 0.2, 9)  # half an arcsec off: still the same id
    assert again is not a and again.id == a.id  # a new job with the same id, so the frame URLs stay valid
    wait(again)
    assert again.doc()["progress"]["done"] == 9 and client.searches == 2  # the rows were reused


def test_builder_refuses_when_the_queue_is_full_and_retries_old_errors():
    import threading
    gate = threading.Event()

    class Slow(FakeClient):
        def tap_rows(self, ra, dec, *a, **k):
            gate.wait(10)
            return []

    b = LiveBuilder(Slow(), max_running=1, max_waiting=1, error_ttl_s=0.0)
    a = b.get_or_start(1.0, 1.0, 0.2, 40)
    c = b.get_or_start(2.0, 2.0, 0.2, 40)
    with pytest.raises(LiveBusy):
        b.get_or_start(3.0, 3.0, 0.2, 40)
    gate.set()
    wait(a), wait(c)
    assert a.doc()["status"] == "error"
    time.sleep(0.01)
    assert b.get_or_start(1.0, 1.0, 0.2, 40) is not a  # error older than the TTL: built again


def test_sia2_fallback_when_tap_fails_is_marked_and_not_remembered(tmp_path):
    class TapDown(FakeClient):
        def tap_rows(self, ra, dec, *a, **k):
            raise IrsaError("TAP query failed after retries: HTTP 502")
        def sia_rows(self, ra, dec, *a, **k):
            return FakeClient.tap_rows(self, ra, dec)
    job = LiveSeries(RA, DEC, 0.2, 8, tap_dir=tmp_path)
    job.run(TapDown())
    doc = job.doc()
    valid(doc)
    assert doc["status"] == "ready" and doc["progress"]["search"] == "sia2"
    assert list(tmp_path.iterdir()) == []  # a possibly partial list is not kept for a week


def test_after_tap_fails_the_next_searches_go_to_sia2_first_until_the_pause_ends():
    from pipeline.live import TapHealth
    now = [0.0]
    health = TapHealth(skip_s=300, clock=lambda: now[0])
    calls = []

    class TapDown(FakeClient):
        def tap_rows(self, ra, dec, *a, **k):
            calls.append("tap")
            raise IrsaError("TAP query failed after retries: HTTP 502")
        def sia_rows(self, ra, dec, *a, **k):
            calls.append("sia")
            return FakeClient.tap_rows(self, ra, dec)

    LiveSeries(1.0, 1.0, 0.2, 4).run(TapDown(), health)
    assert calls == ["tap", "sia"] and health.down()
    j = LiveSeries(2.0, 2.0, 0.2, 4)
    j.run(TapDown(), health)
    assert calls == ["tap", "sia", "sia"] and j.doc()["progress"]["search"] == "sia2"  # no TAP wait this time
    now[0] = 301
    assert not health.down()
    LiveSeries(3.0, 3.0, 0.2, 4).run(TapDown(), health)
    assert calls[-2:] == ["tap", "sia"]  # the pause is over: TAP is tried again


def test_when_sia2_fails_during_the_pause_tap_is_still_tried():
    from pipeline.live import TapHealth
    health = TapHealth(skip_s=300)
    health.failed()

    class OnlyTap(FakeClient):
        def sia_rows(self, ra, dec, *a, **k):
            raise IrsaError("SIA2 down")
    j = LiveSeries(RA, DEC, 0.2, 4)
    j.run(OnlyTap(), health)
    assert j.doc()["progress"]["search"] == "tap" and not health.down()


def test_both_searches_failing_names_both():
    class AllDown(FakeClient):
        def tap_rows(self, ra, dec, *a, **k):
            raise IrsaError("TAP query failed after retries: HTTP 502")
        def sia_rows(self, ra, dec, *a, **k):
            raise IrsaError("SIA2 query spherex_dr1 failed after retries: HTTP 502")
    job = LiveSeries(RA, DEC, 0.2, 8)
    job.run(AllDown())
    msg = job.doc()["error"]["message"]
    assert job.doc()["status"] == "error" and "TAP" in msg and "SIA2" in msg


def test_tap_that_works_is_used_and_remembered(tmp_path):
    job = LiveSeries(RA, DEC, 0.2, 8, tap_dir=tmp_path)
    job.run(FakeClient())
    assert job.doc()["progress"]["search"] == "tap" and len(list(tmp_path.iterdir())) == 1


def test_total_memory_budget_evicts_old_finished_series():
    b = LiveBuilder(FakeClient(), max_total_bytes=1)  # a budget no series fits in
    a = b.get_or_start(1.0, 1.0, 0.2, 3)
    wait(a)
    assert a.png_bytes() > 0 and b.total_bytes() > 0
    assert b.find(a.id) is a  # the latest finished series is never evicted, even over budget
    c = b.get_or_start(2.0, 2.0, 0.2, 3)  # a new build evicts the older finished series
    assert b.find(a.id) is None
    wait(c)
    assert b.find(c.id) is c
    assert c.doc()["status"] == "ready"


def test_one_bad_frame_is_a_gap_not_a_failed_series():
    from astropy.wcs import NoConvergence
    import pipeline.live as live

    real = live.reproject_frame
    calls = []

    def flaky(*a, **k):
        calls.append(1)
        if len(calls) == 2:
            raise NoConvergence("simulated")
        return real(*a, **k)

    with mock.patch.object(live, "reproject_frame", flaky):
        j = LiveSeries(RA, DEC, 0.2, 6)
        j.run(FakeClient())
    d = j.doc()
    valid(d)
    assert d["status"] == "ready" and d["progress"]["done"] == 5 and d["progress"]["failed"] == 1


def test_polls_are_not_blocked_while_pngs_are_rendered():
    import threading
    import pipeline.live as live

    gate, started = threading.Event(), threading.Event()
    real = live._png_bytes

    def slow(*a, **k):
        started.set()
        gate.wait(10)
        return real(*a, **k)

    j = LiveSeries(RA, DEC, 0.2, 3)
    with mock.patch.object(live, "_png_bytes", slow):
        t = threading.Thread(target=j.run, args=(FakeClient(),))
        t.start()
        assert started.wait(10)
        t0 = time.time()
        j.doc()  # would hang until `gate` opens if rendering held the lock
        assert time.time() - t0 < 1.0
        gate.set()
        t.join(30)
    assert j.doc()["status"] == "ready"


def test_asking_for_more_than_the_archive_has_does_not_start_another_pass():
    b = LiveBuilder(FakeClient())
    j = b.get_or_start(1.0, 1.0, 0.2, 100)
    wait(j)
    n = j.doc()["progress"]["total"]
    assert n < 100  # the archive (the fake) has fewer images than asked for
    gen = j.gen
    assert j.extend(102) is False and j.status == "ready" and j.gen == gen and j.doc()["progress"]["total"] == n
