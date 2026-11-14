# CLAUDE.md (generic template; fill in at project start)

## Project
One paragraph: what we're building, who for. (Fill at kickoff.)

## Layout
- `pipeline/`: Python data pipeline
- `api/`: FastAPI service
- `web/`: frontend
- `contracts/`: JSON schemas shared by pipeline, api and web (source of truth)

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
