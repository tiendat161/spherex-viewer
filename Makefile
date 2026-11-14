.PHONY: dev test test-backend test-web verify verify-contract verify-backend verify-web cache

PY := .venv/bin/python

dev:
	$(PY) -m uvicorn api.main:app --reload --port 8000

# The only target that contacts IRSA (at most 4 requests in flight). Session A fills this in.
cache:
	$(PY) -m pipeline.build verify/targets.json

# Offline: schemas are valid; fixtures and every cached series match the contract.
verify-contract:
	$(PY) verify/check_contract.py

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
# verify/e2e.py is written at integration (build-plan merge step 4); until then this fails, on purpose.
verify: verify-contract test
	$(PY) verify/e2e.py
