import threading
import time

import pytest

from pipeline import irsa
from pipeline.irsa import IrsaClient, IrsaError, Response


def test_never_more_than_eight_in_flight_across_tap_and_cutouts():
    lock = threading.Lock()
    state = {"now": 0, "max": 0, "calls": 0}

    def transport(method, url, data):
        with lock:
            state["now"] += 1
            state["calls"] += 1
            state["max"] = max(state["max"], state["now"])
        time.sleep(0.02)
        with lock:
            state["now"] -= 1
        return Response(200, {}, b"planeid,time_bounds_lower,uri\n" if method == "POST" else b"x")

    # Two separate client instances: the limit is process-wide, not per client.
    clients = [IrsaClient(transport), IrsaClient(transport)]
    threads = []
    for i in range(40):
        c = clients[i % 2]
        if i % 5 == 0:
            threads.append(threading.Thread(target=c.tap_rows, args=(1.0, 2.0)))
        else:
            threads.append(threading.Thread(target=c.fetch_cutout, args=(f"ibe/data/spherex/dr1/level2/x{i}.fits", 1.0, 2.0, 0.3)))
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert state["calls"] == 40
    assert state["max"] <= irsa.MAX_IN_FLIGHT == 8
    assert state["max"] == 8  # the fake is slow enough that the limit is actually reached


def test_retry_after_is_honoured_then_succeeds():
    seq = [Response(503, {"retry-after": "7"}, b"busy"), Response(503, {"retry-after": "3"}, b"busy"), Response(200, {}, b"ok")]
    sleeps = []
    c = IrsaClient(lambda m, u, d: seq.pop(0), sleep=sleeps.append)
    assert c.fetch_cutout("ibe/a.fits", 1, 2, 0.3) == b"ok"
    assert sleeps == [7.0, 3.0]


def test_cutout_gives_up_after_four_attempts():
    calls = []

    def transport(m, u, d):
        calls.append(1)
        return Response(503, {"retry-after": "1"}, b"busy")

    sleeps = []
    c = IrsaClient(transport, sleep=sleeps.append)
    with pytest.raises(IrsaError):
        c.fetch_cutout("ibe/a.fits", 1, 2, 0.3)
    assert len(calls) == 4
    assert len(sleeps) == 3  # no sleep after the last attempt


def test_non_retryable_status_fails_at_once():
    calls = []
    c = IrsaClient(lambda m, u, d: (calls.append(1), Response(404, {}, b""))[1], sleep=lambda s: None)
    with pytest.raises(IrsaError):
        c.fetch_cutout("ibe/a.fits", 1, 2, 0.3)
    assert len(calls) == 1


def test_tap_parses_csv():
    body = b"planeid,time_bounds_lower,time_bounds_upper,energy_bandpassname,uri,contentlength\np1,60800.7,60800.8,SPHEREx-D3,ibe/data/spherex/dr1/level2/a/level2_2025W19_1B_0116_1D3_spx_v.fits,1\n"
    c = IrsaClient(lambda m, u, d: Response(200, {}, body))
    rows = c.tap_rows(133.795129, -7.245147)
    assert rows[0]["time_bounds_lower"] == "60800.7"


def test_urls_and_keys():
    assert irsa.cutout_url("ibe/x.fits", 1.5, -2.5, 0.3).startswith("https://irsa.ipac.caltech.edu/ibe/x.fits?center=1.5")
    uri = "ibe/data/spherex/qr3/level2/2026W34_2A/l2b-v27-2026-243/2/level2_2026W34_2A_0233_2D2_spx_l2b-v27-2026-243.fits"
    assert irsa.observation_key(uri) == "2026W34_2A_0233_2D2"
    assert irsa.release_of(uri) == "qr3"
