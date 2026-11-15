# Submission pack (T62)

Written 2026-11-15 (about 13:00 UTC) against `origin/main` at `eed4140`, then rebased onto the tip that has T60 and T61 (section 3 rewritten for the 30 s video). Read-only review: no code, `README.md` or `REFERENCES.md` was changed. Statuses are honest: **done** = built and checked; **partly**; **not done**; **unverified** = not confirmed.

Requirements source: `docs/PLAN.md` ("The challenge" section) is a summary written on 2026-11-09. **The official challenge page was not re-read for this document**, so the list below is only as complete as that summary. The submission form fields are known only from the section names in `REFERENCES.md` ("NASA Data", "Space Agency Partner & Other Data and tools", "AI usage").

## 0. The 5 findings that could make the submission fail (ranked)

1. **Repository visibility and licence: Dat's decision.** `gh repo view` says `tiendat161/spherex-viewer` is **PRIVATE**, and the root has **no LICENSE file** (README says so too). `docs/PLAN.md` still lists "rules on AI tool use, open-source licensing" under "Still to read", so what the challenge requires (public code? an open licence? access for judges?) was **never checked**. If judges must open the repository, a private repo may fail. Nothing to do until Dat reads the rules and decides.
2. **Deadline unconfirmed.** `docs/PLAN.md` and `docs/WORKLOG.md` ("Not verified") say it is unknown. A blog said 15 Nov 2026 23:59 local; not confirmed. Treat it as tonight.
3. **IRSA is still down.** At about 13:00 UTC today `https://irsa.ipac.caltech.edu/TAP/capabilities` and `/SIA/capabilities` both returned HTTP 502. Any position that is not cached fails (friendly error), and the catalogue overlay is unconfirmed. The video must use the five cached targets only, and nobody should type a new position live in the demo or in front of a judge.
4. **`REFERENCES.md` has an open `TODO` that only Dat can answer** (AI-written versus hand-written split, and that scientific claims were checked). It is a section of the submission form. Also stale in `REFERENCES.md`: it still describes the removed position mark (see section 6).
5. **No demo video exists yet** (task T61). It is the one deliverable still entirely missing, and it has a hard rule: **30 seconds or less** (or at most 7 slides), otherwise the project is ineligible for Global Judging. Script and voice-over in section 3; disclose the AI-generated ElevenLabs voice-over.

