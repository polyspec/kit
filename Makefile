# The kit repository: its own tests and the recipes of scripts/kit/kit.mk, which run the sources of scripts/kit. No repository
# includes kit.mk and the package ships no make file (K1054); docs/examples/bootstrap.mk names kit.mk as an example to copy.
KIT := scripts/kit
KIT_EXT := mts
include scripts/kit/kit.mk

.DEFAULT_GOAL := kit-test

.PHONY: kit-test kit-owner-test kit-tool-record source-test install-packages kit-install-symbols-php kit-install-symbols install kit-build

# The suite of kit, which CI runs (.github/workflows/ci.yml); locally only the tests that own a change run
# (node scripts/kit/run-tests.mts node -- --test-concurrency=1 <test file>).
CHECK_TARGETS := typecheck kit-test source-test rebuild-check duplication-check

# The explicit test shards balance the declared unit cases (K718); CI runs every shard independently.
KIT_TEST_SHARDS := 1 2 3 4 5 6 7
KIT_TEST_FILES_1 := \
	tests/kit/bootstrap-platform.test.mts \
	tests/kit/install-idempotent.test.mts \
	tests/kit/checklist.test.mts \
	tests/kit/gate-targets.test.mts tests/kit/install-mise.test.mts tests/kit/mise-tools.test.mts \
	tests/kit/install-vscode.test.mts tests/kit/isolation.test.mts tests/kit/lint-python.test.mts \
	tests/kit/paths.test.mts tests/kit/php-platform.test.mts \
	tests/kit/process.test.mts \
	tests/kit/toolchain-declared.test.mts tests/kit/toolchain-lint.test.mts
KIT_TEST_FILES_2 := \
	tests/kit/bootstrap.test.mts tests/kit/check-rules.test.mts \
	tests/kit/ci.test.mts tests/kit/glob.test.mts \
	tests/kit/install-php.test.mts tests/kit/kit-mk.test.mts tests/kit/link-folders.test.mts \
	tests/kit/link.test.mts tests/kit/owner-check.test.mts tests/kit/pack-manifest.test.mts \
	tests/kit/rebuild-check.test.mts tests/kit/release-root.test.mts \
	tests/kit/run-command-signal.test.mts \
	tests/kit/release-tools.test.mts tests/kit/text-absent.test.mts \
	tests/kit/toolchain-exceptions.test.mts tests/kit/uv-install.test.mts
KIT_TEST_FILES_3 := \
	tests/kit/documents-stamp.test.mts tests/kit/install-symbols.test.mts \
	tests/kit/kit-tools.test.mts tests/kit/markdown.test.mts \
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
	tests/kit/sandbox-cleanup.test.mts \
	tests/kit/toolchain-files.test.mts
KIT_TEST_FILES_5 := \
	tests/kit/duplication-check.test.mts tests/kit/git-hooks.test.mts \
	tests/kit/lint-php.test.mts \
	tests/kit/php-ext.test.mts tests/kit/plan.test.mts \
	tests/kit/process-group.test.mts \
	tests/kit/release-wheel.test.mts tests/kit/retained-branches.test.mts tests/kit/sandbox-repository.test.mts \
	tests/kit/schema.test.mts tests/kit/schema-validate.test.mts tests/kit/test-build-first.test.mts tests/kit/twin-merge.test.mts
KIT_TEST_FILES_6 := \
	tests/kit/actions-expression.test.mts tests/kit/catch-check.test.mts tests/kit/ci-job.test.mts tests/kit/ci-setup.test.mts tests/kit/ci-workflow-jobs.test.mts tests/kit/commits.test.mts \
	tests/kit/documents.test.mts tests/kit/gates-workflow.test.mts \
	tests/kit/generated-files.test.mts tests/kit/git.test.mts tests/kit/kit-sync.test.mts \
	tests/kit/linked-sources.test.mts tests/kit/lint-rust.test.mts tests/kit/lint-steps.test.mts tests/kit/lint-ts.test.mts \
	tests/kit/link-read-only.test.mts tests/kit/python-venv.test.mts \
	tests/kit/release-tools-path.test.mts tests/kit/run-command.test.mts \
	tests/kit/tracked-files.test.mts tests/kit/verification.test.mts \
	tests/kit/worktree-setup.test.mts tests/kit/worktree-links.test.mts
