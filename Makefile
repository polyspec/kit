# The kit repository: its own tests and the shared targets of scripts/kit/kit.mk, which runs the sources of scripts/kit.
KIT := scripts/kit
KIT_EXT := mts
include scripts/kit/kit.mk

.DEFAULT_GOAL := kit-test

.PHONY: kit-test kit-fixture-record source-test

# kit-test fails when its run changes the checkout: git status --porcelain -uall and the hash of git diff --binary HEAD are
# recorded under var/ (ignored) before the run and compared after it; the changed status lines are printed.
kit-test: ## Run the tests of the tools (tests/kit) through the test runner, with per-case progress and timeouts, and fail when the run changes the checkout; offline
	@mkdir -p var && git status --porcelain -uall > var/kit-test-status && git diff --binary HEAD | git hash-object --stdin > var/kit-test-diff
	node scripts/kit/run-tests.mts node -- tests/kit
	@git status --porcelain -uall | diff var/kit-test-status - >&2 && git diff --binary HEAD | git hash-object --stdin | cmp -s var/kit-test-diff - || { echo "kit-test: the run changed the checkout: the status lines above, or a change of these tracked files: $$(git diff --name-only HEAD | tr '\n' ' ')" >&2; exit 1; }

# The kit's own tests (tests/source) check the kit's real Python and wheel path. kit-sync does not vendor them, so a consumer never runs them.
source-test: ## Run the kit's own tests (tests/source) through the test runner, with the pythonBuild and pythonBackend of config/toolchain.json; offline after make install-tools
	node scripts/kit/run-tests.mts node -- tests/source

kit-fixture-record: ## Write the review record of tests/kit/fixture with the stub registries
	node tests/kit/record-fixture.mts

.PHONY: build typecheck
build: ## Build the package @polyspec/kit into dist/: the tools of scripts/kit as JavaScript (tsconfig.build.json), kit.mk and the schemas; offline after npm ci
	rm -rf dist
	node_modules/.bin/tsc -p tsconfig.build.json
	cp scripts/kit/kit.mk dist/kit.mk
	cp -R scripts/kit/schema dist/schema

typecheck: ## Check the types of the tools and tests of kit with tsc (tsconfig.json); offline after npm ci
	node_modules/.bin/tsc -p tsconfig.json

.PHONY: rebuild-check
rebuild-check: ## Check that every tool of config/rebuild.json paths has its class: ecosystem, replaced, record or policy (S1); offline
	node scripts/kit/rebuild-check.mts

.PHONY: duplication-check
# jscpd skips two files until the items that own them remove the code they repeat (S8): install-alint.mts repeats the
# archive download of install-uv.mts, and both installers move to mise; parity-units.mts repeats two blocks of
# parity-declaration.mts, which K75 removes.
duplication-check: ## Fail while a piece of 6 lines or more of scripts/kit exists twice (jscpd); offline after npm ci
	node_modules/.bin/jscpd --min-lines 6 --format typescript --exit-code 1 --reporters console --ignore "**/install-alint.mts,**/parity-units.mts" scripts/kit
