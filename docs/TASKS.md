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
| T41 | Cache three famous positions as demo targets (Orion M42, Eagle M16, Andromeda M31) so a demo never waits for the archive | parked on branch `t41-demo-targets` (entries added, series not built: the archive search service was down, HTTP 502). To finish: when the archive answers, on that branch run `python -m pipeline.build verify/targets.json --only m42 m16 m31`, then `--offline` for flux, then `make verify` | `verify/targets.json`, `static/series/`, `tests/pipeline/test_targets.py` |

## Todo

Priority: P1 = needed for the challenge's core objective or the submission, P2 = an optional consideration from the challenge text, P3 = nice to have.

| ID | P | Task | Challenge item | Touches | Notes |
|---|---|---|---|---|---|
| T20 | P2 | Flag detail: per-pixel flag overlay or a breakdown by flag bit | "display metadata, like contamination flags" | `pipeline/grid.py`, `pipeline/writer.py`, `contracts/`, `web/src/main.js` | Only a flagged fraction per frame is shown today. |
| T24 | P3 | Epsilon Indi B: confirm what the bright object at the field edge is and whether the target is visible | test target | none, or T15 | Presumed Epsilon Indi A, not checked. |
| T32 | P2 | Validate and tune the photometry | none | `pipeline/photometry.py`, `tests/pipeline/`, docs | T28 uses an aperture, annulus and flag rule that are first choices, not tuned. Compare against a source with a known brightness (source and value to be found, not assumed), check the aperture size against the real PSF, decide whether an aperture correction is needed, and handle crowded fields and moving objects (WISE 0855, Barnard's Star). |
| T57 | P3 | Download image with report: a "Download image" button saves the frame on screen as one PNG, with a text strip under it: position (ICRS degrees and h m s / d m s, field of view, pixel scale, north up), time (UTC, MJD, mid-exposure when known; for a stack the date range, epoch and number of images), wavelength, image type (single, stack, difference) with stretch limits, processing (median background subtraction, "8-bit display preview, not calibrated data", zoom), flagged fraction, aperture flux with error and its caveats (single images only; "at the requested position"), REAL or SIMULATED label, source credit (SPHEREx, NASA/IPAC IRSA), permalink, download date. Only values already in the series document; text left out when unknown | "display metadata" (partly); a take-away for judges | `web/src/model.js` (pure `reportLines`), `web/src/main.js` (small handler; usual clash), `web/index.html`, web tests | Browser only: no contract, API or pipeline change. Draw the frame at native size on a wider canvas (a 58 px frame is tiny), not the Aladin backdrop (cross-origin). Not included, would need a contract change: image ID, detector, data release. Flux does not exist for stacks and differences: say so. Do after the submission items. |

### Which tasks can run at the same time

- **Independent of everything:** T10, T12, T16 + T18 (data only), T23, T25, T31.
- **Share `web/src/main.js`, run one at a time or expect a merge:** T13, T14, T15, T20. T19 touches only `model.js` and `index.html` and is small enough to merge easily.
- **Change the contract, so each needs its own contract commit first:** T14, T20, T29.
- **Flux chain, in order:** T28, then T29, then T30. T14 (spectrum on click) builds on the same flux values and should be reconciled with T29 and T30 before starting.

## Done

| ID | Task | Challenge item | Commits |
|---|---|---|---|
| T55 | Requested by Dat: sky backdrop starts as the whole-sky globe (SIN, 360 degrees across) like the Aladin Lite web page, and a magenta crosshair marks the loaded position (set in sky coordinates, placed in the header strip so the image panel does not hide it); labels updated. Branch `claude/aladin-mark-t55`, not yet merged | Aladin backdrop (follows T50, T52) | `0650a3a` |
| T56 | Friendly errors (Dat's request): every error a visitor can see is one plain sentence (archive down, archive asking for fewer requests, no images, none readable, server busy or memory, our rate limit, catalogue, network and HTTP failures); the technical text (TAP, SIA2, HTTP status) is in a new optional `error.detail` (contract commit `bdfadfe`), the server log and an "i" popover. Branch `claude/friendly-archive-error-983104`. See `WORKLOG.md` for every old and new text | none (usability) | `bdfadfe`, `5a9a2ac`, `e91cb82` |
| T54 | Simpler text (Dat's request): explanatory text moved into an "i" icon (hover shows, click pins, click again, Escape or a click elsewhere closes; keyboard and touch work); short labels, status, errors and the REAL / SIMULATED labelling stay visible. See `WORKLOG.md` for the list | none (usability) | `a1df85f` |
| T51 | Bug found by Dat: the target dropdown was covered by the page text once the sky backdrop was on (`.topbar` and `main` shared `z-index:1`, `main` painted over the open list). Fixed with `body.sky-on .topbar { z-index:3 }`; Playwright test checks every option is reachable. Redeployed and checked on the public site | none (usability, found after T50) | `69433e0` |
| T52 | Requested by Dat: the Aladin sky backdrop starts on a wide view of the sky when the page opens, before any target or Load (lazy, after the page is idle); orange image-panel border (`--accent-panel`, `#e07b00`, 2 px). Note: `--sim` is a similar orange used for the SIMULATED badge. Checked on the public site | none (look and feel, follows T50) | `b7feb5e` |
| T53 | Redeploys of `origin/main` to the EC2 host by a deploy session, three times on 2026-11-15 (`b877d4c`, `69433e0`, `b7feb5e`): previous image kept as `spherex-viewer:previous` for rollback, about 10 s downtime each, checked from outside. Catalogue overlay and live builds still unverified on the server (IRSA returned HTTP 502). Deploys stay manual; see `docs/deploy.md` | "public-facing web tool" | `0007f3a`, `8ce7156`, `b5e0702` (docs) |
| T50 | Sky backdrop: Aladin Lite (DSS2 colour) behind the page on desktop, flies to the position on Load; shown only after a survey tile loads, with credit and privacy line, Aladin script checked by SHA-384. Checked in Chromium only | "Aladin" (optional idea); "overlay astronomical data from other telescopes" (partly) | `1163911`, `320c381` |
| T26 | Merged Day 1 worktrees and local branches `claude/build-backend-2cca9d`, `claude/build-web-cb39ff` removed (remote branches left) | none | git only |
| T25 | Frontend checked in Firefox and WebKit: mock and real-data specs pass on all three browsers; `E2E_BROWSERS`, `make verify-browsers` | none | `c426091` |
| T16 | Deeper stacks: `stack_images: 120` for Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis (stacks now from 119-120 images, was 35-40) | "add together ... to improve the signal-to-noise" | `dbd05fa` |
| T18 | The 8 failed frames (Barnard's Star 3, R Draconis 5) retried: all 40 of 40 frames now load for every target | test targets | `dbd05fa` |
| T14 | Spectrum on click: click the image, the Clicked point tab shows that point's flux in every frame (`GET /api/spectrum`, measured on the native cutouts with the T28 method, wavelength read at the clicked pixel). A click on a cached target builds a live series at the same position (about 40 frames, slow the first time) and the panel says its frames differ from the cached ones | "Extra kudos if your tool can generate spectra on the fly" | `a226402` (contract), `cae72f4`, `b9085dc`, `1fe2a65`, `c051d9f` |
| T22 | Finished live series kept across restarts: document data and PNGs on disk (`.cache/live-series/`, newest 30, a week), restored at start; rebuilt from the remembered archive rows when pixels are needed | none | `48376af`, `7e0e675` |
| T15 | WISE catalogue overlay: Advanced > "Show WISE catalogue sources" draws AllWISE sources as orange circles (`GET /api/catalogue`, IRSA TAP); labelled real catalogue data, positions at the catalogue epoch, not corrected for proper motion. Live query NOT yet confirmed against the service (IRSA returned 502 on 2026-11-15, again after review) | "overlay astronomical data from other telescopes" | `c403b96` (contract), `a3648dc`, `8d4ea30`, `672ca78`, `f1c80cd` |
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
| T45 | Per-client rate limit on `/api/series` and a 600 MB total memory budget for live series (figures not measured on the host) | public deployment | the commit on branch `t45-limits` |

| T31 | Archive search stays TAP (not SIA2); QR3 confirmed covered: about a third of each field's images are `qr3` and are kept. SIA2 was not tried; the repo's challenge text does not mention it (official page not re-read) | "Search DR1 and QR3 through SIA2" (wording from this board, source unverified) | the commit on branch `t31-tap-or-sia2` |
| T43 | SIA2 tried as the archive search: same rows as TAP on 4 of 5 targets, but 539 of 2493 images for R Draconis, so TAP stays primary. SIA2 is the live path's backup when TAP fails (marked `progress.search`, not remembered); EC2 timing: SIA2 1 to 5 s, TAP no answer. Not made primary: no TAP speed on a good day | "Search DR1 and QR3 through SIA2" (wording from this board, source unverified) | the commit on branch `t31-tap-or-sia2` |
| T44 | Live builds: PNG rendering outside the job lock, one bad frame is a gap, `retry-after` capped at 30 s | public deployment | the commit on branch `t44-robust` |
| T23 | Reviewer agent over the full diff since Day 1; 14 findings recorded in `WORKLOG.md`, follow-ups T44 to T47 (review by reading only, nothing fixed) | none | the commit that adds this row |
| T47 | Small review items (T23 findings 7 to 14): `fullmatch` and ASCII digits in the `api/main.py` regexes; `series.json` reads cached by mtime, a damaged file skipped; `load` validated only on the live path; `tapcache` cap (500) and unique temp name; a rebuilt live series keeps its id; no restretch when `extend` asks for more than the archive has; dev requirements split into `requirements-dev.txt`; Makefile comment; no "REAL DATA" badge on error documents. Not done: Python 3.9 in Docker, the web build importing the dev mock | none | the commit on branch `t47-review-items` |
| T48 | While TAP is down, live searches ask SIA2 first for 5 minutes (`TapHealth`, `TAP_SKIP_S` = 300, not tuned) instead of waiting for two 90 s TAP tries each time; TAP is tried again after the pause or if SIA2 fails. Not measured on the server after the change | "public-facing web tool" | the commit on branch `tap-skip` |
| T46 | Fixed stale or unverified statements: contract decision 13 and live `frames[].index` meaning, flag bits cited to Explanatory Supplement Table 16, proper-motion adequacy marked unverified, live-wait text made indicative | "never invent scientific facts" | `ee71db0`, `a7657c3`, `2708374`, `5a004c6`, and the commit on branch `t46-claims` that adds this row |
| T12 | Submission paperwork: `README.md` rewritten (public URL, status, limits), `REFERENCES.md` brought up to date. Not done: demo video, the two `TODO`s in `REFERENCES.md` (Gaia endpoint, AI-written split: need Dat), exact deadline unconfirmed | submission | the commit on branch `t12-submission` |
| T49 | User-facing word "epoch" instead of "visit" (Dat's decision): page text, captions, tooltips, chart legends, README; code, JSON fields, contracts and API unchanged; "catalogue epoch" keeps its own meaning | none (clarity) | the commit that adds this row |

## Cancelled

Dropped by Dat; not planned. Kept so the ID is not reused.

| ID | Task | Why |
|---|---|---|
| T17 | WISE 0855: show where the object should be now (needed the organisers' epoch for the challenge coordinates) | Cancelled by Dat on 2026-11-15: not asking the organisers. Nothing is identified at the marker; see `WORKLOG.md` and T04. |
