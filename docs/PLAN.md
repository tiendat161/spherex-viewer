# PLAN.md: NASA Space Apps 2026, "Planet X and SPHEREx"

Status as of 2026-11-09 evening. Items marked (unverified) come from memory or secondhand sources: check them before relying on them.

## Goal
- Main goal: learn to build an end-to-end app with an AI assistant (parallel worktree sessions, subagents, verification loops).
- Also: a CV-worthy repo; a live demo if free hosting works, otherwise a full-stack project that runs locally.
- Not aiming to win. Solo. About 30 hours across Nov 14-15, working from home (the Singapore venue is for kickoff only).

## Key dates
- Fri Nov 13: the challenge's **Resources** tab goes live (the page says so). Read it that evening.
- Sat Nov 14: kickoff. Exact time: check Space Apps Connect or the site (a repo README said 9:00 AM; unverified).
- Nov 14-15: hackathon (per public listings). Judging starts Nov 16 (secondhand). **Submission deadline: unknown, check at kickoff.**

## Rules
- The official challenges page says: "Do not begin work on your projects until the hackathon begins." So before kickoff: learning and generic tooling only. No challenge code, no SPHEREx archive queries, no solution design.
- Still to read: rules on AI tool use, open-source licensing, judging criteria.

## The challenge (official text unchanged between Nov 8 and Nov 9)
- Public web tool: the user enters RA/Dec; the tool shows a series of SPHEREx images of that patch, like a short video, to spot moving objects.
- Test on: Barnard's Star, Epsilon Indi B, WISE 0855 (08h55m10.831s, -7d14m42.53s), RW Aurigae, R Draconis.
- Optional ideas: easy data updates; combine the 102 bands and 6 detector arrays; spectra; add/subtract frames; choose field of view; Gaia/WISE overlays; coordinates in the URL; metadata and contamination flags; Astropy and Aladin.

## Schedule
- Done Nov 8: RA/Dec basics, coords.py with tests, agent files working, SIMBAD lookups, WISE 0855 epoch check.
- Done Nov 9: FITS and WCS, stretches, cutout.py plus review, quiz (7/8, then 8/8).
- Tue Nov 10: archive concepts from public docs only (TAP/ADQL, ObsCore, cutout services, pyvo); ADQL practice on an unrelated catalogue; read the rules; write a one-page "how my tool will get data" note.
- Wed Nov 11: stretches and the blink-player idea on any unrelated image; generic frontend template (Vite, Aladin Lite hello world, `?ra=&dec=`) and generic backend template (FastAPI, Docker, CI, free-host deploy).
- Thu Nov 12: parallel-agents dry run on an unrelated toy app (3 hours), then a no-notes retest of RA/Dec, east/west direction and numpy (y, x).
- Fri Nov 13: read the Resources tab; rest; check logins and charger; decide on Claude Max 5x (not yet decided).
- Event Day 1 (~15h): spec and API contract (1h); feasibility spike on one target, and decide backend vs direct browser calls (2h); pipeline and UI shell in parallel (5h); integrate, `make verify` on all 5 targets, first live deploy (4h); fix and handoff notes (2h).
- Event Day 2 (~15h): features (field of view, stack/subtract, flags); one stretch goal (Gaia/WISE overlay or spectra); hardening and README; demo video and submission; buffer. Cut order if late: stretch goals, overlays, stacking; keep the 5 targets and the live link.

## Decisions so far
- Tools: Claude Code in VS Code and desktop; CLAUDE.md plus subagents (verifier, reviewer, researcher); Max 5x for the event. No Codex or DeepSeek.
- Architecture direction: Python pipeline (query metadata, fetch small cutouts, fixed stretch, frames plus JSON, cache), a small API, a static front end, Aladin Lite for overlays. Backend vs direct browser calls decided in the Day 1 spike (CORS).
- Confluent Cloud dropped: batch archive data does not need streaming. Stretch goal only.
- Contract first: a JSON schema agreed between pipeline, API and UI before parallel sessions start.
- Archive search is TAP (ADQL), not SIA2 (T31, 2026-11-15). The challenge text summarised above does not require SIA2; TAP returns both `dr1` and `qr3` images, and QR3 images are used. Unverified: the official challenge page was not re-read for this, so if it does require SIA2 this decision needs revisiting. Details in `docs/WORKLOG.md`.
- Crop with sky coordinates through the WCS, never raw pixel numbers.
- Use fixed stretch limits across all frames of a blink; let users switch stretch.
- Keep prep code and the hackathon repo separate; copy only the generic `templates/` at kickoff.

## What I learned (short)
- RA = longitude (hours, 1h = 15 deg); Dec = latitude (degrees). 1 deg of RA covers cos(Dec) of the sky.
- Positions need an epoch: WISE 0855's challenge coordinates are about 2010; by 2026 it has moved about 127 arcsec.
- CRPIX = reference pixel in the image; CRVAL = its RA/Dec; the CD matrix gives scale and rotation. Negative CD1_1 means east is left.
- numpy shape is (y, x); astropy counts pixels from 0, FITS from 1.
- AI-written tests can pass while protecting nothing: run a mutation check.

## Open questions
- Which epoch do the organizers intend for the target coordinates?
- SPHEREx pixel scale (about 6 arcsec; unverified); how WISE 0855 and bright stars like R Dra appear (unverified).
- How data is served (IRSA TAP and cutouts?): confirm from docs and the Resources tab.
- Rules on AI tools and licensing; submission deadline.
- Backend vs direct browser calls to the archive.

## Handoff for a new chat
"I'm doing NASA Space Apps 2026 (Planet X and SPHEREx) solo, to learn AI-assisted end-to-end building. Read PLAN.md in my repo for the schedule, decisions and open questions. Today is day N of the prep plan."