KIT_TEST_FILES_7 := tests/kit/install-composer-project.test.mts tests/kit/native-settings.test.mts tests/kit/runtime-targets.test.mts tests/kit/install-rust.test.mts tests/kit/provider-tests.test.mts tests/kit/release-run.test.mts tests/kit/playwright-reporter.test.mts tests/kit/commit-names-check.test.mts

SOURCE_TEST_GROUPS := ts php rust go python common-1 common-2 common-3
SOURCE_TEST_FILES_ts := tests/source/lint-ts-real.test.mts tests/source/node-real.test.mts
SOURCE_TEST_FILES_php := tests/source/phpunit-identity.test.mts tests/source/link-composer-real.test.mts tests/source/lint-php-real.test.mts
SOURCE_TEST_FILES_rust := tests/source/link-cargo-real.test.mts tests/source/lint-rust-real.test.mts
SOURCE_TEST_FILES_go := tests/source/go-bench-output-real.test.mts tests/source/lint-go-real.test.mts tests/source/link-go-real.test.mts
SOURCE_TEST_FILES_python := tests/source/lint-python-real.test.mts tests/source/python-real.test.mts tests/source/python-venv-real.test.mts tests/source/uv-link-real.test.mts tests/source/wheel-metadata-real.test.mts
SOURCE_TEST_FILES_common-1 := tests/source/package.test.mts tests/source/npm-audit-online-real.test.mts tests/source/tool-records-real.test.mts tests/source/ci-workflow.test.mts
SOURCE_TEST_FILES_common-2 := tests/source/consumer-layout.test.mts
SOURCE_TEST_FILES_common-3 := tests/source/workflow-env-real.test.mts tests/source/process-group-posix.test.mts tests/source/install-vscode-posix.test.mts tests/source/checklist-real.test.mts tests/source/checkout.test.mts tests/source/fresh-checkout.test.mts tests/source/layout-real.test.mts tests/source/mise-env-real.test.mts tests/source/mise-trust-real.test.mts tests/source/npm-locked-link-real.test.mts tests/source/npm-source-link-real.test.mts tests/source/release-workflow.test.mts tests/source/tracked-var.test.mts

# The packages of package-lock.json with the npm of var/tools, the step after make install-tools TOOLS=npm; the release
# workflow that kit runs for itself calls it.
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
	$(NODE) scripts/kit/run-tests.mts node -- --test-concurrency=1 tests/kit
	@git status --porcelain -uall | diff var/kit-test-status - >&2 && git diff --binary HEAD | git hash-object --stdin | cmp -s var/kit-test-diff - || { echo "kit-test: the run changed the checkout: the status lines above, or a change of these tracked files: $$(git diff --name-only HEAD | tr '\n' ' ')" >&2; exit 1; }

# The test command of the owner checks of kit (config/owner-checks.json testTarget): the test files of TESTS, with the timeout and
# the one file at a time of kit-test (K1094).
kit-owner-test: ## Run the test files of TESTS through the test runner, as kit-test runs them; the owner checks of kit call it; offline
	$(NODE) scripts/kit/run-tests.mts node -- --test-concurrency=1 $(TESTS)

