# The kit repository: its own tests and the shared targets of scripts/kit/kit.mk, which runs the sources of scripts/kit.
KIT := scripts/kit
KIT_EXT := mts
include scripts/kit/kit.mk

.DEFAULT_GOAL := kit-test

.PHONY: kit-test kit-tool-record source-test install-packages kit-install-symbols-php kit-install-php-arginfo kit-install-symbols install kit-build

# The suite of kit, which CI runs (.github/workflows/ci.yml); locally only the tests that own a change run
# (node scripts/kit/run-tests.mts node -- <test file>).
CHECK_TARGETS := typecheck kit-test source-test rebuild-check duplication-check

# The explicit test shards balance the declared unit cases (K718); CI runs every shard independently.
KIT_TEST_SHARDS := 1 2 3 4 5 6 7
KIT_TEST_FILES_1 := \
	tests/kit/bootstrap-platform.test.mts \
	tests/kit/install-idempotent.test.mts \
	tests/kit/check-toolchain.test.mts tests/kit/checklist.test.mts \
	tests/kit/gate-targets.test.mts tests/kit/install-mise.test.mts \
	tests/kit/install-vscode.test.mts tests/kit/isolation.test.mts tests/kit/lint-python.test.mts \
	tests/kit/parity.test.mts tests/kit/paths.test.mts tests/kit/php-platform.test.mts \
	tests/kit/process.test.mts tests/kit/release-go-tags.test.mts tests/kit/test-exit-deadline.test.mts \
	tests/kit/toolchain-declared.test.mts tests/kit/toolchain-lint.test.mts
KIT_TEST_FILES_2 := \
	tests/kit/bootstrap.test.mts tests/kit/bypass-check.test.mts tests/kit/check-rules.test.mts \
	tests/kit/ci.test.mts tests/kit/editor-boundaries.test.mts tests/kit/glob.test.mts \
	tests/kit/install-php.test.mts tests/kit/kit-mk.test.mts tests/kit/link-folders.test.mts \
	tests/kit/link.test.mts tests/kit/owner-check.test.mts tests/kit/pack-manifest.test.mts \
	tests/kit/rebuild-check.test.mts tests/kit/release-root.test.mts \
	tests/kit/release-tools.test.mts tests/kit/test-selection.test.mts tests/kit/text-absent.test.mts \
	tests/kit/toolchain-exceptions.test.mts tests/kit/uv-install.test.mts
KIT_TEST_FILES_3 := \
	tests/kit/ci-only.test.mts tests/kit/documents-stamp.test.mts tests/kit/install-symbols.test.mts \
	tests/kit/kit-tools.test.mts tests/kit/markdown.test.mts tests/kit/parity-requirements.test.mts \
	tests/kit/recipe-tools.test.mts \
	tests/kit/release-tag.test.mts tests/kit/run-tests.test.mts \
	tests/kit/stubs.test.mts tests/kit/suppression-check.test.mts tests/kit/test-output.test.mts \
	tests/kit/toolchain-mise.test.mts
KIT_TEST_FILES_4 := \
	tests/kit/holder-lock.test.mts \
	tests/kit/install-tools.test.mts tests/kit/kit-assets.test.mts tests/kit/kit-bootstrap.test.mts \
	tests/kit/kit-check.test.mts tests/kit/kit-files.test.mts tests/kit/land.test.mts \
	tests/kit/language-check.test.mts tests/kit/link-check.test.mts tests/kit/lint-go.test.mts \
	tests/kit/registry.test.mts tests/kit/release.test.mts \
	tests/kit/sandbox-cleanup.test.mts tests/kit/test-gap-start.test.mts tests/kit/test-markers.test.mts \
	tests/kit/toolchain-files.test.mts
KIT_TEST_FILES_5 := \
	tests/kit/cargo-downloads.test.mts tests/kit/catch-check-steps.test.mts tests/kit/composer-install.test.mts \
	tests/kit/divergence-check.test.mts tests/kit/duplication-check.test.mts tests/kit/git-hooks.test.mts \
	tests/kit/install-npm.test.mts tests/kit/install-packages.test.mts tests/kit/lint-php.test.mts \
	tests/kit/npm-install.test.mts tests/kit/php-ext.test.mts tests/kit/plan.test.mts \
	tests/kit/process-group.test.mts \
	tests/kit/release-wheel.test.mts tests/kit/retained-branches.test.mts tests/kit/sandbox-repository.test.mts \
	tests/kit/schema.test.mts tests/kit/test-build-first.test.mts tests/kit/twin-merge.test.mts
KIT_TEST_FILES_6 := \
	tests/kit/catch-check.test.mts tests/kit/ci-setup.test.mts tests/kit/claude-hook.test.mts tests/kit/commits.test.mts \
	tests/kit/documents.test.mts tests/kit/gates-workflow.test.mts \
	tests/kit/generated-files.test.mts tests/kit/git.test.mts tests/kit/kit-sync.test.mts \
	tests/kit/linked-sources.test.mts tests/kit/lint-rust.test.mts tests/kit/lint-ts.test.mts \
	tests/kit/project-hook.test.mts tests/kit/python-venv.test.mts tests/kit/release-assets.test.mts \
	tests/kit/release-tools-path.test.mts tests/kit/run-command.test.mts \
	tests/kit/toolchain-npmrc.test.mts tests/kit/tracked-files.test.mts tests/kit/verification.test.mts \
	tests/kit/worktree-setup.test.mts
