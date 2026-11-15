# Work log

What was done, why, and what is still missing. Newest first. The task board is [`TASKS.md`](TASKS.md); IDs below refer to it.
Commit messages stay short; the reasoning and the known gaps live here.

## 2026-11-15: Frontend checked in Firefox and WebKit (T25)
Commits: `c426091`

**What:** Both Playwright configs take `E2E_BROWSERS` (default `chromium`; `chromium,firefox,webkit` for all). `make verify-browsers` runs the mock spec and the real-data spec (via `verify/e2e.py`) on all three. Firefox/WebKit screenshots go to `verify/out/<browser>/`. Result: mock spec 9 tests x 3 browsers and real-data spec 6 tests x 3 browsers all pass, and `make test` and `make verify` pass. Screenshots of WISE 0855 in Firefox and WebKit were inspected: canvas, vertical wavelength slider, visit slider, spectrum chart and badge render as in Chromium. No app code changed.
**Why:** Only Chromium had been tested.
**Gaps:** Two spec changes were needed, both test-side: (1) the mock remembers a "searched" position for the whole server, so the staged-loading test now uses a different RA per browser; (2) Firefox's synthetic `ClipboardEvent` drops its data, so the paste test now dispatches a plain event carrying the `DataTransfer`. A real paste in Firefox was not tried by hand. Not tested: Safari on iOS, mobile viewports, older browser versions, headed mode. The Playwright WebKit build is not Safari itself. Visit 3's label under the visit slider sits close to the right edge in both browsers (not browser-specific, not changed).

## Entry format

```
## YYYY-MM-DD: short title (task ID)
Commits: abc1234, def5678
**What:** what changed, in terms of behaviour.
**Why:** the reason for the approach taken.
**Gaps:** what is missing, weak or unverified. Each gap that needs work gets a task ID.
```

---


## 2026-11-15: Live series survive a restart (T22)
Commits: `48376af`, `7e0e675` (branch `claude/t22-persist-live`, on top of the T14 branch because both change `pipeline/live.py`)

**What:**
- A finished live series is written to `.cache/live-series/<id>/` (`pipeline/livestore.py`): frame metadata, flux, stretch, stacks and every PNG; no pixels. The builder loads the newest 30 (not older than a week) at start. Checked with the real API on real cached cutouts: build, stop the server, start it again, the series answers `ready` at once with the same frame URLs, and a frame PNG is served.
- A restored series has no pixels, so it is treated like one whose pixels were let go: asking for more frames rebuilds it (existing path), and the new `LiveBuilder.revive` rebuilds it for a clicked-point spectrum (`/api/spectrum` calls it). Both reuse the archive rows remembered by `tapcache`, so no new archive search.
- This also fixes a dead end from T14: a series whose pixels were released for memory used to answer a spectrum request with "load the position again", which did nothing.

**Why:** T22 asked for results to outlive a restart, which matters on the EC2 host. Pixels are 50 MB per series, so only what is needed to show the series is kept.

**Gaps:**
- A restored series is a snapshot: while it is rebuilt (after a click for a spectrum, or "Load more"), the series answers `loading` with the frames arriving again, so the player on screen resets for the time of the rebuild.
- The disk folder is not bounded in bytes, only by count (30) and age (a week); one 8-frame series with stacks took 216 KB, so about 3 MB for 102 frames (extrapolated). T45 covers limits.
- Not checked: a real restart in the Docker container with the volume; a restored series is never refreshed for a new data release before the week is up.

## 2026-11-15: Spectrum on click (T14)
Commits: `a226402` (contract, own commit), `cae72f4`, `b9085dc`, `1fe2a65`, `c051d9f`