.PHONY: kit-test-shard source-test-group
kit-test-shard: ## Run one declared kit unit-test shard; CI supplies SHARD=1..6; offline
	@case " $(KIT_TEST_SHARDS) " in *" $(SHARD) "*) ;; *) echo "kit-test-shard: unknown or empty SHARD='$(SHARD)'; choose one of $(KIT_TEST_SHARDS)" >&2; exit 2;; esac
	@test -n "$(KIT_TEST_FILES_$(SHARD))" || { echo "kit-test-shard: SHARD=$(SHARD) has no declared test files" >&2; exit 2; }
	@mkdir -p var && git status --porcelain -uall > var/kit-test-status-$(SHARD) && git diff --binary HEAD | git hash-object --stdin > var/kit-test-diff-$(SHARD)
	$(NODE) scripts/kit/run-tests.mts node -- --test-concurrency=1 $(KIT_TEST_FILES_$(SHARD))
	@git status --porcelain -uall | diff var/kit-test-status-$(SHARD) - >&2 && git diff --binary HEAD | git hash-object --stdin | cmp -s var/kit-test-diff-$(SHARD) - || { echo "kit-test-shard: the run changed the checkout: the status lines above, or a change of these tracked files: $$(git diff --name-only HEAD | tr '\n' ' ')" >&2; exit 1; }

# The kit's own tests (tests/source) check the kit's real Python and wheel path. The package does not ship them, so a consumer never runs them.
source-test: ## Run the kit's own tests (tests/source) through the test runner, with the tools of mise.toml; offline after make install-tools, except uv build, which installs the build-system.requires of each wheel it builds
	$(NODE) scripts/kit/run-tests.mts node -- --test-concurrency=1 tests/source

source-test-group: ## Run one declared source-test group; CI supplies GROUP=ts|php|rust|go|python|common-1|common-2|common-3; offline after make install-tools
	@case " $(SOURCE_TEST_GROUPS) " in *" $(GROUP) "*) ;; *) echo "source-test-group: unknown or empty GROUP='$(GROUP)'; choose one of $(SOURCE_TEST_GROUPS)" >&2; exit 2;; esac
	@test -n "$(SOURCE_TEST_FILES_$(GROUP))" || { echo "source-test-group: GROUP=$(GROUP) has no declared test files" >&2; exit 2; }
	$(NODE) scripts/kit/run-tests.mts node -- --test-concurrency=1 $(SOURCE_TEST_FILES_$(GROUP))

.PHONY: ci-checks ci-kit-tests ci-source-tests ci-bootstrap ci-kit catch-check
# The jobs of kit's own CI (.github/workflows/ci.yml), one recipe each, which CI and a local run call alike (K1250): the installs
# first, each stopping the job at its failure, then every check of the job to its end (make -k), so one run names every failure.
# A job installs only the tools that its tests exercise.
CI_CHECKS := typecheck layout-check duplication-check lint-ts catch-check lint-php lint-php-ext test-php-ext lint-python lint-go lint-rust docs-check rebuild-check owner-validate rules-check suppression-check language-check release-coverage
KIT_TEST_TOOLS_1 := php composer
KIT_TEST_TOOLS_3 := php composer phpunit
KIT_TEST_TOOLS_4 := php composer python go
KIT_TEST_TOOLS_5 := php composer phpunit
KIT_TEST_TOOLS_6 := rust
KIT_TEST_TOOLS_7 := php composer
# Shard 5 runs temporary consumer fixtures, which resolve the PHP parser from the source installation of kit.
KIT_TEST_SYMBOLS := 5
SOURCE_TEST_TOOLS_php := php composer phpcs phpstan phpunit
SOURCE_TEST_TOOLS_rust := rust
SOURCE_TEST_TOOLS_go := go golangciLint deadcode govulncheck
SOURCE_TEST_TOOLS_python := python uv ruff vulture
SOURCE_TEST_TOOLS_common-1 := go php composer
SOURCE_TEST_TOOLS_common-2 := go python uv php phpunit rust
SOURCE_TEST_TOOLS_common-3 := python alint
SOURCE_TEST_SYMBOLS := php

