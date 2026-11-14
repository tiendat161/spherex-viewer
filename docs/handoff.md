# Handoff

Written 2026-11-14, end of the Day 1 build. For whoever (or whichever chat) picks this up next. Read this, then [`structure.md`](structure.md) for the layout and [`build-plan.md`](build-plan.md) for the plan.

## Where things stand

A working prototype is on `main`, committed locally. It is **not pushed**: `main` is 24 commits ahead of `origin/main` once this file is committed. It is not deployed.

- **What it does:** pick one of the five challenge targets and watch up to 40 real SPHEREx frames blink, with date, wavelength and flagged fraction per frame, and a REAL DATA badge.
- **How it runs:** `pipeline/` built a static cache in `static/series/` from the IRSA archive; `api/` (FastAPI) serves that cache and the built frontend; `web/` is the viewer. The browser never contacts IRSA.
- **Checks:** `make verify` passes: 34 backend tests, 22 frontend tests, the contract check on the fixture and all five cached series, and an end-to-end run of each target through the API and a browser.

| Target | Frames | What the screenshot shows |
|---|---|---|
| WISE 0855 | 40 of 40 | Star field, nothing at the marker. Target not confirmed visible. |
| Barnard's Star | 37 of 40 | Bright star under the marker |
| Epsilon Indi B | 40 of 40 | Nothing obvious at the marker; a very bright object (presumably Epsilon Indi A, not checked) floods the right edge |
| RW Aurigae | 40 of 40 | Bright source under the marker |
| R Draconis | 35 of 40 | Bright source under the marker; a few frames have no-coverage areas |

## After the restart

Nothing needs recovering; everything is committed. The local server stops with the restart. To bring it back:

```
cd web && npm run build      # only if web/dist is missing
make dev                     # API plus frontend on http://localhost:8000
make verify                  # full offline check, about 15 seconds
```

The two build sessions' worktrees (`.claude/worktrees/build-backend-2cca9d`, `build-web-cb39ff`) are fully merged and have no uncommitted work. They and their branches can be removed.

## What to do next, in order

1. **Push `main`** to `origin`. Until then the only copy is this machine.
2. **Decide hosting and deploy** (the floor in `PLAN.md` is "five targets and the live link"). Two routes:
   - host the FastAPI app as is on a free Python or Docker host (needs a Dockerfile; free-tier limits not checked);
   - or make the deployed version fully static, reading `static/series/` directly, which runs on GitHub Pages or Cloudflare Pages with no backend.
3. **Run the `reviewer` agent on the full diff.** This was step 4 of the merge order and has not been done.
4. **Retry the 8 failed frames** (3 for Barnard's Star, 5 for R Draconis) with `make cache`. This contacts IRSA; it resumes from `.cache/`, so only the missing frames are fetched.
5. **WISE 0855.** Find out whether it is visible at all, and where. Prep work put the challenge coordinates at about epoch 2010.45, so the target should sit about 126″ from the marker. Options: mark the expected 2025 position on the frame, or centre the cached series on it. Ask the organisers which epoch they intend.
6. **Reduce the band flicker.** Frames are in time order, which interleaves wavelengths with very different background levels. Ordering or grouping by wavelength, or a per-band stretch, are the candidates (contract decisions 3 and 7); either changes `docs/contract.md`.
7. **Submission paperwork:** rewrite `README.md` (it still says "generic scaffolding only"), finish the TODOs in `REFERENCES.md` and add the tools now actually used but not listed there (jsonschema, pytest, httpx, Vitest, Playwright, ajv), record the demo video. **The submission deadline is still unknown: check it first thing.**
8. **Day 2 features** from `PLAN.md`, if time allows: field-of-view choice, frame add/subtract, switchable stretch, Gaia/WISE overlay. Building a series live for arbitrary coordinates is the largest of these and is first on the cut list.

## Things that are not verified

- WISE 0855's proper motion (quoted secondhand in the spike, not read from the paper).
- The native SPHEREx pixel scale; the contract fixes 6.2″.
- That the bright object in the Epsilon Indi B field is Epsilon Indi A.
- The exact Gaia archive endpoint used in the spike (TODO in `REFERENCES.md`).
- Flag meanings beyond Table 16 of the Explanatory Supplement: the mask ignores only `SOURCE` and `FULLSAMPLE`; every other bit counts as flagged.
- The frontend was checked in Chromium only.

## Rules that still apply

From `CLAUDE.md`: read `contracts/` before touching an interface and change a contract in its own commit; never invent scientific numbers; keep real and simulated data labelled; a task is done only when `make verify` passes and, for UI changes, a screenshot was inspected. `make cache` is the only command allowed to contact IRSA, at most 4 requests at a time.
