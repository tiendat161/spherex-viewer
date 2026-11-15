# Work log

What was done, why, and what is still missing. Newest first. The task board is [`TASKS.md`](TASKS.md); IDs below refer to it.
Commit messages stay short; the reasoning and the known gaps live here.

## Entry format

```
## YYYY-MM-DD: short title (task ID)
Commits: abc1234, def5678
**What:** what changed, in terms of behaviour.
**Why:** the reason for the approach taken.
**Gaps:** what is missing, weak or unverified. Each gap that needs work gets a task ID.
```

---

## 2026-11-15: Visit buttons and a vertical wavelength slider (T34)
Commits: see the T34 row on the board. Replaces the horizontal axis of T33.

**What:**
- Individual frames are now chosen by two controls: a row of visit buttons (each with its dates and frame count) and a vertical wavelength slider beside the image. A frame is a (visit, wavelength) point. The buttons pick the visit; the vertical axis, on one log scale shared by all visits (so it does not change when the visit does), picks the wavelength among that visit's frames. Changing visit keeps the wavelength as nearly as it can: it goes to the frame of the new visit closest in wavelength, and the readout shows the wavelength actually reached.
- Keys: up and down change the wavelength within the visit, left and right the visit (in the stacked view and with no visits to show, left and right still step through frames as before). Step, Play and Order are unchanged.
- Visits come from the response (`stacks.visits`, finished series) or, while a series is loading and in the mock, from the frame dates with the pipeline's 30-day gap rule (`VISIT_GAP_DAYS` in `web/src/model.js`, a copy of the constant in `pipeline/stack.py`).
- The stacked view keeps the plain slider. The native range slider stays, visually hidden, for the keyboard and screen readers; the controls go through it.
- Unit tests for the grouping, stepping and snapping; a Playwright test against the mock.

**Why:** time comes in a few visits months apart (3 for the cached WISE 0855 series, 4 or 5 for Epsilon Indi B), so a visit choice is clearer than a date axis, and inside a visit wavelength is a plain one-dimensional axis. This makes blinking at about one wavelength across visits, the motion check, a click. No contract change, no new dependency.

**Gaps:**
- Visits are uneven (WISE 0855: 8, 56 and 38 frames), so the vertical axis is sparse for some visits and the nearest wavelength in another visit can be a few tenths of a micrometre away.
- Frames of nearly the same wavelength overlap on the axis; up and down keys move between them.
- With a single visit the buttons are hidden and only the vertical axis shows.
- Play does not cycle through visits at a held wavelength; "Blink widest pair" is still the way to do a time blink automatically.
- Not tried on a touch screen or outside Chromium (T25).

## 2026-11-15: Draggable wavelength axis (T33)
Commits: see the T33 row on the board

**What:**
- The frame slider is now a wavelength axis on its own line under the buttons. Every individual frame is a tick at its real wavelength, on a log scale, with end labels and labels at 1, 1.5, 2, 3, 4, 5 µm inside the range. Drag anywhere on it (or click) to jump to the nearest frame; the handle follows the current frame. The axis is wavelength whatever the Order setting is: Order only changes how Step and Play walk through the frames.
- Stacked visits combine a band, so they have no single wavelength: the stacked view keeps the plain slider.
- The native range slider is still there, visually hidden, so the keyboard, screen readers and the existing tests work as before. The axis goes through it.
- Pure logic in `web/src/model.js` (`axisSpec`, `nearestPoint`) with unit tests; a Playwright test against the mock drags and clicks the axis in both orders.

**Why:** the slider position was only the frame number, so it hid how unevenly the frames sit in wavelength (the cached WISE 0855 series has visible gaps). A first version switched the axis to dates when Order was Time; that read as confusing, so the axis is now wavelength only. Log scale is a display choice, not a claim about the instrument. No contract change, no new dependency.

