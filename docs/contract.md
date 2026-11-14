# Series API contract (DRAFT)

Date: 2026-11-14. Status: draft, not implemented. The machine-readable source of truth is [`contracts/series.schema.json`](../contracts/series.schema.json); if this page and the schema disagree, the schema wins. Measured facts are cited to [`docs/spike.md`](spike.md); anything not measured is marked UNVERIFIED. Unresolved points are in [Open decisions](#open-decisions), each with the provisional choice the schema currently encodes.

## Why one endpoint

- The archive sends no `Access-Control-Allow-Origin` header on TAP or cutout responses, so a browser cannot read them directly (spike §3, curl only, not browser-tested).
- Each cutout is about 4 MB whatever its size and takes about 6 to 13 s; 12 of 40 sequential requests returned 503 (spike §2).
- The TAP query alone took 9.7 to 44.8 s (spike §1).

So the API fetches and resamples in the background, serves small images from its own origin, and reports progress while the client polls.

## Request

```
GET /api/series?ra=<deg>&dec=<deg>&fov=<deg>&max_frames=102
```

| Parameter | Required | Default | Meaning |
|---|---|---|---|
| `ra` | yes | none | Right ascension, ICRS, decimal degrees, 0 ≤ ra < 360 |
| `dec` | yes | none | Declination, ICRS, decimal degrees, −90 to 90 |
| `fov` | no | `0.2` | Full width of the square field, degrees. One of `0.1`, `0.2`, `0.5`, `1` (2026-11-14, T13: was `0.2` only); any other value returns `status: "error"` |
| `max_frames` | no | `102` | Upper limit on frames in the series. A cached series is returned only when its frame count is at most `max_frames` (2026-11-14: was a fixed 40; raised so the WISE 0855 per-wavelength series fits) |

The coordinates are used as given: no epoch or proper-motion correction (open decision 1).

## Response

JSON, validated by `contracts/series.schema.json`. No properties beyond these are allowed.

| Field | Type | Meaning |
|---|---|---|
| `status` | `"ready"`, `"loading"` or `"error"` | `ready`: every planned frame is done or failed. `loading`: poll again. `error`: the series could not be built. |
| `data_origin` | `"real"` or `"simulated"` | `simulated` if any part of the response is placeholder or synthetic. The UI must show it. |
| `progress.done` | integer ≥ 0 | Frames resampled and present in `frames` |
| `progress.total` | integer ≥ 0 | Frames planned (at most `max_frames`); 0 until the archive query returns |
| `progress.failed` | integer ≥ 0 | Frames given up on; they are not in `frames` |
| `grid` | object, or null unless `ready` | The shared grid, below |
| `grid.center` | `{ra, dec}` | ICRS degrees; equals the request `ra`/`dec` |
| `grid.pixel_scale_arcsec` | `6.2` (constant) | Arcseconds per pixel |
| `grid.shape` | `[ny, nx]` | Grid size in pixels |
| `stretch` | object, or null unless `ready` | The one intensity mapping applied to every frame PNG |
| `stretch.kind` | `"linear"` or `"asinh"` | Mapping function |
| `stretch.vmin`, `stretch.vmax` | number | Pixel values mapped to PNG 0 and 255 |
| `stretch.unit` | string | Unit of `vmin`/`vmax` |
| `frames[]` | array | Frames available so far, ordered by `index` |
| `frames[].index` | integer ≥ 0 | 0-based position in the planned series; a gap means that frame failed |
| `frames[].obs_mjd` | number | Observation time, MJD (UTC) |
| `frames[].wavelength_um` | number > 0 | Wavelength, micrometres |
| `frames[].url` | string | 8-bit PNG of this frame on the API origin, shared stretch already applied |
| `frames[].flag_fraction` | number 0 to 1 | Fraction of grid pixels flagged |
| `error.message` | string | Present only when `status` is `error` |

`data_origin` and `error` are additions to the originally requested field list: the first because the project rules require real and simulated data to be labelled, the second because an `error` status with no reason is not usable.

### Shared grid

Every frame is resampled onto the same grid, so frame *n* pixel (y, x) is the same sky position as frame *m* pixel (y, x):

- tangent-plane (TAN) projection in ICRS, centred on `grid.center`;
- north up, east left;
- square pixels of 6.2″;
- size from `fov`: `round(fov × 3600 / 6.2)` pixels on each side. For `fov=0.2`, 720″ / 6.2″ = 116.1, so `[116, 116]` (open decision 9); `[58, 58]` for 0.1, `[290, 290]` for 0.5, `[581, 581]` for 1.

`frames[].wavelength_um` is evaluated at `grid.center` only. The archive gives the wavelength per detector position (the `WCS-WAVE` lookup, prototype choice 4), so other positions in the field were observed at other wavelengths; how much it changes across a 0.5° or 1° field has not been measured here (UNVERIFIED). Clients must say so for `fov` of 0.5 and above.

The source images are ICRS with a `TAN-SIP` WCS tied to each image's own observation epoch (spike §4, verified from headers). A moving target therefore shifts across the fixed grid from frame to frame: for WISE 0855 about 8.4″ (about 1.4 px) over the 373.6-day observation period, using a proper motion the spike marks UNVERIFIED (spike §4).

### Polling

The client repeats the identical GET until `status` is `ready` or `error`. While `loading`, `frames` holds what is finished so far and grows between polls; `grid` and `stretch` may be null. For a live series the stretch cannot be final until every frame is in: while `loading`, `stretch` is the mapping applied to the PNGs at that moment (limits computed over the frames done so far, recomputed at 1, 2, 4, 8, … frames and at the end), and each recompute changes the `?v=` suffix of every `frames[].url` so clients refetch. When `ready`, the stretch is the all-frames one. When `ready`, `progress.done + progress.failed == progress.total` and `frames` has `progress.done` entries (not expressible in JSON Schema; the API must guarantee it).

## Stacks

Added 2026-11-14. Optional `stacks` object, present only on a `ready` series, plus the optional top-level `background` field (`"none"` or `"median_subtracted"`). Consecutive images of one position are in different wavelengths, so `frames` in time order mostly shows wavelength changing. `stacks` combines images so that only time changes between frames.

| Field | Meaning |
|---|---|
| `stacks.visits[]` | `{index, start_mjd, end_mjd}`: groups of observation dates. A gap of more than 30 days between consecutive archive images starts a new visit; a run longer than 60 days (continuously observed fields) is cut into equal bins of at most 60 days. Boundaries come from every archive image of the position, not only the ones read. `start_mjd`/`end_mjd` are those of the images actually combined. |
| `stacks.bands[]` | `{id, wavelength_min_um, wavelength_max_um, stretch, diff_limit?}`. `id` is `all` (every image of the visit) or the archive's detector band name without the `SPHEREx-` prefix (`D1` to `D6`). The wavelength range is the measured range of the combined images, not a nominal band. `stretch` is shared by all visits of the band (asinh, 1st to 99.5th percentile of the band's stack pixels). |
| `stacks.images[]` | `{visit, band, url, n_images, flag_fraction, diff_url?}`: the sigma-clipped (3σ) mean of the unflagged values per pixel, a plain mean when fewer than 3 images. Where no image has an unflagged value, the mean of all finite values is used and the pixel counts towards `flag_fraction`. |
| `diff_url` | This image minus the band's earliest visit image, linear, `-diff_limit` to `+diff_limit` mapped to 0 to 255 (`diff_limit` = 99.5th percentile of the absolute differences of the band). |

