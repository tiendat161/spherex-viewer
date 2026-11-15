# SPHEREx viewer

A web tool for NASA Space Apps 2026, challenge "Planet X and SPHEREx". Enter a sky position (RA/Dec), and blink through real infrared images of that patch taken by the SPHEREx space telescope, by date or by wavelength, to spot things that move or change. It also shows the visits stacked together and the difference between visits.

**Status:** deployed on one AWS EC2 instance at https://16-179-73-6.sslip.io (see `docs/deploy.md`); the cached targets were checked from outside. The live path (any other position) was **not** verified on that server: the archive's search service answered HTTP 502 at the time. The submission paperwork is still in progress.

## What it does

- **Any position.** Type RA/Dec in decimal degrees or sexagesimal, or paste "RA Dec" together, or pick a target. Positions are also read from the URL: `/?ra=133.795129&dec=-7.245147&fov=0.2`.
- **Five test targets are cached** and open at once: WISE 0855, Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis. They are the ones named in the challenge.
- **Any other position is built live** from the IRSA archive: a first batch of 8 frames spread over dates and bands (the archive search is the slow part: usually under a few minutes, depending on the archive), then "Load more" or "Load up to 102".
- **Views:** individual frames (step through visits at one wavelength, or through the wavelengths), stacked visits per detector band, and the difference from the first visit. Background is subtracted per image.
- **Field of view:** 0.1°, 0.2° (default), 0.5° or 1°. Cached targets are 0.2° only; other sizes are built live.
- **Metadata** per frame: date, wavelength, flagged-pixel fraction, and a REAL / SIMULATED badge. Everything built from the archive is real; the simulated badge appears only for the mock data used in frontend development.

## Run it

Needs Python 3.9+ and Node.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
cd web && npm install && npm run build && cd ..
make dev            # http://localhost:8000
```

Live positions contact the IRSA archive, so they need internet access. `SPHEREX_LIVE=0` turns live builds off.

```bash
make test           # unit tests (Python and web)
make verify         # offline end-to-end check on all five targets, with screenshots in verify/out/
make cache          # rebuild the cached targets from the archive (contacts IRSA)
```

## How it is organised

`contracts/` (JSON schemas) → `pipeline/` (archive client, cache build, live builds) → `api/` (FastAPI) → `web/` (Vite, no framework). `docs/structure.md` has the request flow and a "to change X, look in Y" table. `docs/WORKLOG.md` records what was done and what is still unverified.

## Known limits

- The first batch for a new position waits for the archive search (not timed on the deployed server), and live series are kept in memory only.
- Not checked outside Chromium. The submission deadline and WISE 0855's proper motion are unverified (see `docs/WORKLOG.md`, "Not verified").
- Flux charts (Spectrum, Light curve) use a first-choice aperture that is not yet validated (T32). Not yet built: spectrum at a clicked point, Gaia/WISE catalogue overlays, per-pixel flag detail. The task board lists them.

## Data and credits

Data: SPHEREx images and the archive search from NASA/IPAC IRSA. Sources, libraries and tools are listed in `REFERENCES.md`.

## AI usage

Built with Claude Code (Anthropic): the code, tests and documentation were written in AI-assisted sessions, directed and reviewed by the author. See `REFERENCES.md`.
