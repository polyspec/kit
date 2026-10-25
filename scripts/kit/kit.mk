# The targets of kit that every repository includes. A repository includes it through scripts/kit/kit-bootstrap.mk, which
# sets KIT := node_modules/@polyspec/kit/dist and KIT_EXT := mjs; the Makefile of kit sets KIT := scripts/kit and
# KIT_EXT := mts and runs the sources. Every tool runs as node $(KIT)/<tool>.$(KIT_EXT).
ifeq ($(and $(KIT),$(KIT_EXT)),)
$(error kit.mk needs KIT and KIT_EXT; include it through kit-bootstrap.mk, or set both as the Makefile of kit does)
endif
ONLINE ?=

# The tools of mise.toml (K127) run from the shims of mise, var/tools/mise/shims, which need the environment of mise of the
# checkout (miseEnvironment of scripts/kit/bootstrap/install-mise.mts): every recipe runs with it, and with var/tools/bin
# (npm, npx, mise and the wrappers of the Composer projects) and the shims first on PATH. var/tools is that of the main checkout
# of the repository (KIT_TOOLS, K519): a linked worktree runs the tools that the main checkout installed, its data dir, installs
# and shims, and keeps only its own mise.toml; outside a repository it is the checkout's own.
KIT_GIT_COMMON := $(abspath $(shell git rev-parse --git-common-dir 2>/dev/null))
KIT_MAIN_CHECKOUT := $(realpath $(patsubst %/.git,%,$(filter %/.git,$(KIT_GIT_COMMON))))
KIT_TOOLS := $(or $(KIT_MAIN_CHECKOUT),$(CURDIR))/var/tools
# Set in a linked worktree, whose main checkout is another folder: it installs no tool (install-tools refuses, install-kit skips it).
KIT_WORKTREE := $(if $(KIT_MAIN_CHECKOUT),$(filter-out $(realpath $(CURDIR)),$(KIT_MAIN_CHECKOUT)))
export MISE_DATA_DIR := $(KIT_TOOLS)/mise
export MISE_CACHE_DIR := $(KIT_TOOLS)/mise/cache
export MISE_STATE_DIR := $(KIT_TOOLS)/mise/state
export MISE_CONFIG_DIR := $(KIT_TOOLS)/mise/config
export MISE_GLOBAL_CONFIG_FILE := $(CURDIR)/mise.toml
# mise install records the trust of the root of the global config, the home directory unless this names the checkout (K397-1).
export MISE_GLOBAL_CONFIG_ROOT := $(CURDIR)
export MISE_LOCKED := 1
export MISE_AUTO_INSTALL := 0
export UV_PYTHON_DOWNLOADS := never
export UV_NO_CONFIG := 1
export UV_CACHE_DIR := $(KIT_TOOLS)/mise/cache/uv
MISE_ENVIRONMENT := MISE_DATA_DIR MISE_CACHE_DIR MISE_STATE_DIR MISE_CONFIG_DIR MISE_GLOBAL_CONFIG_FILE MISE_GLOBAL_CONFIG_ROOT MISE_LOCKED MISE_AUTO_INSTALL UV_PYTHON_DOWNLOADS UV_NO_CONFIG UV_CACHE_DIR
export PATH := $(KIT_TOOLS)/bin:$(KIT_TOOLS)/mise/shims:$(PATH)

# A recipe starts a tool of the checkout by its absolute path, never by its bare name: make 3.81 looks up a recipe line
# without shell syntax on the PATH that make started with, not on the PATH above, so `node` there was the node of the
# machine (K171). NODE is the Node.js of mise.toml, whose wrapper the bootstrap writes; BOOTSTRAP_NODE is the node of the
# machine, which only starts the bootstrap that installs NODE and toolchain-lock, which writes the mise.lock that the bootstrap
# installs NODE from (K174). A repository's own recipes use these variables too.
NODE := $(KIT_TOOLS)/bin/node
NPM := $(KIT_TOOLS)/bin/npm
ALINT := $(KIT_TOOLS)/mise/shims/alint
BOOTSTRAP_NODE := node

.PHONY: kit-sync kit-check

kit-sync: ## Write the copies of the installed @polyspec/kit (kit.copies of its package.json), the version of package-lock.json; offline
	$(NODE) $(KIT)/kit-sync.$(KIT_EXT)

kit-check: ## Check the installed @polyspec/kit against package-lock.json, the copies against it and the configuration against its schemas; offline
	$(NODE) $(KIT)/kit-check.$(KIT_EXT)

# --- cargo downloads: the crates of every Cargo.lock are downloaded before a check runs cargo offline.
.PHONY: cargo-downloads-check cargo-downloads-fetch
cargo-downloads-check: ## Check that the crates of every Cargo.lock are in the registry of CARGO_HOME; offline
	$(NODE) $(KIT)/check-cargo-downloads.$(KIT_EXT)

cargo-downloads-fetch: ## Download the crates of every Cargo.lock
	$(ONLINE) $(NODE) $(KIT)/check-cargo-downloads.$(KIT_EXT) --fetch
