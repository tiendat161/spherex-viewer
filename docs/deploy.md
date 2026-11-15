# Deploying the viewer

One container runs everything: the API and the built web app, on one port. The Dockerfile is at the top of the repository.

**Status (2026-11-15):** the image **builds and runs** (built and run with Docker Desktop on an arm64 Mac, 723 MB). In the running container the page, the target list, a cached series (Barnard's Star: 38 real frames, all with flux), a frame image and the health check (`healthy`) all worked, and a request for an uncached position started a live build. Not checked: a full live build to the end inside the container, an amd64 build (what most hosts run), memory use under load. **Not deployed anywhere yet.** Building it first needed three fixes, now in the Dockerfile: the web stage needs `fixtures/` and `verify/targets.json` (the Vite config loads the dev-only mock even for a production build), and `numcodecs` has no prebuilt wheel on arm64 so a compiler is installed for the pip step only.

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

## Deploying on AWS EC2 (the route chosen for T10)

Chosen for learning and for the CV: EC2 is the AWS service most job postings name. Cost estimate (third-party figures for the server, IP and disk, so check the AWS Pricing Calculator): `t4g.small` about $0.0168 per hour, plus a public IPv4 address about $0.005 per hour, plus a 20 GB disk about $1.6 a month, so about **$17 a month**. The server runs only while you keep it; **stop or terminate it after the demo**. A `t4g` server is ARM (Graviton), the same architecture as the image built on an Apple-silicon Mac; the image built on the server itself is always the right one.

1. **Account safety first.** Create a billing alert (AWS Budgets, for example $20 a month) before anything else. Do not use the root account for daily work: make an IAM user.
2. **Launch the server.** EC2, Launch instance: Amazon Linux 2023, **arm64**, type `t4g.small`, a new key pair (keep the `.pem` file private), 20 GB gp3 disk. Region: `us-east-1` (nearest the archive's cloud copy, an untested possible speed-up; see the T40 note in `docs/WORKLOG.md`).
3. **Security group (the firewall).** Allow inbound 22 (SSH) **from your own IP only**, and 80 and 443 from anywhere. Nothing else; the app's port 8000 stays closed to the internet.
4. **Elastic IP.** Allocate one and attach it, so the address does not change when the server restarts.
5. **A name for HTTPS.** Caddy gets a free certificate for a domain name. If you own a domain, point an A record at the Elastic IP. Without one, `<ip with dashes>.sslip.io` (for example `3-91-0-1.sslip.io`) resolves to that IP; this is a public free service and its certificate limits are shared, so treat it as a stopgap.
6. **On the server** (`ssh -i key.pem ec2-user@<ip>`):

```bash
sudo dnf install -y docker git && sudo systemctl enable --now docker && sudo usermod -aG docker ec2-user
```

Log out and back in so the group applies. Then get the code (replace the URL with this repository's) and build:

```bash
git clone <repository-url> spherex-viewer && cd spherex-viewer && docker build -t spherex-viewer .
```

7. **Run the app and Caddy** on one private network, so only Caddy is reachable:

```bash
docker network create web
docker run -d --name viewer --restart unless-stopped --network web -v spherex-cache:/data spherex-viewer
docker run -d --name caddy --restart unless-stopped --network web -p 80:80 -p 443:443 -v caddy-data:/data caddy:2 caddy reverse-proxy --from YOUR.DOMAIN --to viewer:8000
```

8. **Check:** open `https://YOUR.DOMAIN`; `docker ps` shows both as running (the viewer as healthy); `docker logs viewer` shows requests.
9. **Update later:** `git pull && docker build -t spherex-viewer .`, then `docker rm -f viewer` and run the viewer command again. Live builds in progress are lost on a restart.
10. **Tear down:** terminate the instance, release the Elastic IP (an unattached one still costs), delete the disk if it is left over, and check the bill the next day.

Not yet checked: none of these steps has been run on a real server. Memory on 2 GB is an estimate. Possible next steps for the CV, once this works: push the image to ECR and deploy it with GitHub Actions instead of building on the server.
