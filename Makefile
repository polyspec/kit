# The kit repository: its own tests and the shared targets of scripts/kit/kit.mk, which runs the sources of scripts/kit.
KIT := scripts/kit
KIT_EXT := mts
include scripts/kit/kit.mk

.DEFAULT_GOAL := kit-test

.PHONY: kit-test kit-fixture-record kit-tool-record source-test install-packages kit-install-symbols-php install kit-build

# The suite of kit, which CI runs (.github/workflows/ci.yml); locally only the tests that own a change run
# (node scripts/kit/run-tests.mts node -- <test file>).
CHECK_TARGETS := typecheck kit-test source-test rebuild-check duplication-check

# The packages of package-lock.json with the npm of var/tools, the step after make install-tools TOOLS=npm, as in a
# repository (kit-bootstrap.mk); the release workflow that kit vendors and runs for itself calls it.
install-packages: ## Install the packages of package-lock.json with the npm of var/tools; ONLINE
	$(ONLINE) $(NPM) ci

# The PHP lint runs PHPStan on the PHP symbol extractor with the autoloader of its Composer project, as on every Composer
# package (lint-php.mts); a consumer installs the extractor into var/tools/symbols-php instead (install-symbols.mts).
kit-install-symbols-php: ## Install the locked packages of the PHP symbol extractor into scripts/kit/symbols/php/vendor with the Composer of mise.toml, for the PHPStan of lint-php; ONLINE
	$(ONLINE) env COMPOSER_HOME=$(KIT_TOOLS)/composer/home COMPOSER_CACHE_DIR=$(KIT_TOOLS)/composer/cache $(KIT_TOOLS)/mise/shims/composer install --working-dir=scripts/kit/symbols/php --no-interaction --no-progress --no-scripts --no-plugins --prefer-dist

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

.PHONY: typecheck
# kit holds no runtime of packages/; its build, tests and lints join the fixed tasks of kit.mk as prerequisites (K246).
build: kit-build
test: kit-test source-test
lint: lint-ts lint-php lint-python lint-go

kit-build: ## Build the package @polyspec/kit into dist/ through dist.next/ and a rename, including the pinned PHP arginfo Composer project, so a consumer that links kit never reads a half-built dist; offline after npm ci
	rm -rf dist.next dist.old
	$(CURDIR)/node_modules/.bin/tsc -p tsconfig.build.json --outDir dist.next
	cp scripts/kit/kit.mk dist.next/kit.mk
	cp -R scripts/kit/php-arginfo dist.next/php-arginfo
	cp -R scripts/kit/schema dist.next/schema
	cp -R scripts/kit/php-library dist.next/php-library
	tar -C scripts/kit --exclude=vendor -cf - symbols | tar -C dist.next -xf -
	cp -R scripts/kit/markers dist.next/markers
	cp -R scripts/kit/runners dist.next/runners
	if [ -d dist ]; then mv dist dist.old; fi
	if mv dist.next dist; then rm -rf dist.old; else if [ -d dist.old ]; then mv dist.old dist; fi; exit 1; fi

typecheck: ## Check the types of the tools and tests of kit with tsc (tsconfig.json); offline after npm ci
	$(CURDIR)/node_modules/.bin/tsc -p tsconfig.json

.PHONY: install install-kit kit-install
# install runs the bootstrap of kit as its first prerequisite; a repository adds its install steps as later prerequisites
# that depend on install-kit, such as install: <repo>-install and <repo>-install: install-kit (K246-2). The step of kit itself
# installs the packages of the PHP symbol extractor, which lint-php reads, so a fresh worktree of kit lints its PHP (K412).
install: install-kit kit-install ## Install the tools and packages in the bootstrap order: the npm of packageManager, package-lock.json, then the tools, then the steps of the repository; ONLINE
kit-install: install-kit ## The install step of kit after its bootstrap: the packages of the PHP symbol extractor (kit-install-symbols-php); ONLINE
	$(MAKE) --no-print-directory kit-install-symbols-php
	$(MAKE) --no-print-directory kit-install-php-arginfo

.PHONY: kit-install-php-arginfo
kit-install-php-arginfo: ## Install the declared PHP generator and its paired parser for the PHP extension fixtures; ONLINE
	$(ONLINE) $(NODE) scripts/kit/install-php-arginfo.mts
install-kit: ## Install the npm of packageManager, the packages of package-lock.json and the tools, in that order; a worktree installs nothing (K519); ONLINE
ifneq ($(KIT_WORKTREE),)
	@echo "[install-kit] $(CURDIR) is a worktree, which installs nothing: it runs the tools of the main checkout $(KIT_MAIN_CHECKOUT), and make worktree-setup links its node_modules to the main checkout's (K519)" >&2
	@exit 1
else
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
endif