# Toolchains (K8.2, K127): the bootstrap (TOOLS=npm) installs the npm of packageManager and mise; install-tools installs every
# tool of mise.toml at the digests of mise.lock with mise, then what mise does not install (the wheel backend, the Composer
# projects, the symbol extractors); toolchain-lock writes mise.lock. All three download, so they run ONLINE. Nothing outside
# the checkout changes. toolchain-check compares the running tools with the declarations and fails with the expected and the
# running version.
.PHONY: install-tools toolchain-lock toolchain-check

# TOOLS=npm is the first step of a checkout, before npm ci installs the packages that the other tools import, so it runs the
# bootstrap installer of $(KIT)/bootstrap, which imports only Node.js built-ins.
install-tools: ## Install the tools of mise.lock with mise, and the tools that mise does not install, into var/tools; TOOLS=npm runs the bootstrap; ONLINE
ifneq ($(KIT_WORKTREE),)
	@echo "[install-tools] $(CURDIR) is a worktree that runs the tools of the main checkout $(KIT_MAIN_CHECKOUT) and installs none; run make install-tools there (K519)" >&2
	@exit 1
else ifeq ($(TOOLS),npm)
	$(ONLINE) $(BOOTSTRAP_NODE) $(KIT)/bootstrap/bootstrap.$(KIT_EXT)
else
	$(ONLINE) $(NODE) $(KIT)/install-tools.$(KIT_EXT) $(TOOLS)
endif

# toolchain-lock runs before the node of the checkout exists, which the bootstrap installs from mise.lock, so the node of the
# machine starts it, and it installs the mise of config/toolchain.json itself (K174).
toolchain-lock: ## Write mise.lock: the digests of the tools of mise.toml for linux-x64, linux-arm64, macos-arm64 and macos-x64, with mise lock; ONLINE
	$(ONLINE) $(BOOTSTRAP_NODE) $(KIT)/toolchain-lock.$(KIT_EXT)

toolchain-check: ## Check that the running tools are the declared versions; TOOLS limits the tools; offline
	$(NODE) $(KIT)/check-toolchain.$(KIT_EXT) $(TOOLS)

# ---- Folder layout (S5) ---------------------------------------------------------------------------------------------
# alint (mise.toml, installed by install-tools) checks the tree against config/layout.yml, which extends
# the common rules of kit in the vendored config/layout.kit.yml with the map of the repository.
.PHONY: layout-check
layout-check: ## Check the folder layout of the checkout (S5) against config/layout.yml with the alint of mise.toml, and that Git ignores each install directory (K372), and that no tracked file is generated (K426); offline
	@test -x $(ALINT) || { echo "layout-check: $(ALINT) is missing; run make install-tools"; exit 1; }
	$(ALINT) check --config config/layout.yml --color never --compact .
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) installs
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) tracked
# ---- The gates: Git hooks and push gate --------------------------------------------------------------------------------
# scripts/kit/git-hooks.mts and push-gate.mts read config/checklist.json. The full suite runs only in CI, as the targets of
# `make ci-targets` (ci-only.mts); no target runs it locally.
COMMIT ?= HEAD

.PHONY: hooks hooks-check staged-generated-hook commit-gates-hook merge-commit-hook push-gate-hook commit-msg-hook push-gate-commit

# Git runs the hooks of core.hooksPath. A checkout that tracks .githooks/pre-push sets it on every make invocation.
ifneq ($(wildcard .githooks/pre-push),)
ifneq ($(shell git config core.hooksPath),.githooks)
$(shell git config core.hooksPath .githooks)
endif
endif

twin-merge: ## The merge drivers that make hooks declares: kit-twin of a Korean changelog or checklist (K354), kit-changelog of CHANGELOG.md, whose Unreleased entries it puts newest first (K354-1), and kit-checklist of a checklist, which merges its task rows by ID (K354-3); git runs it with MERGE="<base> <ours> <theirs> <path>"; offline
	@$(NODE) $(KIT)/twin-merge.$(KIT_EXT) $(MERGE)

hooks: ## Set core.hooksPath to .githooks, write the pre-commit, pre-merge-commit, pre-push, commit-msg and prepare-commit-msg hooks of kit and check the hooks
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) install

hooks-check: ## Fail while core.hooksPath is not .githooks or a hook of config/checklist.json is missing, not executable or changed
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) check

staged-generated-hook: ## The generated-file check of the pre-commit hook: fail while a staged path has a generated segment that config/generated.json does not declare; the hook that make hooks writes runs it
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) staged

push-gate-hook: ## The push gate of the pre-push hook, with the pushed refs on standard input; the hook that make hooks writes runs it
	$(NODE) $(KIT)/push-gate.$(KIT_EXT) hook

commit-gates-hook: ## No gate runs on a commit (K603): the gates run once, at land; the pre-commit hook that make hooks writes still calls it
	@$(NODE) $(KIT)/check-commits.$(KIT_EXT) --commit-gates

merge-commit-hook: ## Refuse a merge commit on main (K404-1, P38): the pre-merge-commit hook that make hooks writes runs it
	@$(NODE) $(KIT)/check-commits.$(KIT_EXT) --merge-commit

commit-msg-hook: ## The message checks of make commit on the message being committed as MESSAGE (K380); the commit-msg hook that make hooks writes runs it
	$(NODE) $(KIT)/check-commits.$(KIT_EXT) --message $(MESSAGE)

