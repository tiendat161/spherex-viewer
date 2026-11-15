.PHONY: refresh dev test test-backend test-web verify verify-contract verify-docs verify-backend verify-web cache

PY := .venv/bin/python

dev:
	$(PY) -m uvicorn api.main:app --reload --port 8000

# The only target that contacts IRSA (at most 8 requests in flight (MAX_IN_FLIGHT in pipeline/irsa.py)). Session A fills this in.
cache:
	$(PY) -m pipeline.build verify/targets.json

# Like `make cache`, but asks the archive again which images exist (new data releases) instead of
# using the saved search. Old cutouts stay in .cache/; only new images are downloaded. See docs/data-updates.md.
refresh:
	$(PY) -m pipeline.build verify/targets.json --refresh-tap

# Offline: schemas are valid; fixtures and every cached series match the contract.
verify-contract:
	$(PY) verify/check_contract.py

# Offline: every source file is named in docs/structure.md, and every file it names exists.
verify-docs:
	$(PY) verify/check_docs.py

test-backend:
	$(PY) -m pytest tests

test-web:
	cd web && npm test

test: test-backend test-web

# Per-session checks (see docs/build-plan.md).
verify-backend: verify-contract test-backend

verify-web: verify-contract test-web
	cd web && npx playwright test

# End-to-end check over every acceptance target in verify/targets.json.
# Offline: builds web, serves it from the API, checks each target through the API and in a browser,
# and saves verify/out/<id>.png.
verify: verify-contract verify-docs test
	$(PY) verify/e2e.py
