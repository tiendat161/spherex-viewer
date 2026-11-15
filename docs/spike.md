# SPHEREx feasibility spike

Date: 2026-11-14. Measurements only, no design. All numbers are **real archive responses** (nothing simulated). Raw logs and scripts are in `spike/`; downloaded files are in `.cache/` (gitignored). Timings were taken from one home-network machine at one time of day, so they are indicative, not benchmarks.

Targets:
- WISE 0855: RA 08h55m10.831s = 133.795129°, Dec −7°14′42.53″ = −7.245147° (the challenge coordinates, used as given).
- Barnard's Star: Gaia DR3 4472832130942575872 (ref epoch 2016.0) propagated by hand to 2026.0 → RA 269.446268°, Dec +4.768204° (Gaia values from the Gaia archive TAP; SIMBAD was returning 404, so not cross-checked).

## 1. TAP query (`spike/tap.py`, `spike/tap_*.log`)

`spherex.artifact` has no geometry or time columns. `poly` and `time_bounds_lower` are in `spherex.plane`, so the query joins `spherex.plane p` to `spherex.artifact a` on `planeid`, with `CONTAINS(POINT('ICRS',ra,dec), p.poly)=1 ORDER BY p.time_bounds_lower`. Endpoint: `/TAP/sync`, FORMAT=csv.

| Target | Images | Seconds (3 runs, in order) | First obs (MJD) | Last obs (MJD) |
|---|---|---|---|---|
| WISE 0855 | 258 | 44.8, 18.7, 12.7 | 60800.70 (2025-05-05) | 61174.29 |
| Barnard's Star | 358 | 13.5, 9.7, 20.1 | 60902.86 | 61305.63 |

- Rows span release paths `dr1` and `qr3`, so not all rows are in one data release.
- Server timing headers show most of the time is queueing, not the query: a trivial `SELECT TOP 1 planeid FROM spherex.plane` took 18 to 27 s, of which `spinoff_queued` was 12 to 13 s and `database_query` about 0.05 s.
- Each row's `contentlength` is about 65 MB (full image); the URL is `https://irsa.ipac.caltech.edu/` + `uri`.

## 2. Cutouts (`spike/cutout.py`, `spike/cutout.log`, `spike/cutout_probe.log`)

URL form: `<image URL>?center=RA,DEC&size=S`; `size` is in degrees by default (0.01° gave a 6×6 px IMAGE, `30arcsec` also works). Pixel scale is about 6.2″.

10 sequential fetches per target per size, evenly spaced over each target's image list:

| Target | size | OK / 10 | Seconds per OK fetch | MB per OK fetch |
|---|---|---|---|---|
| WISE 0855 | 0.01° | 7 | 7.9 to 12.5 | 3.95 to 4.04 |
| Barnard | 0.01° | 6 | 6.8 to 12.9 | 3.95 to 4.04 |
| WISE 0855 | 0.05° | 8 | 6.4 to 11.3 | 3.96 to 4.05 |
| Barnard | 0.05° | 7 | 7.9 to 12.3 | 3.96 to 4.05 |

- **Size does not change the payload.** Each cutout is a MEF: IMAGE, FLAGS, VARIANCE, ZODI are cropped (6×6 px at 0.01°, 29×29 px at 0.05°), but the `EPSF` extension is a fixed 8752×451 float array (3.947 MB) in every cutout. So each cutout is about 4 MB regardless of size. I did not test whether a parameter can drop EPSF (unverified, no documentation found).
- **Failures:** 12 of 40 sequential requests returned HTTP 503 (25 bytes, `retry-after: 5`, about 0.75 s each). Retrying after 5 s succeeded within 2 to 3 attempts in my probes.
- **20 parallel fetches (size 0.01°):** it works only partially. WISE 0855: 11 of 20 got 200, 9 got 503, wall 12.0 s. Barnard: 5 of 20 got 200, 15 got 503, wall 17.8 s. So 20 in parallel gets throttled by 503s; the successful ones still take 6 to 18 s each.

## 3. CORS (`spike/cors.log`, `spike/cutout_probe.log`)

Sent `Origin: https://example.pages.dev` with `curl`:

| Request | Status | `Access-Control-Allow-Origin` |
|---|---|---|
| TAP sync, POST | 200 | **absent** |
| TAP sync, GET | 200 | **absent** |
| TAP OPTIONS preflight (Request-Method POST) | 200 (text/xml) | **absent** |
| Cutout GET, 200 response | 200 | **absent** |
| Cutout GET, 503 response | 503 | **absent** |
| Cutout OPTIONS preflight | 405, `allow: GET` | **absent** |

I checked headers with curl only; I did not test in a browser. Without this header a browser on `example.pages.dev` would block reading these responses. An HTTP-level proxy is not part of this spike.

## 4. Coordinate epoch and target motion (`spike/epoch.py`)

