# Project structure

Where things are and how they connect. Read this before searching the code.

**Keeping it current:** a commit that adds, moves or removes a source file updates this file in the same commit. `make verify-docs` (part of `make verify`) fails when a source file is not mentioned here, or when a file named here no longer exists. It cannot tell whether a description is still right, so when a file's job changes, change its line here too. Counts and sizes are left out on purpose because they go stale.

## How the pieces fit

```
                 make cache (offline rebuild: --offline)
IRSA archive ──────────────────────────────▶ pipeline/build.py ──▶ static/series/   (cached targets, in git)
     ▲                                                                   │ read
     │ live build for any other position or field of view                ▼
     └──────────────── pipeline/live.py (in memory) ◀──────────────── api/main.py ◀── browser (web/, built into web/dist)
```

- `contracts/` defines the JSON that `pipeline/` writes, `api/` returns and `web/` reads.
- `verify/` and `tests/` check that the three agree.
- Two code paths contact IRSA, both through the one client in `pipeline/irsa.py`: `make cache`, and the API's live builds. Setting `SPHEREX_LIVE=0` turns live builds off, which is how `make verify` stays offline.

## Request flow: what happens when a user asks for a position

1. **Browser.** `web/src/main.js` reads `?ra=&dec=&fov=` from the page URL (`parseLocation` in `web/src/model.js`) or takes the form values, and calls `load`. `load` calls `pollSeries` in `web/src/api.js`, which requests `GET /api/series?ra=&dec=&fov=&max_frames=` (`seriesUrl`) and repeats every `POLL_MS` until the status is final.
2. **API, cached path.** `series` in `api/main.py` validates the numbers (`allowed_fov` in `pipeline/grid.py`). For `fov` 0.2 it looks for a `static/series/<id>/series.json` whose grid centre is within `MATCH_ARCSEC` of the position and returns that file unchanged.
3. **API, live path.** Any other position, and any other field of view, goes to `LiveBuilder.get_or_start` in `pipeline/live.py`. It starts (or finds) a `LiveSeries` running in a background thread and returns its current document at once; the `load` parameter says how many frames to have loaded (the web app asks for 8, then more on request), and a larger `load` for a series that already exists extends it. Too many series running or waiting raises `LiveBusy`, which the API returns as a `status: "error"` document. With live builds off the API returns an error document instead.
4. **Live build.** `LiveSeries` queries the archive (`IrsaClient.tap_rows`; if TAP fails or takes over 90 s twice, `IrsaClient.sia_rows`, whose list may be incomplete and is reported as `progress.search: "sia2"` and not remembered; after TAP has failed, the next searches ask SIA2 first for `TAP_SKIP_S`, so a visitor does not wait for TAP again: `TapHealth`), picks frames (`select_frames` in `pipeline/select.py`), then for each one downloads the cutout, reads it (`pipeline/cutout.py`), subtracts the background (`pipeline/stack.py`) and resamples it onto the shared grid (`pipeline/grid.py`). Frames are kept in memory only.
5. **Stretch refresh.** The brightness mapping (`pipeline/stretch.py`) is recomputed as frames arrive (after 1, 2, 4, 8, … frames and once at the end). Each recompute re-renders every PNG and raises a counter that is added to frame URLs as `?v=<gen>`, so the browser fetches the new images. When all frames are in, `build_stacks` adds the stacked and difference images.
6. **Frames.** The browser loads each `url` from the document: `GET /api/frames/<id>/<name>`. The API serves the file from `static/series/<id>/frames/` if it exists, otherwise the PNG held in memory by the live series (sent with `Cache-Control: no-cache`).
7. **Display.** On every poll result `onUpdate` in `web/src/main.js` rebuilds the frame slots (`buildSlots`, `orderSlots`, `stackSlots` in `web/src/model.js`) and `render` / `drawCurrent` update the canvas, the progress text, the real or simulated badge and the per-frame readouts.

The cached path runs the same steps as 4 and 5, once, in `pipeline/build.py`, and writes the result with `pipeline/writer.py`.

## To change X, look in Y

