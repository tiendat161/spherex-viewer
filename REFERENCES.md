# References

Sections match the Space Apps submission form.

## NASA Data

- NASA/IPAC IRSA SPHEREx archive: https://irsa.ipac.caltech.edu/Missions/spherex.html
- IRSA TAP service: https://irsa.ipac.caltech.edu/TAP (the spike in `spike/tap.py` queried `https://irsa.ipac.caltech.edu/TAP/sync`)
- Archive search choice: the app searches with TAP (ADQL); both `dr1` and `qr3` images come back and are used (see `docs/WORKLOG.md`, T31). SIA2 (`https://irsa.ipac.caltech.edu/SIA`, collections `spherex_dr1`, `spherex_qr3`) is the backup for live positions when TAP fails: it answered in 1 to 5 s when TAP did not, but on R Draconis it lists 539 of the 2493 images TAP lists, so the page labels such a list as possibly incomplete (T43, T48). The cached targets are built from TAP only.
- SPHEREx cutout service docs: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html
- SPHEREx Explanatory Supplement: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf
- IRSA SPHEREx tutorial notebooks: https://caltech-ipac.github.io/irsa-tutorials/spherex/
- AllWISE Source Catalog (WISE, NASA/IPAC IRSA), used by the catalogue overlay (T15) through IRSA TAP, table `allwise_p3as_psd`: catalogue documentation https://irsa.ipac.caltech.edu/data/WISE/docs/release/AllWISE/ (FAQ at https://irsa.ipac.caltech.edu/data/WISE/docs/release/AllWISE/faq.html), registry record naming the TAP table https://dc.g-vo.org/I/ivo://irsa.ipac/WISE/Catalog/AllWISE/Source_Catalog, citation DOI https://ipac.caltech.edu/doi/10.26131/IRSA1. The AllWISE Explanatory Supplement was NOT read: the meaning of `w1mpro` (W1 profile-fit magnitude, Vega) and `w1mjdmean` (mean MJD of the W1 observations) is taken from IRSA documentation text found by search, and the reference epoch of the positions is not confirmed. The live query returned HTTP 502 on 2026-11-15 (not confirmed against the service).
- IRSA TAP (ADQL) is the same service as above; the catalogue overlay uses `POST https://irsa.ipac.caltech.edu/TAP/sync` with `FORMAT=csv` like the image search.
- Gaia DR3 (ESA, not NASA): used by hand only, not by the app. The spike read Barnard's Star proper motion and 2016.0 position from the **ESA Gaia Archive TAP** (host `gea.esac.esa.int`, per `spike/epoch.py` and `docs/spike.md`), and the values were entered by hand into `verify/targets.json`. No Gaia query exists in `pipeline/`, `api/` or `web/`, and no query script was kept, so there is no endpoint to list here; the catalogue overlay uses AllWISE through IRSA TAP instead (T15, see above). Documentation for the archive: https://www.cosmos.esa.int/web/gaia-users/archive/programmatic-access. It was unreachable on 2026-11-15.

## Space Agency Partner & Other Data and tools

- WiseView (inspiration only, no code or data used): http://byw.tools/wiseview
- Astropy: https://www.astropy.org/
- reproject: https://reproject.readthedocs.io/
- NumPy: https://numpy.org/
- Pillow: https://python-pillow.org/
- FastAPI: https://fastapi.tiangolo.com/
- Uvicorn: https://www.uvicorn.org/
- Vite: https://vite.dev/
- Aladin Lite (sky backdrop, loaded in the browser from a CDN, pinned to 3.8.2): https://aladin.cds.unistra.fr/AladinLite/ (CDN copy: https://www.npmjs.com/package/aladin-lite)
- DSS2 colour HiPS survey (`CDS/P/DSS2/color`), the backdrop image: Digitized Sky Survey, STScI/NASA, colour composite and HiPS by CDS (credit and copyright line from the survey's own record, http://archive.stsci.edu/dss/copyright.html); the plates cover about 1975 to 1999 (the record's `t_min`/`t_max`, MJD 42413 to 51179). Read from the CDS server, or the STScI (MAST) or CSIRO copy listed in the same record: https://aladin.cds.unistra.fr/hips/
- 2MASS (Two Micron All Sky Survey), used only to check the photometry scale (T32, `docs/photometry-validation.md`): J, H, Ks magnitudes of field stars from VizieR table II/246 (Cutri et al. 2003) and zero points from the 2MASS Explanatory Supplement section 6.4a (Cohen et al. 2003), as cited in that document; not re-read for this file.
- Claude Code (AI assistance for code and docs): https://claude.com/claude-code
- Generic scaffolding created before the event: the agent definitions in `.claude/` and the `Makefile` (plus `CLAUDE.md`), committed in `f080347` "Generic scaffolding (pre-event)".

Note: every library above is imported or run by the code (checked 2026-11-15 by searching `pipeline/`, `api/`, `Makefile` and `web/package.json`; `requests` is imported inside `pipeline/irsa.py`). Python versions are pinned in `requirements.txt`, web versions in `web/package.json`. Aladin Lite is used only for the optional background image (T50); it is not used for any measurement. The position mark (T55) is an Aladin Lite catalogue (`A.catalog`, `A.source`, `addCatalog`; a canvas can be the source shape, read from the 3.8.2 `dist/aladin.js` and its API docs https://cds-astro.github.io/aladin-lite/) and is decoration, not data. The catalogue overlay (T15) reads the AllWISE Source Catalog (table `allwise_p3as_psd`, IRSA TAP; https://irsa.ipac.caltech.edu/ibe/docs/wise/allwise/ is the image atlas; the catalogue is described at https://irsa.ipac.caltech.edu/data/WISE/docs/release/AllWISE/) through `pipeline/catalogue.py`. The column names `w1mpro` and `w1mjdmean` were taken from IRSA documentation text found by search; the live query was NOT yet confirmed against the service (it returned HTTP 502 on 2026-11-15). Gaia is not queried by the app (see its entry above). Also used for tests: pytest, jsonschema, httpx, Vitest, Playwright, Ajv.

## AI usage

Claude Code (Anthropic) was used during the event to help write code and documentation, including the exploratory scripts in `spike/`, the notes in `docs/spike.md`, and this file. The pre-event scaffolding listed above was also generic Claude Code configuration. TODO: the author should confirm the exact split of which parts were AI-written versus hand-written, and that all scientific claims in `docs/` were checked against the cited sources.
