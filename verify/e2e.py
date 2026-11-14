"""End-to-end check over every acceptance target, run by `make verify`.

1. Builds the web app (web/dist).
2. Starts the API on a free local port, serving web/dist and static/series.
3. For every target in verify/targets.json: finds it in GET /api/targets, requests
   GET /api/series for its position, validates the response against the contract,
   and requires status "ready", data_origin "real", at least `min_frames` frames,
   and a fetchable PNG for the first and last frame. Also checks that an uncached
   position returns a schema-valid "error".
4. Runs the Playwright real-data spec, which loads each target in a browser and
   saves verify/out/<id>.png.

Uses only the local cache: nothing here contacts IRSA. Exits non-zero on any failure.
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def load(path):
    with open(path) as f:
        return json.load(f)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(base, path):
    with urllib.request.urlopen(base + path, timeout=20) as r:
        return r.status, r.headers.get("content-type", ""), r.read()


def get_json(base, path):
    status, _, body = get(base, path)
    return status, json.loads(body)


def wait_until_up(base, proc, seconds=20):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if proc.poll() is not None:
            raise SystemExit(f"API exited early with code {proc.returncode}")
        try:
            get(base, "/api/targets")
            return
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.2)
    raise SystemExit("API did not start in time")


def schema_errors(validator, doc):
    return [f"{'/'.join(str(x) for x in e.absolute_path) or '(root)'}: {e.message[:160]}" for e in validator.iter_errors(doc)]


def check_api(base, cfg):
    """Returns (failures, browser_targets)."""
    series_v = Draft202012Validator(load(ROOT / "contracts" / "series.schema.json"))
    targets_v = Draft202012Validator(load(ROOT / "contracts" / "targets.schema.json"))
    failures, browser_targets = [], []

    _, listed = get_json(base, "/api/targets")
    errs = schema_errors(targets_v, listed)
    if errs:
        return [f"/api/targets: {e}" for e in errs], []
    by_id = {t["id"]: t for t in listed}
    wanted = [t["id"] for t in cfg["targets"]]
    if sorted(by_id) != sorted(wanted):
        failures.append(f"/api/targets lists {sorted(by_id)}, verify/targets.json has {sorted(wanted)}")

    for tid in wanted:
        errs = []
        t = by_id.get(tid)
        if t is None:
            failures.append(f"{tid}: not listed by /api/targets")
            print(f"FAIL {tid}: not listed")
            continue
        q = f"/api/series?ra={t['ra']}&dec={t['dec']}&fov={cfg['fov']}&max_frames=102"  # the API ceiling; each series returns its own frame count
        status, doc = get_json(base, q)
        if status != 200:
            errs.append(f"HTTP {status}")
        errs += schema_errors(series_v, doc)
        if not errs:
            if doc["status"] != "ready":
                errs.append(f"status is {doc['status']!r}: {doc.get('error', {}).get('message', '')}")
            else:
                p = doc["progress"]
                if doc["data_origin"] != "real":
                    errs.append(f"data_origin is {doc['data_origin']!r}, expected 'real'")
                if p["done"] < cfg["min_frames"]:
                    errs.append(f"{p['done']} frames done, need at least {cfg['min_frames']}")
                if len(doc["frames"]) != p["done"] or p["done"] + p["failed"] != p["total"]:
                    errs.append(f"progress {p} does not match {len(doc['frames'])} frames")
                c = doc["grid"]["center"]
                if abs(c["ra"] - t["ra"]) > 1e-9 or abs(c["dec"] - t["dec"]) > 1e-9:
                    errs.append(f"grid.center {c} differs from the requested position")
                for frame in (doc["frames"][:1] + doc["frames"][-1:]):
                    try:
                        s, ctype, body = get(base, frame["url"])
                        if s != 200 or not ctype.startswith("image/png") or not body.startswith(PNG_MAGIC):
                            errs.append(f"{frame['url']}: HTTP {s}, {ctype}, not a PNG")
                    except urllib.error.URLError as e:
                        errs.append(f"{frame['url']}: {e}")
        if errs:
            failures += [f"{tid}: {e}" for e in errs]
            print(f"FAIL {tid}")
            for e in errs:
                print(f"     {e}")
        else:
            p = doc["progress"]
            print(f"ok   {tid}: real, {p['done']} of {p['total']} frames ({p['failed']} failed)")
            browser_targets.append({"id": tid, "ra": t["ra"], "dec": t["dec"], "done": p["done"], "total": p["total"]})

    # A position that is not cached must give a schema-valid error, not a crash.
    _, doc = get_json(base, "/api/series?ra=10&dec=10")
    errs = schema_errors(series_v, doc)
    if doc.get("status") != "error":
        errs.append(f"uncached position returned status {doc.get('status')!r}, expected 'error'")
    if errs:
        failures += [f"uncached position: {e}" for e in errs]
        print("FAIL uncached position")
    else:
        print("ok   uncached position returns a contract-valid error")
    return failures, browser_targets


def main():
    cfg = load(ROOT / "verify" / "targets.json")
    web = ROOT / "web"

    print("== build web")
    subprocess.run(["npm", "run", "build", "--silent"], cwd=web, check=True)

    port = free_port()
    base = f"http://127.0.0.1:{port}"
    print(f"== start API on {base}")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "api.main:app", "--port", str(port), "--log-level", "warning"],
        cwd=ROOT,
        env=dict(os.environ, SPHEREX_LIVE="0"),  # cache only: this check must not contact IRSA
    )
    try:
        wait_until_up(base, proc)
        print("== API checks")
        failures, browser_targets = check_api(base, cfg)

        print("== browser checks")
        if browser_targets:
            env = dict(os.environ, E2E_BASE_URL=base, E2E_TARGETS=json.dumps(browser_targets))
            r = subprocess.run(["npx", "playwright", "test", "--config", "playwright.real.config.js"], cwd=web, env=env)
            if r.returncode != 0:
                failures.append("Playwright real-data spec failed")
            for t in browser_targets:
                shot = ROOT / "verify" / "out" / f"{t['id']}.png"
                if not shot.is_file() or shot.stat().st_mtime < time.time() - 300:
                    failures.append(f"{t['id']}: no fresh screenshot at {shot.relative_to(ROOT)}")
        else:
            failures.append("no target passed the API checks, browser checks skipped")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()

    n = len(cfg["targets"])
    if failures:
        print(f"\nverify FAILED ({len(failures)} problem(s) over {n} targets)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"\nverify passed: {n} targets, screenshots in verify/out/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