| To change | Look in |
|---|---|
| A field in the series or targets JSON | `contracts/series.schema.json` or `contracts/targets.schema.json` first (own commit), then `docs/contract.md`, `pipeline/writer.py` and `pipeline/live.py` (both produce the document), `web/src/model.js`, `fixtures/wise0855.json` |
| Request parameters, validation, routes | `api/main.py` |
| The text of an error a visitor sees (archive down, no images, busy, rate limit, catalogue), and where the technical detail goes | `pipeline/messages.py` (texts), set in `pipeline/live.py` (`_fail`), `api/main.py`, `pipeline/catalogue.py`; for failures of the request itself `clientError` in `web/src/api.js`; shown by `onUpdate` in `web/src/main.js` (`#message`, text in the box, `error.detail` in its "i") |
| Allowed fields of view, pixel scale, grid size, which flag bits count | `pipeline/grid.py` (`FOVS_DEG`, `PIXEL_SCALE_ARCSEC`, `IGNORED_FLAG_BITS`); the frontend copy of the list is `FOVS_DEG` in `web/src/model.js` |
| Which images are picked for a series | `pipeline/select.py` |
| Archive queries, download limits, retries | `pipeline/irsa.py` (`MAX_IN_FLIGHT`, `CUTOUT_ATTEMPTS`, `TAP_ATTEMPTS`); how long the live path waits for TAP before the SIA2 backup: `TAP_LIVE_ATTEMPTS`, `TAP_LIVE_TIMEOUT_S`, `TAP_SKIP_S` in `pipeline/live.py` |
| Brightness mapping | `pipeline/stretch.py` |
| Background subtraction, visit grouping, stacked and difference images | `pipeline/stack.py` |
| Flux measurement: aperture and ring size, flag rule, error estimate | `pipeline/photometry.py` |
| Live build limits (how many at once, how many kept, frame counts, memory for kept pixels) | constants at the top of `pipeline/live.py` (`LIVE_FRAMES`, `MAX_LIVE_FRAMES`, `HOT_PIXEL_BYTES`); the first batch size and the "Load more" step are `INITIAL_LOAD` and `MORE_STEP` in `web/src/model.js` |
| The cached targets, their positions, frame counts, proper motion | `verify/targets.json`, read by `pipeline/targets.py`; then `make cache` |
| The flux charts: what is drawn, colours, tabs, what a click on a dot does | `web/src/main.js` (`renderCharts`); the data handling is `web/src/chart.js` |
| Spectrum at a clicked point: the measurement, the endpoint, the cached-target fallback | `pipeline/live.py` (`LiveSeries.spectrum`), `pipeline/cutout.py` (`wavelength_map`), `api/main.py` (`spectrum`), `contracts/spectrum.schema.json` (T58: the page no longer offers it; the web helpers `spectrumUrl`, `pixelToSky`, `clickToImage` and `pollSpectrum` are kept, unused) |
| WISE catalogue overlay: the query, the endpoint, the drawing | `pipeline/catalogue.py` (table, radius, row limit, error text), `api/main.py` (`catalogue`: rate limit, answer cache `CATALOGUE_TTL_S`), `pipeline/irsa.py` (`tap_query`, its own gate `CATALOGUE_IN_FLIGHT`), `contracts/catalogue.schema.json`; the drawing is `renderCatalogue` in `web/src/main.js` (`skyToPixel` in `web/src/model.js`), the toggle is under Advanced in `web/index.html` |
| Sky backdrop (Aladin Lite, DSS2 colour, behind the page): when it is on, the survey, the pinned CDN version, how wide it ends, the fallback | `web/src/sky.js` (`backdropEnabled`, `backdropFov`, `SURVEY_ROOTS`, `ALADIN_URL`); the one call is `showSky` in `load` in `web/src/main.js`; the box, label and dimming are `#sky`, `#sky-label` in `web/index.html` and the `.sky` rules in `web/src/style.css` |
| Explanatory text and the "i" icons: which text is shown and which is in a popover, hover / click / Escape behaviour, where a popover is placed | the markup (`<span class="info">` with a `.info-btn` and an `.info-pop`) is in `web/index.html`; the behaviour is `web/src/info.js` (`initInfo`, `placePopover`); texts that `main.js` fills in are set in `renderCharts`, `renderCatalogue` (`setCat`), `renderPlayNote`; the look is the `.info` rules at the end of `web/src/style.css` |
| Player behaviour: controls, blink, zoom, frame order, badge, readouts | `web/src/main.js`; pure logic it uses is in `web/src/model.js` |
| Page markup and styling | `web/index.html`, `web/src/style.css` |
| How the frontend fetches and polls | `web/src/api.js` |
| What the mock API returns in frontend development | `web/mock/plugin.js`, `web/mock/png.js`, `fixtures/wise0855.json` |
| What `make verify` checks | `Makefile`, `verify/check_contract.py`, `verify/check_docs.py`, `verify/e2e.py`, `web/e2e-real/real.spec.js` |
| Which release is used, refreshing for new data releases | `RELEASE_PREFERENCE` in `pipeline/select.py`, `make refresh`, `docs/data-updates.md` |
| Tasks and history | `docs/TASKS.md`, `docs/WORKLOG.md` |