The 30-day, 60-day and 3σ values are choices, not measurements. Stacks are built from the images the series read: all 258 for `wise0855`, but only the 40 selected frames for the other cached targets and for live series, so their per-detector stacks hold only a few images each (`n_images` says how many). Setting `stack_images` for a target in `verify/targets.json` makes `make cache` read more.

## Fixture

[`fixtures/wise0855.json`](../fixtures/wise0855.json) is a `ready` response for the WISE 0855 challenge coordinates with `data_origin: "simulated"`. Only its `obs_mjd` values and grid centre are real; see [`fixtures/README.md`](../fixtures/README.md).

## Targets endpoint

```
GET /api/targets
```

Returns the targets whose series are cached, validated by [`contracts/targets.schema.json`](../contracts/targets.schema.json): an array of `{id, name, ra, dec, position_note}`. `ra`/`dec` are the cached request position (ICRS degrees); passing them to `/api/series` with the default `fov` and `max_frames` returns that target's cached series. The UI must show `position_note`. The source list is [`verify/targets.json`](../verify/targets.json).

## Prototype choices (2026-11-14)

Provisional answers adopted for the prototype so the build sessions are not blocked. They are choices, not findings; none changes `series.schema.json`. Numbers match the open decisions below.

| # | Choice |
|---|---|
| 1 | Coordinates used as given; the API applies no correction. Proper-motion propagation happens only when the pipeline derives a cached target's position from `verify/targets.json`. |
| 2, 3 | 40 frames evenly spaced through the time-ordered list; order by `obs_mjd`. **Exception, `wise0855` only (2026-11-14):** one frame per distinct wavelength, up to 102 frames, ordered by `wavelength_um`. Wavelength is read from each cutout's WCS-WAVE, so every TAP row is fetched first (the detector bandpass name is only one of six arrays, not a wavelength). Rows whose wavelengths fall within 0.002 µm of each other count as one band; within a band the frame with the lowest flagged fraction is kept. The 102 cap is the mission's spectral channel count as stated in `docs/PLAN.md`; whether the data yields 102 bands is UNVERIFIED. The other four targets keep the 40-frame rule until they are changed in their own commits. |
| 4 | `wavelength_um` from the cutout's `WCS-WAVE` extension at the target pixel. Timebox 1 h; if it cannot be evaluated, stop and ask. No invented values. |
| 5 | `flag_fraction` = fraction of grid pixels whose nearest source pixel has any `FLAGS` bit set other than `SOURCE` (bit 21) and `FULLSAMPLE` (bit 12), plus pixels with no coverage. The same mask selects the pixels used for the stretch limits. Revised 2026-11-14: the first version counted every bit, but `SOURCE` means "Pixel mapped to a known source" and `FULLSAMPLE` is "purely informational" (Explanatory Supplement v2.0, Table 16), and `SOURCE` was set on 96% of pixels in ten Barnard's Star cutouts and 52% in ten WISE 0855 cutouts (measured from `.cache/cutouts/`). |
| 6 | `obs_mjd` = TAP `time_bounds_lower`. |
| 7 | `asinh`; `vmin`/`vmax` = 1st and 99.5th percentile over all unflagged pixels of all frames in the series; unit from header `BUNIT`. **Revised 2026-11-14:** each image first has the median of its own unflagged pixels subtracted (`background: "median_subtracted"`), because the background level differs a lot between wavelengths and made a time-ordered blink flicker. The `ZODI` extension is not used. |
| 8, 9 | 6.2″ and `[116, 116]`, as the schema fixes them. Native scale still UNVERIFIED. |
| 10 | Bilinear (`reproject.reproject_interp`). |
| 11 | Honour `retry-after`; up to 4 attempts per cutout, then the frame counts as failed. |
| 12 | Always HTTP 200 with `status` in the body; poll every 2 s; no machine-readable error code. |
| 13 | Cached targets first: a request matches if within 1″ of a cached position with `fov=0.2` and `max_frames` at least the series' frame count (at most 102). **Any other position is built live (2026-11-14, `pipeline/live.py`):** min(`max_frames`, 40) frames, evenly spaced in time, same grid, flag and stretch rules as the cache. Requests within 1″ of a live series share it. Live series are held in memory only (lost on restart; the 30 most recent are kept); 2 are built at a time and 6 more may wait, beyond that the response is `status: "error"`. A failed live series is retried when requested again after 60 s. **`fov` (2026-11-14, T13):** the cache holds `fov=0.2` only, so a request with `fov` 0.1, 0.5 or 1 is always built live, also at a cached position; requests share a live series only when `fov` is the same. Any other `fov` returns `status: "error"`. At 0.5° and 1° a frame can run off the detector edge, leaving part of the grid without data (counted in `flag_fraction`; seen in 4-frame test builds at the WISE 0855 position). With `SPHEREX_LIVE=0` the API serves the cache only. |
| 14 | Prefer `dr1` when the same observation appears under both release paths. |
| 15 | `url` = `/api/frames/<id>/NN.png`, a path on the API origin, kept as long as the cache is deployed. |