**Gaps:**
- Frames of nearly the same wavelength overlap on the axis, so a drag cannot choose between them; Step and the arrow keys do. The tooltip says so.
- Time is not shown on the axis any more. Seeing time and wavelength together is T34.
- Not tried on a touch screen or outside Chromium (T25). A draggable wavelength range for the stacks was not done.

## 2026-11-14: Structure guide and a check that keeps it current (T27)
Commits: `3ab1d85`, `18f595a`, `c8f4e76`

**What:**
- `docs/structure.md` rewritten against the current code. New: a request flow from the browser through the API to the cache or a live build, and a "to change X, look in Y" table. Added the files it was missing (`pipeline/live.py`, `pipeline/stack.py`, their tests, the mock and test helpers) and the environment variables. Removed the claim that the API never contacts IRSA.
- `make verify-docs` (new `verify/check_docs.py`, part of `make verify`): fails when a source file under `contracts/`, `pipeline/`, `api/`, `web/`, `verify/`, `tests/`, `fixtures/` or `docs/` is not named in the guide, or when the guide names a file that does not exist.
- `CLAUDE.md`: the project paragraph is filled in, the Layout section says to read the guide first, and a working rule says a commit that adds, moves or removes a source file updates the guide.
- `docs/contract.md`: the status line no longer says "draft, not implemented".

**Why:** the guide existed but nothing pointed to it and nothing failed when it went stale, so it had fallen behind after T06 to T08 and T13. Counts and sizes (frame totals, megabytes) were dropped because they were the first things to go stale. One line per source file rather than a full tree, since most tracked files are generated PNGs. No new dependency.

**Gaps:**
- The check compares file names only. A description that is wrong, or a request flow that no longer matches the code, passes.
- `contracts/series.schema.json` still says "DRAFT" in its description; changing it is a contract commit and was left alone.
- `README.md` is still the scaffolding text (T12).

## 2026-11-14: Field-of-view selector (T13)
Commits: `07fc9f5` (contract), `1703a89`, `cb845e5`

**What:**
- `/api/series` accepts `fov` 0.1, 0.2, 0.5 or 1 (degrees); anything else is `status: "error"`. Grid sizes are 58, 116, 290 and 581 pixels.
- The cache is 0.2° only, so every other size is built live, also at a cached target's position. With `SPHEREX_LIVE=0` those sizes return an error.
- The form has a "Field of view" selector. Changing it reloads the position on screen at that size. The page URL carries `&fov=` (left out for 0.2°, so old links are unchanged); an unsupported `fov` in a link falls back to 0.2°. Cached-target buttons always load the cached 0.2° series.
- The scale bar is 60″, 2′ or 5′ depending on the field. From 0.5° up a note says the wavelength shown is exact only at the centre.
- The mock API returns placeholder frames of the matching size (SIMULATED).

**Why:** The schema needed no structural change (`grid.shape` was already free), so the contract commit only states the allowed values. A fixed list keeps series identity simple and bounds the cost. The selector reloads at once, like the other selectors; target buttons reset to 0.2° so one click never starts a multi-minute live build by accident.

**Checked with real data:** 4-frame live builds at the WISE 0855 position: 0.5° gave 4 of 4 frames in 37 s, 1° gave 3 of 4 in 54 s (one archive failure). One PNG of each was inspected and shows a star field. Screenshot of the UI at 0.5° (mock data): `verify/out/web-mock-fov05.png`.

**Gaps:**
- A full 40-frame series at 0.5° or 1° was not run through the browser against the real archive; only the 4-frame builds above and the mock.
- How much the wavelength changes across a 0.5° or 1° field is not measured; the note gives no number.
- At 0.5° and 1° some frames have an empty corner where the field runs off the detector (flagged fraction up to 0.22 in the test builds). The stacked view was not inspected at these sizes.
- Memory: a finished 1° live series keeps about 40 PNGs of 581 × 581 plus stacks, and up to 30 series are kept. Not measured; relevant for T10 and T22.
- `make verify` still covers only the cached 0.2° targets (it must not contact IRSA).

