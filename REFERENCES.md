# References

Sections match the Space Apps submission form.

## NASA Data

- NASA/IPAC IRSA SPHEREx archive: https://irsa.ipac.caltech.edu/Missions/spherex.html
- IRSA TAP service: https://irsa.ipac.caltech.edu/TAP (the spike in `spike/tap.py` queried `https://irsa.ipac.caltech.edu/TAP/sync`)
- Archive search choice: the app searches with TAP (ADQL); both `dr1` and `qr3` images come back and are used (see `docs/WORKLOG.md`, T31). SIA2 (`https://irsa.ipac.caltech.edu/SIA`, collections `spherex_dr1`, `spherex_qr3`) is the backup for live positions when TAP fails: it answered in 1 to 5 s when TAP did not, but on R Draconis it lists 539 of the 2493 images TAP lists, so the page labels such a list as possibly incomplete (T43, T48). The cached targets are built from TAP only.
- SPHEREx cutout service docs: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/cutout_tool.html
- SPHEREx Explanatory Supplement: https://irsa.ipac.caltech.edu/data/SPHEREx/docs/SPHEREx_Expsupp.pdf
- IRSA SPHEREx tutorial notebooks: https://caltech-ipac.github.io/irsa-tutorials/spherex/
- Gaia DR3 (ESA, not NASA): the spike read Barnard's Star proper motion and 2016.0 position from the **ESA Gaia Archive TAP** (host `gea.esac.esa.int`, per `spike/epoch.py` and `docs/spike.md`), not from VizieR or IRSA. The values were entered by hand; no query script was kept. TODO: confirm and paste the exact TAP endpoint URL used; it is not recorded in the repo.

## Space Agency Partner & Other Data and tools

- WiseView (inspiration only, no code or data used): http://byw.tools/wiseview
- Astropy: https://www.astropy.org/
- reproject: https://reproject.readthedocs.io/
- NumPy: https://numpy.org/
- Pillow: https://python-pillow.org/
- FastAPI: https://fastapi.tiangolo.com/
- Uvicorn: https://www.uvicorn.org/
- Vite: https://vite.dev/
- Claude Code (AI assistance for code and docs): https://claude.com/claude-code
- Generic scaffolding created before the event: the agent definitions in `.claude/` and the `Makefile` (plus `CLAUDE.md`), committed in `f080347` "Generic scaffolding (pre-event)".

Note: every library above is imported or run by the code (checked 2026-11-15 by searching `pipeline/`, `api/`, `Makefile` and `web/package.json`; `requests` is imported inside `pipeline/irsa.py`). Python versions are pinned in `requirements.txt`, web versions in `web/package.json`. Not used: Aladin Lite, Gaia or WISE catalogue overlays (planned tasks only). Also used for tests: pytest, jsonschema, httpx, Vitest, Playwright, Ajv.

## AI usage

Claude Code (Anthropic) was used during the event to help write code and documentation, including the exploratory scripts in `spike/`, the notes in `docs/spike.md`, and this file. The pre-event scaffolding listed above was also generic Claude Code configuration. TODO: the author should confirm the exact split of which parts were AI-written versus hand-written, and that all scientific claims in `docs/` were checked against the cited sources.
