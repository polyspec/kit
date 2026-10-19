# The targets of kit that every repository includes. A repository includes it through scripts/kit/kit-bootstrap.mk, which
# sets KIT := node_modules/@polyspec/kit/dist and KIT_EXT := mjs; the Makefile of kit sets KIT := scripts/kit and
# KIT_EXT := mts and runs the sources. Every tool runs as node $(KIT)/<tool>.$(KIT_EXT).
ifeq ($(and $(KIT),$(KIT_EXT)),)
$(error kit.mk needs KIT and KIT_EXT; include it through kit-bootstrap.mk, or set both as the Makefile of kit does)
endif
ONLINE ?=

# The tools of mise.toml (K127) run from the shims of mise, var/tools/mise/shims, which need the environment of mise of the
# checkout (miseEnvironment of scripts/kit/bootstrap/install-mise.mts): every recipe runs with it, and with var/tools/bin
# (npm, npx, mise and the wrappers of the Composer projects) and the shims first on PATH.
export MISE_DATA_DIR := $(CURDIR)/var/tools/mise
export MISE_CACHE_DIR := $(CURDIR)/var/tools/mise/cache
export MISE_STATE_DIR := $(CURDIR)/var/tools/mise/state
export MISE_CONFIG_DIR := $(CURDIR)/var/tools/mise/config
export MISE_GLOBAL_CONFIG_FILE := $(CURDIR)/mise.toml
export MISE_LOCKED := 1
export MISE_AUTO_INSTALL := 0
export UV_PYTHON_DOWNLOADS := never
export UV_NO_CONFIG := 1
export UV_CACHE_DIR := $(CURDIR)/var/tools/mise/cache/uv
MISE_ENVIRONMENT := MISE_DATA_DIR MISE_CACHE_DIR MISE_STATE_DIR MISE_CONFIG_DIR MISE_GLOBAL_CONFIG_FILE MISE_LOCKED MISE_AUTO_INSTALL UV_PYTHON_DOWNLOADS UV_NO_CONFIG UV_CACHE_DIR
export PATH := $(CURDIR)/var/tools/bin:$(CURDIR)/var/tools/mise/shims:$(PATH)

# A recipe starts a tool of the checkout by its absolute path, never by its bare name: make 3.81 looks up a recipe line
# without shell syntax on the PATH that make started with, not on the PATH above, so `node` there was the node of the
# machine (K171). NODE is the Node.js of mise.toml, whose wrapper the bootstrap writes; BOOTSTRAP_NODE is the node of the
# machine, which only starts the bootstrap that installs NODE and toolchain-lock, which writes the mise.lock that the bootstrap
# installs NODE from (K174). A repository's own recipes use these variables too.
NODE := $(CURDIR)/var/tools/bin/node
NPM := $(CURDIR)/var/tools/bin/npm
ALINT := $(CURDIR)/var/tools/mise/shims/alint
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
ifeq ($(TOOLS),npm)
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
layout-check: ## Check the folder layout of the checkout (S5) against config/layout.yml with the alint of mise.toml; offline
	@test -x $(ALINT) || { echo "layout-check: $(ALINT) is missing; run make install-tools"; exit 1; }
	$(ALINT) check --config config/layout.yml --color never --compact .
# ---- The gates: Git hooks and push gate --------------------------------------------------------------------------------
# scripts/kit/git-hooks.mts and push-gate.mts read config/checklist.json. The full suite runs only in CI, as the targets of
# `make ci-targets` (ci-only.mts); no target runs it locally.
COMMIT ?= HEAD

.PHONY: hooks hooks-check staged-generated-hook push-gate-hook push-gate-commit

# Git runs the hooks of core.hooksPath. A checkout that tracks .githooks/pre-push sets it on every make invocation.
ifneq ($(wildcard .githooks/pre-push),)
ifneq ($(shell git config core.hooksPath),.githooks)
$(shell git config core.hooksPath .githooks)
endif
endif

hooks: ## Set core.hooksPath to .githooks, write the pre-commit and pre-push hooks of kit and check the hooks
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) install

hooks-check: ## Fail while core.hooksPath is not .githooks or a hook of config/checklist.json is missing, not executable or changed
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) check

