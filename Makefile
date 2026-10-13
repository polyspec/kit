# The kit repository: its own tests and the shared targets of scripts/kit/kit.mk.
include scripts/kit/kit.mk

.DEFAULT_GOAL := kit-test

.PHONY: kit-fixture-record source-test

# The kit's own tests (tests/source) check the kit's real Python and wheel path. kit-sync does not vendor them, so a consumer never runs them.
source-test: ## Run the kit's own tests (tests/source) through the test runner, with the pythonBuild and pythonBackend of config/toolchain.json; offline after make install-tools
	node scripts/kit/run-tests.mts node -- tests/source

kit-fixture-record: ## Write the review record of tests/kit/fixture with the stub registries
	node tests/kit/record-fixture.mts

.PHONY: typecheck
typecheck: ## Check the types of the tools and tests of kit with tsc (tsconfig.json); offline after npm ci
	node_modules/.bin/tsc -p tsconfig.json