Good news, checked from outside just now: the public site loads (HTTP 200 in 0.4 s), the five cached targets answer with 102 frames (WISE 0855) or 40 frames (the other four), all `ready`, `data_origin: real`; the HTTPS certificate is valid (Let's Encrypt, issued 15 Nov 2026, expires **13 Feb 2027**). `make test` passes. See section 5.

## 1. Requirements checklist

Challenge text from `docs/PLAN.md`: "Public web tool: the user enters RA/Dec; the tool shows a series of SPHEREx images of that patch, like a short video, to spot moving objects. Test on: Barnard's Star, Epsilon Indi B, WISE 0855, RW Aurigae, R Draconis." Optional ideas: easy data updates; combine the 102 bands and 6 detector arrays; spectra; add/subtract frames; choose field of view; Gaia/WISE overlays; coordinates in the URL; metadata and contamination flags; Astropy and Aladin.

### Required

| # | Requirement | Status | Evidence |
|---|---|---|---|
| R1 | Public web tool | done | `https://16-179-73-6.sslip.io` (T10, `docs/deploy.md`); checked from outside today (HTTP 200, valid certificate). One EC2 instance; manual deploys |
| R2 | User enters RA/Dec | done | T06, T19 (decimal, sexagesimal, paste both). Cached targets: reliable. **Any other position: partly**, built live from IRSA, which is down today (finding 3) |
| R3 | Series of SPHEREx images "like a short video" | done | T01, T04, T38 (Play buttons, blink by epoch or by wavelength). All cached images are real archive data |
| R4 | Spot moving objects | partly | Blink, stacked epochs, difference from first epoch (T05, T08, T16). Nothing is identified automatically. WISE 0855's proper motion is **unverified** (`docs/WORKLOG.md`, "Not verified"); T17 (marker where it should be now) was cancelled |
| R5 | Five test targets work | done | `/api/series` answers `ready` for all five today; `make verify` runs them offline (section 5). Epsilon Indi B's bright field-edge object is unconfirmed (T24) |

### Optional considerations

| # | Consideration | Status | Evidence |
|---|---|---|---|
| O1 | Easy data updates | done | T21: `make refresh`, `docs/data-updates.md`. Not exercised on a new release |
| O2 | Combine the 102 bands | done | T04 (WISE 0855: one frame per band, 102 frames from 258 images); "Combined" stacks per detector band (T08) |
| O3 | Combine the 6 detector arrays | partly | Stacks are per detector band (T08, T16); the six arrays are shown as band choices, not merged into one image. Wording of what exactly the page does with the six arrays is not checked here |
| O4 | Spectra | done | T30 Spectrum tab, aperture flux in microjansky with error; photometry checked against 2MASS stars on two fields, 1.2 to 2.2 µm only (T32, `docs/photometry-validation.md`). Click-for-spectrum (T14) was hidden from the page by T58 |
| O5 | Light curve with real timestamps | done | T29, T30 (mid-exposure times stored in the series) |
| O6 | Add / subtract frames | done | T08 stacks and "Difference from first epoch" |
| O7 | Choose field of view | done | T13: 0.1°, 0.2°, 0.5°, 1°; `&fov=` in the URL. Cached targets are 0.2° only; other sizes need the archive |
| O8 | WISE overlay | partly | T15 AllWISE sources, Advanced option. **Unverified** against the live service (IRSA 502); only code and mocked tests are checked |
| O9 | Gaia overlay | not done | Gaia is not queried by the app (`REFERENCES.md`) |
| O10 | Coordinates in the URL | done | T02: `/?ra=133.795129&dec=-7.245147&fov=0.2`. Page returns 200 |
| O11 | Metadata | done | T03: date, wavelength, flagged fraction, REAL / SIMULATED badge |
| O12 | Contamination flags | partly | Flagged fraction per frame only; per-pixel flags (T20) not built |
| O13 | Astropy | done | Used in `pipeline/` (`REFERENCES.md`) |
| O14 | Aladin | done | T50: optional DSS2 sky backdrop (not SPHEREx data), desktop only, Chromium-checked only |

### Other deliverables (from the form and the project rules)

| Item | Status | Evidence |
|---|---|---|
| Demo video (30 s or less) | **not done** | T61; script in section 3 |
| Project description for the form | drafted | Section 2 |
| Data and tool references | done | `REFERENCES.md` (one fix needed, section 6) |
| AI-assistance statement | partly | `REFERENCES.md` "AI usage" and README say Claude Code wrote the code; the exact split is a `TODO` for Dat |
| Licence | **not done** | No LICENSE file; options in section 4 |
| Code accessible to judges | **unverified** | Repository is private; see finding 1 |

## 2. Project description for the submission form

**Three lines**

1. Type a sky position (RA/Dec) and blink through real SPHEREx infrared images of that patch, by epoch or by wavelength, with stacked and difference images.
2. Spectrum and light-curve charts at the position, a field-of-view selector, and coordinates in the link.
3. Five test targets are ready to open at once; other positions are built live from the NASA/IPAC IRSA archive, which was down for much of 15 November.

**One paragraph**

SPHEREx viewer is a public web tool for the "Planet X and SPHEREx" challenge. You enter a sky position (or pick one of the five test targets: WISE 0855, Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis) and the page shows real SPHEREx infrared images of that patch as a blink: step or play through epochs at one wavelength, or through wavelengths, look at the images of each epoch added together, or at the difference from the first epoch, to spot things that move or change. Each frame shows its date, wavelength and the fraction of flagged pixels, and carries a REAL DATA badge: all images come from the NASA/IPAC IRSA SPHEREx archive; nothing is simulated. Spectrum and Light curve charts show aperture flux at the position (microjansky, with an uncertainty), and the field of view can be 0.1, 0.2, 0.5 or 1 degree. The five test targets are cached and open reliably. A position you type yourself is built live from the archive, which depends on IRSA being up: its search services returned HTTP 502 for much of 15 November, so live builds and the optional WISE catalogue overlay are unconfirmed on the server. The coloured sky backdrop (DSS2 through Aladin Lite) is optional decoration and is not SPHEREx data. Not built: a Gaia overlay, per-pixel flag detail, any automatic detection of moving objects. The code and documentation were written with Claude Code (Anthropic), directed and reviewed by the author.

## 3. Demo video script: 30 seconds at most (task T61)

Rule (from the T61 row, quoting the Space Apps Singapore guide): a video of **30 s or less**, or at most 7 slides; exceeding either makes the project ineligible for Global Judging. Aim for **26 to 28 s**. The 2 to 3 minute script that this section held before was **dropped**; do not submit a longer cut.

Setup: record the live site after T60 is deployed (the toggle now reads **Combined** / **Single images** on `origin/main`; if the server is older, redeploy first or re-read the labels). Desktop width, hard reload, cached target only (IRSA returned HTTP 502 much of 15 Nov). Start from `https://16-179-73-6.sslip.io/?ra=133.795129&dec=-7.245147` so WISE 0855 is already loaded and no dropdown time is spent. Show no NASA or SPHEREx logos and do not alter any (the page has none; do not add any), and use no AI-generated imagery.

**Voice-over (64 words, about 25 s at a calm pace; replace the two bracketed names).** Structure from T61: name and team, challenge, project name and tagline, solution and NASA open data, future impact. The wording avoids claims that depend on IRSA being up.

> I'm Dat, from team [team name]. For the challenge Planet X and SPHEREx, we built [project name]: blink through the sky. Choose a sky position and see real SPHEREx infrared images, combined per epoch or as single images by wavelength, with difference images and a spectrum. It uses open NASA IRSA data. Anyone can look for moving objects, and the next discovery could be yours.

(The draft in the shared notes, `t61-narration.md`, says "type any position", "by time ... by wavelength" and "Planet X hides in infrared sky surveys"; the first overclaims while live builds are down and the last is not a checked statement. Dat decides which wording to use.)

| Seconds | On screen: exactly what to do | Voice-over words |
|---|---|---|
| 0 to 4 | Page already loaded on WISE 0855, REAL DATA badge visible. Do not click | "I'm Dat, from team [team name]. For the challenge Planet X and SPHEREx," |
| 4 to 8 | Keep still; the sky backdrop and the title are on screen | "we built [project name]: blink through the sky." |
| 8 to 14 | Click **Single images** (already selected: if so, do nothing), click **Play across epochs** (or **Play**): frames blink, date and wavelength change | "Choose a sky position and see real SPHEREx infrared images," |
| 14 to 19 | Click **Pause**, click **Combined**, click **Play** | "combined per epoch or as single images by wavelength," |
| 19 to 23 | Open **Advanced**, tick **Difference from first epoch** (stacked view) | "with difference images and a spectrum." |
| 23 to 26 | Click the **Spectrum** tab; chart visible | "It uses open NASA IRSA data." |
| 26 to 28 | Hold on the page with the chart | "Anyone can look for moving objects, and the next discovery could be yours." |

Check the total is under 30 s on the exported file (not only the recording); if it runs over, cut the Pause and Advanced steps first. Rehearse twice before the real take.

**Disclosure and upload (from T61):** upload publicly (YouTube or Drive, no login needed) with **AI-generated voice-over (ElevenLabs)** in the title or description and in the file metadata. Field 8 of the form must also say the code was written with Claude. Check the link in a private window. Fallback if the upload fails: 3 or 4 screenshots as slides (at most 7 slides).

### Screenshots worth attaching (take at 1440 px wide, desktop)

1. **WISE 0855, single image with metadata:** pick WISE 0855, **Single images**, a mid-wavelength frame; shows image, date, wavelength, Flagged, REAL DATA badge.
2. **Stacked epoch, same target:** **Combined**, shows the deeper image and the epoch caption.
3. **Difference image:** Advanced, "Difference from first epoch" on, on Barnard's Star (large proper motion, per `docs/spike.md`; the visible shift is not measured in this document, so look before you caption it).
4. **Spectrum tab** (and, if space allows, the **Light curve** tab) with the error bars.
5. **URL with coordinates:** the address bar showing `?ra=133.795129&dec=-7.245147` beside the loaded page.

How: the automated run of `make verify` already writes one screenshot per target to `verify/out/<id>.png` (see section 5), useful as a fallback; for the others use the browser's own screenshot (macOS: Shift-Command-4, then Space, then click the window) after a hard reload.

## 4. Pre-submission checklist for Dat (in this order)

| Box | Do | Notes |
|---|---|---|
| 10 min | **Confirm the deadline** on the official Space Apps site or Space Apps Connect; write it at the top of your screen | Unconfirmed. If you cannot open it, assume 23:59 tonight local |
| 15 min | **Read the challenge and event rules** on licensing, AI-tool use, and what judges must be able to open | `docs/PLAN.md` says these were never read. Settles finding 1 |
| 10 min | **Repository access**: either make the repository public, or add the judges or organisers as read-only collaborators, or submit only the live link, as the rules allow | Your decision. The deploy key on the server is separate and read-only; making the repo public would not expose it, but check Settings > Deploy keys first |
| 5 min | **Licence**: if the rules ask for open source, add a LICENSE file. Options (you choose): MIT (short, permissive), Apache-2.0 (permissive, patent grant), BSD-3-Clause (permissive), GPL-3.0 (copyleft), or CC0 / Unlicense (public domain). Third-party material keeps its own terms (Aladin Lite, DSS credits) | I did not choose one |
| 10 min | **Fill the AI-assistance split** in `REFERENCES.md` ("AI usage", the `TODO`), and tick off that scientific claims were checked against the cited sources | Only you can write it |
| 10 min | **Apply the README / REFERENCES fixes** from section 6, after T60 has merged | Then run `make test` |
| 25 min | **Record the 30 s video** (T61) with the script in section 3, **after T60 is deployed**; measure the exported file (must be 30 s or less); upload publicly with AI-generated voice-over (ElevenLabs) in the title or description | Cached targets only; no NASA or SPHEREx logos; check the link in a private window |
| 10 min | **Take the 5 screenshots** | Section 3 |
| 10 min | **Open the public link once more** in a private window, and click the five targets | Last check before pasting |
| 10 min | **Paste the form** (field 8 must also say the code was written with Claude): link `https://16-179-73-6.sslip.io`, the three-line and one-paragraph text from section 2, the repository link, the video link, the screenshots, the references | Save a draft; submit with at least 30 minutes to spare |
| 5 min | **Submit, then keep the confirmation** (screenshot of the submitted page) | |

## 5. Read-only check results

| Check | Result |
|---|---|
| Public URL | `https://16-179-73-6.sslip.io/` HTTP 200, 0.4 s |
| Page with coordinates | `/?ra=133.795129&dec=-7.245147` HTTP 200 |
| `/api/targets` | The five targets listed (WISE 0855, Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis) |
| `/api/series` for the five | All `ready`, `data_origin: real`, `progress` complete: WISE 0855 102 of 102 frames, the other four 40 of 40, by the coordinate form (`?ra=&dec=`). **Note:** `/api/series?id=wise0855` returns a short "not found" style reply, because `id` is the live-job id, not the target id: do not use it to check cached targets |
| HTTPS certificate | Let's Encrypt (CN=YE2), subject `16-179-73-6.sslip.io`, valid 15 Nov 2026 to **13 Feb 2027** |
| IRSA TAP and SIA | HTTP 502 at about 13:00 UTC today |
| README link to the site | The URL is in the README and works. The GitHub repository URL returns 404 to an anonymous request, because it is private |
| `make test` on `origin/main` | **Passes**: 181 Python tests, 124 web tests |
| `make verify` on `origin/main` | **Passes**: contract and docs checks, all tests, then the offline end-to-end run on the five targets (WISE 0855 102 of 102 frames, the other four 40 of 40, uncached position returns a contract-valid error, browser checks, screenshots in `verify/out/`). It ran in this worktree after adding this file to `docs/structure.md` |
| Secrets in the tree | None found: no private key, `.pem`, `.env`, AWS key id, GitHub or Slack token, or key-like assignment. Keyword matches in the tree are only the word "token" in `verify/check_docs.py` and `web/test/api.test.js` (a JSON parse message). Nothing is printed here by design |
| Secrets in git history | None found: searched all commits for `AKIA...`, `BEGIN ... PRIVATE KEY`, `ghp_`, `github_pat_`, `xox[bp]-`, `sk-...`, and key/secret/password/bearer assignments: 0 commits each. No `.pem`, `.env`, `id_rsa` or `.key` file was ever committed. A pattern search can miss unusual formats; it is not a proof |
| Large files | Pack 11.6 MiB for the whole history, 3,436 objects. Largest blobs are old versions of `docs/WORKLOG.md` (about 90 KB). Largest tracked files: `docs/WORKLOG.md` 92 KB, `web/package-lock.json` 44 KB, `static/` (cached frames) 4.3 MB in total. No FITS or datasets committed |
| `.gitignore` | Covers `.cache/`, `.venv/`, `node_modules/`, `dist/` (so `web/dist`), `*.pem`, `.env`, `*.fits`, `verify/out/` |
| Stray committed symlink | `web/node_modules` is **tracked in git** as a symlink to an absolute path on the author's machine (`/Users/<user>/development/.../web/node_modules`), added by commit `c051d9f` (T14). Harmless to the app, but it exposes a local home path and is a dangling link on any other machine. Suggested fix (not applied, repository hygiene): `git rm --cached web/node_modules` in its own commit (the ignore rule `node_modules/` does not match a symlink; use `node_modules` without the slash). Do it before the freeze or not at all |
| LICENSE | None (README says "The repository has no licence file yet") |
| Repository visibility | PRIVATE (`gh repo view`) |
| README renders | Headings, bullets and the code fences are plain Markdown and consistent with the board, except the items in section 6 |

## 6. Suggested README / REFERENCES fixes (not applied; apply after T60 merged)

1. **`README.md`, intro (line 3).** Before: `blink through real infrared images of that patch taken by the SPHEREx space telescope, by date or by wavelength, to spot things that move or change. It also shows the epochs stacked together and the difference between visits.`
   After (T60 has merged: the page now says Combined / Single images): `blink through real infrared images of that patch taken by the SPHEREx space telescope, as single images or as combined images per epoch, to spot things that move or change. It also shows the difference from the first epoch.`
   (Also "visits" became "epochs" in T49.)
2. **`README.md`, "Views" bullet.** Before: `individual frames (step through epochs at one wavelength, or through the wavelengths), stacked epochs per detector band, and the difference from the first epoch.`
   After: `individual frames ("Single images": step through epochs at one wavelength, or through the wavelengths), "Combined" epochs per detector band, and the difference from the first epoch.`
3. **`REFERENCES.md`, last paragraph, sentence "The position mark (T55) is an Aladin Lite catalogue ... and is decoration, not data."** Stale: T59 removed the mark. Delete that sentence, or replace with: `The position mark of T55 was removed again (T59).`
4. **`REFERENCES.md`, "AI usage" `TODO`.** Dat to replace `TODO: the author should confirm ...` with the real split and a statement that the scientific claims were checked (or which were not: see `docs/WORKLOG.md` "Not verified").
5. **`README.md`, "Data and credits".** After the licence decision, replace `The repository has no licence file yet.` with the chosen licence.
6. **`README.md`, "Status".** Add the demo video link when it exists (T61).
7. **Stray symlink**: see the "Stray committed symlink" row in section 5.
8. **`docs/TASKS.md` row T55** (Done) still says `not yet merged`, but `0650a3a` is on `origin/main`. Not changed here (the board rows belong to their owners); suggest the master edits it.

## 7. Freeze list (do not touch in the last hour)

- Anything in `web/`, `api/`, `pipeline/`, `contracts/` and `static/series/` (the cached data): no features, no "small fixes". A bad last-minute change cannot be redeployed safely if the deploy session is busy.
- **No redeploy** of the EC2 host in the last hour, except to roll back to `spherex-viewer:previous` if the site is broken. Do not restart Caddy or Docker, or change the security group or the Elastic IP (the public name is built from the IP).
- No new cached targets (T41 stays parked) and no rebuild of the cache: `make cache` and `make refresh` contact IRSA, which is down, and would overwrite working series.
- No dependency changes (`requirements.txt`, `web/package.json`, lockfiles).
- Do not rename the repository or change the GitHub URL after pasting it in the form.
- Allowed: wording-only changes to `README.md`, `REFERENCES.md` and `docs/` (after T60 has merged), the LICENSE file, and the repository visibility change. Run `make test` after any edit.