ci-checks: ## The checks job of kit's CI: every tool of mise.toml and the PHP symbol packages, then every check of CI_CHECKS to its end; ONLINE for the installs
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory kit-install-symbols-php
	$(MAKE) --no-print-directory -k $(CI_CHECKS)

ci-kit-tests: ## The kit tests job of kit's CI for SHARD=1..7: the tools of the shard, then its tests; ONLINE for the installs
	@case " $(KIT_TEST_SHARDS) " in *" $(SHARD) "*) ;; *) echo "ci-kit-tests: unknown or empty SHARD='$(SHARD)'; choose one of $(KIT_TEST_SHARDS)" >&2; exit 2;; esac
	$(if $(KIT_TEST_TOOLS_$(SHARD)),$(MAKE) --no-print-directory install-tools TOOLS="$(KIT_TEST_TOOLS_$(SHARD))")
	$(if $(filter $(SHARD),$(KIT_TEST_SYMBOLS)),$(MAKE) --no-print-directory kit-install-symbols-php)
	$(MAKE) --no-print-directory kit-test-shard SHARD=$(SHARD)

ci-source-tests: ## The source tests job of kit's CI for GROUP=<group> of SOURCE_TEST_GROUPS: the tools of the group, then its tests; ONLINE for the installs
	@case " $(SOURCE_TEST_GROUPS) " in *" $(GROUP) "*) ;; *) echo "ci-source-tests: unknown or empty GROUP='$(GROUP)'; choose one of $(SOURCE_TEST_GROUPS)" >&2; exit 2;; esac
	$(if $(SOURCE_TEST_TOOLS_$(GROUP)),$(MAKE) --no-print-directory install-tools TOOLS="$(SOURCE_TEST_TOOLS_$(GROUP))")
	$(if $(filter $(GROUP),$(SOURCE_TEST_SYMBOLS)),$(MAKE) --no-print-directory kit-install-symbols-php)
	$(MAKE) --no-print-directory source-test-group GROUP=$(GROUP)

# The platform bootstrap smoke (K730): the bootstrap of a fresh checkout with the Node.js of the machine, its idempotence and the
# pinned Go and Rust, then the smoke checks of the platform. Linux source CI owns the POSIX defunct-group check on Linux and the
# macOS job owns it on macOS (K1041); Windows checks its native batch wrappers in PowerShell, since Git Bash cannot run a .cmd
# wrapper as a command (K820).
ifeq ($(OS),Windows_NT)
CI_BOOTSTRAP_PLATFORM := windows
else
CI_BOOTSTRAP_PLATFORM := $(if $(filter Darwin,$(shell uname -s)),macos,linux)
endif
CI_BOOTSTRAP_CHECKS := case-sensitive-runner-smoke bootstrap-process-smoke bootstrap-go-bench-smoke
CI_BOOTSTRAP_CHECKS_linux := $(CI_BOOTSTRAP_CHECKS) bootstrap-versions-check
CI_BOOTSTRAP_CHECKS_macos := $(CI_BOOTSTRAP_CHECKS) bootstrap-posix-smoke bootstrap-versions-check
CI_BOOTSTRAP_CHECKS_windows := owner-validate $(CI_BOOTSTRAP_CHECKS) bootstrap-windows-shim-smoke bootstrap-windows-versions-check
ci-bootstrap: ## The platform bootstrap job of kit's CI: make bootstrap, its idempotence, the pinned Go and Rust, then the smoke checks of the platform to their end; ONLINE for the installs
	$(MAKE) --no-print-directory bootstrap
	$(BOOTSTRAP_NODE) scripts/kit/bootstrap/verify-idempotent.mts
	$(MAKE) --no-print-directory install-tools TOOLS="go rust"
	$(MAKE) --no-print-directory -k $(CI_BOOTSTRAP_CHECKS_$(CI_BOOTSTRAP_PLATFORM))

