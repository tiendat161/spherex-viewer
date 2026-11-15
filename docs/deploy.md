# Deploying the viewer

One container runs everything: the API and the built web app, on one port. The Dockerfile is at the top of the repository.

**Status (2026-11-15):** the Dockerfile and these notes are written but the image has **not been built or deployed**: Docker's background service was not running on the machine they were written on. What was checked instead: the files the image copies (`api/`, `pipeline/`, `contracts/`, `static/`, `verify/targets.json`, `web/dist`, 4.3 MB) were copied to an empty folder and the service was started there with the project's Python; the page, the target list, a cached series with flux, a frame image and the start of a live build all worked. The Python version in the image (3.9) is the one the project runs on. Run `docker build` once before trusting any of this.

## Build and run locally

```bash
docker build -t spherex-viewer .
```

```bash
docker run --rm -p 8000:8000 -v spherex-cache:/data spherex-viewer
```

Then open http://localhost:8000. The volume is optional: it keeps remembered archive searches (`/data/cache/tap/live`, valid for a week) across restarts.

## Settings (environment variables)

| Variable | Default in the image | Meaning |
|---|---|---|
| `PORT` | `8000` | Port the service listens on. Many hosts set this themselves. |
| `SPHEREX_CACHE_DIR` | `/data/cache` | Where remembered archive searches are written. |
| `SPHEREX_LIVE` | on | `0` turns live builds off: only the five cached targets work and nothing contacts the archive. A safe mode for a demo when the archive is down. |
| `SPHEREX_SERIES_DIR` | the folder baked into the image | A different folder of cached series. |

Health check: `GET /api/targets` (the image has one built in).

## What the host must provide

1. **One instance, one process.** Live builds, their progress and the images they make are kept in memory, and the browser polls the same instance for them. Two instances, or autoscaling, would send a poll to an instance that never heard of the build. Turn autoscaling off and keep it at one instance.
2. **Outbound HTTPS to `irsa.ipac.caltech.edu`** (the archive). Without it only the cached targets work.
3. **About 1 GB of memory.** The service keeps up to about 300 MB of pixels for recent live series, on top of Python and astropy. This is an estimate, not a measurement.
4. **Inbound HTTPS** (most hosts add it) and a way to set `PORT` if the host does not.

Any container host that runs a Dockerfile and keeps one instance running fits. Which one to use is a choice for the person deploying (cost, region, free tier); nothing here depends on it. If the host runs in AWS us-east-1, near the archive's cloud copy, `docs/WORKLOG.md` (2026-11-15, T40) notes a faster download route that is worth another look.

## Things to know before making it public

- **The archive decides how fast a new position is.** A search took 40 to 67 s in three runs and about 4 minutes once, and at the time of writing the archive's search service returned HTTP 502. The five cached targets never wait for it.
- **No rate limit per visitor.** The service limits itself (at most 8 archive downloads at once, 2 builds running and 6 waiting) but a single visitor can fill the queue. A host or proxy that limits requests per address helps.
- **No accounts, no stored user data.** Positions typed by visitors go to the archive as part of the search; nothing else leaves the service.
- **The cached targets are in the image.** Refreshing them is `make refresh` on a machine with archive access (`docs/data-updates.md`), then rebuild the image.
