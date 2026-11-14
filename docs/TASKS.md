# Tasks

The single task board for this project. Status is one of `todo`, `in progress`, `done`.
Details of finished work (what, why, what is still missing) are in [`WORKLOG.md`](WORKLOG.md).

## How to use this file

- **Dat edits this file often** (adds, rewords, reorders, re-prioritises). Always re-read it at the start of a session and before picking a task. Never overwrite or revert rows you did not change.
- **One task per session.** Before starting, set its status to `in progress` and put the branch or session name in the Owner column. Change only your own row.
- **Check "Touches" before starting.** Two tasks that touch the same files should not run at the same time; `web/src/main.js` is the usual clash.
- **When done:** set status to `done`, add the commit hash, and add an entry to `WORKLOG.md`, all in the same branch as the work.
- New ideas go at the bottom of Todo with the next free ID. IDs are never reused.

## In progress

| ID | Task | Owner | Touches |
|---|---|---|---|
| | *(none)* | | |

## Todo

Priority: P1 = needed for the challenge's core objective or the submission, P2 = an optional consideration from the challenge text, P3 = nice to have.

| ID | P | Task | Challenge item | Touches | Notes |
|---|---|---|---|---|---|
| T10 | P1 | Deploy a public link | "public-facing web tool" | new `Dockerfile` or hosting config, `README.md` | Not deployed anywhere. Live builds need a running Python backend; a static-only host would be cached targets only. Independent of all other tasks. |
| T12 | P1 | Submission paperwork: rewrite `README.md`, finish `REFERENCES.md`, demo video | submission | `README.md`, `REFERENCES.md` | README still says "generic scaffolding only". Submission deadline is still unknown: check first. Independent of code tasks. |
| T14 | P2 | Spectrum on click: brightness of the clicked point across all bands | "Extra kudos if your tool can generate spectra on the fly" | `contracts/`, `pipeline/` (new per-frame flux data), `api/main.py`, `web/src/main.js` | Needs per-frame flux values, which the 8-bit PNGs do not carry. Clashes with T13 and T15 in `main.js`. |
| T15 | P2 | Overlay Gaia or WISE catalogue positions | "overlay astronomical data from other telescopes" | `api/main.py` (catalogue query), `web/src/main.js`, `web/index.html` | Would also answer where WISE 0855 and Epsilon Indi B should be. Aladin Lite was the planned route. |
| T16 | P2 | Deeper stacks for Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis | "add together ... to improve the signal-to-noise" | `verify/targets.json` (`stack_images`), `static/series/`, `.cache/` | They stack only their 35–40 cached images (1–3 per detector per visit). A full fetch was started and stopped (about 14 images a minute). Suggested: `stack_images: 120`. Barnard's Star already has 170 cutouts cached. Contacts IRSA. Data only: no code clash. |
| T17 | P2 | WISE 0855: show where the object should be now | test target | `verify/targets.json`, `pipeline/targets.py`, or overlay via T15 | Nothing identified at the marker. Challenge coordinates match about epoch 2010; the object should be about 126″ away. Proper motion value is unverified. Ask the organisers which epoch they mean. |
| T18 | P2 | Retry the 8 failed frames (Barnard's Star 3, R Draconis 5) | test targets | `static/series/`, `.cache/` | `make cache` resumes from `.cache/`. Contacts IRSA. Can be done together with T16. |
| T19 | P2 | Sexagesimal input (`08h55m10.831s -7d14m42.53s`) | "enter the coordinates" | `web/src/model.js`, `web/index.html`, `web/test/` | The form takes decimal degrees only; the challenge gives WISE 0855 in sexagesimal. Small. |
| T20 | P2 | Flag detail: per-pixel flag overlay or a breakdown by flag bit | "display metadata, like contamination flags" | `pipeline/grid.py`, `pipeline/writer.py`, `contracts/`, `web/src/main.js` | Only a flagged fraction per frame is shown today. |
| T21 | P2 | Make data-release updates easy | "easy to update with the latest data releases" | `pipeline/select.py`, `pipeline/irsa.py`, `Makefile`, docs | `dr1` is preferred over `qr3` in code; a refresh is a manual `make cache --refresh-tap`. Document or automate. |
| T22 | P3 | Keep live series across restarts | none | `pipeline/live.py`, `api/main.py` | Live results are in memory only (30 most recent). Matters once deployed (T10). |
| T23 | P3 | Run the `reviewer` agent over the full diff since Day 1 | none | read-only | Never done; was step 4 of the Day 1 merge order. |
| T24 | P3 | Epsilon Indi B: confirm what the bright object at the field edge is and whether the target is visible | test target | none, or T15 | Presumed Epsilon Indi A, not checked. |
| T25 | P3 | Check the frontend outside Chromium | none | `web/playwright*.config.js` | Only Chromium has been tested. |
| T26 | P3 | Remove the merged Day 1 worktrees and branches (`claude/build-backend-2cca9d`, `claude/build-web-cb39ff`) | none | git only | Fully merged, no uncommitted work. Needs Dat's go-ahead. |
| T29 | P1 | Store flux measurements with actual timestamps | "Store measurements with actual timestamps" | `contracts/` (own commit first), `docs/contract.md`, `pipeline/writer.py`, `pipeline/build.py`, `pipeline/live.py`, `api/main.py`, `fixtures/wise0855.json` | Needs T28. Decide which timestamp is stored: `time_bounds_lower` from the archive query (used for `obs_mjd` today) or the cutout's `MJD-AVG`; store both if they differ, and say which is which. Measurements must work on the cached (offline) and the live path. |
| T30 | P1 | Display the spectrum and the light curve | "Display spectrum and light curve" | `web/src/main.js` (clashes with T14, T15, T20), new chart module, `web/index.html`, `web/src/style.css` | Needs T29. Spectrum: flux against wavelength. Light curve: flux against time, one series per band or per wavelength range (flux at different wavelengths is not one curve). Mark real data in the chart, show error bars. |
| T31 | P2 | Decide TAP or SIA2 for the archive search, and confirm QR3 is covered | "Search DR1 and QR3 through SIA2" | `pipeline/irsa.py`, `pipeline/select.py`, `docs/PLAN.md`, `REFERENCES.md` | Today the search is a TAP query (`IrsaClient.tap_rows`) and `dr1` is preferred over `qr3`. Check the challenge text and `docs/spike.md` for whether SIA2 is required and whether QR3 rows actually come back. Switch only if required; otherwise document the choice. Contacts IRSA. |
| T32 | P2 | Validate and tune the photometry | none | `pipeline/photometry.py`, `tests/pipeline/`, docs | T28 uses an aperture, annulus and flag rule that are first choices, not tuned. Compare against a source with a known brightness (source and value to be found, not assumed), check the aperture size against the real PSF, decide whether an aperture correction is needed, and handle crowded fields and moving objects (WISE 0855, Barnard's Star). |

### Which tasks can run at the same time

- **Independent of everything:** T10, T12, T16 + T18 (data only), T23, T25, T31.
- **Share `web/src/main.js`, run one at a time or expect a merge:** T13, T14, T15, T20. T19 touches only `model.js` and `index.html` and is small enough to merge easily.
- **Change the contract, so each needs its own contract commit first:** T14, T20, T29.
- **Flux chain, in order:** T28, then T29, then T30. T14 (spectrum on click) builds on the same flux values and should be reconciled with T29 and T30 before starting.

## Done

| ID | Task | Challenge item | Commits |
|---|---|---|---|
| T01 | Day 1 prototype: pipeline, API, blink viewer, five cached targets, `make verify` | core objective, test targets | up to `2a34741` |
| T02 | Coordinates in the URL (`?ra=&dec=`) | "query your tool by including coordinates in the URL" | Day 1 |
| T03 | Per-frame metadata: date, wavelength, flagged fraction, REAL/SIMULATED badge | "display metadata" (partly, see T20) | Day 1 |
| T04 | WISE 0855: one frame per wavelength band, 102 frames from 258 images | "display those 102 infrared bands" | `76abdcf`, `862af65`, `5bd8141`, `4bf12f8` |
| T05 | Zoom and "Blink widest pair" | spotting motion | `7a165e9` |
| T06 | Live series for any RA/Dec | "Users will enter the coordinates of a patch of sky" | `d1b0575`, `c17c5bb` |
| T07 | Median background subtraction per image | less flicker in a time-ordered blink | `6727df2`, `c17c5bb` |
| T08 | Stacked visits per detector band, difference from first visit, time or wavelength frame order | "add together all the data taken by each of the six detector arrays", "add together or subtract images taken at different times" | `d1b0575`, `6727df2`, `c17c5bb`, `cf89aa9`, `b6f9771` |
| T09 | "Mark centre" toggle (circle hidden by default) | none | `cf89aa9` |
| T11 | Push `main` to `origin` | none | pushed up to `ac6e722` |
| T13 | Field-of-view selector: 0.1°, 0.2° (default), 0.5°, 1°; `&fov=` in the URL; wide-field wavelength note | "Let users choose the field of view" | `07fc9f5` (contract), `1703a89`, `cb845e5` |
| T27 | Structure guide brought up to date, `CLAUDE.md` points to it, `make verify-docs` fails when a source file is missing from it | none | `3ab1d85`, `18f595a`, `c8f4e76` |
| T28 | Flux extraction in Python: aperture photometry on native cutouts (`pipeline/photometry.py`), checked on the cached real cutouts. Not stored or shown yet (T29, T30) | "Extract flux measurements using Python" | `35c9528` |