prepare-commit-msg-hook: ## The record of an amend that the commit-msg check reads (K380-2), from the SOURCE and the SHA that git gives the prepare-commit-msg hook, silent on every commit, which it only records (K380-3); the hook that make hooks writes runs it
	@$(NODE) $(KIT)/check-commits.$(KIT_EXT) --prepare --source=$(SOURCE) --sha=$(SHA)

push-gate-commit: ## The push gate on COMMIT (HEAD): fail while it has an item in an active state or does not track an executable hook
	$(NODE) $(KIT)/push-gate.$(KIT_EXT) commit $(COMMIT)

# --- Rules: every tool has its class (S1) and every rule names the check that enforces it (K248) --------------------------
.PHONY: build test lint build-go build-js build-php build-python build-rust build-ts lint-js build-php-ext lint-php-ext test-php-ext php-ext-arginfo
# The fixed tasks of a repository (K246): each runs its target for every runtime that packages/ holds; a repository adds its
# own steps to a task as prerequisites, never under another name.
build test lint: ## Run build-<runtime>, test-<runtime> or lint-<runtime> for every runtime that packages/ holds; offline
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) task $@

build-go build-js build-php build-python build-rust build-ts: ## Build each package of the runtime with the build of its ecosystem; offline
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) build $(@:build-%=%)

# oxlint lints the JavaScript as it lints the TypeScript.
lint-js: lint-ts

# The PHP extension of packages/php-ext (php-extension.mts, S10): one build with phpize, the check of its names, its stub and
# the stub hash of its arginfo header when present, the generated header during the temporary build, and the declaration test before its unit tests. A repository
# without an extension passes them, so every CI runs them.
build-php-ext: ## Build packages/php-ext with phpize into var/php-ext/polyspec_<repository>.so after the offline arginfo check; offline
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) build

lint-php-ext: ## Check the names, the one stub and the stub hash when an arginfo header is present (S10); offline
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) check

test-php-ext: build-php-ext ## Compare the declarations of the built extension with the PHP library, then run its unit tests with CASES=<pattern>; offline
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) test

php-ext-arginfo: ## Write the ignored arginfo header of packages/php-ext from its stub with the pinned local gen_stub.php; offline
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) arginfo

.PHONY: test-go test-js test-php test-python test-rust test-ts test-integration test-conformance
# The unit tests of a runtime with CASES=<pattern>, the name filter of its runner; without CASES, every unit test, which
# run-tests allows only in CI. The suites run only in CI (K244).
test-go test-js test-php test-python test-rust test-ts: ## Run the unit tests of each package of the runtime with the name filter CASES=<pattern>; offline
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) $(@:test-%=%)

test-integration test-conformance: ## Run the suite of each runtime under tests/integration or tests/conformance of the root; only in CI
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) $(@:test-%=%)

.PHONY: kit-gates
# The gates of every repository, which the vendored gates workflow runs with make -k so that one run shows every failure
# (K270): each make target that a rule of PRINCIPLES.md is enforced by. commits-check reads RANGE from the run.
kit-gates: kit-check toolchain-check layout-check docs-check rules-check owner-validate rebuild-check language-check test-markers-check duplication-check dependency-policy-check parity-declarations-check parity-check commits-check link-state-check bypass-check suppression-check divergence-check lint-ts lint-php lint-python lint-go lint-rust lint-php-ext test-php-ext ## Run every gate of kit; the gates workflow runs it with make -k in CI


.PHONY: link-state-check
link-state-check: ## Fail while an installed package folder that a sibling checkout provides is a copy or links elsewhere, a tracked lock records a provided polyspec package as a path or a link (K507), or a workspace link, go.work, the hook, the trust or a merged worktree is wrong; no version is judged (K448, S4); offline
	$(NODE) $(KIT)/link-state-check.$(KIT_EXT)

.PHONY: suppression-check
suppression-check: ## Fail on a tracked suppression of a lint finding (eslint-disable, oxlint-disable, noqa, @phpstan-ignore, phpcs:ignore, nolint, allow) that states no reason in the form of its tool (P8, K334); offline
	$(NODE) $(KIT)/suppression-check.$(KIT_EXT)

.PHONY: bypass-check
bypass-check: ## Fail on a tracked test, script or Makefile that sets the CI identity, assumes a gate of kit-gates up to date with make -o, or skips a Git hook with --no-verify (K308); offline
	$(NODE) $(KIT)/bypass-check.$(KIT_EXT)

# The red of a row whose whole change is text (K431): the Verification of P19's sub-item. It is no gate of kit-gates.
.PHONY: text-absent
# FILE and TEXT reach the tool through its environment, unexpanded: a stale text may hold a backquote, a $ or a quote, which neither
# make nor the shell of the recipe may read. make exports a variable of its command line expanded, so TEXT is not exported.
unexport TEXT
text-absent: export KIT_TEXT_ABSENT_FILE = $(value FILE)
text-absent: export KIT_TEXT_ABSENT_TEXT = $(value TEXT)
text-absent: ## Fail while the tracked file FILE holds the stale text TEXT, naming each line: the red of a row whose whole change is text (K431); offline
	$(NODE) $(KIT)/text-absent.$(KIT_EXT)

