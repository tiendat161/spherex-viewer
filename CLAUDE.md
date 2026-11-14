# CLAUDE.md

## Project
A public-facing web tool for a hackathon challenge: the user enters a sky position (RA/Dec) and blinks through real SPHEREx infrared images of that patch, ordered by time or wavelength, with stacked and difference images. Five test targets are cached; any other position is built live from the IRSA archive. The challenge text and goals are in `docs/PLAN.md`.

## Layout
**Read `docs/structure.md` first, before searching the code.** It has the request flow from browser to archive, a "to change X, look in Y" table, and one line per source file.

- `contracts/`: JSON schemas shared by pipeline, api and web (source of truth)
- `pipeline/`: Python: archive client, cache build, live builds
- `api/`: FastAPI service
- `web/`: frontend (Vite, no framework)
- `verify/`, `tests/`: acceptance targets and checks
- `docs/`: task board, work log, contract write-up, structure guide

## Commands
- `make dev`: run everything locally
- `make test`: unit tests
- `make verify`: end-to-end check on all acceptance targets (see Done criteria)

## Working rules
- Read `contracts/` before touching any interface; change a contract in its own commit and say so.
- Small commits; one concern per commit; run `make test` before committing.
- Never invent scientific facts or numbers; cite the source or mark it unverified.
- Label real data vs simulated data in the UI and in code.
- Don't add dependencies without saying why.
- A commit that adds, moves or removes a source file, or changes what a file is for, updates `docs/structure.md` in the same commit. `make verify-docs` fails on a missing or dead file name.

## Task tracking
- `docs/TASKS.md` is the task board (`todo`, `in progress`, `done`). Dat edits it often: re-read it at the start of every session and before picking a task, and never overwrite or revert rows you did not change.
- Work is done by several Claude sessions in parallel, one task per session. Before starting, mark the task `in progress` with your branch or session name; check its "Touches" column against other tasks in progress.
- When a task is finished: mark it `done` with the commit hash and add an entry to `docs/WORKLOG.md` (what, why, gaps), in the same branch as the work.
- Both files are written in English.

## Done criteria
A task is done only when `make verify` passes and, for UI changes, a screenshot was taken and inspected.

## Never
- Commit secrets or API keys
- Download large datasets into the repo (cache under `.cache/`, gitignored)
- Skip failing checks to make them pass