## Top level

```
spherex-viewer/
├── contracts/        JSON schemas: the interface everyone builds against
├── pipeline/         Python: fetches SPHEREx data, builds the cache and live series
├── api/              Python: FastAPI service that serves series, frames and the web app
├── web/              JavaScript: the blink viewer the user sees
├── static/series/    Generated: the cached series for the acceptance targets
├── tests/            Python unit tests for pipeline/ and api/
├── verify/           Acceptance targets and the offline checks
├── fixtures/         A simulated example response for frontend development
├── docs/             Task board, work log, contract write-up, plans, this guide
├── spike/            Day-one feasibility scripts and their logs
├── .claude/          Claude Code agents and the preview launch config
├── Dockerfile        One container for the API and the built web app (see docs/deploy.md)
├── Makefile          dev, cache, test and verify commands
├── requirements.txt  Python dependencies the service needs (the container installs only these)
├── requirements-dev.txt  Test and check dependencies (jsonschema, pytest, httpx), on top of requirements.txt
├── CLAUDE.md         Working rules for AI-assisted sessions
├── README.md         Project summary
└── REFERENCES.md     Data sources, tools and AI-usage notes for the submission
```

Not in git: `.venv/` (Python environment), `.cache/` (raw downloads), `web/node_modules/`, `web/dist/` (built frontend), `verify/out/` (screenshots), `.claude/worktrees/`.

## Source folders

### `contracts/`

The source of truth for every interface. Read it before changing anything that crosses a boundary; a contract change goes in its own commit.

| File | Defines |
|---|---|
| `series.schema.json` | Response of `GET /api/series`: status, real or simulated label, progress, the shared grid, the stretch, the list of frames, and the optional stacks |
| `spectrum.schema.json` | Response of `GET /api/spectrum` (T14): the flux at a clicked position in every frame of a live series |
| `catalogue.schema.json` | Response of `GET /api/catalogue` (T15): AllWISE sources in a field, real catalogue data, positions not corrected for proper motion |
| `targets.schema.json` | Response of `GET /api/targets`: the cached targets and where each position comes from |

The prose explanation, with the choices made and the open decisions, is in `docs/contract.md`.

### `pipeline/`

Turns archive data into series. Used in two ways: `build.py` writes the static cache, and `live.py` builds a series in memory for the API.