staged-generated-hook: ## The generated-file check of the pre-commit hook: fail while a staged path has a generated segment that config/generated.json does not declare; the hook that make hooks writes runs it
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) staged

push-gate-hook: ## The push gate of the pre-push hook, with the pushed refs on standard input; the hook that make hooks writes runs it
	$(NODE) $(KIT)/push-gate.$(KIT_EXT) hook

push-gate-commit: ## The push gate on COMMIT (HEAD): fail while it has an item in an active state or does not track an executable hook
	$(NODE) $(KIT)/push-gate.$(KIT_EXT) commit $(COMMIT)

# --- Rules: every tool has its class (S1) and every rule names the check that enforces it (K248) --------------------------
.PHONY: rebuild-check rules-check

rebuild-check: ## Check that every tool that config/rebuild.json selects has its class: ecosystem, replaced, record or policy (S1); offline
	$(NODE) $(KIT)/rebuild-check.$(KIT_EXT)

rules-check: ## Check that every rule of PRINCIPLES.md and AGENTS.md names a check that a CI workflow, a Git hook or the Claude Code hook runs (K248); offline
	$(NODE) $(KIT)/check-rules.$(KIT_EXT)

# --- Document, owner and CI report tools (rows K7 and K8.1) ---------------------------------------------------------------
.PHONY: documents-check

documents-check: ## Check the documents declared in config/documents.json: translation pairs, revisions, links, and the checklists of config/checklist.json; offline
	$(NODE) $(KIT)/check-documents.$(KIT_EXT)

.PHONY: plan-new item-new item-state

# The plan utilities (plan.mts, K249) read their values from the environment, where make puts its command-line variables.
plan-new: ## Write the plan NAME=<slug> into docs/plans/<slug>/ with TITLE and TITLE_KO: plan.md, checklist.md and their Korean twins; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) plan-new

item-new: ## Add the item ID to the checklist of PLAN and its Korean twin in the waiting state, with TASK, TASK_KO, DELIVERABLES and VERIFICATION; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-new

item-state: ## Move the item ID to STATE in both languages along an allowed transition; done needs its changelog line, bypassed CAUSE, RETRY, CAUSE_KO and RETRY_KO, impossible CAUSE and CAUSE_KO; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-state

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

commits-check: ## Check the commit messages of RANGE (<base>..<head>, default HEAD) against config/commits.json; offline
	$(NODE) $(KIT)/check-commits.$(KIT_EXT) $(if $(RANGE),--range $(RANGE))
# The steps of a release (scripts/kit/release.mts, config/release.json). TAG is the pushed tag, vX.Y.Z or <Go module
# directory>/vX.Y.Z; release-verify reads the check runs of GITHUB_REPOSITORY. The release workflow runs the steps in this order.
.PHONY: release-prepare release-tools release-verify release-versions release-assets release-publish release-undraft release-coverage release-go-tags release-backend

# release-prepare is the preparation that a repository's release needs before release-tools, such as the checkout of a sibling
# release: kit declares it with no recipe, and a repository adds its own with a release-prepare:: rule of its Makefile (K132).
release-prepare:: ## Prepare what the release of this repository needs before release-tools; a repository declares it with release-prepare::
	@:

release-tools: ## Install the tools that config/release.json needs for the release (npm, Composer, Python and its backend, Go) and check cargo when a git-tag proof needs it; ONLINE
	$(ONLINE) $(NODE) $(KIT)/release-tools.$(KIT_EXT)


release-tools-path: ## Append var/tools/bin and the shims of mise to GITHUB_PATH and the environment of mise to GITHUB_ENV for the steps that follow; the release workflow runs it after release-tools
	@test -n "$$GITHUB_PATH" || { echo 'release-tools-path: GITHUB_PATH is not set; run it in the release workflow between steps'; exit 1; }
	@test -n "$$GITHUB_ENV" || { echo 'release-tools-path: GITHUB_ENV is not set; run it in the release workflow between steps'; exit 1; }
	@echo "$$PWD/var/tools/mise/shims" >> "$$GITHUB_PATH"
	@echo "$$PWD/var/tools/bin" >> "$$GITHUB_PATH"
	@for name in $(MISE_ENVIRONMENT); do echo "$$name=$$(printenv $$name)"; done >> "$$GITHUB_ENV"

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
# are linked, else the whole tree of the checkout. link points every installed polyspec package pinned at 0.0.x at its
# provider's source and never builds; link-check lists each one as linked, NOT linked, STALE or own; unlink restores the
# locked installs. link writes a git-ignored go.work at each Go module, which go reads by itself; unlink removes it.
.PHONY: link link-check unlink
link: ## Link every installed polyspec package pinned at 0.0.x to its source in CHECKOUTS (PROJECT names the consumer); never builds; offline
	$(NODE) $(KIT)/link.$(KIT_EXT) link $(if $(PROJECT),--project $(PROJECT)) $(CHECKOUTS)