## 2026-11-14: Task board and work log
Commits: this commit

**What:** Added `docs/TASKS.md` and this file; removed `docs/handoff.md`; added a "Task tracking" rule to `CLAUDE.md`.
**Why:** Work continues in several Claude sessions in parallel, each in its own worktree. They need one place to pick tasks from and to see which files a task touches. `handoff.md` was out of date after today (it described a cached-only prototype); its still-valid points are carried into TASKS (T11, T12, T17, T18, T23–T26) and the "Not verified" list at the bottom of this file.
**Gaps:** None.

## 2026-11-14: FOV timing (measurement for T13, no code change)

**What:** Timed one IRSA cutout at the WISE 0855 position for several fields of view. The cutout is requested 1.5 times wider than the field so the corners are covered after rotating to north-up.

| Field of view | Time for one image | Size | Source image (px) |
|---|---|---|---|
| 0.1° | 8–12 s | 4.1 MB | 88 × 88 |
| 0.2° | 8 s | 4.4 MB | 176 × 175 |
| 0.5° | 10–15 s | 6.8 MB | 439 × 408 |
| 1° | 17 s | 12.8 MB | 878 × 628 |
| 2° | 17 s | 31.3 MB | 1604 × 1066 |

**Why:** To decide whether a field-of-view choice is affordable. It is: size grows about 8 times from 0.1° to 2°, time about 2 times, so most of the time is the server, not the transfer. Reading and reprojecting takes 0.05–0.2 s.
**Gaps:** One or two images per size only. Almost every request got HTTP 503 on the first attempt and succeeded on the second or third; the times above exclude that waiting. At 1° and 2° the cutout is clipped at the detector edge (not square), so part of the frame has no data. A full 40-frame series at 1° was not run; 5–7 minutes is an estimate.

## 2026-11-14: Deeper-stack fetch started and stopped (T16)

**What:** Set `stack_images: 500` and started `make cache` for Barnard's Star, Epsilon Indi B, RW Aurigae and R Draconis; stopped at Dat's request after about 9 minutes. The setting was removed again. 133 extra Barnard's Star cutouts remain in `.cache/` (170 in total).
**Why stopped:** The archive delivered about 14 images a minute, so the remaining 1,370 images would have taken about an hour and a half.
**Gaps:** No series was rewritten, so the four targets still stack only their 35–40 cached images. T16 proposes a smaller `stack_images` (120).

## 2026-11-14: Stacked visits, difference view, background subtraction, Mark centre (T07, T08, T09)
Commits: `d1b0575` (contract), `6727df2`, `c17c5bb`, `cf89aa9`, `b6f9771`

**What:**
- Every image has the median of its own unflagged pixels subtracted before stretching.
- New `stacks` section in the series response: images grouped into visits and combined per detector band (`D1`–`D6`) and for all detectors together, with one stretch per band and a difference image against the band's earliest visit.
- Viewer opens in "Stacked visits" once a series is ready (1 fps), with a Band selector and "Difference from first visit". "Individual frames" remains, with Order: Time (default) or Wavelength.
- The centre circle is hidden unless "Mark centre" is ticked.
- All five cached series were rebuilt offline from `.cache/`.

