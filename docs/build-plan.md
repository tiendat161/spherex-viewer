# Build plan (prototype)

Date: 2026-11-14. Status: plan only, no code written. Sources: [`PLAN.md`](PLAN.md) (prep plan, copied in today), [`../CLAUDE.md`](../CLAUDE.md), [`spike.md`](spike.md), [`contract.md`](contract.md), [`../contracts/series.schema.json`](../contracts/series.schema.json). Numbers are cited to those files; anything else is marked ESTIMATE or UNVERIFIED.

## Scope

The prototype serves a blink series for the five challenge targets from a pre-built cache. The browser talks only to our API.

| Constraint | How the plan meets it |
|---|---|
| Backend required, no browser calls to IRSA | IRSA sends no CORS header (spike §3). Only `pipeline/` contacts IRSA. `web/` calls relative `/api/...` paths and nothing else; a test greps the built bundle for `irsa.ipac.caltech.edu`. |
| Cache the 5 targets as static JSON and PNGs | `pipeline/` runs offline of the request path and writes `static/series/<id>/series.json` plus `frames/NN.png`. `api/` only reads those files. |
| Sonnet 5.5 for bulk work | Both build sessions run on `claude-sonnet-5-5`. This (planning) session keeps contract changes, merges and the pre-merge review. |
| At most 4 concurrent IRSA requests | One process-wide semaphore of 4 in a single IRSA client module, covering TAP and cutouts together. Spike §2 saw 9 to 15 of 20 parallel requests get 503; behaviour at 4 was not measured. |

Out of scope for the prototype: building a series live for arbitrary coordinates (first stretch item, see cut list). Coordinates that are not cached return `status: "error"` with a message saying so.

### The five targets

From the challenge text (`PLAN.md`). Positions are SIMBAD ICRS J2000 values recorded on 2026-11-08 in the prep repo's `learning-log.md` (Harvard mirror), except WISE 0855, which uses the challenge coordinates as given.

| `id` | Name | Cached request position | Note |
|---|---|---|---|
| `wise0855` | WISE 0855 | RA 133.795129°, Dec −7.245147° (challenge text, spike Targets) | Prep work found these match epoch about 2010.45, so the target sits about 126″ from grid centre in 2025 (spike §4); inside the 360″ half-width. Proper motion UNVERIFIED in spike. |
| `barnard` | Barnard's Star | SIMBAD J2000 17 57 48.498 +04 41 36.11, propagated to 2025.85 by its proper motion | Spike used a Gaia-based 2026.0 position (269.446268°, +4.768204°); the two must agree to a few arcsec or the build stops. |
| `epsindb` | Epsilon Indi B | SIMBAD J2000 22 04 10.595 −56 46 58.24, propagated to 2025.85 | About 4.7″/yr, so about 121″ from J2000 (ESTIMATE from the SIMBAD proper motion). |
| `rwaur` | RW Aurigae | SIMBAD J2000 05 07 49.566 +30 24 05.18, as is | Proper motion about 22 mas/yr: negligible. |
| `rdra` | R Draconis | SIMBAD J2000 16 32 40.227 +66 45 17.93, as is | Proper motion about 22 mas/yr: negligible. |

SPHEREx coverage for `epsindb`, `rwaur` and `rdra` has not been queried (UNVERIFIED): the spike only ran TAP for WISE 0855 (258 images) and Barnard's Star (358).

## Step 0: foundation commit (this session, before the two sessions start)

Worktrees only see committed files, and `contracts/`, `docs/`, `fixtures/` and `spike/` are still untracked. So first, on `main`:

1. Commit `contracts/`, `fixtures/`, `docs/`, `spike/`, `.gitignore`.
2. Add `contracts/targets.schema.json` (new contract, own commit): response of `GET /api/targets`, an array of `{id, name, ra, dec, position_note}`. The UI needs it to list the cached targets; nothing in the current contract provides it.
3. Add `verify/targets.json` with the five rows above (J2000 position, proper motion, source, and for WISE 0855 the as-given flag). The pipeline computes the propagated positions; they are not typed in by hand.
4. Add `verify/check_contract.py`, `requirements.txt`, and the Makefile targets in [Shared verify](#shared-make-verify). New dependency: `jsonschema` (needed to validate against the schema; not in `.venv` today).
5. Record the provisional answers to the contract's open decisions (below) in `docs/contract.md`.

After step 0, neither build session edits `contracts/`, `fixtures/`, `verify/`, `Makefile` or `docs/contract.md`. A session that needs a change stops and asks.

### Provisional answers to open decisions (contract.md numbering)

| # | Choice for the prototype |
|---|---|
| 1 | Coordinates used as given; no correction in the API. Propagation happens only when building `verify/targets.json` positions. |
| 2, 3 | 40 frames evenly spaced through the time-ordered list; order by `obs_mjd`. |
| 4 | `wavelength_um` from the cutout's `WCS-WAVE` extension at the target pixel. Timebox 1 h. If it cannot be evaluated, stop and ask: a made-up value is not acceptable, and a per-band value needs a cited table. |
| 5 | `flag_fraction` = fraction of grid pixels whose nearest source pixel has any `FLAGS` bit set, plus pixels with no coverage. Bit meanings unread; say so in the UI tooltip. |
| 6 | `obs_mjd` = TAP `time_bounds_lower`. |
| 7 | `asinh`; `vmin`/`vmax` = 1st and 99.5th percentile over all unflagged pixels of all frames in the series; unit from the header `BUNIT`; no `ZODI` subtraction. |
| 8, 9 | 6.2″, `[116, 116]`, as the schema fixes them. |
| 10 | Bilinear (`reproject.reproject_interp`, already installed). |
| 11 | Honour `retry-after`; up to 4 attempts per cutout, then the frame is failed. |
| 12 | Always HTTP 200 with `status` in the body; poll every 2 s. |
| 13 | A request matches a cached target if within 1″ of its cached position and `fov=0.2`, `max_frames=40`. |
| 14 | Prefer `dr1` when the same observation appears in both releases. |
| 15 | `url` = `/api/frames/<id>/NN.png`, a path on the API origin. |

## Session A brief: pipeline and API

- **Model:** `claude-sonnet-5-5`. **Branch / worktree:** `build/backend`.
- **Goal:** build the static cache for the five targets from real IRSA data, and a FastAPI service that serves it under the contract.

**Owns** (nobody else writes here):
- `pipeline/`: IRSA client (TAP join query from spike §1, cutout fetch, semaphore of 4, retry), frame selection, reprojection to the shared grid, stretch, PNG and `series.json` writer, CLI.
- `api/`: FastAPI app with `GET /api/series`, `GET /api/targets`, `GET /api/frames/<id>/NN.png`, and static serving of `web/dist` when it exists.
- `static/series/`: generated output, committed. ESTIMATE: 200 PNGs of 116×116 px, a few MB in total.
- `tests/pipeline/`, `tests/api/`.

**Reads, does not write:** `contracts/`, `fixtures/`, `verify/`, `spike/`. Raw FITS go to `.cache/` (gitignored), never to the repo. Set `SPHEREX_CACHE_DIR` to the main checkout's `.cache/` so the worktree reuses the spike's downloads.

**Contract parts used:** the whole of `series.schema.json` (it produces every field); request parameters and polling rules from `contract.md`; `targets.schema.json`; the shared-grid definition (TAN, ICRS, north up, east left, 6.2″, `[116, 116]`).

**Acceptance criteria:**
1. `make cache` builds all five targets with never more than 4 IRSA requests in flight (asserted by a test against a fake transport that counts concurrency).
2. Each `static/series/<id>/series.json` validates against the schema with `status: "ready"`, `data_origin: "real"`, `done + failed == total`, `len(frames) == done`, and at least 30 frames done. A target with fewer than 30 available images is reported to the user, not padded.
3. Every `frames[].url` resolves to an existing 8-bit PNG whose size equals `grid.shape`.
4. `GET /api/series` for each cached position returns that file's content; for an uncached position it returns a schema-valid `status: "error"`.
5. Orientation test: a synthetic source placed north-east of centre in a fake `TAN-SIP` image lands up-left in the output PNG. Synthetic inputs live only in tests and are labelled simulated.
6. Tests never touch the network. `make cache` is the only command that does.

**Verify command:** `make verify-backend`

**Budget:** 200 cutouts at about 4 MB and 6 to 13 s each (spike §2) is about 800 MB into `.cache/` and, 4 at a time, roughly 10 minutes before 503 retries (ESTIMATE; 12 of 40 sequential requests got 503 in the spike). Start the WISE 0855 build first and keep coding while it runs.

## Session B brief: frontend

- **Model:** `claude-sonnet-5-5`. **Branch / worktree:** `build/web`.
- **Goal:** a Vite single-page app that lists the five targets, loads a series from `/api/series`, and plays it as a blink sequence.

**Owns:**
- `web/`: app source, `web/mock/` (dev-only middleware that serves `fixtures/wise0855.json` and generated placeholder frames), unit tests, Playwright spec and config.

**Reads, does not write:** `contracts/`, `fixtures/`, `verify/`. Does not touch `pipeline/`, `api/`, `static/`.

**Contract parts used:** request parameters and polling rule; `status`, `error.message`, `progress.*` (loading bar, failed count); `data_origin` (badge); `grid.shape` and `grid.pixel_scale_arcsec` (canvas size, scale bar); `stretch` (legend, display only: the PNGs already have it applied); `frames[].index`, `obs_mjd`, `wavelength_um`, `url`, `flag_fraction` (player and per-frame readout); `targets.schema.json` (target picker).

**Acceptance criteria:**
1. Against the mock: the page shows a visible **SIMULATED** badge, plays 40 frames, and supports play/pause, step, and a frame slider. Each frame shows its date (from `obs_mjd`), wavelength and flag fraction.
2. `loading` responses show `done / total` and partial frames; `error` shows `error.message`. Both states are covered by unit tests using hand-built responses that validate against the schema.
3. A gap in `frames[].index` is shown as a skipped frame, not a crash.
4. `?ra=&dec=` in the URL selects the series (and the target picker sets it).
5. Images are drawn with nearest-neighbour scaling, north up, east left, with the request position marked and a note that a moving target may be off-centre.
6. The built bundle contains no IRSA hostname, and all requests go to relative `/api/` paths.
7. A Playwright run saves `verify/out/web-mock.png`, and the session inspects it.

**Verify command:** `make verify-web`

**New dependencies, with reasons:** Vite (build and dev proxy, already the intended stack in `REFERENCES.md`), Vitest (unit tests), Playwright (screenshot required by the done criteria). No UI framework unless the session argues for one. Aladin Lite is on the cut list, not in the brief.

## Shared `make verify`

To be added in step 0. Everything here runs offline.

```make
verify-contract:   # schema vs fixture, and vs every cached series
	.venv/bin/python verify/check_contract.py

test-backend:
	.venv/bin/python -m pytest tests

test-web:
	cd web && npm test

test: test-backend test-web

verify-backend: verify-contract test-backend
verify-web: verify-contract test-web
	cd web && npx playwright test          # mock mode, writes verify/out/web-mock.png

verify: verify-contract test
	.venv/bin/python verify/e2e.py         # starts the API, checks all 5 targets, screenshots each
```

`verify/check_contract.py` does three things and exits non-zero on any failure:
1. Checks that both schemas are valid JSON Schema 2020-12.
2. Validates every `fixtures/*.json`, and every `static/series/*/series.json` that exists, against `series.schema.json`.
3. For each `ready` document, checks what the schema cannot express: `done + failed == total`, `len(frames) == done`, indexes strictly increasing; for cached series also that each PNG exists and matches `grid.shape`.

`verify/e2e.py` (written at integration, step 3) starts the API serving `web/dist`, and for each row of `verify/targets.json` requests `/api/series`, validates it, requires `data_origin: "real"` and at least 30 frames, fetches the first and last PNG, and saves `verify/out/<id>.png` from Playwright.

Before step 3, `make verify` fails if either side is missing; that is intended. Sessions use their own command until then.

## Merge order

1. **Step 0** on `main`, then create both worktrees from it.
2. **`build/backend`** merges first, once `make verify-backend` passes with at least `wise0855` and `barnard` cached. The remaining three targets can land as follow-up commits on `main`, since they add files only under `static/series/`.
3. **`build/web`** rebases on the new `main`, then merges after `make verify-web` passes and one manual run against the real API.
4. **Integration** on `main`: add `verify/e2e.py`, run `make verify`, inspect the five screenshots, run the `reviewer` agent on the full diff, then deploy.

Backend goes first because it is the only side that can disprove the contract against real data; the frontend can keep working on the fixture meanwhile.

## Integration risks

| Risk | Why it is likely | Mitigation |
|---|---|---|
| Fixture and real output differ in ways the schema allows | The fixture's `url`, `stretch`, wavelengths and flags are placeholders (`fixtures/README.md`) | Step 2 of the merge order runs the web app against the real cache before merging; `check_contract.py` validates both. |
| Contract change mid-build | 15 open decisions; #4 (wavelength) may fail its timebox | Only this session edits `contracts/`, in its own commit; both sessions rebase. |
| A target has few or no SPHEREx images | Coverage for three targets was never queried | Session A runs the five TAP queries first (one at a time, about 10 to 45 s each) and reports counts before fetching cutouts. |
| Target is outside or far from centre of the field | High proper motion and the unresolved coordinate epoch (spike §4) | Positions for `barnard` and `epsindb` are propagated; `wise0855` stays as given by design and the UI says so. Whether each source is visible in the frames is checked by eye in step 4. |
| North/east flipped or transposed between pipeline and canvas | numpy is `(y, x)` with row 0 at the bottom in FITS, PNG row 0 at the top | Orientation test in session A; nearest-neighbour, untransformed drawing in session B; eyeball one frame against another survey in step 4. |
| IRSA throttling or outage during `make cache` | 30% 503 rate sequentially; TAP queue time 12 to 13 s (spike §1, §2) | Cache is resumable per frame from `.cache/`; verify never needs the network; failed frames are recorded, not hidden. |
| One shared stretch hides the source | Background may differ a lot across wavelength (contract decision 7, not measured) | Look at the first real series before building the other four; changing the percentile rule is a pipeline-only change. |
| Frame URLs break behind the dev proxy or on the host | `url` is a path on the API origin | Vite proxies `/api`; in production the API serves `web/dist`, so there is one origin. |
| `.venv` and `.cache` are missing in worktrees | Both are gitignored | Briefs say to use the main checkout's `.venv` and `SPHEREX_CACHE_DIR`. |
| Simulated data shown as real | Mock and fixture are easy to leave switched on | Mock exists only in the Vite dev server; the e2e check requires `data_origin: "real"` for all five. |

## Cut list

Cut from the top. `PLAN.md` sets the floor: keep the five targets and the live link.

1. Live on-demand build for arbitrary coordinates (not in the prototype anyway; the `loading` state stays in the UI and tests).
2. Aladin Lite, Gaia/WISE overlays, spectra, frame add/subtract, user-switchable stretch.
3. Free field-of-view choice (keep `fov=0.2` only).
4. Scale bar, stretch legend, flag tooltip wording.
5. Per-target Playwright screenshots: fall back to one screenshot plus the API checks for the other four, and say so in the README.
6. Fewer frames: build 20 per target instead of 40 (lower the 30-frame threshold with it, in `verify/targets.json`, as a visible change).
7. Fewer targets, last resort and against the floor: keep `wise0855` and `barnard`, whose archive queries are already known to work, and list the missing ones in the README.

Never cut: the `data_origin` badge, `make verify-contract`, the concurrency limit, or the no-IRSA-in-browser rule.

## Not decided here

- Hosting for the live link (needs a host that runs FastAPI and serves a few MB of static files).
- Whether `static/series/` being committed is acceptable under "no large datasets in the repo"; the plan assumes yes because it is a few MB of derived PNGs, with raw FITS kept in `.cache/`.
- The submission deadline (`PLAN.md`: unknown).
