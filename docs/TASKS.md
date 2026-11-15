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
| T12 | Submission paperwork: README, REFERENCES (demo video not started) | t12-readme | `README.md`, `REFERENCES.md` |
| T41 | Cache three famous positions as demo targets (Orion M42, Eagle M16, Andromeda M31) so a demo never waits for the archive | parked on branch `t41-demo-targets` (entries added, series not built: the archive search service was down, HTTP 502). To finish: when the archive answers, on that branch run `python -m pipeline.build verify/targets.json --only m42 m16 m31`, then `--offline` for flux, then `make verify` | `verify/targets.json`, `static/series/`, `tests/pipeline/test_targets.py` |

## Todo

Priority: P1 = needed for the challenge's core objective or the submission, P2 = an optional consideration from the challenge text, P3 = nice to have.

| ID | P | Task | Challenge item | Touches | Notes |
|---|---|---|---|---|---|
| T12 | P1 | Submission paperwork: rewrite `README.md`, finish `REFERENCES.md`, demo video | submission | `README.md`, `REFERENCES.md` | README still says "generic scaffolding only". Submission deadline is still unknown: check first. Independent of code tasks. |
| T14 | P2 | Spectrum on click: brightness of the clicked point across all bands | "Extra kudos if your tool can generate spectra on the fly" | `contracts/`, `pipeline/` (new per-frame flux data), `api/main.py`, `web/src/main.js` | Needs per-frame flux values, which the 8-bit PNGs do not carry. Clashes with T13 and T15 in `main.js`. |
| T15 | P2 | Overlay Gaia or WISE catalogue positions | "overlay astronomical data from other telescopes" | `api/main.py` (catalogue query), `web/src/main.js`, `web/index.html` | Would also answer where WISE 0855 and Epsilon Indi B should be. Aladin Lite was the planned route. |
| T16 | P2 | Deeper stacks for Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis | "add together ... to improve the signal-to-noise" | `verify/targets.json` (`stack_images`), `static/series/`, `.cache/` | They stack only their 35–40 cached images (1–3 per detector per visit). A full fetch was started and stopped (about 14 images a minute). Suggested: `stack_images: 120`. Barnard's Star already has 170 cutouts cached. Contacts IRSA. Data only: no code clash. |
| T17 | P2 | WISE 0855: show where the object should be now | test target | `verify/targets.json`, `pipeline/targets.py`, or overlay via T15 | Nothing identified at the marker. Challenge coordinates match about epoch 2010; the object should be about 126″ away. Proper motion value is unverified. Ask the organisers which epoch they mean. |
| T18 | P2 | Retry the 8 failed frames (Barnard's Star 3, R Draconis 5) | test targets | `static/series/`, `.cache/` | `make cache` resumes from `.cache/`. Contacts IRSA. Can be done together with T16. |
| T20 | P2 | Flag detail: per-pixel flag overlay or a breakdown by flag bit | "display metadata, like contamination flags" | `pipeline/grid.py`, `pipeline/writer.py`, `contracts/`, `web/src/main.js` | Only a flagged fraction per frame is shown today. |
| T22 | P3 | Keep live series across restarts | none | `pipeline/live.py`, `api/main.py` | Live results are in memory only (30 most recent). Matters once deployed (T10). |
| T23 | P3 | Run the `reviewer` agent over the full diff since Day 1 | none | read-only | Never done; was step 4 of the Day 1 merge order. |
| T24 | P3 | Epsilon Indi B: confirm what the bright object at the field edge is and whether the target is visible | test target | none, or T15 | Presumed Epsilon Indi A, not checked. |
| T25 | P3 | Check the frontend outside Chromium | none | `web/playwright*.config.js` | Only Chromium has been tested. |
| T26 | P3 | Remove the merged Day 1 worktrees and branches (`claude/build-backend-2cca9d`, `claude/build-web-cb39ff`) | none | git only | Fully merged, no uncommitted work. Needs Dat's go-ahead. |
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
| T33 | Frame slider as a draggable axis: a tick per frame at its real wavelength (log scale), drag to move through the frames | none (usability) | `5dde92a` |
| T34 | Visit selector and a vertical wavelength slider for the individual frames (replaces the horizontal axis of T33) | none (usability) | `200f489` |
| T35 | Visit slider instead of buttons; wavelength marks evenly spaced with written wavelengths and breaks at big gaps (refines T34) | none (usability) | `92de4f1` |
| T36 | A "Pick a wavelength" button beside the stacked view, which has no wavelength slider (people could not find it) | none (usability) | `37f24d8` |
| T37 | Play mode "across visits, same wavelength" (the default for individual frames when there are two or more visits) next to "through the frames, in Order" | none (usability, motion check) | `887d108` |
| T38 | Buttons follow the two sliders: step visit, step wavelength, "Play across visits", "Play through wavelengths"; the Order and Play selectors are removed (replaces T37's selector) | none (usability) | `90cdc9c` |
| T39 | Simple first screen: target dropdown and RA/Dec boxes on top (paste both at once), "By date / By wavelength" toggle, caption, visit slider for stacks too, everything else under "Advanced" | none (usability) | `801e2ff` |
| T40 | Staged loading of a live position: a first batch of 8 frames spread over dates and bands, then "Load more" / "Load up to 102"; 8 downloads at once; archive-search message | `7e23de0` and `1ddb0f8` (contract), `5725cb3`, `60cea46` |
| T21 | `make refresh`, `RELEASE_PREFERENCE` list, `docs/data-updates.md` for refreshing on a new data release | "easy to update with the latest data releases" | `d26ff13` |
| T42 | Remember archive searches on disk (a repeated position skips the slow search, also after a restart); say plainly when the archive is slow | none (demo reliability) | `3a0790d` |
| T28 | Flux extraction in Python: aperture photometry on native cutouts (`pipeline/photometry.py`), checked on the cached real cutouts. Not stored or shown yet (T29, T30) | "Extract flux measurements using Python" | `35c9528` |
| T29 | Flux measurements stored with timestamps: per-frame flux, error and mid-exposure time in the series document, cached and live | "Store measurements with actual timestamps" | `32492ed` (contract), `7c83325`, `3e4dc80` |
| T30 | Spectrum and Light curve next to the image, coloured by visit, click a point to show the frame | "Display spectrum and light curve" | `8283816` |
| T19 | Sexagesimal RA and Dec input (`08h55m10.831s -7d14m42.53s`), alone or pasted together | "enter the coordinates" | `b76cb00` |
| T10 | Public deployment: container on AWS EC2 (Sydney, `t3.small`) behind Caddy HTTPS at `https://16-179-73-6.sslip.io`; cached targets verified from outside. Live builds not verified (archive returned 502). README link goes with T12 | "public-facing web tool" | `044a7e3`, `26c9518`, and the commit that adds this row |
| T31 | Archive search stays TAP (not SIA2); QR3 confirmed covered: about a third of each field's images are `qr3` and are kept. SIA2 was not tried; the repo's challenge text does not mention it (official page not re-read) | "Search DR1 and QR3 through SIA2" (wording from this board, source unverified) | the commit on branch `t31-tap-or-sia2` |
| T43 | SIA2 tried as the archive search: same rows as TAP on 4 of 5 targets, but 539 of 2493 images for R Draconis, so TAP stays. `sia_rows` added, unused. Not timed from EC2 | "Search DR1 and QR3 through SIA2" (wording from this board, source unverified) | the commit on branch `t31-tap-or-sia2` |
