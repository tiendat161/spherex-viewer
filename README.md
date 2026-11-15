# SPHEREx viewer

A web tool for NASA Space Apps 2026, challenge "Planet X and SPHEREx". Enter a sky position (RA/Dec), and blink through real infrared images of that patch taken by the SPHEREx space telescope, by date or by wavelength, to spot things that move or change. It also shows the epochs stacked together and the difference between visits.

**Status:** deployed on one AWS EC2 instance (Sydney) at https://16-179-73-6.sslip.io (see `docs/deploy.md`). The five cached targets open at once and were checked from outside.

**How to try it:** open the link and pick one of the five cached targets from the dropdown (WISE 0855 is the first). That is the reliable path. Any other position is built live from the IRSA archive, which depends on IRSA being up: both its search services (TAP and SIA2) returned HTTP 502 for much of 15 November, so live builds failed then. One live position (Orion M42, 8 frames in about 252 s, through the backup search) was built to the end on the server earlier, when TAP was failing; it is not known to work now.

## What it does

- **Any position.** Type RA/Dec in decimal degrees or sexagesimal, or paste "RA Dec" together, or pick a target. Positions are also read from the URL: `/?ra=133.795129&dec=-7.245147&fov=0.2`.
- **Five test targets are cached** and open at once: WISE 0855, Barnard's Star, Epsilon Indi B, RW Aurigae, R Draconis. They are the ones named in the challenge.
- **Any other position is built live** from the IRSA archive: a first batch of 8 frames spread over dates and bands (the archive search is the slow part: from seconds to several minutes, depending on the archive; if the main search (TAP) fails, a backup search (SIA2) is used and the page says the list of images may be incomplete), then "Load more" or "Load up to 102".
- **Views:** individual frames (step through epochs at one wavelength, or through the wavelengths), stacked epochs per detector band, and the difference from the first epoch. Background is subtracted per image.
- **Field of view:** 0.1°, 0.2° (default), 0.5° or 1°. Cached targets are 0.2° only; other sizes are built live.
- **Flux charts:** Spectrum and Light curve at the target position (aperture photometry, microjansky, with uncertainty). The photometry was checked against 2MASS stars (T32, `docs/photometry-validation.md`): flux scale within about 2 percent, 3 percent frame-to-frame scatter on bright stars, and the quoted error was too small, so it is scaled by 2.2. Checked on two fields and 1.2 to 2.2 µm only; no aperture correction is applied.
- **Sky backdrop (optional, desktop):** a DSS2 colour image of the sky from Aladin Lite sits behind the page and flies to the position, with a magenta mark. It is not SPHEREx data (plates from about 1975 to 1999, credit shown on the page) and loads from CDS servers, which receive the sky position.
- **WISE catalogue overlay (Advanced option):** AllWISE sources drawn on the image (T15). The live query to IRSA was **not confirmed to work end to end** on the deployed server (IRSA returned HTTP 502); only the code and tests with mocked replies are verified.
- **Plain wording:** groups of observation dates are called epochs; explanations sit behind "i" icons; errors are one plain sentence with the technical text in a detail line.
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

- The first batch for a new position waits for the archive search (one run timed on the deployed server: about 252 s), and live series are kept in memory only.
- Firefox and WebKit were checked once (T25); later features such as the sky backdrop were checked in Chromium only. The exact submission deadline (public listings say the hackathon closes on 15 November 2026; no official time was found) and WISE 0855's proper motion are unverified (see `docs/WORKLOG.md`, "Not verified").
- The API endpoint `GET /api/spectrum` (flux at any sky position) exists and is tested, but the page does not offer it (T58): it needs about 40 archive downloads and failed while the archive was down. Not built: a Gaia catalogue overlay (the AllWISE one is built, see above), per-pixel flag detail (T20; only a flagged fraction per frame is shown). The task board (`docs/TASKS.md`) lists them. WISE 0855's proper motion is not corrected for in its request position (T17).

## Data and credits

Data: SPHEREx images, the archive search and the AllWISE catalogue from NASA/IPAC IRSA; the sky backdrop is Digitized Sky Survey (STScI/NASA, colour and HiPS by CDS) through Aladin Lite (CDS). The repository has no licence file yet. Sources, libraries and tools are listed in `REFERENCES.md`.

## AI usage

Built with Claude Code (Anthropic): the code, tests and documentation were written in AI-assisted sessions, directed and reviewed by the author. See `REFERENCES.md`.
