# The kit repository: its own tests and the shared targets of scripts/kit/kit.mk, which runs the sources of scripts/kit.
KIT := scripts/kit
KIT_EXT := mts
include scripts/kit/kit.mk

.DEFAULT_GOAL := kit-test

.PHONY: kit-test kit-fixture-record kit-tool-record source-test install-packages

# The suite of kit, which CI runs (.github/workflows/ci.yml); locally only the tests that own a change run
# (node scripts/kit/run-tests.mts node -- <test file>).
CHECK_TARGETS := typecheck kit-test source-test rebuild-check duplication-check

# The packages of package-lock.json with the npm of var/tools, the step after make install-tools TOOLS=npm, as in a
# repository (kit-bootstrap.mk); the release workflow that kit vendors and runs for itself calls it.
install-packages: ## Install the packages of package-lock.json with the npm of var/tools; ONLINE
	$(ONLINE) $(NPM) ci

# kit-test fails when its run changes the checkout: git status --porcelain -uall and the hash of git diff --binary HEAD are
# recorded under var/ (ignored) before the run and compared after it; the changed status lines are printed.
kit-test: ## Run the tests of the tools (tests/kit) through the test runner, with per-case progress and timeouts, and fail when the run changes the checkout; offline
	@mkdir -p var && git status --porcelain -uall > var/kit-test-status && git diff --binary HEAD | git hash-object --stdin > var/kit-test-diff
	$(NODE) scripts/kit/run-tests.mts node -- tests/kit
	@git status --porcelain -uall | diff var/kit-test-status - >&2 && git diff --binary HEAD | git hash-object --stdin | cmp -s var/kit-test-diff - || { echo "kit-test: the run changed the checkout: the status lines above, or a change of these tracked files: $$(git diff --name-only HEAD | tr '\n' ' ')" >&2; exit 1; }

# The kit's own tests (tests/source) check the kit's real Python and wheel path. kit-sync does not vendor them, so a consumer never runs them.
source-test: ## Run the kit's own tests (tests/source) through the test runner, with the pythonBuild and pythonBackend of config/toolchain.json; offline after make install-tools
	$(NODE) scripts/kit/run-tests.mts node -- tests/source

kit-fixture-record: ## Write the review record of tests/kit/fixture with the stub registries
	$(NODE) tests/kit/record-fixture.mts

kit-tool-record: ## Write tests/kit/tool-records.json, what the pinned go and Composer print for the requests of the stubs; offline after make install-tools
	$(NODE) tests/kit/record-tools.mts

.PHONY: build typecheck
build: ## Build the package @polyspec/kit into dist/ through dist.next/ and a rename, so a consumer that links kit never reads a half-built dist: the tools of scripts/kit as JavaScript (tsconfig.build.json), kit.mk, the schemas and the symbol extractors; offline after npm ci
	rm -rf dist.next dist.old
	$(CURDIR)/node_modules/.bin/tsc -p tsconfig.build.json --outDir dist.next
	cp scripts/kit/kit.mk dist.next/kit.mk
	cp -R scripts/kit/schema dist.next/schema
	cp -R scripts/kit/symbols dist.next/symbols
	if [ -d dist ]; then mv dist dist.old; fi
	if mv dist.next dist; then rm -rf dist.old; else if [ -d dist.old ]; then mv dist.old dist; fi; exit 1; fi

typecheck: ## Check the types of the tools and tests of kit with tsc (tsconfig.json); offline after npm ci
	$(CURDIR)/node_modules/.bin/tsc -p tsconfig.json

.PHONY: rebuild-check
rebuild-check: ## Check that every tool of config/rebuild.json paths has its class: ecosystem, replaced, record or policy (S1); offline
	$(NODE) scripts/kit/rebuild-check.mts

.PHONY: duplication-check
duplication-check: ## Fail while a piece of 6 lines or more of scripts/kit exists twice (jscpd); offline after npm ci
	$(CURDIR)/node_modules/.bin/jscpd --min-lines 6 --format typescript --exit-code 1 --reporters console scripts/kit