KIT_TEST_FILES_7 := tests/kit/install-composer-project.test.mts tests/kit/parity-api.test.mts tests/kit/runtime-targets.test.mts tests/kit/install-rust.test.mts tests/kit/provider-tests.test.mts tests/kit/release-run.test.mts tests/kit/playwright-reporter.test.mts

SOURCE_TEST_GROUPS := ts php rust go python common-1 common-2 common-3
SOURCE_TEST_FILES_ts := tests/source/lint-ts-real.test.mts tests/source/node-real.test.mts tests/source/symbols-ts-real.test.mts
SOURCE_TEST_FILES_php := tests/source/composer-install-real.test.mts tests/source/link-composer-real.test.mts tests/source/lint-php-real.test.mts tests/source/symbols-php-real.test.mts
SOURCE_TEST_FILES_rust := tests/source/link-cargo-real.test.mts tests/source/lint-rust-real.test.mts
SOURCE_TEST_FILES_go := tests/source/lint-go-real.test.mts tests/source/tools-go-mod-real.test.mts
SOURCE_TEST_FILES_python := tests/source/lint-python-real.test.mts tests/source/python-real.test.mts tests/source/python-venv-real.test.mts tests/source/symbols-python-real.test.mts tests/source/uv-link-real.test.mts tests/source/wheel-metadata-real.test.mts
SOURCE_TEST_FILES_common-1 := tests/source/package.test.mts tests/source/npm-audit-online-real.test.mts tests/source/tool-records-real.test.mts tests/source/ci-workflow.test.mts
SOURCE_TEST_FILES_common-2 := tests/source/consumer-layout.test.mts tests/source/parity-real.test.mts
SOURCE_TEST_FILES_common-3 := tests/source/checklist-real.test.mts tests/source/checkout.test.mts tests/source/fresh-checkout.test.mts tests/source/installed-hook-real.test.mts tests/source/layout-real.test.mts tests/source/mise-env-real.test.mts tests/source/mise-trust-real.test.mts tests/source/npm-locked-link-real.test.mts tests/source/npm-source-link-real.test.mts tests/source/release-workflow.test.mts tests/source/tracked-var.test.mts

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

.PHONY: kit-test-shard source-test-group
kit-test-shard: ## Run one declared kit unit-test shard; CI supplies SHARD=1..6; offline
	@case " $(KIT_TEST_SHARDS) " in *" $(SHARD) "*) ;; *) echo "kit-test-shard: unknown or empty SHARD='$(SHARD)'; choose one of $(KIT_TEST_SHARDS)" >&2; exit 2;; esac
	@test -n "$(KIT_TEST_FILES_$(SHARD))" || { echo "kit-test-shard: SHARD=$(SHARD) has no declared test files" >&2; exit 2; }
	@mkdir -p var && git status --porcelain -uall > var/kit-test-status-$(SHARD) && git diff --binary HEAD | git hash-object --stdin > var/kit-test-diff-$(SHARD)
	$(NODE) scripts/kit/run-tests.mts node -- $(KIT_TEST_FILES_$(SHARD))
	@git status --porcelain -uall | diff var/kit-test-status-$(SHARD) - >&2 && git diff --binary HEAD | git hash-object --stdin | cmp -s var/kit-test-diff-$(SHARD) - || { echo "kit-test-shard: the run changed the checkout: the status lines above, or a change of these tracked files: $$(git diff --name-only HEAD | tr '\n' ' ')" >&2; exit 1; }

# The kit's own tests (tests/source) check the kit's real Python and wheel path. kit-sync does not vendor them, so a consumer never runs them.
source-test: ## Run the kit's own tests (tests/source) through the test runner, with the tools of mise.toml; offline after make install-tools, except uv build, which installs the build-system.requires of each wheel it builds
	$(NODE) scripts/kit/run-tests.mts node -- tests/source

source-test-group: ## Run one declared source-test group; CI supplies GROUP=ts|php|rust|go|python|common-1|common-2|common-3; offline after make install-tools
	@case " $(SOURCE_TEST_GROUPS) " in *" $(GROUP) "*) ;; *) echo "source-test-group: unknown or empty GROUP='$(GROUP)'; choose one of $(SOURCE_TEST_GROUPS)" >&2; exit 2;; esac
	@test -n "$(SOURCE_TEST_FILES_$(GROUP))" || { echo "source-test-group: GROUP=$(GROUP) has no declared test files" >&2; exit 2; }
	$(NODE) scripts/kit/run-tests.mts node -- $(SOURCE_TEST_FILES_$(GROUP))

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

install-kit: ## Install the npm of packageManager, the packages of package-lock.json and the tools, in that order, in the checkout's own var/tools, a worktree's too (K858); ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