**Why:**
- Consecutive SPHEREx images of one position are in different wavelengths with very different background levels, so a time-ordered blink mostly showed the background flickering.
- The archive listing shows each position is observed in a few visits about six months apart (WISE 0855: 3 visits; Barnard's Star 3; RW Aurigae 3; Epsilon Indi B 4; R Draconis nearly continuous). Combining one visit gives a deep image, and blinking visits leaves time as the only thing that changes.
- Visit boundaries come from the full archive listing, not the images read, because 40 sampled images split one visit at their own gaps (Barnard's Star came out as 5 visits instead of 3).
- A difference image is offered because WISE 0855 should move only about 1.4 px over the whole span, which is hard to see in a blink.

**Gaps:**
- WISE 0855 is still not identified in the stacks or the difference images (T17).
- Four targets and all live series stack only 35–40 images (T16).
- Live series get their stacks only when the build finishes, not while loading.
- The 30-day visit gap, 60-day maximum visit length and 3σ clip are choices, not measurements.
- `ZODI` extension is not used; the background is a plain median.
- Stacking a visit erases anything that moves within it (asteroids, comets); use "Individual frames" for those.
- `series.schema.json` was re-serialised when edited, so its diff is larger than the change.

## 2026-11-14: Live series for any position (T06)
Commits: `d1b0575` (contract doc), `c17c5bb`

**What:** A position that is not within 1″ of a cached target is built in the background from IRSA (`pipeline/live.py`): archive query, 40 frames evenly spaced in time, same grid and flag rules as the cache. The API returns `status: "loading"` with the frames done so far while the page polls every 2 s. `SPHEREX_LIVE=0` turns this off; `make verify` runs that way and never contacts IRSA.
**Why:**
- The challenge's core requirement is that the user enters any RA/Dec; before this, only the five cached targets worked.
- The shared stretch is only known when every frame is in, so while loading it is recomputed at 1, 2, 4, 8, 16, 32 frames and at the end, and frame URLs carry `?v=<generation>` so the browser refetches. This avoids re-rendering on every frame.
- Two builds run at once and six may wait, to keep within IRSA's limit of 4 requests in flight and to bound abuse on a public site.

**Gaps:**
- Tested on one real position (`ra=164.1204, dec=7.0147`): 39 of 40 frames, a few minutes end to end.
- Results are in memory only, lost on restart, 30 most recent kept (T22).
- Field of view fixed at 0.2° (T13). Decimal degrees only (T19).
- `make dev` now contacts IRSA for uncached positions, which overrides the Day 1 rule that only `make cache` may.
- Raw cutouts of live builds are not cached on disk, so a failed build starts again from nothing.

## 2026-11-14: WISE 0855 per-wavelength series; zoom and widest-pair blink (T04, T05)
Commits: `76abdcf`, `862af65`, `5bd8141`, `7a165e9`, `4bf12f8`

**What:** WISE 0855 shows one frame per distinct wavelength (102 frames from 258 images, the least-flagged image per band). `max_frames` became a ceiling of 102. The viewer got 1×/2×/4× zoom and "Blink widest pair" (two frames far apart in time and close in wavelength).
**Why:** To show the full spectral coverage for the one target the challenge gives coordinates for, and to give a flicker-free way to compare early and late frames.
**Gaps:** Done in another session; see those commits for detail. The other four targets keep the 40-frame time-evenly rule.

## 2026-11-14: Day 1 prototype (T01, T02, T03)
Commits: up to `2a34741`

**What:** Contract-first build: `pipeline/` fetches IRSA cutouts and writes `static/series/`; `api/` serves it; `web/` blinks the frames with date, wavelength, flagged fraction and a REAL DATA badge; `make verify` checks all five challenge targets end to end.
**Why:** IRSA sends no CORS headers and is slow (query 10–45 s, cutouts 6–13 s with frequent 503s), so the browser cannot call it directly; a backend with a cache was needed.
**Gaps:** Barnard's Star is missing 3 of 40 frames and R Draconis 5 of 40 (T18). Epsilon Indi B shows nothing obvious at the marker (T24).

---

## Not verified (carried over, still true)

- WISE 0855's proper motion (quoted secondhand in `docs/spike.md`, not read from the paper), and which epoch the challenge coordinates refer to.
- The native SPHEREx pixel scale; the contract fixes 6.2″.
- That the bright object in the Epsilon Indi B field is Epsilon Indi A.
- Flag meanings beyond Table 16 of the Explanatory Supplement: the mask ignores only `SOURCE` and `FULLSAMPLE`.
- Which kinds of object are bright in which detector band (general astronomy knowledge, not checked against this data).
- The frontend outside Chromium.
- The submission deadline.