.PHONY: divergence-check
divergence-check: ## Fail on an implementation that diverges through a branch on the runtime, a narrowing of its run, a partial or unsupported feature, or an exception without a kind of reason (K315); offline
	$(NODE) $(KIT)/divergence-check.$(KIT_EXT)

.PHONY: language-check
language-check: ## Fail on Hangul in a comment, an identifier, an error or log message or a test name of the code (K252); offline
	$(NODE) $(KIT)/language-check.$(KIT_EXT)

.PHONY: test-markers-check
test-markers-check: ## Fail on a test that a marker skips or narrows: test.skip, it.only, t.Skip, unittest.skip, markTestSkipped, #[ignore] (K255); offline
	$(NODE) $(KIT)/test-markers.$(KIT_EXT)

.PHONY: duplication-check
duplication-check: ## Fail while a piece of 6 lines or more of code exists twice outside the folders of config/duplication.json (jscpd, K248-3); offline
	$(NODE) $(KIT)/duplication-check.$(KIT_EXT)

.PHONY: rebuild-check rules-check

rebuild-check: ## Check that every tool that config/rebuild.json selects has its class: ecosystem, replaced, record or policy (S1); offline
	$(NODE) $(KIT)/rebuild-check.$(KIT_EXT)

rules-check: ## Check that every rule of PRINCIPLES.md and AGENTS.md names a check that a CI workflow, a Git hook or the Claude Code hook runs (K248); offline
	$(NODE) $(KIT)/check-rules.$(KIT_EXT)

# --- Document, owner and CI report tools (rows K7 and K8.1) ---------------------------------------------------------------
.PHONY: docs-check

# The document checks of a repository after the check of kit (K419): the repository adds a make target with DOCS_CHECKS += <target>,
# and docs-check runs check-documents and every target of DOCS_CHECKS, each whatever the status of the others, then fails naming
# those that failed. The recipe is expanded when it runs, so a DOCS_CHECKS that the Makefile sets after the include counts.
DOCS_CHECKS_BEGIN = $(if $(strip $(DOCS_CHECKS)),status=0; failed=; )
DOCS_CHECKS_END = $(if $(strip $(DOCS_CHECKS)), || { status=1; failed=check-documents; }; for target in $(DOCS_CHECKS); do $(MAKE) --no-print-directory $$target || { status=1; failed="$$failed $$target"; }; done; if [ $$status -ne 0 ]; then echo "[docs-check] failed:$$failed" >&2; fi; exit $$status)
docs-check: ## Check the documents declared in config/documents.json: translation pairs, revisions, links, and the checklists of config/checklist.json, then the document checks that a repository adds with DOCS_CHECKS += <target> (K419); offline
	$(DOCS_CHECKS_BEGIN)$(NODE) $(KIT)/check-documents.$(KIT_EXT)$(DOCS_CHECKS_END)

.PHONY: plan-new plan-split item-new item-edit item-state item-red item-test commit

# The plan utilities (plan.mts, K249) read their values from the environment, where make puts its command-line variables.
plan-new: ## Write the plan NAME=<slug> into docs/plans/<slug>/ with TITLE and TITLE_KO: plan.md, checklist.md and their Korean twins; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) plan-new

plan-split: ## Move the items IDS="<id> <id>" with their sub-items from the checklist of the plan FROM to the plan TO (made with TITLE and TITLE_KO when it does not exist), in both languages; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) plan-split

# The texts of a row reach the tool unexpanded (K457): make expands the dollar signs of a variable's value, and exports the expansion,
# so a text that names a make or shell variable would be stored with its value. Each text that is set is passed to the tool in the
# recipe as its raw value (`$(value)`), in single quotes, and an unset text stays unset.
raw_text = $(foreach v,$(1),$(if $(filter undefined,$(origin $(v))),,$(v)='$(subst ','\'',$(value $(v)))'))

item-new: ## Add the item ID to the checklist of PLAN and its Korean twin in the waiting state, with TASK, TASK_KO, DELIVERABLES and VERIFICATION; on main it commits the registration with BODY_FILE (K499-2); offline
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION) $(NODE) $(KIT)/plan.$(KIT_EXT) item-new

# item-edit also rewrites the cause and the retry of a held item (K442): CAUSE, RETRY, CAUSE_KO and RETRY_KO.
item-edit: ## Replace the Verification cell of the item ID with VERIFICATION, its Deliverables cell with DELIVERABLES, or its Task cells with TASK and TASK_KO, in both languages, through the checks of item-new; with CAUSE, RETRY, CAUSE_KO and RETRY_KO, rewrite the cause and the retry of a bypassed item (its cause for an impossible one) through the checks of item-state; offline
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION CAUSE RETRY CAUSE_KO RETRY_KO) $(NODE) $(KIT)/plan.$(KIT_EXT) item-edit

item-state: ## Move the item ID to STATE in both languages along an allowed transition; done needs its changelog line, bypassed CAUSE, RETRY, CAUSE_KO and RETRY_KO, impossible CAUSE and CAUSE_KO; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-state

item-red: ## Run the commands of the Verification cell of the active item ID after its test is written and before its fix: they must fail, and the failure is recorded for make commit and item-state done (K389); offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-red

item-test: ## Run the commands of the Verification cell of the item ID in order; each must be a run of its own unit tests that the Claude Code hook allows; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-test

