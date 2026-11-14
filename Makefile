.PHONY: dev test verify

dev:
	@echo "TODO: start api + web"

test:
	@echo "TODO: pytest + frontend tests"

# End-to-end check over every acceptance target listed in verify/targets.json.
# Skeleton: fill in at project start.
verify: test
	@echo "TODO: for each target in verify/targets.json:"
	@echo "  1. call the pipeline/API"
	@echo "  2. assert output matches contracts/ schema and frame count > 0"
	@echo "  3. take a UI screenshot (Playwright) into verify/out/"