**What:**
- Click the image: the Clicked point tab shows that sky position's flux in every frame, with error bars. New `GET /api/spectrum?ra=&dec=&fov=&at_ra=&at_dec=&load=` and `contracts/spectrum.schema.json`; `series.schema.json` is unchanged.
- It uses the T28 method (aperture, ring background, flag rule, error factor 2.2) on the native cutouts, with the aperture at the clicked position. Live series now keep each native cutout (image, flags, variance, WCS and a wavelength plane, about 0.5 MB a frame), counted in `HOT_PIXEL_BYTES` and dropped with the pixels.
- The wavelength of a point is read at its own pixel from the WCS-WAVE table: on one real cutout it ran from 1.624 to 1.684 um across the 0.3 degree cutout, so using the frame's centre wavelength would put off-centre points at the wrong place on the spectrum.
- Cached targets (Dat's choice A): their native cutouts are not on a deployed server, so a click starts a live series at the same position (fov 0.2, 40 frames). Its frames are chosen by the live rule, not the cached ones; the panel says so, and the dots cannot be opened as frames. The first click takes minutes (archive search and downloads), later ones are instant.
- On a live series already on screen the click measures the same frames, so a dot opens its frame, and the spectrum is refreshed when more frames load.
- Tests: off-centre source recovery, wavelength at the pixel, budget, endpoint polling and errors, TAN inverse against the grid WCS (python reference values), poll helper.

**Why:** the 8-bit PNGs carry no flux. Measuring on the resampled grid pixels would have interpolated and lost the variance and the per-pixel wavelength, and it is not the method T32 validated.

**Review fixes (same day):**
- A bad or missing wavelength plane no longer fails the frame: `read_cutout` gives `wave_map: None`, the frame stays in the series and only the clicked-point spectrum skips it. The real `wavelength_map` now has tests (`tests/pipeline/test_wave_map.py`, a simulated table in the archive's WCS-WAVE layout: agrees with the single-position lookup; NaN and non-positive tables are refused). One bad table node spoils the whole cutout, including the centre lookup, so the "map fails alone" case is simulated with a mock.
- Cost of the plane: 1.2 ms for one real 175 x 176 cutout (R Draconis, measured once with `all_pix2world`), 3.2 ms on the simulated 175 x 175 table in the test. Negligible next to a download.
- `LiveSeries.spectrum` remembers its last answer (key: point, frames in, status, totals), so polling does not re-measure up to 102 frames.
- `load=0` on `/api/spectrum` means "use the series as loaded" (`LiveBuilder.find_at`); the web click path uses it for a live series on screen. Out-of-range errors name `at_ra`/`at_dec`; one `error_document` helper replaces three inline dicts; the unused `keep_native` argument is gone.

**Gaps:**
- Checked in a browser on real cached R Draconis cutouts served through the live path (the archive's search service answered HTTP 502, so no download from IRSA was tried). Seen: a faint empty-sky point gives scatter around zero consistent with the error bars; the bright star's point is mostly flagged (1 of 40 frames).
- Validation of the flux (T32) was at the target centre on bright stars; a clicked point uses the same code but off-centre accuracy is not separately checked. The panel says so.
- A series whose pixels were released (memory budget) answers with an error and must be loaded again. No per-click rate limit (T45). The `at` of the series' own flux is still a fixed sky position (T48).
- Cached-target clicks cost about 40 archive downloads each first time; no cap beyond the live builder limits.
- The mock API (`web/mock/`) has no spectrum endpoint and `make verify` runs with live builds off, so the click path has unit tests and the manual check above but no Playwright test.

## 2026-11-15: Submission paperwork (T12)
Commit: see `git log` (branch `t12-submission`, message starts "T12").

**What:** `README.md`: status line now gives the public URL, says the five cached targets work and a live position was built once on the server (M42, about 252 s, through the backup search), and tells a demo to use cached targets or to request a live position early; the search description and limits mention the TAP/SIA2 backup. `REFERENCES.md`: the archive-search line said SIA2 was unused; it is now the live backup, with the R Draconis caveat.

**Deadline:** not confirmed. Public listings (web search, not the official site, which could not be opened from here: certificate error) say the event ran 14 to 15 November 2026 and registration closes on the 15th; one blog says submissions close 15 November 23:59 local time. Treat it as tonight unless Dat sees otherwise.

**Gaps:** (1) demo video not started: needs a screen recording of the public URL, a cached target first (blink by date, then by wavelength, the stacked and difference views, the Spectrum and Light curve), a live position last (requested a few minutes beforehand), and the REAL badge shown. (2) `REFERENCES.md` still has two `TODO`s for the author: the exact Gaia TAP endpoint, and which parts were AI-written. (3) Nothing re-checked on the live site after the README change (docs only).

## 2026-11-15: Live-build robustness (T44)
Commit: see `git log` (message starts "T44").
**What:** (1) Stretch re-renders, the final render and the stacks of a live series now run outside the job lock; a re-render is installed only if no newer one landed, and a series is marked ready only if no `extend` raised the cap meanwhile (it then takes another pass). (2) A frame that raises `ValueError` or WCS `NoConvergence` (or disagrees on BUNIT) counts as a failed frame, not a failed series. (3) `retry-after` is capped at 30 s (`MAX_RETRY_WAIT_S` in `pipeline/irsa.py`). Tests in `tests/pipeline/test_live.py` and `test_irsa.py`.
**Why:** T23 findings 1, 3, 4.
**Gaps:** The lock-free rendering is tested with a blocked render, not measured on a 1 degree field. Frames that arrive during a re-render get the new stretch rendered under the lock (a few frames, cheap). Not run against the live archive (down).

## 2026-11-15: Stale and unverified statements fixed (T46)
Commits: branch `t46-claims`, messages start "T46".

**What:** T23 findings 5 and 6. (1) `docs/contract.md` choice 13: a live series is the first N images of `spread_order` (N = `load`, else min(`max_frames`, 40)), and `frames[].index` is the position in that order, not time order; cached series stay in `obs_mjd` order (`wavelength_um` for `wise0855`). The schema text for `index` ("Position in the planned series") is still correct, so no contract file changed. (2) `pipeline/grid.py`: re-read `.cache/expsupp/` (Explanatory Supplement v2.0, 2026-08-25): Sect. 3.2.5 "Bad Pixel Flagging", Table 16 lists FULLSAMPLE at bit 12 ("purely informational") and SOURCE at bit 21 ("Pixel mapped to a known source"). Both confirmed; the ignored bits are unchanged. (3) `pipeline/targets.py`: the "adequate at ~0.01 arcsec" claim is now marked UNVERIFIED. (4) `web/index.html` and the archive-search progress line in `web/src/model.js` (same claim, one test updated): "about a minute" became "usually under a minute to a few minutes, depending on the archive", and the sizes and waits are called rough figures.

**Why:** CLAUDE.md: never invent facts; cite or mark unverified.

**Gaps:** not verified: that bit N means 2**N (the table gives bit numbers only); the proper-motion adequacy (no full propagation was done); `IMAGES_PER_MIN` and `MB_PER_IMAGE` are still from one run and only labelled as rough. The "proper motion negligible" note for RW Aurigae in `targets.py` was not reviewed. The index text was screenshotted in the Advanced panel; `make test` and `make verify` passed.

## 2026-11-15: Skip TAP for a while after it fails (T48)
Commit: on branch `tap-skip`, merged to main.

**What:** `pipeline/live.py` `TapHealth`, owned by `LiveBuilder`: when TAP fails, searches for the next 300 s ask SIA2 first (1 to 5 s on EC2); if SIA2 fails too, TAP is still tried. A TAP success clears the pause. Two unit tests with a fake clock.

**Why:** the M42 run on EC2 took 252 s, about 180 s of it two TAP timeouts before the fallback; every visitor would wait that again while TAP is down.

**Gaps:** deployed to EC2, but the check failed for an outside reason: right after the deploy both TAP and the SIA2 `spherex_qr3` search answered HTTP 502, so M42 (fov 0.5) and a second position ended in the "both searches failed" error (16 to 65 s). The new skip path was therefore not seen working on the server; only the unit tests cover it. The 300 s is a guess. The first search after the pause still pays the full TAP wait. A position searched via SIA2 may list fewer images than TAP (T43).

## 2026-11-15: Live build verified on the EC2 server through SIA2 (T10, T43)
Commit: see `git log` (message starts "Deploy: record").

**What:** pulled `origin/main` on the server, rebuilt the image, restarted the viewer. A live M42 build (`load=8`) through `https://16-179-73-6.sslip.io` finished in about 252 s: 8 of 8 frames, `progress.search: "sia2"`, frames fetchable. TAP was still returning 502.

**Why:** the live path was the largest unverified risk for the demo.

**Gaps:** one run. About 180 s of the 252 s were the two 90 s TAP waits before the fallback; a visitor waits that long while TAP is down (idea, not done: skip TAP for a few minutes after it has failed). SIA2 may list fewer images than TAP (539 of 2493 for R Draconis, T43). Not checked in a browser or with TAP up.

## 2026-11-15: Small review items (T47)
Commit: on branch `t47-review-items`.

**What:** T23 findings 7 to 14. `api/main.py`: regexes use `fullmatch` and `[0-9]`; `series.json` is re-read only when its mtime changes and a damaged file is skipped instead of giving a 500; `load` is range-checked only on the live path (`contract.md` says a cached series ignores it; a non-number is still rejected first). `pipeline/tapcache.py`: unique temp file per save, at most 500 entries kept (oldest removed). `pipeline/live.py`: a series rebuilt after losing its pixels keeps its first position, so its id and frame URLs stay; `extend` beyond the images the archive has starts no new pass. `requirements.txt` is now what the service needs, `requirements-dev.txt` adds jsonschema, pytest, httpx (README updated; the container installs only the first). Makefile comment says 8 requests in flight. `setBadge` shows "NO DATA YET" for a `status: "error"` document instead of "REAL DATA".

**Why:** "never invent facts" and a public server: a wrong badge, a 500 from one bad file, and an unbounded cache folder are the kind of small errors a visitor or a reviewer notices.

**Gaps:** not changed: Docker on Python 3.9 (the venv is the same version, so changing it needs its own check) and `vite.config.js` importing the dev mock (not part of the bundle; `bundle.test.js` covers the archive hostname only). The badge change was seen only as "NO DATA YET" on a rejected position in the browser; an error document coming back from the API during a poll was not screenshotted. The 500-entry cap is a guess, not measured.

## 2026-11-15: SIA2 as the backup archive search for live series (T43)
Commits: see `git log` (the contract commit "Contract: optional progress.search", then "T43: SIA2 backup ...").

**What:** a live series asks TAP first (2 tries, 90 s each; before, 3 tries of up to 300 s). If TAP fails, it asks SIA2 (`IrsaClient.sia_rows`, 60 s per collection). The document then says `progress.search: "sia2"` (new optional contract field) and the progress line adds "a backup search was used: this list of images may be incomplete". A SIA2 list is not written to the remembered searches (`tapcache`), so the next request tries TAP again. If both fail, the error names both. The cache build (`make cache`, `make refresh`) still uses TAP only, so a cached target is never built from a partial list.

**Why:** from EC2 on 2026-11-15 SIA2 answered in 1 to 5 s (about half the calls got a 502 first, which the retry covers) while TAP never answered in 10 tries; but SIA2 lists 539 of R Draconis's 2493 images, so it is a backup, not the first choice.

**Gaps:** (1) SIA2 is not made primary: no speed comparison is possible until TAP works again; re-run the EC2 timing then (`docs/spike.md`, section 5), and check a deep field as well. (2) The 90 s TAP limit is a guess: the usual search takes 10 to 67 s and one took about 4 minutes, so a slow but working TAP may now be abandoned. (3) The fallback was tested with fakes only, not against the live archive from the server. (4) The new progress note was checked in a unit test, not in a screenshot: it only appears on the fallback path, which could not be triggered in the browser. (5) The partial-list cause for R Draconis is still unknown.

## 2026-11-15: Rate limit and memory cap for the public server (T45)
Commit: see `git log` on branch `t45-limits` (message starts "T45").
**What:** `GET /api/series` is limited per client address (120 a minute, `SPHEREX_RATE_LIMIT`; HTTP 429 with an error document). Live series now have a total memory budget (pixels plus PNGs, 600 MB): older finished series are evicted, the newest finished one is kept, and a new build is refused while running series alone fill the budget. The image starts uvicorn with `--proxy-headers` so the limit sees the real client behind Caddy. Tests in `tests/api/test_api.py` and `tests/pipeline/test_live.py`; `make verify` passed (no UI change, no screenshot).
**Why:** T23 finding 2: one client could fill the build slots and memory was only bounded for pixels of finished series.
**Gaps:** The 120 a minute and the 600 MB are chosen figures, not measured on the EC2 host (T45's own note said to measure first). `--forwarded-allow-ips='*'` is only safe while port 8000 is not public. One client can still fill the 8 build slots with different positions inside the rate limit (no per-client build quota). Rate-limit state is in memory and per process. Not run inside the container.

## 2026-11-15: SIA2 tried as the archive search; TAP stays (T43)
Commit: see `git log` (branch `t31-tap-or-sia2`, message starts "T43").

**What:** added `IrsaClient.sia_rows` (one SIA2 query per collection, `spherex_dr1` and `spherex_qr3`) and `parse_sia_rows`, which return the same keys as the TAP rows, with unit tests on a small made-up VOTable. Nothing calls it: the build and the live path still use `tap_rows`. Compared it with the saved TAP answers for all five targets (table in `docs/spike.md`, section 5).

**Why TAP stays:** four targets give identical rows, but for R Draconis SIA2 lists 539 images and TAP 2493. Switching would silently drop most of that field's images, and the live path would remember the short list for a week (`tapcache`). Falling back from TAP to SIA2 would have the same problem. The cause of the difference is unknown.

**Update, same day:** timed from the EC2 host: SIA2 1 to 4 s, TAP no answer in 150 s on three tries (`docs/spike.md`, section 5). SIA2 is therefore a working source when TAP is down, but it is not wired in as a fallback because of the R Draconis gap; whether to wire it in (and show the user that the list may be partial) is Dat's decision.

**Gaps:** (1) ~~not timed from the EC2 host~~ done, see the update above. (2) TAP was not timed on a normal day, so there is no like-for-like speed comparison; SIA2's speed matters only if TAP is down again. (3) why SIA2 misses images for R Draconis (a deep field near the ecliptic pole) was not found; it could be asked of IRSA. (4) `access_estsize` is in kilobytes, so `contentlength` from SIA2 is an estimate; nothing reads it. (5) whether SIA2 is required by the challenge is still unverified (see T31). `make verify` was not run for this change; only `make test` (104 passed), because no behaviour changed.

## 2026-11-15: Archive search stays TAP, QR3 confirmed covered (T31)
Commit: see `git log` (branch `t31-tap-or-sia2`, message starts "Docs: T31").

**What:** no code change. Decided to keep the TAP query (`IrsaClient.tap_rows`) instead of switching to SIA2, and documented it in `docs/PLAN.md` and `REFERENCES.md`. Checked QR3 coverage on the saved real archive answers in `.cache/tap/` (read through `observation_key`, `release_of` and `dedupe_prefer_release`): Barnard's Star 239 `dr1` + 119 `qr3`, Epsilon Indi B 338 + 120, R Draconis 1638 + 855, RW Aurigae 226 + 109, WISE 0855 258 + 0. All counts are kept after de-duplication, because in these answers no observation is listed under both releases; the release preference only matters if that happens.

**Why:** TAP already returns both releases and works for every target, so switching would cost work and re-verification against a slow archive for no gain. The only thing that would force a switch is a rule that the tool must use SIA2.

**Gaps:** (1) The phrase "Search DR1 and QR3 through SIA2" comes from the task board; it is not in `docs/PLAN.md`'s summary of the challenge text, and the official page was not re-read, so whether SIA2 is required is unverified. Re-read the Resources tab; if SIA2 is required, this needs a new task. (2) SIA2 got one quick test afterwards, from a laptop, not from the Sydney host: about 1 to 5 s per query, same 258 `dr1` rows for WISE 0855 and 0 `qr3`, while TAP did not answer for over 9 minutes (the archive's bad state of that day; earlier TAP took 10 to 45 s). The rows' columns were not checked. Follow-up: T43. (3) The counts come from searches saved on 2026-11-14 and may be older than the archive; `make refresh` would update them. (4) The WISE 0855 field has no `qr3` images; that is what the archive returned, not checked further.

## 2026-11-15: Reviewer pass over the whole diff since Day 1 (T23)
Commit: see `git log` (message starts "Docs: record the T23 review").

**What:** the `reviewer` agent read `f080347..HEAD` (pipeline, api, web/src, contracts, verify, tests, Dockerfile, Makefile). Read-only: nothing was run and nothing was changed in code. Clean: no secrets or large files committed; no `innerHTML` with untrusted text; no path traversal in frame serving (`ID_RE`, `FRAME_RE`); the live document matches `series.schema.json`; the `extend` hand-off is race-free; the archive request limit is released before a retry sleep.

**Findings (from reading only; the first four marked * were also re-read by me):**
1. Live-build lock held while PNGs are re-rendered (`pipeline/live.py` `_restretch`, `build_stacks`): polls and `LiveBuilder.get_or_start` stall for seconds on a big field of view (T44).
2. No abuse limit on a public server: one client can fill the 8 job slots; memory estimate ignores running jobs' pixels and kept PNG sets (about 165 MB per running 1° series and about 1 GB of PNGs are the reviewer's estimates, not measured) (T45).
3. One bad frame (`ValueError`, WCS `NoConvergence`) fails the whole series and wipes its frames (`live.py` `work`, `_fail`) (T44).
4. * `retry-after` is not capped (`pipeline/irsa.py` `_retry_after`): a large value parks a worker for that long (T44).
5. * `docs/contract.md` decision 13 is stale: it says min(`max_frames`, 40) evenly spaced in time; live frames now use `spread_order` and `load`, so `frames[].index` is not time order for live series (T46).
6. Unverified science in code: flag-bit meanings in `pipeline/grid.py` ("relayed, not re-read"); proper-motion adequacy claim in `pipeline/targets.py`; `IMAGES_PER_MIN` and `MB_PER_IMAGE` come from one local run, and the "about a minute" wording in `web/index.html` is not marked indicative (T46).
7. * `ID_RE` and `FRAME_RE` use `$`, which matches before a trailing newline (harmless, a 404 follows); `\d` accepts non-ASCII digits (T47).
8. `cached()` re-reads every `series.json` per request; a damaged file would give a 500 (T47).
9. `load` is range-checked even for cached series, although `contract.md` says it is ignored there (T47).
10. `tapcache` has no entry cap and a shared `.part` temp name (T47).
11. A rebuilt live series takes the new request's ra/dec, so its id and frame URLs can change (T47).
12. `extend` with a cap above the frame count re-runs the stretch and stacks for nothing (T47).
13. Dev-only packages (`jsonschema`, `pytest`, `httpx`) are in the production image; the web build imports the dev mock; Makefile comment says 4 requests in flight but the limit is 8; Docker uses Python 3.9 (T47).
14. * Error documents carry `data_origin: "real"` and `setBadge` in `web/src/main.js` reads only `data_origin`, so an error may show "REAL DATA": check whether the caller hides the badge on `status: "error"` (T47).

**Why:** Day 1 merge step 4 was never done; the app is now public (T10), so the review matters more.

**Gaps:** the review was by reading; no finding was reproduced by running code, and none is fixed. Each is a todo row (T44 to T47). The reviewer did not check the Python tests, the e2e spec or `web/` styling.

## 2026-11-15: Deployed on AWS EC2 (T10)
Commit: see `git log` (message starts "Deploy: record the EC2 deployment").

**What:** the container runs on an EC2 `t3.small` in Sydney behind Caddy, reachable at `https://16-179-73-6.sslip.io` with a valid Let's Encrypt certificate. From a laptop: the page, `/api/targets` (5), Barnard's Star (38 real frames) and a frame PNG all answered. Server: both containers up, app healthy, 466 MB of 1.9 GB used at idle. Details and the exact commands are in `docs/deploy.md`.

**Why this shape:** the free plan account is locked to Sydney and offers no Arm types; a private repo needed a read-only deploy key; an Elastic IP was attached before the HTTPS name so the name survives a restart.

**Gaps:** a live build (M42) never completed: IRSA's TAP service returned HTTP 502 from the server and from a laptop (the poll kept answering `loading`, 0 frames, for over 9 minutes). So the live path on this server, and its speed from Sydney, are **unverified**. Not checked: `make verify` against the server, a stop and start, load. The link is not yet in the README (T12). The `sslip.io` name is a stopgap; a real domain is better. Remember to terminate the instance and release the Elastic IP when finished, or it keeps billing.

## 2026-11-15: Container built and run locally (T10)
Commit: see `git log` (message starts "Deploy: fix the image build").

**What:** started Docker, built the image for the first time and ran it. Three build failures fixed in the `Dockerfile`/`.dockerignore`: the web stage lacked `fixtures/` and `verify/targets.json` (the Vite config imports the dev-only mock, which reads them), and `numcodecs` had to be compiled on arm64 (gcc installed and purged in the same layer). The running container served the page, `/api/targets` (5), a cached series (Barnard's Star, 38 real frames with flux), a frame PNG, and reported healthy.

**Gaps:** T10 is not finished: nothing is deployed and no host is chosen (needs Dat). Not checked: a live build run to the end in the container, an amd64 build, memory under load, `make verify` against the container.

## 2026-11-15: Data-release updates (T21)
Commit: `d26ff13`.

**What:** `make refresh` asks the archive again for the image list and rebuilds the cached targets (it runs `pipeline.build --refresh-tap`). The release choice is one list, `RELEASE_PREFERENCE` in `pipeline/select.py` (was hard-coded to `dr1`; `dedupe_prefer_dr1` is now `dedupe_prefer_release`, same default behaviour, new test). `docs/data-updates.md` explains the steps.

**Gaps:** not run against the real archive. Only unit tests, `verify-contract` and `verify-docs` ran here (no `make verify`: this worktree has no web build). Not automated: nothing checks for new releases on a schedule, and `make refresh` rebuilds every target. How IRSA names future releases, and whether a newer one supersedes `dr1`, was not checked.

## 2026-11-15: Sexagesimal input (T19)
Commit: `b76cb00`.

**What:** the RA and Dec boxes accept decimal degrees as before, and sexagesimal: `08h55m10.831s`, `8h 55m 10.8s`, `08:55:10.831` or `08 55 10.831` for RA (hours), `-7d14m42.53s`, `-07°14′42.53″`, `-07:14:42.53` or `-07 14 42.53` for Dec. Pasting a pair into either box (`08h55m10.831s -7d14m42.53s`, or six numbers) fills both. A unit letter (h or d) decides the unit. Load converts to degrees, which the boxes and the URL then show. Out-of-range values (RA 24h or more, Dec beyond 90, minutes or seconds 60 or more) get a message that says what is accepted.

**Why:** the challenge gives WISE 0855 as `08h55m10.831s -7d14m42.53s`; a unit test checks that this is the cached 133.795129, -7.245147. No new dependency.

**Gaps:** names ("Orion Nebula") are not resolved; that needs a lookup service. A bare decimal RA is degrees, never hours (a decimal with `h`, like `8.9196h`, is hours). Not tried on a phone keyboard.

## 2026-11-15: Flux stored and charted: Spectrum and Light curve (T29, T30)
Commits: `32492ed` (contract, own commit), `7c83325` (pipeline), `3e4dc80` (cache), `8283816` (web).

**What:**
- Contract (optional, so nothing older breaks): each frame can carry `flux` (`ok` with `flux_ujy` and `flux_err_ujy`, or `ok: false` with a `reason`) and `mjd_avg` (the header's mid-exposure time, next to the archive's `obs_mjd`); the series can carry a `photometry` block with the method (aperture 2 px, ring 4 to 7 px, not aperture-corrected, at the request position). The schema refuses a zero standing in for "no flux".
- Pipeline: `pipeline/build.py` (cached targets) and `pipeline/live.py` (live series) measure the flux on the original cutout, before resampling, with `pipeline/photometry.py` from T28 (merged here). `pipeline/writer.py` writes it.
- The five cached series were rebuilt offline from the cached cutouts: flux for 87 of 102 frames of WISE 0855, 31 of 40 of Epsilon Indi B, 3 of 40 of RW Aurigae, none for Barnard's Star (38 frames) and R Draconis (35): every aperture there carries saturation or blooming flags. Barnard's Star now has 38 frames, not 37, because more of its cutouts were in the local cache than at the first build; its images changed too.
- Web: a panel next to the image (below it on a narrow window) with two tabs. **Spectrum**: flux against wavelength for every measured frame. **Light curve**: flux against date for the frames within 5% of the wavelength on screen, so the vertical wavelength slider drives it. Points are coloured by visit (the same grouping as the visit slider), have error bars, and a click on a point shows that frame (switching to the individual frames if needed). The current frame is marked. A series with no measurable frame gets a plain message ("This is not zero flux") instead of an empty chart. The method, the "not aperture-corrected" caveat and the count of frames without flux are written under the chart. The mock fixture carries SIMULATED flux so the charts work without the backend; the charts say SIMULATED then.
- New `web/src/chart.js` (pure logic, unit tested) and no new dependency: the charts are hand-drawn SVG.

**Why:** the challenge asks for a spectrum and a light curve with real timestamps; until now the page was an image viewer. The light curve uses frames at nearly one wavelength because flux at different wavelengths is not one curve.

**Gaps:**
- **The flux values are not validated.** The aperture, ring and flag rule are first choices (T32). Epsilon Indi B reads about 20,000 to 50,000 µJy with a scatter of a factor of 2 to 4 between frames, and its field has a very bright star at the edge: nobody has checked whether that is the target, scattered light from the star, or a problem with the method. WISE 0855 at its requested position is at the noise level, and its position may be wrong for the observation epoch (T17).
- The light curve exists only where several visits have a frame within 5% of the wavelength; elsewhere it says so. The 5% window is a guess. Whether `mjd_avg` and `obs_mjd` differ by more than minutes was not compared.
- Stacks have no flux. A moving target is not followed (the aperture is fixed on the request position).
- Live series carry flux too, tested with simulated cutouts only: the archive was not answering searches when this was written, so it was not run against real live data.
- The side-by-side layout needs a window about 820 px wide (it first needed 1040 px, and the panel then sat under the image and below the fold in a 930 px window, which looked like the charts were missing; found by the user, fixed in the commit after `8283816`); below 820 px the panel is under the image. The page is up to 1240 px wide. The visit slider's margins were widened so its end labels no longer overflow a 930 px window.
- The demo targets (T41) were built before this change and will need an offline rebuild to carry flux.
- A one-line "how to read this" sits under each chart (what a colour means, that a change must exceed the error bars, that the circle does not follow a moving object); added after the user asked how the charts should be read.

## 2026-11-15: Remembered archive searches and a slow-archive message (T42); demo targets started (T41)
Commits: see the T42 row on the board.

**What:**
- New `pipeline/tapcache.py`: live series remember the archive's list of images for a position under `.cache/tap/live/` (matched to 0.36 arcsec, valid for a week, damaged files ignored). A position searched before skips the search, also after a server restart. The cache build keeps its own copies as before.
- After 90 s the page stops saying the search "usually takes about a minute" and says the archive is slower than usual today and that this step is the archive's own queue.
- T41 (in progress, not committed): three famous positions (Orion M42, Eagle M16, Andromeda M31) are being added to `verify/targets.json` and built into `static/series/`, so a demo does not depend on the archive. Positions were read from SIMBAD (simbad.cfa.harvard.edu TAP) on 2026-11-15. The entries stay out of git until their series are built, because `make verify` needs every configured target built.

**Why:** a live position took about 4 minutes to start once, and at the time of writing the archive's search service did not answer a trivial query within 60 s or 120 s (its web page answered at once). Remembering searches and having cached famous positions are the two things that remove the archive from a demo. The archive timeout was not shortened: a cancelled search would lose its place in the archive's queue and may be slower, and nothing measured says otherwise.

**Gaps:**
- T41 is not finished: the build was still on its first archive search about 10 minutes in. Until it finishes the demo targets do not exist; the site works without them.
- A position nobody has searched before still pays for the search.
- The slow message gives no countdown or retry count; the page does not know whether the server is retrying.
- The 90 s threshold is a guess from four observations (47, 55, 67 s, and about 4 minutes).

## 2026-11-15: Staged loading of a live position (T40)
Commits: `7e23de0` and `1ddb0f8` (contract, own commits), `5725cb3` (backend), see the T40 row for the web commit.

**What:**
- A position that is not cached now loads a first batch of 8 frames, chosen by `pipeline.select.spread_order` so that any first N cover the observation dates and the detector bands (greedy farthest-point order on date and band). The page then offers "Load 16 more" and "Load up to 102 / Load all N", each with a time estimate and, for the big one, the download size. Nothing loads by itself after the first batch.
- A live series is one job per position and field of view. A larger `load` extends it: frames already loaded keep their index and URL, only new images are fetched, and the stretch and stacks are rebuilt when they are in. While it loads, the response keeps the previous stacks (contract change `1ddb0f8`), so the view does not jump.
- `progress.available` (new, optional, contract commit `7e23de0`) says how many images the archive lists; the page shows "8 of 269 images loaded". While the archive search runs (total still 0) the page says so, with the seconds elapsed and "usually about a minute".
- 8 archive downloads at once instead of 4 (`MAX_IN_FLIGHT`). Network errors were already retried like HTTP 503s.
- A finished series keeps its pixels so it can be extended; to bound memory only the most recent ones do (300 MB budget). Extending an older one builds it again from its kept archive rows, without searching again.
- Cached targets are untouched (no `load` is sent for them, and the API ignores it for them).

**Measured (this machine, one position, one run, RA 135 Dec -7.245, against the real archive):** search 40 s; first frames on screen after 48 s; the first 8 ready after 56 s; extending to 24 took 24 s more (about 40 images a minute). Before, the same position showed nothing for about a minute and took about 4 minutes for 40 frames. Earlier direct tests: archive search 47 to 67 s over three runs; 8 at once about 30 images a minute against about 14 at 4; 12 at once had the server reset a connection; the cutout service cannot leave out its 3.9 MB PSF table (checked in its documentation and with requests), so each image stays about 4.4 MB.

**Gaps:**
- The archive search (about a minute, not under our control) still comes first for every new position and is not cached between server restarts.
- The time estimates assume 30 images a minute, measured once; they will be wrong when the archive is slower.
- 12 downloads at once was not safe in one test, so 8 is the ceiling; the effect of many visitors sharing the 8 slots was not tested.
- Reading only the needed pixels straight from the AWS copy of the archive was tried by hand (about 10% of the bytes, no faster from here, flags extension not decoded) and not built. It may be worth another look if the backend is deployed in AWS us-east-1 (T10).
- Pixels are kept for a few finished series; a visitor who comes back to an older position and asks for more waits for the downloads again.
- "Load all" is capped at 102, the contract ceiling, even when the archive lists more (269 here).

## 2026-11-15: A simple first screen, advanced settings folded away (T39)
Commits: see the T39 row on the board.

**What:**
- Top bar: the cached targets are a dropdown bar ("Target: WISE 0855", one line per target, the technical note in full on hover; it closes when a target is picked or on a click elsewhere), next to the RA and Dec boxes. Paste "RA Dec" (separated by a space, a comma or a semicolon) into either box and both fill; one value pastes as usual. Decimal degrees only, as before (sexagesimal is T19).
- Below the image: a one-line caption in words (for example "Visit 2 of 3 · dates · 128 images combined, 0.74-5.00 µm"), a "By date | By wavelength" toggle in place of the View selector (the selector stays, visually hidden, as the state), the step and play buttons, and the visit slider. The visit slider now also serves the stacked view, so both views look the same. The empty column and the "Pick a wavelength" button of the stacked view are gone.
- Folded under "Advanced": speed, zoom, blink widest pair, mark centre, detector band, difference from first visit, field of view, the frame readout, the stretch legend and the long explanations.
- The image is sized to the window height so the image, caption and sliders fit on a laptop screen; on a phone width the visit labels drop their dates (the caption has them).
- Tests: unit tests for the paste split and the caption; the browser tests open the folds where they use hidden controls and cover the menu, the paste, the toggle and the caption.

**Why:** requested: simple at first sight, with the filters and settings an astronomer wants available but out of the way. No contract change, no new dependency.

**Gaps:**
- The Spectrum and Light curve tabs next to the image are not built: they need the flux measurements stored and served (T29, T30). The page is a single column 900 px wide and will need widening for them.
- Target cards still carry the technical SIMBAD note (one line, full text on hover). A short plain-language line per target was left out: it would be new scientific text that nobody has checked.
- No introductory sentence about SPHEREx was added for the same reason.
- The Advanced fold is not remembered between visits.
- Looked at on a laptop-sized window and a 375 px phone width in Chromium; not tried on a real touch device or other browsers (T25).

## 2026-11-15: Buttons follow the two sliders (T38)
Commits: see the T38 row on the board. Replaces the Play selector of T37.

**What:**
- The Order selector (Time or Wavelength) and the Play selector are gone: with a visit slider and a wavelength slider they said the same thing twice. Individual frames are always in time order underneath (this only shows in "1 of 102" and in the hidden slider).
- With the sliders in use the buttons follow the axes: "◀ Visit" and "Visit ▶" step the visit (keeping the wavelength as nearly as possible), "▼ λ" and "λ ▲" step the wavelength within the visit, "Play across visits" holds the wavelength and cycles the visits, "Play through wavelengths" holds the visit and goes from the shortest wavelength to the longest and back. While one plays the other is disabled and the playing one reads "Pause". A note says what is held. With a single visit only the wavelength buttons show.
- In the stacked view, with "Blink widest pair" on, or with fewer than two wavelengths, the buttons are the plain "Step" and "Play" as before. The detector Band filter of the stacked view is unchanged.
- Unit test for the turn-round step (`pingPong`); the Playwright tests drive the step and play buttons.

**Why:** requested after trying T37: the Order selector no longer meant anything the user could see. Play follows the axis the way the arrow keys already did. No contract change, no new dependency.

**Gaps:**
- The old "walk through every frame in time order" play is gone from the individual-frames view (it mostly showed the background changing); the plain frame walk remains for the stacked view and for pair blinking.
- The Band (detector) filter applies to the stacked view only; the individual frames are not filtered by detector.
- Playback speed stays at 5 fps; the Speed setting changes it.
- Not tried on a touch screen or outside Chromium (T25).

## 2026-11-15: Play across visits at one wavelength (T37)
Commits: see the T37 row on the board.

**What:** a "Play" selector for the individual frames when the series has two or more visits. "Across visits, same wavelength" (the new default) shows each visit in turn at the wavelength the current frame had when Play started: the frame of each visit closest to it, wrapping round. The wavelength is held from the start, so it does not drift from one visit to the next, and a note says which wavelength is held. "Through the frames, in Order" is the old behaviour. Step, the arrow keys, the stacked view, "Blink widest pair" and series with a single visit are unchanged. Unit test for `cycleVisit`; a Playwright test checks that each visit always shows the same frame while playing, and the other mode.

**Why:** the useful blink for spotting motion is one wavelength seen at different dates; walking through frames in time order mostly shows the background changing. No contract change, no new dependency.

**Gaps:**
- The held wavelength is only matched as nearly as each visit allows; the nearest frame in a visit can be a few tenths of a micrometre away (the readout shows it).
- The speed stays at the individual-frames default of 5 fps, which is quick for three or four visits; the Speed setting changes it.
- A series that finishes loading autostarts in the stacked view, so the new mode is reached by choosing Individual frames and pressing Play.
- Not tried on a touch screen or outside Chromium (T25).

## 2026-11-15: Say why the stacked view has no wavelength slider (T36)
Commits: see the T36 row on the board.

**What:** a series opens in the stacked view, which has no wavelength slider (a stack combines a whole band), and the slider was found missing twice. In the stacked view there is now a "Pick a wavelength" button in its place, with the note "Stacks have no single wavelength"; it switches to the individual frames, where the visit and wavelength sliders are. The real-data browser test checks both states.

**Why:** a hidden control reads as a missing one. The default view was left alone: the stacked view is the better first look, and the choice of a different default is the user's.

**Gaps:** the default view is still the stacked one; the button is the only pointer to the sliders.

## 2026-11-15: Visit slider and evenly spaced wavelength marks (T35)
Commits: see the T35 row on the board. Refines T34.

**What:**
- The visit buttons are now a horizontal slider: one evenly spaced mark per visit, labelled with the visit number, its dates and its frame count. Drag or click to change visit; the wavelength is kept as nearly as possible. A new visit shows up as another mark, because visits are read from the data (the response's `stacks.visits`, or the 30-day gap rule while loading).
- The vertical wavelength slider no longer places marks by wavelength value. Each frame of the visit is one evenly spaced mark, shortest wavelength at the bottom, so every frame can be reached and one drag step or arrow press is one frame. The real wavelengths are written beside it (about seven, first and last always; the current one at the handle, in the accent colour), and a small break is drawn where the wavelength jumps by more than three times the typical step (needs 4 or more frames in the visit).
- Unit tests for the spacing, the labelling and the gap rule; the Playwright test drives both sliders.

**Why:** the log-scale slider crowded many frames into a few pixels and was hard to land on; the choice was agreed in chat. No contract change, no new dependency.

**Gaps:**
- The real spacing in wavelength is only visible through the written values and the breaks; the gap rule (3 times the typical step, and over 0.1 in log) is a first choice and not tuned.
- Marks are per visit, so the handle can change height when the visit changes.
- Whether further visits will appear as the telescope revisits the sky was not checked here; the control follows whatever visits the data has.
- Not tried on a touch screen or outside Chromium (T25).

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

## 2026-11-14: Flux extraction (T28)
Commits: `35c9528`

**What:**
- New `pipeline/photometry.py`: `measure_flux(cutout, ra, dec)` does circular aperture photometry (radius 2 pixels, sub-pixel weights) on the native cutout, with a background from the median of a 4 to 7 pixel ring. It returns flux in microjansky and a 1-sigma uncertainty (the VARIANCE extension summed over the aperture, plus the background level's uncertainty). If any aperture pixel is non-finite or flagged (other than the SOURCE and FULLSAMPLE bits) it returns no flux and says why.
- `pipeline/cutout.py` now also returns the VARIANCE extension and `MJD-AVG`, and has helpers for sky-to-pixel and pixel solid angle.
- 13 new tests on simulated cutouts (known flux recovered within 2%, background level does not matter, reported error matches the scatter over 300 noise draws, flagged and NaN pixels).
- Tried on every cached real cutout (not part of the repo, a scratch script): wise0855 224 measured of 258, epsindb 31 of 40, rwaur 3 of 40, barnard 0 of 170, rdra 0 of 35.

**Why:** aperture photometry on the native cutout avoids the interpolation of the shared grid and is simple to explain. No new dependency (numpy and astropy only). Returning no flux for a flagged aperture rather than a partial sum avoids a number that is biased low.

**Found on real data:**
- A NaN pixel with zero weight turned the whole sum into NaN. Fixed and covered by a test.
- Barnard's Star and R Draconis get no measurement: their apertures carry OVERFLOW, SUR_ERROR and BLOOM flags (Explanatory Supplement v2.0, Table 16, the cached copy in `.cache/expsupp/`), as expected for bright stars. Bright targets will have no spectrum under this rule.

**Gaps:**
- Aperture and ring sizes, the all-or-nothing flag rule and the error model are first choices, not tuned or checked against a source of known brightness (T32). No aperture correction, no PSF fit.
- Epsilon Indi B gives about 27,000 uJy between 1.2 and 3.6 um, a nearly flat spectrum. Not checked against any reference, so it is not known whether that is the target, a neighbour or a problem.
- WISE 0855 values are at the noise level (median error 62 uJy); the position may also be wrong for the observation epoch (T17).
- Nothing calls `measure_flux` yet: the build, the live path, the contract and the API do not carry flux (T29), and nothing is displayed (T30).
- The timestamp question (`time_bounds_lower` against `MJD-AVG`) is left to T29.

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
- The frontend outside Chromium, Firefox and WebKit (Playwright builds); real Safari, mobile browsers and a hand-made paste in Firefox are untested.
- The submission deadline.

## T16 + T18: deeper stacks, failed frames retried

**What:** Set `stack_images: 120` in `verify/targets.json` for Barnard's Star, Epsilon Indi B, RW Aurigae and R Draconis and re-ran the build (`pipeline.build --only`, resumed from `.cache/`). Visit stacks and difference images now come from 119-120 images per target (was 35-40); the 40 shown frames are unchanged in choice. The 8 frames that had failed earlier (Barnard's Star 3, R Draconis 5) downloaded this time: `done=40 failed=0` for all four. `make verify` passes.
**Why:** The challenge asks to add images together to improve signal-to-noise; the stacks used only 1-3 images per detector per visit.
**Gaps:** Epsilon Indi B has 119 images (the archive returned one fewer than 120). The cutout images are 120 per target, not every available image (Barnard's Star has 170 cached). Not checked visually beyond the `make verify` screenshots. Flux series were not recomputed beyond what the rebuild did.

## T15: WISE catalogue overlay

**What:** `GET /api/catalogue` (`pipeline/catalogue.py`, contract `contracts/catalogue.schema.json`) returns AllWISE Source Catalog sources for the field through the existing IRSA client; the web app draws them as orange circles when "Show WISE catalogue sources" (under Advanced, off by default) is ticked. The note under it says REAL catalogue data, gives the median catalogue observation date of the shown sources and says positions are not corrected for proper motion. A service failure gives a short message and leaves the images alone. Code `8d4ea30`.
**Why AllWISE and not Gaia or Aladin Lite:** the server already reaches IRSA (no new host to allow in the container), WISE is infrared like SPHEREx, and a small endpoint plus a canvas is much less to ship tonight than Aladin Lite. The documented ESA Gaia TAP sync endpoint (`https://gea.esac.esa.int/tap-server/tap/sync`) timed out from the development machine, so Gaia was not built.
**Gaps:** (1) The live query was never confirmed: IRSA TAP answered HTTP 502 for every request on 2026-11-15, so the ADQL (table `allwise_p3as_psd`, columns `w1mpro`, `w1mjdmean`, `designation`) is untested against the service; tests use a fake transport. Run `curl "localhost:8000/api/catalogue?ra=133.795&dec=-7.245"` once IRSA is back. (2) The UI screenshot used SIMULATED catalogue rows from a throwaway script (not in the repo) because of (1); it shows the drawing and the real-data note wording, not real AllWISE positions. (3) The AllWISE reference epoch was not found in the docs read; the page quotes the catalogue's own `w1mjdmean`. No proper motion is applied for WISE 0855, Barnard's Star or Epsilon Indi, so T17 (where WISE 0855 is now) is not answered. (4) `pipeline/irsa.py` got a small `tap_query` method (outside the listed Touches).

### T15 follow-up after review

Fixes: `/api/catalogue` has the same per-client rate limit as `/api/series` (429 with `Retry-After`) and a small answer cache (64 entries, 10 minutes, keyed on `ra`, `dec` rounded to 4 decimals and `fov`; failures are not cached). The query makes one attempt with a 20 s timeout and waits on its own gate (`CATALOGUE_IN_FLIGHT = 2` in `pipeline/irsa.py`), so it cannot take a slot from image downloads. The unsourced "3.4–22 µm" is gone; the `w1mjdmean` meaning and the table name are described as taken from IRSA text found by search, the Explanatory Supplement not read (see `REFERENCES.md`). The overlay redraws on window resize, and hovering a circle shows its designation, W1 magnitude and catalogue epoch. Tests: poles and RA wrap in the query text, one attempt, cache and 429, `fetchCatalogue`, `medianMjd`, and a Playwright check of the overlay on the mock API (SIMULATED sources).
**Live query:** still NOT confirmed. IRSA TAP answered HTTP 502 again on 2026-11-15. Once it is back: `curl -s https://irsa.ipac.caltech.edu/TAP/sync --data-urlencode REQUEST=doQuery --data-urlencode LANG=ADQL --data-urlencode FORMAT=csv --data-urlencode "QUERY=SELECT TOP 3 designation,ra,dec,w1mpro,w1mjdmean FROM allwise_p3as_psd WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',133.795,-7.245,0.05))=1 ORDER BY w1mpro"` and check the column names.
## T49: "epoch" instead of "visit" in the UI

**What:** Everything a user reads now says "epoch" where it said "visit": caption, readout, slider labels, step and play buttons, tooltips, legends, chart legend and help text, `README.md` (`web/index.html`, `web/src/main.js`, `web/src/model.js`). Tests that assert the strings were updated (`web/test/`, `web/e2e/`, `web/e2e-real/`). Code identifiers, CSS classes, JSON fields, contracts and API stay `visit`; `docs/structure.md` has a naming note.
**Why:** Dat's decision; "visit" read as a person visiting. No definition of an epoch was added, only the word changed.
**Gaps:** Contract descriptions in `contracts/series.schema.json` and `docs/contract.md` still say "visit" (not changed: needs its own commit and Dat's say-so). The UI has no text about catalogue epochs yet; when T15 merges, its wording must say "catalogue epoch" in full and any "visit" it adds needs renaming.

## T50: sky backdrop (Aladin Lite, DSS2 colour)

**What:** `web/src/sky.js` loads Aladin Lite 3.8.2 from jsdelivr when the page is wide (900 px or more) and has WebGL, and shows the DSS2 colour survey dimmed (opacity 0.6) behind the whole page. `load()` calls `showSky(ra, dec, fov)`: the first Load starts wide (150 degrees, off to the side) and flies in over 2.5 s; later Loads fly from where it is. It ends 1 degree wide, 1.5x the field for 0.5 and 1 degree (0.75 and 1.5). The view takes no clicks (checked: the Clicked point click on the SPHEREx image works with it on). A line under the top bar says: background sky, DSS2 colour (optical, plates from about 1975 to 1999), not SPHEREx data, does not show where a moving object is now. Cited in `REFERENCES.md`. Commit `1163911`.
**Why DSS2 colour:** stars are visible and the sky stays dark; not compared with 2MASS or AllWISE (no time left, and DSS2 read well in the screenshots). The 1975-1999 years are the survey record's `t_min`/`t_max` (MJD 42413 to 51179), not something I measured.
**Fallbacks:** the script import has a 10 s timeout; the survey is probed on three servers (CDS, STScI/MAST, CSIRO, from the survey's own record) and the first answer is used; if nothing works, or WebGL or the script fails, `body.sky-on` is never set and the page is as before (checked with the CDN blocked: no change, no errors). Automated browsers (`navigator.webdriver`) get no backdrop unless `?backdrop=on`, so the Playwright specs are unaffected (they pass).
**Gaps:** (1) The CDS HiPS server returned an error page for DSS2 colour on 2026-11-15, so the page used the MAST copy; the CDS first-choice path was not seen working. (2) Aladin Lite 3.8.2 sends a usage log request (with the page URL, which holds the RA and Dec) to `alasky.unistra.fr`; that host does not resolve (NXDOMAIN, 2026-11-15), so it fails and prints one `Failed to fetch` error in the console, which does not affect the page. Not patched; it would be a privacy question if the host came back. (3) Only checked in Chromium with software WebGL (SwiftShader) and in the app browser pane; not on a GPU, Firefox or Safari. (4) The survey is not time-matched to the SPHEREx epochs. (5) No test of the animation itself beyond screenshots mid-flight and at the end.

### T50 review fixes

**Changed:** (1) `body.sky-on` (backdrop and label) is set only after Aladin Lite is running and one real survey tile (`Norder3/Dir0/Npix0.jpg`, content type image) has loaded from one of the three servers; otherwise the page stays as before. (2) The label now carries the credit line, copied from the survey's own record (`obs_copyright`: "Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS"), and says the sky position is sent to the survey tile servers and to jsdelivr. (3) SRI: `dist/aladin.js` is fetched, hashed with SHA-384 and compared with the pinned hash (computed from the 3.8.2 file, 2390678 bytes) before it is imported from a blob URL; a mismatch gives up quietly. Needs `crypto.subtle`, so on plain http (not localhost) the backdrop is simply off. (4) `matchMedia` is read inside the `try`; the box uses `inset:0; width/height:100%`; a Load that is overtaken by a newer one does not start its own flight. (5) Four Playwright cases (script blocked, no tile, wrong hash, and a stand-in Aladin: `elementFromPoint` over the SPHEREx canvas is the canvas and the Clicked point click works). A test can replace the pinned hash with `window.__skyHash`; that is only a test hook. (6) The board keeps T50 in progress until merged.
**Seen today (2026-11-15):** the CDS server (`alasky.cds.unistra.fr`) still answered 404 for DSS2 colour tiles, so the MAST copy was used; the backdrop drew from it with the real Aladin Lite 3.8.2 through the blob import (screenshots: desktop shows stars, 700 px wide is hidden, CDN blocked leaves the page unchanged). **Credit wording:** copied from the survey record, not checked against the STScI copyright page itself. The usage-log failure to `alasky.unistra.fr` (NXDOMAIN) is unchanged.

## 2026-11-15: Redeployed latest main to EC2 (b877d4c)
**What:** server updated from `6c8cddd` to `b877d4c` (git pull, docker build on the server, container replaced; `spherex-viewer:previous` kept for rollback; about 10 s downtime). Verified from outside: HTTPS page, 5 targets, bundle has Aladin, catalogue and "Clicked point", Barnard series (40 frames) and frame PNG, container healthy, about 80 MB memory.

**Gaps:** IRSA returned HTTP 502, so `/api/catalogue` errored and a spectrum request on a non-cached grid stayed `loading`; live builds and the catalogue are unverified on the server. Cached-target spectrum on click not checked in a browser. The bundle still contains the word "visit" in code (epoch/visit data fields); user-facing text uses "epoch" (not read through in the browser).

### T50 fix: target menu hidden behind the page

With the backdrop on, `header`, `.topbar` and `main` all had `z-index:1`, and `main` (later in the page) painted over the target menu that overflows the top bar. Fix: `body.sky-on .topbar { z-index:3 }` (`web/src/style.css`); the backdrop is still click-through. A Playwright case (backdrop forced on with the stand-in Aladin) checks that `elementFromPoint` at the centre of every menu option is inside `.targets` (it fails without the fix, at option 1) and that picking the last option loads it. Other overflowing things were checked by reading the CSS: the catalogue hover label (`.cat-tip`), the Advanced panel and the charts are inside `main` or in normal flow, so `main`'s z-index does not hide them; not each one re-tested with the backdrop on.

## 2026-11-15: Redeployed 69433e0 to EC2
**What:** target-menu stacking fix deployed (build on server, container swapped, about 10 s downtime). Checked from outside: page 200, 5 targets, `.topbar` z-index 3 under `sky-on` in the CSS, Barnard series (40 frames), healthy. **Gaps:** menu not clicked through in a browser on the public site; IRSA-dependent paths not rechecked.

### T50: backdrop at first paint; orange image panel

`idleSky()` (called once from `main.js`) starts Aladin after the page `load` event and when the browser is idle (`requestIdleCallback`, 500 ms timer if missing), on an arbitrary wide view (RA 150, Dec 20, 150 degrees across; not a target; TAN shows it stretched at the edges). Same rules as before: shown only after a tile loads, falls back quietly, click-through, off below 900 px. Load flies from there. The label says "arbitrary wide view ... not a target" until the first flight (`body.sky-flown`). The on/off decision is now made once per page load, because Load rewrites the URL and drops `?backdrop=`. The label adds one line to the first screen when the backdrop is on (it was already there after Load); nothing was added when it is off. The image panel (`.stage`) has a 2px `var(--accent-panel)` border, `#e07b00`, chosen by screenshot: it is distinct from the SIMULATED badge orange (`#ff9f1a`) and the blue active button, and readable on both the dark page and the backdrop; checked with the backdrop on, off and at 700 px. Playwright: backdrop starts with no position (stand-in Aladin), border colour. The idle view was only seen in Chromium with software WebGL.

## 2026-11-15: Redeployed b7feb5e to EC2
**What:** idle backdrop and orange panel border deployed (server build, container swapped, about 10 s downtime). Checked from outside: page 200, 5 targets, new CSS and JS present, Barnard series (40 frames), healthy. **Gaps:** not looked at in a browser on the public site; IRSA-dependent paths not rechecked.

## 2026-11-15: Extra work Dat asked for, logged as T51 to T53
**What:** three pieces of work that were done on request in the same session but were not on the board, now logged. T51: the target dropdown covered by the page text when the backdrop is on (stacking fix, `69433e0`). T52: backdrop on a wide sky view before any Load, and the orange image-panel border (`b7feb5e`). T53: three redeploys to EC2 and their docs notes (`0007f3a`, `8ce7156`, `b5e0702`).

**Why:** the board should show everything that changed, with a number, so the work can be found later. T17 (WISE 0855 marker) was cancelled by Dat the same day, see "Cancelled" in `TASKS.md`.

**Gaps:** nothing new beyond the entries each piece already has. The info-icon text simplification is in progress under the next ID.

### T54: "i" icons, simpler text

New `web/src/info.js`. An "i" button with a popover (`role="tooltip"`, `aria-describedby`, `aria-expanded`): hover shows it and leaving hides it; a click pins it and a second click closes it; Escape and a click elsewhere close it; keyboard focus shows it; a tap toggles it. The popover is moved to `<body>` (z-index 1000), so the `.topbar` / `main` stacking problem of T51 cannot cover it, and is placed below or above the icon and kept inside the screen (max 320 px wide). An "i" whose popover has no text hides itself.

Moved into an "i" (text kept): the long part of the RA/Dec hint; the sky-backdrop explanation, full credit and privacy sentence (the label now reads "Background: DSS2 sky survey (STScI/NASA, CDS), not SPHEREx data"); "how to read this chart" and the photometry method (one "i" beside the chart tabs); catalogue detail (proper motion, catalogue epoch, truncation); the wide-field reason; "more images" explanation; the epoch-play and widest-pair explanations; the tooltips of the Advanced options; the brightness-scale text; the two long Advanced paragraphs (live building, reading the image; each now has a one-line summary). Shortened with the meaning kept: archive-wait text ("depending on the archive" dropped), slow-archive text, backup-search note, "building a live series" message for a clicked cached target, catalogue line. Stays visible: badge, progress and error texts, "REAL catalogue data", "Real SPHEREx data" on the clicked-point chart, "SIMULATED." in chart titles, frames-without-flux counts, load buttons with time and size.

Not changed: `title` tooltips on the image, sliders, tabs and view buttons (already hover text), the target menu's one-line position note (full text on hover, as before), the orange image panel, backdrop behaviour.
Checked: `make test`, `make verify`, `make verify-docs`, Playwright mock specs on Chromium, Firefox and WebKit (the keyboard Tab test is skipped on WebKit, which does not Tab to buttons by default). The real Aladin backdrop was not checked with live tiles here (the tests use the stand-in).

## 2026-11-15: Redeployed 6e5ea47 to EC2
**What:** T54 info icons deployed (server build, container swapped, about 10 s downtime). Checked from outside: page 200, 5 targets, info-icon code in the bundle, Barnard series (40 frames), healthy. **Gaps:** popovers not opened in a browser on the public site; IRSA-dependent paths not rechecked. `docs/TASKS.md` left alone.

## T55: position mark and globe start on the sky backdrop
**What:** (1) The idle backdrop is now the whole sky as a globe: `projection: 'SIN'`, `fov: 360` (same option names as before; SIN is Aladin Lite 3.8.2's default projection, found in `dist/aladin.js`). `fov` is the width of the view, so 360 across a wide window shows the whole sphere with its edge, like the Aladin Lite web page (checked by screenshot at 1440x900; 180 showed only the middle of the sphere). (2) On Load a magenta crosshair (`#ff66ff`, thin lines, gap in the middle, dark glow) is drawn at the RA/Dec as a one-source Aladin catalogue whose shape is a canvas, so it stays on its star as Aladin pans and zooms; moved on each Load; none in the idle view. It is inside the `.sky` box, so `pointer-events:none`, the 900 px rule, the fallback and reduced motion are unchanged. (3) Placement: the image panel and controls cover most of the page, so the view centre is shifted (`viewCentre`) to put the position in the translucent header strip (screen centre, half the header height); in the first screenshot attempt with the mark at the centre it was hidden behind the panel. The mark is therefore visible with the page scrolled to the top and not after scrolling down. The header overlay was made lighter (`#0f111570`) so the mark shows. (4) Label: "(the whole sky, not a target)" before a position, "(the cross marks the position you loaded)" after; the longer text is in the "i" popover. Credit line kept.
**Not done:** zoom out then in when another target is chosen (it flies directly from the previous view). The shift uses a flat approximation (fov width / window width per pixel), so the mark lands near, not exactly at, the intended height; not matter for a mark. The mark is dim (the backdrop is drawn at 60% opacity under a translucent header); the colour was raised from the first try for this.
**Checked:** real Aladin Lite with the STScI tile server (tiles did load today, CDS did not resolve from this machine): idle globe, after Load, 800 px wide (no backdrop, no mark), CDN blocked (page as before). Vitest, Playwright mock specs (stand-in Aladin now records projection, fov, catalogue shape and mark position).


### T56: friendly error messages

Why: during IRSA's HTTP 502 outage a visitor saw "The archive query failed: TAP query failed after retries: HTTP 502; the SIA2 fallback also failed: ...". Now `error.message` is one plain sentence and the technical text is in a new optional `error.detail` (contract commit `bdfadfe`; series, spectrum and catalogue schemas), which the page shows only in an "i" popover (`info.js`) and the server writes to its log (`spherex.live`, WARNING). The texts are all in `pipeline/messages.py`; `clientError` in `web/src/api.js` does the same for failures of the request itself. Rule kept: a service failure is never worded as "no data".

Old text → new text (message; the old text is now `detail` where it carried information):
- Both searches failed ("The archive query failed: TAP ...; the SIA2 fallback also failed: ...") → "The search failed because NASA's data archive (IRSA) is not available right now. Try again in a few minutes. The cached targets still work." If either cause was HTTP 429: "NASA's data archive (IRSA) is asking for fewer requests right now, so this position could not be searched. Try again in a few minutes. The cached targets still work."
- "The SPHEREx archive lists no images covering this position." → "The archive lists no SPHEREx images covering this position. Try another position or one of the cached targets."
- "None of the N images could be read from the archive. Try again later." → "The archive listed images for this position, but none of them could be downloaded right now. Try again in a few minutes. The cached targets still work." (detail: N planned images)
- Unexpected exception in a build ("ValueError: ...") → "Something went wrong while building this position. Try again, or pick another position. The cached targets still work." (detail: the exception)
- "Too many positions are being built right now. Try again in a few minutes." → "Many positions are being built right now. Try again in a few minutes. The cached targets still work."
- "The server is holding as much data as it can. Try again in a few minutes." → "The server is holding as much data as it can right now. Try again in a few minutes. The cached targets still work."
- "Too many requests from this address. Wait a minute and try again." (HTTP 429, series and catalogue) → "You are sending requests too fast. Wait a minute and try again." (detail: per-client rate limit). The page now reads the body of a non-200 reply, so this text reaches the visitor.
- "The pixels of this series were released to save memory. Load the position again." → "The data for this position was released to save memory. Load the position again."
- No live builds (SPHEREX_LIVE=0): "No cached series within 1 arcsec ... nothing is built live." and "Only fov=0.2 is cached, ..." → "This server only shows its cached targets; other positions cannot be built here."; spectrum: "Clicking a point needs live data, which this server does not build."
- Catalogue: "The catalogue service (IRSA) did not answer: HTTP 502. The images are not affected; try again later." → "The WISE star catalogue could not be fetched from NASA's archive right now. The images are not affected."; unreadable answer → "The WISE star catalogue answer could not be read. The images are not affected."; off → "The WISE star catalogue overlay is not available on this server."; network → "The WISE star catalogue could not be fetched right now. The images are not affected." (the box line no longer starts "WISE catalogue sources unavailable.")
- Browser, HTTP error without our JSON ("GET /api/series returned HTTP 502") → "The server could not answer right now. Try again in a few minutes. The cached targets still work."; network failure ("Failed to fetch") → "This page could not reach the server. Check your internet connection and try again."; unreadable reply → "The server sent an answer this page cannot read. Try again in a few minutes. The cached targets still work."; targets list failed → "The list of targets could not be loaded. Reload the page in a few minutes."
- A bad frame: progress "2 failed" → "2 skipped"; "Frame N of the planned series was skipped (the API could not build it)." → "Frame N was skipped: the archive did not return a usable image for it."
- Spectrum fallback "The spectrum could not be measured." → "The brightness at this point could not be measured. Try again in a few minutes."

Not changed: input validation messages (bad RA/Dec, fov, load), reachable only by editing the URL by hand. The archive's own retry-after waits are not a separate visitor message: they end in the "not available" text above.

Tests: `tests/pipeline/test_messages.py` (no developer words in any text, 429 told apart, detail kept, logged), updated live, catalogue and API tests, `clientError` unit tests in `web/test/api.test.js`, two Playwright cases (a long 502 detail shows only the short text with the detail in the "i"; a raw HTTP 502 reply). Screenshots: `verify/out/error-archive-down.png` (desktop, popover open) and `error-archive-down-narrow.png` (390 px).

Gaps: the "i" for the chart message and catalogue line is wired but only the main message box has a Playwright case for it. Chromium only.

## 2026-11-15: Redeployed 1914fa7 to EC2
**What:** T55 and T56 deployed (server build, container swapped, about 10 s downtime). Checked from outside: page 200, 5 targets, SIN and `#ff66ff` in the bundle, friendly `error.message` plus `error.detail` on a failing catalogue request (IRSA 502), Barnard series (40 frames), healthy. **Gaps:** the globe and crosshair were not looked at in a browser on the public site; the friendly text for a failed live series build was not seen (the build was still `loading`).

## T59: position mark removed
**What:** Dat decided the magenta crosshair of T55 was not a good idea. Removed the mark (canvas shape, catalogue layer, colour, `.sky-mark` CSS, the label and "i" text about the cross) and the `viewCentre` offset, which existed only so the mark sat in the header strip: the fly-in now ends centred on the position, as in T50 (simpler and the T50 behaviour). The header overlay is back to `#0f1115b0`. Kept: the SIN globe start (`fov` 360), fly-in, reduced motion, tile-loaded gating, fallback, click-through, credit and privacy text. Tests: the mark cases and the `viewCentre` unit tests are gone; the globe case and a fly-in-to-RA/Dec case remain.