**Frame of the images (verified):** the Level 2 cutout headers contain `RADESYS = 'ICRS'` and `CTYPE = RA---TAN-SIP / DEC--TAN-SIP`, plus per-image `MJD-OBS`/`DATE-AVG` (UTC). There is no `EQUINOX` or `EPOCH` keyword.

**Explanatory Supplement (read, verified):** [PDF, 30 MB](https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp_QR.pdf), Version 2.0, 2026-08-25, downloaded to `.cache/expsupp/` and converted with `pdftotext` (poppler, installed via Homebrew at the user's OK).
- Header table (App. A): `RADESYS = 'ICRS'`.
- Sec. 3.2.8, Fine Astrometry (PDF page 33): "Proper motions provided by Gaia are used to propagate stellar positions to the current observation epoch; sources with poorly constrained proper motions are excluded." The final solution uses "proper motion-corrected Gaia stars" via astrometry.net then scamp.
- The text has no statement of an equinox, and nothing saying which epoch a user-supplied RA/Dec should have. Searches for J2000, equinox, high-proper-motion and moving-object handling found nothing beyond the Gaia propagation above and a known-solar-system-object catalog used for masking.
- Net: the image WCS is ICRS and tied to the observation epoch of each image (verified). **The epoch of the challenge coordinates is still not established** by any source I have; it has to come from the challenge author.

**Other sources checked (earlier pass):**
- The [archive data-products page](https://caltech-ipac.github.io/spherex-archive-documentation/spherex-data-products) does not mention epoch or proper motion.
- The [pipeline paper](https://arxiv.org/abs/2511.15823) (Sec. IV.2) says the reference catalog "evolves objects with known astrometric motions to the epoch of the observation" and uses Gaia, but does not state the Gaia epoch, and does not mention ICRS. It says solar-system objects are handled by orbit propagation; it says nothing specific about high-proper-motion stars.
- Implication: a target's position in an image is its position at that image's observation time (ICRS). The epoch of the challenge's RA/Dec is whatever the challenge author used.

**Motion of WISE 0855** (proper motion −8.188″/yr in RA·cosδ, +0.680″/yr in Dec, from Luhman & Esplin 2016 *as quoted in a search summary, not read from the paper*: UNVERIFIED):
- Observation period of its 258 images: MJD 60800.70 to 61174.29 = 373.6 d = 1.02 yr. Motion in that window: ΔRA·cosδ = −8.37″, ΔDec = +0.70″, total **8.4″** (about 1.4 SPHEREx pixels).
- Offset between the challenge position and the target's true position at the window midpoint (2025.85), depending on the epoch of the challenge coordinates: J2000.0 → 212″; 2010.5 → 126″; 2016.0 → 81″.
- A 0.05° (180″) cutout centered on the challenge coordinates could therefore miss the target by more than its half-width (90″) unless the coordinates are already near 2016 or later. I did not check where the source falls in the cutouts.

**Barnard's Star** (Gaia DR3 2016.0 pm, 10.393″/yr): 10.6″ over the same-length window; 102″ from its 2016.0 position by 2025.85. The Barnard cutouts above were centered on my 2026.0 propagated position (about 1.6″ from its 2025.85 position by the same arithmetic).

## 5. SIA2 against TAP (T43, 2026-11-15, from a laptop; not from the EC2 host)

Query: `https://irsa.ipac.caltech.edu/SIA?COLLECTION=spherex_dr1` (and `spherex_qr3`), `POS=circle <ra> <dec> 0.0003`, one call per collection. The answer is a VOTable whose rows carry `t_min`, `t_max`, `energy_bandpassname`, `access_url` (the same file URL as TAP's `uri`, with the host in front) and `access_estsize` (kilobytes). So every field the pipeline reads can be filled (`IrsaClient.sia_rows`).

| Target | SIA2 rows (both collections) | TAP rows (saved 2026-11-14) | SIA2 time |
|---|---|---|---|
| WISE 0855 | 258 | 258 | 5.3 s |
| Barnard's Star | 358 | 358 | 5.6 s |
| Epsilon Indi B | 458 | 458 | 6.5 s |
| RW Aurigae | 335 | 335 | 6.1 s |
| R Draconis | 539 (413 dr1 + 126 qr3) | 2493 (1638 dr1 + 855 qr3) | 6.7 s |

Where both agree, the file URIs, times and bands are identical. For R Draconis SIA2 lists only 22% of what TAP lists; every SIA2 row is also in TAP. Widening the circle to 0.05° gave 451 dr1 rows, still far below 1638. The cause was not found. TAP itself did not answer for over 9 minutes on the same day, so these times are not a like-for-like speed comparison.

## Caveats
- The failed 503 requests were counted as failures, not retried, in the benchmark tables.
- `make verify` and a UI screenshot are not applicable: no code under `pipeline/`, `api/` or `web/` was touched.