commit: ## Commit the index for the item ID as TYPE(SCOPE): SUBJECT (#ID) with the body of BODY_FILE wrapped, after the checks of the commit-msg hook; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) commit

.PHONY: documents-stamp

documents-stamp: ## Write the source-sha256 of each English document into its Korean twin; run it after the translation matches
	$(NODE) $(KIT)/documents-stamp.$(KIT_EXT)

.PHONY: owner-check owner-validate

owner-check: ## Run the checks that own the changed paths (config/owner-checks.json); PATHS="a b" or BASE=<revision> selects the paths
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base $(BASE))

owner-validate: ## Check that config/owner-checks.json owns every tracked path and names only existing checks; offline
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) --validate

.PHONY: ci-targets ci-summary ci-passed

CI_REPORT ?= var/report/ci-targets

ci-targets: ## Run the make targets of TARGETS past failures and write the report to CI_REPORT (logs, record.json, summary.md)
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) $(CI_REPORT) $(TARGETS)

ci-summary: ## Write summary.md of CI_REPORT again from its record, also for a run that stopped; never judges the targets
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) --summary $(CI_REPORT)

ci-passed: ## Fail unless every job of RESULTS, the JSON of toJSON(needs), has the result success
	$(NODE) $(KIT)/ci-passed.$(KIT_EXT)

.PHONY: commits-check

commits-check: ## Check the commit messages of RANGE (<base>..<head>, default HEAD) against COMMIT_RULES of check-commits.mts; offline
	$(NODE) $(KIT)/check-commits.$(KIT_EXT) $(if $(RANGE),--range $(RANGE))
# The steps of a release (scripts/kit/release.mts, config/release.json). TAG is the pushed tag, vX.Y.Z or <Go module
# directory>/vX.Y.Z; release-verify reads the check runs of GITHUB_REPOSITORY. The release workflow runs the steps in this order.
.PHONY: release-prepare release-tools release-tag release-verify release-versions release-assets release-publish release-undraft release-coverage release-go-tags release-backend

# release-prepare is the preparation that a repository's release needs before release-tools, such as the checkout of a sibling
# release: kit declares it with no recipe, and a repository adds its own with a release-prepare:: rule of its Makefile (K132).
release-prepare:: ## Prepare what the release of this repository needs before release-tools; a repository declares it with release-prepare::
	@:

release-tools: ## Install the tools that config/release.json needs for the release (npm, Composer, Python and its backend, Go) and check cargo when a git-tag proof needs it; ONLINE
	$(ONLINE) $(NODE) $(KIT)/release-tools.$(KIT_EXT)


release-tools-path: ## Append var/tools/bin and the shims of mise to GITHUB_PATH and the environment of mise to GITHUB_ENV for the steps that follow; the release workflow runs it after release-tools
	@test -n "$$GITHUB_PATH" || { echo 'release-tools-path: GITHUB_PATH is not set; run it in the release workflow between steps'; exit 1; }
	@test -n "$$GITHUB_ENV" || { echo 'release-tools-path: GITHUB_ENV is not set; run it in the release workflow between steps'; exit 1; }
	@echo "$(KIT_TOOLS)/mise/shims" >> "$$GITHUB_PATH"
	@echo "$(KIT_TOOLS)/bin" >> "$$GITHUB_PATH"
	@for name in $(MISE_ENVIRONMENT); do echo "$$name=$$(printenv $$name)"; done >> "$$GITHUB_ENV"

