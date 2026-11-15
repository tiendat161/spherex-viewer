# Fixtures

Example responses for building and testing against `contracts/series.schema.json`. See `docs/contract.md`.

## `wise0855.json`: SIMULATED

A `ready` response for the WISE 0855 challenge coordinates. It carries `data_origin: "simulated"` because most of it is placeholder. Do not read any science from it.

| Field | Real or placeholder | Source |
|---|---|---|
| `grid.center` | Real | Challenge coordinates as given (`docs/spike.md`, Targets) |
| `frames[].obs_mjd` | Real | `time_bounds_lower` of 40 of the 258 rows the archive TAP query returned on 2026-11-14 (`docs/spike.md` §1; cached in `.cache/wise0855.csv`, gitignored). Every 6th row of the time-ordered list, the same sampling as `spike/cutout.py`, so it covers MJD 60800.70 to 61165.59, not quite the full period (which ends at 61174.29). |
| `grid.pixel_scale_arcsec`, `grid.shape` | Contract values | 6.2″ as specified; 116 = 720″ / 6.2″ rounded. Native pixel scale is unverified (contract open decisions 8 and 9). |
| `frames[].wavelength_um` | **Placeholder** | Linear ramp 0.75 to 5.0 by frame index. Not the wavelength of those observations. The 0.75 to 5.0 µm range is the commonly quoted SPHEREx coverage, written from memory and UNVERIFIED. |
| `frames[].flag_fraction` | **Placeholder** | Repeating pattern `(index × 7 mod 20) / 100`. Nothing was measured. |
| `frames[].flux`, `frames[].mjd_avg`, `photometry` | **Placeholder** | Added 2026-11-15 (T29) so the frontend can draw its charts without the backend. A made-up smooth curve (peak near 2.2 µm, 12% brighter per visit) plus noise from a fixed random seed, and every 9th frame marked as not measured. Nothing was measured; do not read any science from it. `mjd_avg` is `obs_mjd` plus 0.004 days. The method block is the real one. |
| `frames[].url` | **Placeholder** | No image exists at these paths. |
| `stretch` | **Placeholder** | `vmin` 0, `vmax` 1, unit `"placeholder"`. |
| `progress` | Placeholder | 40 done, 0 failed. |