## Open decisions

Each item gives the provisional choice in the current schema or fixture. See [Prototype choices](#prototype-choices-2026-11-14) for what the prototype adopts.

1. **Epoch of the request coordinates.** The epoch of the challenge coordinates is not established by any source (spike §4). Provisional: centre the grid on the coordinates as given. With `fov=0.2` the half-width is 360″, so even the spike's largest offset case (212″ if the coordinates are J2000.0) stays inside the field, but the target would be well off-centre. Needs the challenge author's answer.
2. **Which frames when more exist than `max_frames`.** WISE 0855 has 258 images (spike §1). Provisional for the other targets: evenly spaced through the time-ordered list. For WISE 0855 the choice is now even wavelength coverage (see the exception in the table above).
3. **Frame order.** Provisional: by `obs_mjd`, except WISE 0855, which is ordered by `wavelength_um`. In the cached WISE 0855 TAP result the 258 rows fall on 129 distinct start times, two detector bands each, so time order interleaves bands.
4. **Definition of `wavelength_um`.** Wavelength at the target pixel (cutouts carry a `WCS-WAVE` extension, spike `cutout_probe.log`) or a per-band central value. UNVERIFIED: the spike did not evaluate `WCS-WAVE`.
5. **Definition of `flag_fraction`.** Any `FLAGS` bit set, selected bits only, and whether grid pixels with no coverage after resampling count. The flag bit meanings have not been read.
6. **Definition of `obs_mjd`.** Provisional: TAP `time_bounds_lower` (what the fixture uses). Alternative: header `MJD-OBS`, or the `DATE-AVG` midpoint.
7. **Stretch.** Which kinds to allow, how `vmin`/`vmax` are chosen (for example percentiles over all frames), the unit, and whether the `ZODI` extension is subtracted first. One shared stretch may hide detail if background level differs a lot between wavelengths (not measured).
8. **Pixel scale.** The contract fixes 6.2″ as specified. The spike says "about 6.2″", yet its 0.01° (36″) cutout was 6×6 px, which is 6.0″ per pixel if taken at face value. The exact native scale is UNVERIFIED.
9. **Grid shape.** Provisional `[116, 116]`. An odd size (117) would put the request position on a pixel centre.
10. **Resampling method.** Nearest neighbour, bilinear or flux-conserving, from a `TAN-SIP` source.
11. **Failed frames.** How many 503 retries before a frame counts as failed (the spike's probes succeeded within 2 to 3 attempts at 5 s spacing, §2). Provisional: failed frames are left out of `frames` and `index` keeps the planned position.
12. **Loading and error transport.** Provisional: always HTTP 200 with `status` in the body. Alternatives: 202 while loading, 4xx/5xx on error. Also the recommended poll interval and whether `error` needs a machine-readable code.
13. **Parameter limits and series identity.** Maximum `fov` (now the fixed list 0.1, 0.2, 0.5, 1) and `max_frames`, and how `ra`/`dec` are rounded so repeated polls map to the same series.
14. **Mixed data releases.** Rows can span `dr1` and `qr3` release paths (spike §1); decide whether to prefer one or de-duplicate. The cached WISE 0855 rows are all `dr1`.
15. **`url` form.** Provisional: a path on the API origin. Alternative: absolute URL. Also how long frame PNGs stay available.
