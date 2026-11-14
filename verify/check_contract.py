"""Offline contract check, run by `make verify-contract`.

1. Both schemas in contracts/ are valid JSON Schema 2020-12.
2. Every fixtures/*.json and every static/series/*/series.json validates
   against contracts/series.schema.json.
3. For `ready` documents, checks the schema cannot express:
   done + failed == total, len(frames) == done, indexes strictly increasing.
   For cached series also: data_origin is "real", and every frame PNG exists,
   is 8-bit, and matches grid.shape.

Extra series documents can be passed as arguments (checked like fixtures).
Exits non-zero on any failure. Never touches the network.
"""
import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAME_URL_PREFIX = "/api/frames/"


def load(path):
    with open(path) as f:
        return json.load(f)


def ready_invariants(doc):
    errors = []
    p = doc["progress"]
    if p["done"] + p["failed"] != p["total"]:
        errors.append(f"done + failed != total ({p['done']} + {p['failed']} != {p['total']})")
    if len(doc["frames"]) != p["done"]:
        errors.append(f"len(frames) {len(doc['frames'])} != progress.done {p['done']}")
    idx = [f["index"] for f in doc["frames"]]
    if any(b <= a for a, b in zip(idx, idx[1:])):
        errors.append("frame indexes are not strictly increasing")
    if idx and idx[-1] >= p["total"]:
        errors.append(f"frame index {idx[-1]} >= progress.total {p['total']}")
    return errors


def cached_series_checks(doc, series_dir):
    errors = []
    if doc["status"] != "ready":
        errors.append(f"cached series has status {doc['status']!r}, expected 'ready'")
        return errors
    if doc["data_origin"] != "real":
        errors.append(f"cached series has data_origin {doc['data_origin']!r}, expected 'real'")
    ny, nx = doc["grid"]["shape"]
    want_prefix = f"{FRAME_URL_PREFIX}{series_dir.name}/"
    for frame in doc["frames"]:
        url = frame["url"]
        if not url.startswith(want_prefix):
            errors.append(f"frame {frame['index']}: url {url!r} does not start with {want_prefix!r}")
            continue
        png = series_dir / "frames" / url[len(want_prefix):]
        if not png.is_file():
            errors.append(f"frame {frame['index']}: missing file {png.relative_to(ROOT)}")
            continue
        with Image.open(png) as im:
            if im.format != "PNG" or im.mode not in ("L", "P"):
                errors.append(f"frame {frame['index']}: {png.name} is {im.format}/{im.mode}, expected 8-bit PNG")
            if im.size != (nx, ny):
                errors.append(f"frame {frame['index']}: {png.name} is {im.size[0]}x{im.size[1]}, grid is {nx}x{ny}")
    return errors


def main(extra_paths):
    failures = 0

    def report(label, errors):
        nonlocal failures
        if errors:
            failures += 1
            print(f"FAIL {label}")
            for e in errors:
                print(f"     {e}")
        else:
            print(f"ok   {label}")

    schemas = {}
    for path in sorted((ROOT / "contracts").glob("*.schema.json")):
        schema = load(path)
        try:
            Draft202012Validator.check_schema(schema)
            report(f"{path.relative_to(ROOT)} is a valid schema", [])
        except Exception as e:  # jsonschema.SchemaError
            report(f"{path.relative_to(ROOT)} is a valid schema", [str(e).splitlines()[0]])
        schemas[path.name] = schema
    series_validator = Draft202012Validator(schemas["series.schema.json"])

    fixtures = sorted((ROOT / "fixtures").glob("*.json")) + [Path(p).resolve() for p in extra_paths]
    cached = sorted((ROOT / "static" / "series").glob("*/series.json"))
    if not fixtures:
        report("fixtures/*.json", ["no fixture found"])

    for path, is_cached in [(p, False) for p in fixtures] + [(p, True) for p in cached]:
        doc = load(path)
        errors = [
            f"{'/'.join(str(x) for x in e.absolute_path) or '(root)'}: "
            + (e.message if len(e.message) <= 200 else e.message[:80] + " ... " + e.message[-110:])
            for e in series_validator.iter_errors(doc)
        ]
        if not errors:
            if doc["status"] == "ready":
                errors += ready_invariants(doc)
            if is_cached:
                errors += cached_series_checks(doc, path.parent)
        try:
            label = str(path.relative_to(ROOT))
        except ValueError:
            label = str(path)
        report(label, errors)

    print(f"{len(fixtures)} fixture(s), {len(cached)} cached series checked; {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