| File | Does |
|---|---|
| `irsa.py` | The one IRSA client (`IrsaClient`): archive query (`tap_rows`, TAP, the complete list; `sia_rows`, SIA2, the live path's backup when TAP fails) and cutout download, a process-wide limit on requests in flight (8), retries on HTTP 503, de-duplication across data releases |
| `targets.py` | Reads `verify/targets.json`, converts positions to degrees, applies proper motion where the target asks for it; `sep_arcsec` |
| `select.py` | Picks which images make a series: evenly spaced in time (`select_frames`), one per wavelength band (`select_per_wavelength`), or for live series an order in which any first N spread over the dates and detector bands (`spread_order`); prefers releases in the order of `RELEASE_PREFERENCE` (`dr1` first) |
| `cutout.py` | Reads one downloaded cutout: image, flags, variance, sky coordinates, unit, wavelength and `MJD-AVG`; optionally the wavelength at every pixel (`wave_map`, for a clicked position); helpers for sky-to-pixel and pixel solid angle |
| `photometry.py` | Flux at a sky position on one native cutout: aperture photometry with a ring background, in microjansky with an uncertainty; says why when it cannot measure. Called by the build and the live path; the result is in each frame's `flux` and the series' `photometry` block |
| `catalogue.py` | AllWISE Source Catalog sources for a field through the IRSA client (`allwise_p3as_psd`); a service failure becomes an error document. Used by `GET /api/catalogue` |
| `grid.py` | The shared north-up grid: allowed fields of view, grid size, resampling every frame onto it, which pixels count as flagged |
| `stretch.py` | Computes one brightness mapping per series and converts frames to 8-bit |
| `stack.py` | Median background subtraction, grouping dates into visits, stacking per visit and detector band, difference from the first visit |
| `writer.py` | Writes `series.json` and the frame, stack and difference PNGs (with each frame's flux and the photometry method) |
| `build.py` | Command-line entry point for the cache: `python -m pipeline.build verify/targets.json [--only id] [--refresh-tap] [--offline]`. Resumes from `.cache/` |
| `live.py` | Live series for positions or fields of view that are not cached: `LiveBuilder` (queue, limits, which finished series keep their pixels) and `LiveSeries` (one per position and field of view, in memory, with progress; keeps each native cutout so `spectrum` can measure any clicked position; loads a first batch and is extended when a larger `load` is asked for) |
| `messages.py` | Every error text a visitor can see (T56), one plain sentence each, and `archive_failure` (archive down vs archive asking for fewer requests); the technical text goes to `error.detail` and the server log |
| `tapcache.py` | Remembers the archive's answer to "which images cover this position" for live series on disk (`.cache/tap/live/`, a week), so a repeated position, also after a restart, skips the slow search |
| `livestore.py` | Keeps finished live series on disk (`.cache/live-series/`, newest 30, a week): document data and PNGs, no pixels, so a restart does not lose them. A restored series shows at once and is rebuilt from the remembered archive rows when its pixels are needed (`LiveBuilder.revive`) |
| `tapcount.py` | Small helper that prints how many archive images cover each target |

Environment: `SPHEREX_CACHE_DIR` moves the raw download folder (default `.cache/`); finished live series are kept under `live-series/` in it.

### `api/`

`main.py` is the whole service (`create_app`).

- `GET /api/targets` lists the cached targets.
- `GET /api/series?ra=&dec=&fov=&max_frames=&load=` returns the cached series for that position, or starts, extends and reports a live build (`load`: frames to have loaded, live only). Every failure is a contract-valid `status: "error"` document, not an HTTP error.
- `GET /api/spectrum?ra=&dec=&fov=&at_ra=&at_dec=&load=` (`load=0`: use the series as loaded, never extend it) returns the flux at the clicked position `at_ra, at_dec` in every frame of the live series at `ra, dec, fov` (started if needed, also at a cached position: the cached series has no cutouts on the server). Polled like `/api/series`.
- `GET /api/frames/<id>/<name>` serves a frame (`NN.png`), stack (`s_<band>_<visit>.png`) or difference (`d_<band>_<visit>.png`) image, from disk or from a live series.
- Any other `/api/` path is a 404. Everything else is served from `web/dist`, so the app and the API share one origin.

Environment: `SPHEREX_LIVE=0` turns live builds off; `SPHEREX_SERIES_DIR` points at a different cache folder.

### `web/`

The frontend, built with Vite and no UI framework. It only ever calls relative `/api/` paths.

**Naming (T49):** the page says "epoch" wherever the code and the contract say "visit" (a group of observation dates); only user-visible text changed. "Catalogue epoch" (the date a catalogue position refers to) is a different thing and is always written in full.

| Path | Holds |
|---|---|
| `index.html`, `src/style.css` | Page markup and styling: the top bar (target dropdown, RA and Dec boxes), the image with its sliders, the buttons, and the folded "Advanced" settings |
| `src/model.js` | Pure helpers, no DOM: URL parsing and building, field-of-view list, frame slots and ordering, visits and the wavelength pad (`visitsOf`, `padSpec`, `labelIndexes`, `stepWavelength`, `stepVisit`, `cycleVisit`, `pingPong`), blink pair, zoom rectangle, scale bar, progress text, date conversion, splitting a pasted "RA Dec" (`splitCoordinates`), the one-line caption (`captionText`), `imageToBox`, and the helpers of the removed clicked-point feature (T58, unused by the page: `spectrumUrl`, `pixelToSky`, `clickToImage`) |
| `src/chart.js` | Pure helpers for the Spectrum and Light curve charts: which frames have a flux, tick values, where each point is drawn, the reasons in words. No DOM; the drawing is in `main.js` (`renderCharts`) |
| `src/sky.js` | Sky backdrop (T50): loads Aladin Lite from a pinned CDN release at run time (fetched, checked against a pinned SHA-384, imported from a blob URL), shows the DSS2 colour survey (first HiPS server that answers) dimmed behind the page, starting on the whole sky as a SIN-projection globe (360 degrees across, so the sphere fits) when the page is idle after loading (`idleSky`), and flying to the position on Load (`showSky`); off on narrow screens, without WebGL, for automated browsers (`?backdrop=on` forces it) and with `?backdrop=off`; the backdrop and its label appear only after one survey tile has loaded; any failure leaves the page as it was |
| `src/info.js` | The "i" icon (T54): wires every `.info` in the page. Hover shows the popover and leaving hides it, a click pins it and a second click closes it, Escape and a click elsewhere close it, keyboard focus shows it, a tap toggles it. The popover is moved to `<body>`, so no panel covers it, and kept inside the screen. `infoVisible` and `placePopover` are pure and unit tested |
| `src/api.js` | `fetchTargets`, `pollSeries`, and `pollSpectrum` (T58: unused by the page, kept with its tests) |
| `src/main.js` | The player: target list, form, canvas, controls, the target dropdown and paste handling, the Combined and Single images toggle, the visit slider (for stacks and frames) and the vertical wavelength slider (`renderPad`), "Load more" and "Load all" for a live series, the Spectrum and Light curve panel (`renderCharts`), the visit and wavelength step buttons, the play loop (across visits, through wavelengths, or plain frames), badge, readouts |
| `mock/plugin.js`, `mock/png.js` | Dev-only stand-in for the API (`npm run dev:mock`): serves the fixture and generated placeholder frames, and simulated catalogue sources for `/api/catalogue`, labelled simulated. Never part of a build |
| `test/model.test.js`, `test/api.test.js`, `test/chart.test.js`, `test/sky.test.js`, `test/info.test.js` | Vitest unit tests for the modules |
| `test/bundle.test.js` | Checks the built bundle contains no archive hostname |
| `test/helpers.js` | Schema validators for the tests, built from `contracts/` |
| `e2e/web-mock.spec.js` | Playwright spec against the mock (`make verify-web`); config `playwright.config.js`; `E2E_BROWSERS=chromium,firefox,webkit` adds browsers (`make verify-browsers`) |
| `e2e-real/real.spec.js` | Playwright spec against the real API, one test per target, run by `verify/e2e.py`; config `playwright.real.config.js` |
| `vite.config.js`, `vitest.config.js` | Build and test configuration; the dev server proxies `/api` to port 8000 |
| `package.json` | Scripts: `dev`, `dev:mock`, `build`, `test`, `e2e` |

## Data folders

### `static/series/`

Generated by `pipeline/build.py` and committed. One folder per target id from `verify/targets.json`, each with:

- `series.json`: the exact response the API returns for that target, marked `data_origin: "real"`;
- `frames/`: 8-bit PNGs. `NN.png` is one frame, `s_<band>_<visit>.png` a stack, `d_<band>_<visit>.png` a difference image. A missing frame number is an image that failed to download.

The cache holds the 0.2° field of view only. Do not edit by hand; rebuild with `make cache`.

### `fixtures/`

`wise0855.json` is an example `ready` response marked `data_origin: "simulated"`. `fixtures/README.md` lists which of its fields are real and which are placeholders. It exists so the frontend and the contract check can run without the backend.

### `.cache/` (not in git)

Raw material: archive query results (`tap/`), downloaded cutout files (`cutouts/<id>/`), the SPHEREx Explanatory Supplement (`expsupp/`), and leftovers from the spike. Safe to delete, but the next `make cache` would download everything again.

## Checking folders

### `tests/`

Pytest unit tests; none touches the network.

| File | Covers |
|---|---|
| `pipeline/synth.py` | Builds synthetic cutouts, labelled simulated, for the tests below |
| `pipeline/test_grid.py` | Resampling, orientation, the flag mask |
| `pipeline/test_select.py` | Frame selection and release de-duplication |
| `pipeline/test_irsa.py` | The concurrency limit and retries |
| `pipeline/test_targets.py` | Position parsing and proper motion |
| `pipeline/test_stack.py` | Background subtraction, visits, stacks, differences |
| `conftest.py` | Replaces the per-pixel wavelength plane in every test (synthetic cutouts have no WCS-WAVE table) |
| `pipeline/test_wave_map.py` | The real per-pixel wavelength plane on a simulated WCS-WAVE table: agreement with the single-position lookup, bad tables refused, a frame without a map stays in the series |
| `pipeline/test_spectrum.py` | Spectrum at a clicked position: off-centre source, wavelength at the clicked pixel, errors, memory budget |
| `pipeline/test_flux_series.py` | Flux in the series document: live and cached paths, flagged apertures, the schema's flux rules |
| `pipeline/test_photometry.py` | Flux recovery, background independence, error estimate, flagged and NaN pixels, off-image position |
| `pipeline/test_catalogue.py` | Catalogue query text, row parsing, truncation, service down (fake transport) |
| `pipeline/test_build.py` | The cache build end to end on synthetic data |
| `pipeline/test_live.py` | Live series: progress, stretch refresh, limits, staged loading and extension |
| `pipeline/test_messages.py` | The visitor texts: no developer words, archive down is never worded as "no data", the detail is kept |
| `pipeline/test_livestore.py` | Finished series surviving a restart: same document and PNGs, rebuilt to measure or extend, newest kept, old and damaged entries ignored |
| `pipeline/test_tapcache.py` | Remembered archive searches: matching, expiry, damaged files, skipping the search after a restart |
| `api/test_api.py` | The endpoints, cached and live |

### `verify/`

| File | Does |
|---|---|
| `targets.json` | The acceptance targets: source positions, proper motions, field of view, frame counts and minimums, selection rule |
| `check_contract.py` | `make verify-contract`: validates the schemas, the fixture and every cached series, and that every frame PNG exists at the right size |
| `check_docs.py` | `make verify-docs`: every source file is mentioned in this guide, and every file this guide names exists |
| `e2e.py` | `make verify`: builds the web app, starts the API with live builds off, checks each target through the API and in a browser, saves `verify/out/<id>.png` (`verify/out/<browser>/` for Firefox/WebKit) |

## Documentation and history

### `docs/`

| File | Holds |
|---|---|
| `structure.md` | This file |
| `TASKS.md` | The task board: todo, in progress, done, with the files each task touches |
| `WORKLOG.md` | What was done, why, and what is still missing, newest first |
| `data-updates.md` | How to refresh the cached targets for a new data release, and where the release preference is set |
| `SUBMISSION.md` | Submission pack (T62): requirements checklist, form text, demo script, pre-submission checklist, freeze list, repository checks |
| `contract.md` | The API contract in prose, the choices made and the open decisions |
| `PLAN.md` | The pre-hackathon prep plan: goal, schedule, challenge text, open questions |
| `spike.md` | Measurements from the feasibility spike: query times, cutout sizes, 503 rates, CORS, coordinate epoch |
| `deploy.md` | Running the container, its settings, what a host must provide (one instance), what was and was not checked |
| `build-plan.md` | The Day 1 build plan: session briefs, verify design, merge order, risks, cut list. Historical |

### `spike/`

The throwaway scripts behind `docs/spike.md` and the logs they produced. Kept as evidence for the measurements; nothing imports them.

### `.claude/`

`agents/` defines three helper agents (researcher, reviewer, verifier). `launch.json` tells the Claude desktop preview pane how to start the API.

## Commands

| Command | Does | Network |
|---|---|---|
| `make dev` | Starts the API on port 8000, serving `web/dist` (build it first with `cd web && npm run build`). Live builds are on | IRSA, for uncached positions |
| `cd web && npm run dev` | Vite dev server on port 5173, proxying `/api` to port 8000 | No |
| `cd web && npm run dev:mock` | Vite dev server with the mock API, no backend needed | No |
| `make cache` | Rebuilds `static/series/` from the archive | Yes, IRSA |
| `make test` | Backend and frontend unit tests | No |
| `make verify-contract` | Schema and cache consistency check | No |
| `make verify-docs` | This guide against the files on disk | No |
| `make verify-backend`, `make verify-web` | Contract check plus one side's tests (the web one also runs the mock Playwright spec) | No |
| `make verify` | Contract, docs and unit checks, then the end-to-end run on every acceptance target | No |