.PHONY: bootstrap-process-smoke bootstrap-posix-smoke bootstrap-go-bench-smoke bootstrap-versions-check bootstrap-windows-shim-smoke bootstrap-windows-versions-check
bootstrap-process-smoke: ## Run the common process ownership and native wrapper tests on this platform; offline
	$(NODE) --test tests/kit/process.test.mts tests/kit/process-group.test.mts
bootstrap-posix-smoke: ## Run the native POSIX defunct-group test on this platform; offline
	$(NODE) --test tests/source/process-group-posix.test.mts
# K919: the runner reads the result line of a real Go benchmark on each platform, whose pipes split it differently. K923: the go
# shim of mise reaches mise only by the PATH of kit.mk, so make runs the test.
bootstrap-go-bench-smoke: ## Read the result line of a real Go benchmark on this platform; offline after make install-tools TOOLS=go
	$(NODE) scripts/kit/run-tests.mts node -- --test-concurrency=1 tests/source/go-bench-output-real.test.mts
bootstrap-versions-check: ## Check that the POSIX wrappers of var/tools and the selected toolchains run the pinned releases; offline
	test "$$(var/tools/bin/mise --version | cut -d' ' -f1)" = 2026.10.10
	test "$$(var/tools/bin/node --version)" = v26.12.0
	test "$$(var/tools/bin/npm --version)" = 12.2.0
	go_binary="$$(var/tools/bin/mise which go)" && test "$$("$$go_binary" version | cut -d' ' -f3)" = go1.27.3
	test "$$(rustc --version | cut -d' ' -f2)" = 1.99.0
	test "$$(cargo --version | cut -d' ' -f2)" = 1.99.0
bootstrap-windows-shim-smoke: ## Run a mise shim through Git Bash make on Windows; offline
	$(KIT_TOOLS)/mise/shims/go version | grep 'go1\.27\.3 windows/'
# The script reaches PowerShell through the environment, unexpanded, since make would expand its dollar signs.
define WINDOWS_VERSIONS_CHECK
$mise = (& .\var\tools\bin\mise.cmd --version).Trim()
if ($LASTEXITCODE -ne 0 -or $mise -notmatch '^2026\.10\.10 ') { throw "Unexpected mise output: $mise" }
$node = (& .\var\tools\bin\node.cmd --version).Trim()
if ($LASTEXITCODE -ne 0 -or $node -ne 'v26.12.0') { throw "Unexpected Node.js output: $node" }
$npm = (& .\var\tools\bin\npm.cmd --version).Trim()
if ($LASTEXITCODE -ne 0 -or $npm -ne '12.2.0') { throw "Unexpected npm output: $npm" }
$goBinary = (& .\var\tools\bin\mise.cmd which go).Trim()
$go = (& $goBinary version).Trim()
if ($LASTEXITCODE -ne 0 -or $go -notmatch 'go1\.27\.3 windows/') { throw "Unexpected Go output: $go" }
$rustc = (& rustc --version).Trim()
if ($LASTEXITCODE -ne 0 -or $rustc -notmatch '^rustc 1\.99\.0 ') { throw "Unexpected rustc output: $rustc" }
$cargo = (& cargo --version).Trim()
if ($LASTEXITCODE -ne 0 -or $cargo -notmatch '^cargo 1\.99\.0 ') { throw "Unexpected cargo output: $cargo" }
endef
bootstrap-windows-versions-check: export KIT_WINDOWS_VERSIONS_CHECK = $(value WINDOWS_VERSIONS_CHECK)
bootstrap-windows-versions-check: ## Check in PowerShell that the native batch wrappers of var/tools and the selected toolchains run the pinned releases on Windows; offline
	pwsh -NoProfile -NonInteractive -Command "$$KIT_WINDOWS_VERSIONS_CHECK"

# The required job of kit's CI judges the results of the other jobs, which only a CI run has.
ci-kit: ## The required job of kit's CI: fail unless every job of RESULTS, the JSON of toJSON(needs), succeeded, a skipped one included (K1111)
	$(MAKE) --no-print-directory ci-passed FAIL_SKIPPED=1

