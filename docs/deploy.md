# Deploying the viewer

One container runs everything: the API and the built web app, on one port. The Dockerfile is at the top of the repository.

**Status (2026-11-15):** the image **builds and runs, and is deployed on AWS EC2 (see the last section)**. Earlier the same day: the image **builds and runs** (built and run with Docker Desktop on an arm64 Mac, 723 MB). In the running container the page, the target list, a cached series (Barnard's Star: 38 real frames, all with flux), a frame image and the health check (`healthy`) all worked, and a request for an uncached position started a live build. Not checked: a full live build to the end inside the container, an amd64 build (what most hosts run), memory use under load. **Not deployed anywhere yet.** Building it first needed three fixes, now in the Dockerfile: the web stage needs `fixtures/` and `verify/targets.json` (the Vite config loads the dev-only mock even for a production build), and `numcodecs` has no prebuilt wheel on arm64 so a compiler is installed for the pip step only.

## Build and run locally

```bash
docker build -t spherex-viewer .
```

```bash
docker run --rm -p 8000:8000 -v spherex-cache:/data spherex-viewer
```

Then open http://localhost:8000. The volume is optional: it keeps remembered archive searches (`/data/cache/tap/live`) and the 30 newest finished live series (`/data/cache/live-series`, frames and charts but not pixels), both valid for a week, across restarts.

## Settings (environment variables)

| Variable | Default in the image | Meaning |
|---|---|---|
| `PORT` | `8000` | Port the service listens on. Many hosts set this themselves. |
| `SPHEREX_CACHE_DIR` | `/data/cache` | Where remembered archive searches are written. |
| `SPHEREX_LIVE` | on | `0` turns live builds off: only the five cached targets work and nothing contacts the archive. A safe mode for a demo when the archive is down. |
| `SPHEREX_RATE_LIMIT` | `120` | `/api/series` requests per client address per minute; `0` is no limit. |
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
- **Limits per visitor and for memory (T45).** `GET /api/series` is limited to 120 requests a minute per client address (`SPHEREX_RATE_LIMIT`, `0` turns it off); over it the API answers HTTP 429 with an error document. One browser tab polls about 30 times a minute. The address is the real client only if the proxy sends `X-Forwarded-For`: the image starts uvicorn with `--proxy-headers --forwarded-allow-ips='*'`, which is safe only while port 8000 is not reachable from outside (as in the EC2 setup). Behind no proxy, drop those flags. Live series (pixels plus PNGs) are capped at 600 MB (`MAX_TOTAL_BYTES` in `pipeline/live.py`): older finished series are evicted first, and a new build is refused while running ones alone fill it. The 600 MB and the 120 a minute are chosen figures, not measured on the host. One visitor can still fill the 8 build slots by asking for many different positions within the limit.
- **No accounts, no stored user data.** Positions typed by visitors go to the archive as part of the search; nothing else leaves the service.
- **The cached targets are in the image.** Refreshing them is `make refresh` on a machine with archive access (`docs/data-updates.md`), then rebuild the image.

## Deploying on AWS EC2 (what was actually done for T10)

Chosen for learning and for the CV: EC2 is the AWS service most job postings name. Deployed 2026-11-15 and checked from outside: `https://16-179-73-6.sslip.io` serves the page, the five cached targets and their frames over HTTPS with a valid certificate. A live build (M42) did **not** complete on the first deploy: the archive's search service answered HTTP 502 from both the server and a laptop at the time, so the live path is not verified on this server.

What was used, and why it differs from the first plan:

- **Account:** an AWS free plan account ($100 credits, 182 days, 2026-11-15). Its project is **locked to `ap-southeast-2` (Sydney)**; other regions need an upgrade, which was not done. The archive is in the US, so a live build from Sydney may be slower than from us-east-1 (not measured).
- **Server:** `t3.small` (2 vCPU, 2 GiB, x86), Amazon Linux 2023, 20 GiB gp3. Arm (`t4g`) types were not offered on this plan. Credit mode set to **standard**, so a burst slows the server instead of billing extra. Price in the console: $0.0264 per hour for the server, so about $19 a month, plus a public IPv4 address about $3.65 and the disk; roughly **$25 a month** if left running (estimate, check Cost Explorer).
- **Firewall (security group):** SSH (22) from one IP only, HTTP (80) and HTTPS (443) from anywhere. The app's port 8000 is not open.
- **Elastic IP** attached before HTTPS, so the address (and the name built from it) survives a stop and start. Associating it changes the address you SSH to.
- **Name and certificate:** `<ip with dashes>.sslip.io`, a public free service that points at the IP; Caddy got a Let's Encrypt certificate for it by itself. A real domain would be better for a long-lived link.
- **Code on the server:** the repository is private, so the server uses a read-only **deploy key** (GitHub repository Settings, Deploy keys, write access off). The image is built on the server (`docker build`), so it is x86 there.

Steps (the commands that were run, on the server unless noted):

1. Console: launch the instance as above; keep the `.pem` key outside the repository (`~/.ssh/`, `chmod 400`).
2. `sudo dnf install -y docker git && sudo systemctl enable --now docker && sudo usermod -aG docker ec2-user`, then log out and in.
3. `ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" -C "spherex-ec2"`, add `deploy_key.pub` as a deploy key on GitHub, then `GIT_SSH_COMMAND='ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes' git clone git@github.com:<owner>/spherex-viewer.git` and `git config core.sshCommand 'ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes'` inside it.
4. Console: allocate an Elastic IP and associate it with the instance; reconnect to the new address.
5. `docker build -t spherex-viewer .`
6. `docker network create web`, then `docker run -d --name viewer --restart unless-stopped --network web -v spherex-cache:/data spherex-viewer`.
7. `docker run -d --name caddy --restart unless-stopped --network web -p 80:80 -p 443:443 -v caddy-data:/data caddy:2 caddy reverse-proxy --from <name>.sslip.io --to viewer:8000`
8. Check: the page opens, `docker ps` shows both running (the viewer healthy), `docker logs caddy` says a certificate was obtained.

Update later: `git pull && docker build -t spherex-viewer .`, then `docker rm -f viewer` and run step 6's viewer command again. Live builds in progress are lost on a restart; finished ones are restored from the volume.

Tear down when finished: terminate the instance (the disk is deleted with it), **release the Elastic IP** (an unattached one still costs), check the bill the next day.

Re-deployed 2026-11-15 with the SIA2 backup (T43): a live build of M42 (`ra=83.8221 dec=-5.3911 fov=0.2 load=8`) finished through the public URL in about 252 s with `progress.search: "sia2"`, 8 of 8 frames, and a frame PNG served. TAP was still down; most of the time was the two 90 s TAP waits before the fallback (one run, so indicative only).

**Redeployed 2026-11-15 (evening) at `b877d4c`** (previous image kept as `spherex-viewer:previous`). Server did `git pull`, `docker build -t spherex-viewer .` (old `latest` tagged `previous` first), then `docker rm -f viewer` and step 6's run command again (about 10 s downtime). New in the public build: spectrum on click, catalogue overlay, Aladin sky backdrop, epoch wording, live series kept across restarts. Checked from outside: page 200 (HTTP redirects 308 to HTTPS), `/api/targets` returns 5, the new JS bundle contains Aladin, catalogue and "Clicked point", Barnard's Star series is ready with 40 frames and a frame PNG loads, container healthy, memory about 80 MB (viewer) after start. Not completed: `/api/catalogue` answered an error because IRSA returned HTTP 502, and a spectrum request on a non-cached grid started a live build that was still `loading` after about 1 minute (IRSA down), so the catalogue and live paths are unverified on the server. Rollback: `docker rm -f viewer; docker run -d --name viewer --restart unless-stopped --network web -v spherex-cache:/data spherex-viewer:previous`.

**Redeployed again 2026-11-15 at `69433e0`** (target-menu stacking fix, T50 follow-up): same steps, `spherex-viewer:previous` now holds the `b877d4c` image. Checked: page 200, 5 targets, CSS asset has `body.sky-on .topbar{z-index:3}`, Barnard series ready with 40 frames, viewer healthy, about 76 MB.

**Redeployed again 2026-11-15 at `b7feb5e`** (idle backdrop, orange image panel border): same steps; `spherex-viewer:previous` holds the `69433e0` image. Checked: page 200, 5 targets, CSS has `--accent-panel:#e07b00` and `.stage{border:2px solid var(--accent-panel)}`, bundle has the idle-backdrop code, Barnard series ready (40 frames), viewer healthy, about 76 MB.

**Redeployed again 2026-11-15 at `6e5ea47`** (T54 info icons): same steps; `spherex-viewer:previous` holds the `b7feb5e` image. Checked: page 200, 5 targets, the page HTML has 51 `info` popover markers, the bundle has `aria-describedby`, `aria-expanded` and `tooltip` code, the long RA/Dec paragraph is replaced by a one-line hint, Barnard series ready (40 frames), viewer healthy, about 76 MB.

**Redeployed again 2026-11-15 at `1914fa7`** (T55 globe start and magenta crosshair, T56 friendly archive errors with `error.detail`): same steps; `spherex-viewer:previous` holds the `6e5ea47` image. Checked: page 200, 5 targets, bundle has the SIN projection and `#ff66ff` crosshair colour, Barnard series ready (40 frames), viewer healthy, about 76 MB. With IRSA still answering 502, `/api/catalogue` on a non-cached position returned the short message "The WISE star catalogue could not be fetched from NASA's archive right now. The images are not affected." plus `error.detail` with the technical text. A live series request for a non-cached position stayed `loading` (no error returned yet).

Not yet checked: a live build to the end with TAP answering, a second live build while the first runs, memory under load (about 466 MB used of 1.9 GB at idle), `make verify` against the server, a stop and start of the instance.