link-check: ## List every installed polyspec package pinned at 0.0.x as linked, NOT linked or STALE against CHECKOUTS; offline
	$(NODE) $(KIT)/link.$(KIT_EXT) check $(if $(PROJECT),--project $(PROJECT)) $(CHECKOUTS)

unlink: ## Restore the locked installs of the consumer (PROJECT) with npm ci, composer install and uv sync, and remove its go.work files; ONLINE
	$(ONLINE) $(NODE) $(KIT)/link.$(KIT_EXT) unlink $(if $(PROJECT),--project $(PROJECT))

# The release and the dependency review use the released versions, so their Go runs without the go.work of the links.
release-prepare release-tools release-verify release-versions release-assets release-publish release-undraft release-coverage release-go-tags release-backend release-consumer release-consumer-lock release-proof dependency-review: export GOWORK := off


# ---- Lint (K77) ------------------------------------------------------------------------------------------------------
# Each target runs the lint of one language with the configuration that kit copies (ruff.toml, phpcs.xml.dist,
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
.PHONY: dependency-policy-check dependency-policy-mutation-check dependency-review
dependency-policy-check: ## Check the manifests and locks against config/dependency-policy.json and the review record; offline
	$(NODE) $(KIT)/check-dependency-policy.$(KIT_EXT)

dependency-policy-mutation-check: ## Check that the dependency gate rejects each known mutation of the checkout; offline
	$(NODE) $(KIT)/check-dependency-policy-mutation.$(KIT_EXT)

dependency-review: ## Ask the registries for newer stable releases and advisories; RECORD=1 records the review, UPDATE=1 updates first; ONLINE
	$(ONLINE) $(NODE) $(KIT)/dependency-review.$(KIT_EXT) $(if $(RECORD),--record) $(if $(UPDATE),--update)

# --- language parity: config/parity.json declares the implementations and the units that each of them holds.
# Without UNITS the check is a full run, which runs only in CI (ci-only.mts). The guard runs while make reads the makefiles,
# so no prerequisite that a repository adds to parity-check builds before it.
ifneq ($(filter parity-check,$(MAKECMDGOALS)),)
ifeq ($(UNITS),)
ifneq ($(shell $(NODE) $(KIT)/ci-only.$(KIT_EXT) make parity-check >&2; echo $$?),0)
$(error parity-check: a full parity check runs only in CI; name the units with UNITS="<id>...")
endif
endif
endif
.PHONY: parity-check parity-declarations-check
parity-check: ## Run the binding of every suite in every implementation and check every parity rule of config/parity.json; UNITS="<id>..." runs only the named units (their bindings), without the cross-unit rules; the full check runs only in CI; offline
	$(NODE) $(KIT)/parity.$(KIT_EXT) $(foreach unit,$(UNITS),--unit $(unit))

parity-declarations-check: ## Check the parity rules of config/parity.json that need no run: symbols, bindings, tests, error codes, lists, documents; offline
	$(NODE) $(KIT)/parity.$(KIT_EXT) --declarations

# --- python-lock: the PEP 751 locks of config/dependency-policy.json (pythonLocks), each with its requirements and a constraints file
# that pins every package. The writer resolves with the uv of mise.toml (make install-tools); the check never resolves.
.PHONY: python-lock python-lock-check
python-lock: ## Write every Python lock of pythonLocks with the uv of mise.toml from its requirements and constraints; ONLINE
	$(ONLINE) $(NODE) $(KIT)/python-lock.$(KIT_EXT) write

python-lock-check: ## Check every Python lock of pythonLocks against its requirements and constraints, with no network; offline
	$(NODE) $(KIT)/python-lock.$(KIT_EXT) check