catch-check: ## Fail on a catch without a statement (K537, K1050); offline
	$(NODE) scripts/kit/catch-check.mts

.PHONY: workflow-env-smoke
workflow-env-smoke: ## Verify native workflow expression and child environment casing, last writes and PATH; offline
	$(NODE) scripts/kit/run-tests.mts node -- --test-concurrency=1 tests/source/workflow-env-real.test.mts

.PHONY: case-sensitive-runner-smoke
# The smoke of kit's own CI (K1121): the standard Node runner in a temporary verified case-sensitive directory, with kit's own smoke file.
case-sensitive-runner-smoke: ## Smoke the standard Node runner with a temporary verified case-sensitive directory; offline
	CASE_SENSITIVE_ENV=KIT_CASE_SENSITIVE_SMOKE_DIR $(NODE) scripts/kit/runtime-targets.mts case-sensitive-smoke tests/kit/standard-case-sensitive-smoke.mts

kit-tool-record: ## Write tests/kit/tool-records.json, what the pinned go and Composer print for the requests of the stubs; offline after make install-tools
	$(NODE) tests/kit/record-tools.mts

.PHONY: typecheck build test lint
# kit holds no runtime of packages/; its tasks build, test and lint are its own builds, tests and lints (K246, K1106).
build: kit-build
test: kit-test source-test
lint: lint-ts lint-php lint-python lint-go

kit-build: ## Build the package @polyspec/kit into dist/ through dist.next/ and a rename, so a consumer that links kit never reads a half-built dist; offline after npm ci
	rm -rf dist.next dist.old
	$(CURDIR)/node_modules/.bin/tsc -p tsconfig.build.json --outDir dist.next
	cp -R scripts/kit/schema dist.next/schema
	tar -C scripts/kit --exclude=vendor --exclude=__pycache__ -cf - symbols runners | tar -C dist.next -xf -
	$(NODE) $(KIT)/kit-items.$(KIT_EXT) dist.next/kit-items.json
	if [ -d dist ]; then mv dist dist.old; fi
	if mv dist.next dist; then rm -rf dist.old; else if [ -d dist.old ]; then mv dist.old dist; fi; exit 1; fi

typecheck: ## Check the types of the tools and tests of kit with tsc (tsconfig.json); offline after npm ci
	$(CURDIR)/node_modules/.bin/tsc -p tsconfig.json

.PHONY: bootstrap
# The first make of a fresh checkout of kit, locally and in CI, where the kit-bootstrap action runs it after setting up Node.js
# (K1250). kit runs its own sources, so unlike a repository (docs/examples/bootstrap.mk) it installs no kit package first.
bootstrap: ## Install the mise, node and npm of mise.toml, then the packages of package-lock.json with that npm; ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages

.PHONY: install install-kit kit-install
# install runs the bootstrap of kit as its first prerequisite; a repository adds its install steps as later prerequisites
# that depend on install-kit, such as install: <repo>-install and <repo>-install: install-kit (K246-2). The step of kit itself
# installs the packages of the PHP symbol extractor, which lint-php reads, so a fresh worktree of kit lints its PHP (K412).
install: install-kit kit-install ## Install the tools and packages in the bootstrap order: the mise, node and npm of mise.toml, package-lock.json, then the tools, then the steps of the repository; ONLINE
kit-install: install-kit ## The install step of kit after its bootstrap: the packages of the PHP symbol extractor (kit-install-symbols-php); ONLINE
	$(MAKE) --no-print-directory kit-install-symbols-php

install-kit: ## Install the mise, node and npm of mise.toml, the packages of package-lock.json, the tools and the declared PHP programs of kit (K861), in that order, in the checkout's own var/tools, a worktree's too (K858); ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory kit-install-declared