release-tag: ## Create the annotated tag TAG at origin/main and push it, or pass when it is there already; the release workflow runs it on a dispatch (K269)
	@test -n "$$TAG" || { echo "release-tag: TAG is required, for example make release-tag TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release.$(KIT_EXT) tag "$$TAG"

release-verify: ## Require the commit of TAG on origin/main with its check runs succeeded; reads GITHUB_REPOSITORY
	@test -n "$$TAG" || { echo "release-verify: TAG is required, for example make release-verify TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release.$(KIT_EXT) verify "$$TAG"

release-versions: ## Require the version of TAG in every manifest, the Go module path and the change log section; offline
	@test -n "$$TAG" || { echo "release-versions: TAG is required, for example make release-versions TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release.$(KIT_EXT) versions "$$TAG"

release-assets: ## Build the archive of every package of TAG into var/release/assets
	@test -n "$$TAG" || { echo "release-assets: TAG is required, for example make release-assets TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release.$(KIT_EXT) assets "$$TAG"

release-publish: ## Create the GitHub Release of TAG as a draft with the notes and the archives of release-assets; a draft of an earlier run is replaced
	@test -n "$$TAG" || { echo "release-publish: TAG is required, for example make release-publish TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release.$(KIT_EXT) publish "$$TAG"

release-undraft: ## Make the draft release of TAG public; run only after release-proof of TAG passed
	@test -n "$$TAG" || { echo "release-undraft: TAG is required, for example make release-undraft TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release.$(KIT_EXT) undraft "$$TAG"

release-coverage: ## Require every package file of the checkout to be classified in config/release.json; offline
	$(NODE) $(KIT)/release.$(KIT_EXT) coverage

release-go-tags: ## Require the tag <directory>/vX.Y.Z of every Go module at the commit of TAG; offline
	@test -n "$$TAG" || { echo "release-go-tags: TAG is required, for example make release-go-tags TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release.$(KIT_EXT) go-tags "$$TAG"

release-backend: ## Download the build backend of the wheel packages into var/tools/wheels with its sha256 checked; ONLINE
	$(ONLINE) $(NODE) $(KIT)/release-backend.$(KIT_EXT)

# --- release-assets: the release archives of other repositories that config/release-assets.json pins by version and sha256
# (scripts/kit/release-assets.mts). The fetch is an install step; a Makefile reads the version of an entry with
# `$(shell node $(KIT)/release-assets.$(KIT_EXT) version <name>)`.
.PHONY: release-assets-fetch
release-assets-fetch: ## Download the archives of config/release-assets.json that var/ lacks, with their sha256 checked, and extract those that declare unpack; ONLINE
	$(ONLINE) $(NODE) $(KIT)/release-assets.$(KIT_EXT) fetch

# --- python-venv: a virtual environment of the checkout Python, made by the uv of the checkout as uv makes it
# (scripts/kit/python-venv.mts); an existing venv of the checkout Python is kept.
.PHONY: python-venv
python-venv: ## Make the virtual environment DIR from the python3 of mise.toml with its uv venv; offline
	@test -n "$(DIR)" || { echo "python-venv: DIR is required, for example make python-venv DIR=pkg/.venv"; exit 1; }
	$(NODE) $(KIT)/python-venv.$(KIT_EXT) $(DIR)

# --- link: the local links of 0.0.x development (docs/operations/local-links.md, K201, K205). CHECKOUTS names the main checkouts
# that provide the packages (scripts/kit/link.mts); PROJECT, when given, names the consumer whose manifests directly in it
# are linked, else the whole tree of the checkout. link replaces each installed package folder that a provider gives with a direct
# relative symlink to the provider's folder and never builds; no package manager runs and no version is read (K448); link-check
# lists each provided folder that is a copy or links elsewhere; unlink restores the locked installs. link writes a git-ignored
# go.work at each Go module, which go reads by itself; unlink removes it.
.PHONY: link link-check unlink
link: ## Replace each installed package folder that a checkout of CHECKOUTS, else the checkouts beside the repository, provides with a direct relative symlink to it, a copy removed, also from a worktree (PROJECT names the consumer); no package manager runs and no version is read (K448); never builds; offline
	$(NODE) $(KIT)/link.$(KIT_EXT) link $(if $(PROJECT),--project $(PROJECT)) $(if $(CHECKOUTS),$(CHECKOUTS),--siblings)

link-check: ## List each installed package folder that a checkout of CHECKOUTS, else the checkouts beside the repository, provides and that is a copy or links elsewhere, as NOT linked, and fail on one (K448); offline
	$(NODE) $(KIT)/link.$(KIT_EXT) check $(if $(PROJECT),--project $(PROJECT)) $(if $(CHECKOUTS),$(CHECKOUTS),--siblings)

.PHONY: worktree-setup
worktree-setup: ## Make the worktree ../<repository>-NAME-ID of a row on the branch TYPE/NAME-ID (TYPE fix by default) from main; links the installs of the main checkout, each npm project, Python environment and Composer vendor folder with the repository's own packages from the worktree, builds the worktree's own packages and checks it with link-state-check; installs nothing (K519, K521, K530, K533); refuses under 30 GB of free disk; a second run converges (K348); ONLINE
	$(ONLINE) $(NODE) $(KIT)/worktree-setup.$(KIT_EXT) $(NAME) $(ID) $(or $(TYPE),fix)

# WORKTREE_STOP (K441): a repository sets WORKTREE_STOP to the make target that stops the servers of its worktree (the server-stop target of
# orm). land and worktree-prune run it, with make in the worktree, before they remove the worktree; a failing stop keeps the worktree.
.PHONY: land
land: ## Land the branch BRANCH on main (K394): refuses unless the main checkout is on main and clean and the branch is rebased on main and has a worktree; runs the static gates of kit-gates that its changed paths select, with docs-check and commits-check, in its worktree (no test: parity-check and test- targets are printed as not run, K394-1); a gate that fails there is refused only on a finding that main does not have, compared with the same gate run on main; merges fast-forward, then runs the WORKTREE_STOP targets of the worktree and removes it, refused while a process runs in it (K429), and removes the branch; offline
	$(NODE) $(KIT)/land.$(KIT_EXT) $(BRANCH)

.PHONY: worktree-prune
worktree-prune: ## Remove the worktree and delete the branch of every branch merged into main (its own commits all in main, after its reflog creation point), running the WORKTREE_STOP targets of the worktree first, and list the others with the reason: a dirty worktree, an unmerged, fresh or reflog-less branch (K381); also list the processes that name a path of a removed worktree folder, by pid and path, and kill none; offline
	$(NODE) $(KIT)/worktree-prune.$(KIT_EXT)

# composer-install installs a consumer's Composer project: composer install of the tracked lock, then the link of the folders (K448).
.PHONY: composer-install
composer-install: ## Install the Composer project DIR with composer install of its tracked lock, then link each installed package that a checkout of CHECKOUTS, else a sibling checkout, provides (K448); NO_DEV=1 installs with --no-dev (K483-2)
	$(ONLINE) $(NODE) $(KIT)/composer-install.$(KIT_EXT) $(DIR) $(if $(NO_DEV),--no-dev) $(CHECKOUTS)

# npm-install installs a consumer's npm packages: npm ci of the tracked lock, then the link of the folders (K448).
.PHONY: npm-install
npm-install: ## Install the npm packages of DIR with npm ci of its tracked lock, then link each installed package that a checkout of CHECKOUTS, else a sibling checkout, provides, each a package folder or a repository root whose package folders under packages/ the kit finds itself (K448, K494); ADD=<checkout>... links each named checkout whether or not the project declares its package (K485); a declared polyspec package with no checkout is refused (K483-1)
	NPM_BIN=$(NPM) $(ONLINE) $(NODE) $(KIT)/npm-install.$(KIT_EXT) $(DIR) $(CHECKOUTS) $(addprefix --add ,$(ADD))

# uv-install installs a consumer's uv environment: uv sync of the tracked lock, then the link of the folders (K448).
.PHONY: uv-install
uv-install: ## Install the uv environment of DIR with uv sync --frozen of its tracked uv.lock, then link each installed package of site-packages that a checkout of CHECKOUTS, else a sibling checkout, provides (K448); SYNC passes --no-install-project and --all-groups and refuses any other flag (K487)
	UV_SYNC="$(SYNC)" $(ONLINE) $(NODE) $(KIT)/uv-install.$(KIT_EXT) $(DIR) $(CHECKOUTS)

# cargo-fetch is the fetch of a consumer's Cargo crates in place of its cargo fetch: through the link of cargo, with the polyspec crates
# of the sibling checkouts patched to their paths, so the git tag of a sibling crate is never fetched (K448-5).
.PHONY: cargo-fetch
cargo-fetch: ## Fetch the Cargo crates of the project DIR in place of cargo fetch --locked: the polyspec crates that a sibling checkout provides are patched to their paths from the start, no git tag fetched (K448-5)
	$(ONLINE) $(NODE) $(KIT)/link.$(KIT_EXT) cargo --siblings $(DIR) fetch --locked

unlink: ## Restore the locked installs of the consumer (PROJECT) with npm ci, composer install and uv sync, and remove its go.work files; ONLINE
	$(ONLINE) $(NODE) $(KIT)/link.$(KIT_EXT) unlink $(if $(PROJECT),--project $(PROJECT))

# The release, the dependency review and the dependency policy use the released versions (K343), so their Go runs without the go.work of the links.
release-prepare release-tools release-verify release-versions release-assets release-publish release-undraft release-coverage release-go-tags release-backend release-consumer release-consumer-lock release-proof dependency-review dependency-policy-check: export GOWORK := off


# ---- Lint (K77) ------------------------------------------------------------------------------------------------------
# Each target runs the lint of one language with the configuration of the kit package (K514: ruff.toml, phpcs.xml.dist,
# phpstan.dist.neon, .golangci.yml, .oxlintrc.json, knip.json, config/api-extractor.kit.json) and the tools of var/tools
# (make install-tools) or node_modules (npm ci). config/layout.kit.yml checks the lint rules that live in manifests.
.PHONY: lint-python lint-php lint-rust lint-go lint-ts
lint-python: ## Lint the Python of the checkout: ruff with ruff.toml, and vulture on each package; offline
	$(NODE) $(KIT)/lint-python.$(KIT_EXT)

lint-php: ## Lint the PHP of the checkout: phpcs with phpcs.xml.dist, and PHPStan with phpstan.dist.neon on each Composer package; offline
	$(NODE) $(KIT)/lint-php.$(KIT_EXT)

lint-rust: ## Lint the Rust of the checkout: cargo clippy with -D warnings in each Cargo workspace; offline once the crates are downloaded
	$(NODE) $(KIT)/lint-rust.$(KIT_EXT)

lint-go: ## Lint the Go of the checkout: golangci-lint with .golangci.yml, and deadcode -test, in each Go module; offline once the modules are downloaded
	$(NODE) $(KIT)/lint-go.$(KIT_EXT)

lint-ts: ## Lint the TypeScript of the checkout: oxlint type-aware, knip, and API Extractor in each package with an api-extractor.json; offline
	$(NODE) $(KIT)/lint-ts.$(KIT_EXT)
# ---- Consumer install of the release archives (K5.4) ------------------------------------------------------------
# ---- Consumer install and proof of a release (K5.4, K5.5) ------------------------------------------------------------
# scripts/kit/release-consumer.mts installs the archives of TAG from var/release/assets (make release-assets) in clean npm and
# Composer projects outside the checkout, from the manifests and locks that config/release.json `consumers` names, and runs a
# smoke command for each package. A lock pins registry packages by version and integrity, so the install downloads them: that is
# installation, and the target is no offline check. release-consumer-lock resolves versions and runs ONLINE.
# scripts/kit/release-proof.mts proves a released TAG from outside the repository (GitHub Release, consumer installs, git-tag
# installs, Go modules); the release workflow of workflows/release.yml runs it on the draft after release-publish, and a developer may run it.
.PHONY: release-consumer release-consumer-lock release-proof

release-consumer: ## Install the archives of TAG in var/release/assets in clean npm and Composer projects and run the smoke commands
	@test -n "$$TAG" || { echo "release-consumer: TAG is required, for example make release-consumer TAG=v0.0.1"; exit 1; }
	$(NODE) $(KIT)/release-consumer.$(KIT_EXT) install "$$TAG"

release-consumer-lock: ## Write the consumer manifests and locks of TAG from the archives in var/release/assets; ONLINE
	@test -n "$$TAG" || { echo "release-consumer-lock: TAG is required, for example make release-consumer-lock TAG=v0.0.1"; exit 1; }
	$(ONLINE) $(NODE) $(KIT)/release-consumer.$(KIT_EXT) lock "$$TAG"

release-proof: ## Prove the released TAG from outside the checkout: release assets, consumer installs, git-tag installs, Go modules; ONLINE
	@test -n "$$TAG" || { echo "release-proof: TAG is required, for example make release-proof TAG=v0.0.1"; exit 1; }
	$(ONLINE) $(NODE) $(KIT)/release-proof.$(KIT_EXT) "$$TAG"

# --- dependencies: the gate reads the manifests, the locks and the review record; the review asks the registries.
.PHONY: dependency-policy-check dependency-policy-mutation-check dependency-review composer-provider-entries
dependency-policy-check: ## Check the manifests and locks against config/dependency-policy.json and the review record; PACKAGES=<name>[,<name>...] reports and fails only on the findings of those packages (K493); offline
	$(NODE) $(KIT)/check-dependency-policy.$(KIT_EXT) $(if $(filter command line,$(origin PACKAGES)),--packages $(PACKAGES))

dependency-policy-mutation-check: ## Check that the dependency gate rejects each known mutation of the checkout; offline
	$(NODE) $(KIT)/check-dependency-policy-mutation.$(KIT_EXT)

# K435: TARGETS names the versions of one batch, so that every checkout takes the same pin and records the same snapshot.
dependency-review: ## Ask the registries for newer stable releases and advisories; RECORD=1 records the review, UPDATE=1 updates first; TARGETS=<file> with UPDATE=1 takes the named versions of its JSON file (dependency-targets.schema.json) in place of the latest stable releases, and RECORD=1 then records its snapshot moment; ONLINE
	$(ONLINE) $(NODE) $(KIT)/dependency-review.$(KIT_EXT) $(if $(RECORD),--record) $(if $(UPDATE),--update) $(if $(TARGETS),--targets $(TARGETS))

# K439: the metadata of a provided polyspec package in each tracked composer.lock, without the review or the updates.
composer-provider-entries: ## Rewrite the metadata of each polyspec package that a sibling checkout provides in every tracked composer.lock of the Composer projects, from its composer.json, keeping the versions; offline
	$(NODE) $(KIT)/dependency-review.$(KIT_EXT) --provider-entries

# --- language parity: config/parity.json declares the implementations and the units that each of them holds.
# Without UNITS the check is a full run, which runs only in CI (ci-only.mts). The guard runs while make reads the makefiles,
# so no prerequisite that a repository adds to parity-check builds before it; kit-gates runs it in full, so kit-gates runs only in CI.
ifneq ($(filter parity-check kit-gates,$(MAKECMDGOALS)),)
ifeq ($(UNITS),)
ifneq ($(shell $(NODE) $(KIT)/ci-only.$(KIT_EXT) make parity-check >&2; echo $$?),0)
$(error parity-check: a full parity check runs only in CI; name the units with UNITS="<id>...")
endif
endif
endif
.PHONY: parity-check parity-declarations-check
parity-check: ## Run the binding of every suite in every implementation and check every parity rule of config/parity.json; UNITS="<id>..." runs only the named units (their bindings), without the cross-unit rules; the full check runs only in CI; offline
	$(NODE) $(KIT)/parity.$(KIT_EXT) $(foreach unit,$(UNITS),--unit $(unit))

parity-declarations-check: ## Check the parity rules of config/parity.json that need no run: symbols, bindings, tests, error codes, lists, documents; UNITS="<id>..." reports only the findings of the named units, their schema findings included, and of config/parity.json itself (K400, K400-1); RULES="<rule>..." reports only the findings of the named rules, by id or name, and of config/parity.json itself (K414); IDS="<requirement>..." reports only the findings that name one of the requirement ids, and of config/parity.json itself (K414-1); offline
	$(NODE) $(KIT)/parity.$(KIT_EXT) --declarations $(foreach unit,$(UNITS),--unit $(unit)) $(foreach rule,$(RULES),--rule $(rule)) $(foreach id,$(IDS),--id $(id))

# --- python-lock: the PEP 751 locks of config/dependency-policy.json (pythonLocks), each with its requirements and a constraints file
# that pins every package. The writer resolves with the uv of mise.toml (make install-tools); the check never resolves.
.PHONY: python-lock python-lock-check
python-lock: ## Write every Python lock of pythonLocks with the uv of mise.toml from its requirements and constraints; ONLINE
	$(ONLINE) $(NODE) $(KIT)/python-lock.$(KIT_EXT) write

python-lock-check: ## Check every Python lock of pythonLocks against its requirements and constraints, with no network; offline
	$(NODE) $(KIT)/python-lock.$(KIT_EXT) check
