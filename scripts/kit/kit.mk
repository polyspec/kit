# The targets of kit that every repository includes. A repository includes it through scripts/kit/kit-bootstrap.mk, which
# sets KIT := node_modules/@polyspec/kit/dist and KIT_EXT := mjs; the Makefile of kit sets KIT := scripts/kit and
# KIT_EXT := mts and runs the sources. Every tool runs as node $(KIT)/<tool>.$(KIT_EXT).
ifeq ($(and $(KIT),$(KIT_EXT)),)
$(error kit.mk needs KIT and KIT_EXT; include it through kit-bootstrap.mk, or set both as the Makefile of kit does)
endif
ONLINE ?=

.PHONY: kit-sync kit-check

kit-sync: ## Write the copies of the installed @polyspec/kit (kit.copies of its package.json), the version of package-lock.json; offline
	node $(KIT)/kit-sync.$(KIT_EXT)

kit-check: ## Check the installed @polyspec/kit against package-lock.json, the copies against it and the configuration against its schemas; offline
	node $(KIT)/kit-check.$(KIT_EXT)

# --- cargo downloads: the crates of every Cargo.lock are downloaded before a check runs cargo offline.
.PHONY: cargo-downloads-check cargo-downloads-fetch
cargo-downloads-check: ## Check that the crates of every Cargo.lock are in the registry of CARGO_HOME; offline
	node $(KIT)/check-cargo-downloads.$(KIT_EXT)

cargo-downloads-fetch: ## Download the crates of every Cargo.lock
	$(ONLINE) node $(KIT)/check-cargo-downloads.$(KIT_EXT) --fetch
# Toolchains (K8.2): install-tools installs the declared npm, Go, ruff and uv (with the sha256 of their wheels), Composer (with a sha256), cargo-audit and
# govulncheck into var/tools; ONLINE, because it downloads. Nothing on the machine changes. Put var/tools/bin first on PATH.
# toolchain-check compares the running tools with the declarations and fails with the expected and the running version.
.PHONY: install-tools toolchain-check

# TOOLS=npm is the first step of a checkout, before npm ci installs the packages that the other tools import, so it runs the
# bootstrap installer of $(KIT)/bootstrap, which imports only Node.js built-ins.
install-tools: ## Install the toolchains that the checkout declares into var/tools; TOOLS limits the tools; ONLINE
ifeq ($(TOOLS),npm)
	$(ONLINE) node $(KIT)/bootstrap/bootstrap-npm.$(KIT_EXT)
else
	$(ONLINE) node $(KIT)/install-tools.$(KIT_EXT) $(TOOLS)
endif

toolchain-check: ## Check that the running tools are the declared versions; TOOLS limits the tools; offline
	node $(KIT)/check-toolchain.$(KIT_EXT) $(TOOLS)

# ---- Folder layout (S5) ---------------------------------------------------------------------------------------------
# alint (config/toolchain.json alint, installed by install-tools) checks the tree against config/layout.yml, which extends
# the common rules of kit in the vendored config/layout.kit.yml with the map of the repository.
.PHONY: layout-check
layout-check: ## Check the folder layout of the checkout (S5) against config/layout.yml with the alint of var/tools; offline
	@test -x var/tools/bin/alint || { echo "layout-check: var/tools/bin/alint is missing; run make install-tools TOOLS=alint"; exit 1; }
	var/tools/bin/alint check --config config/layout.yml --color never --compact .
# ---- The gates: Git hooks, push gate and guard of the full run ------------------------------------------------------
# scripts/kit/git-hooks.mts, push-gate.mts and full-run.mts read config/checklist.json. The target that runs the full suite
# is the repository's own: it calls `node $(KIT)/full-run.$(KIT_EXT) run <target>...` with the targets of its suite.
COMMIT ?= HEAD
FULL_RUN_KEYS ?=

.PHONY: hooks hooks-check push-gate-hook push-gate-commit rerun-failed

# Git runs the hooks of core.hooksPath. A checkout that tracks .githooks/pre-push sets it on every make invocation.
ifneq ($(wildcard .githooks/pre-push),)
ifneq ($(shell git config core.hooksPath),.githooks)
$(shell git config core.hooksPath .githooks)
endif
endif

hooks: ## Set core.hooksPath to .githooks, write the pre-push hook of the push gate and check the hooks
	node $(KIT)/git-hooks.$(KIT_EXT) install

hooks-check: ## Fail while core.hooksPath is not .githooks or a hook of config/checklist.json is missing, not executable or changed
	node $(KIT)/git-hooks.$(KIT_EXT) check

push-gate-hook: ## The push gate of the pre-push hook, with the pushed refs on standard input; the hook that make hooks writes runs it
	node $(KIT)/push-gate.$(KIT_EXT) hook

push-gate-commit: ## The push gate on COMMIT (HEAD): fail while it has an item in an active state or does not track an executable hook
	node $(KIT)/push-gate.$(KIT_EXT) commit $(COMMIT)

rerun-failed: ## Rerun the targets of the last full run of this tree that did not pass; FULL_RUN_KEYS repeats the keys of that run
	node $(KIT)/full-run.$(KIT_EXT) rerun-failed$(if $(FULL_RUN_KEYS), $(FULL_RUN_KEYS))
# --- Document, owner and CI report tools (rows K7 and K8.1) ---------------------------------------------------------------
.PHONY: documents-check

documents-check: ## Check the documents declared in config/documents.json: translation pairs, revisions, links, and the checklists of config/checklist.json; offline
	node $(KIT)/check-documents.$(KIT_EXT)

.PHONY: documents-stamp

documents-stamp: ## Write the source-sha256 of each English document into its Korean twin; run it after the translation matches
	node $(KIT)/documents-stamp.$(KIT_EXT)

.PHONY: owner-check owner-validate

owner-check: ## Run the checks that own the changed paths (config/owner-checks.json); PATHS="a b" or BASE=<revision> selects the paths
	node $(KIT)/owner-check.$(KIT_EXT) $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base $(BASE))

owner-validate: ## Check that config/owner-checks.json owns every tracked path and names only existing checks; offline
	node $(KIT)/owner-check.$(KIT_EXT) --validate

.PHONY: ci-targets ci-summary ci-passed

CI_REPORT ?= var/report/ci-targets

ci-targets: ## Run the make targets of TARGETS past failures and write the report to CI_REPORT (logs, record.json, summary.md)
	node $(KIT)/ci-targets.$(KIT_EXT) $(CI_REPORT) $(TARGETS)

ci-summary: ## Write summary.md of CI_REPORT again from its record, also for a run that stopped; never judges the targets
	node $(KIT)/ci-targets.$(KIT_EXT) --summary $(CI_REPORT)

ci-passed: ## Fail unless every job of RESULTS, the JSON of toJSON(needs), has the result success
	node $(KIT)/ci-passed.$(KIT_EXT)

.PHONY: commits-check

commits-check: ## Check the commit messages of RANGE (<base>..<head>, default HEAD) against config/commits.json; offline
	node $(KIT)/check-commits.$(KIT_EXT) $(if $(RANGE),--range $(RANGE))
# The steps of a release (scripts/kit/release.mts, config/release.json). TAG is the pushed tag, vX.Y.Z or <Go module
# directory>/vX.Y.Z; release-verify reads the check runs of GITHUB_REPOSITORY. The release workflow runs the steps in this order.
.PHONY: release-tools release-verify release-versions release-assets release-publish release-undraft release-coverage release-go-tags release-backend

release-tools: ## Install the tools that config/release.json needs for the release (npm, Composer, Python and its backend, Go) and check cargo when a git-tag proof needs it; ONLINE
	$(ONLINE) node $(KIT)/release-tools.$(KIT_EXT)


release-tools-path: ## Append var/tools/bin to GITHUB_PATH for the steps that follow; the release workflow runs it after release-tools
	@test -n "$$GITHUB_PATH" || { echo 'release-tools-path: GITHUB_PATH is not set; run it in the release workflow between steps'; exit 1; }
	@echo "$$PWD/var/tools/bin" >> "$$GITHUB_PATH"

release-verify: ## Require the commit of TAG on origin/main with its check runs succeeded; reads GITHUB_REPOSITORY
	@test -n "$$TAG" || { echo "release-verify: TAG is required, for example make release-verify TAG=v0.0.1"; exit 1; }
	node $(KIT)/release.$(KIT_EXT) verify "$$TAG"

release-versions: ## Require the version of TAG in every manifest, the Go module path and the change log section; offline
	@test -n "$$TAG" || { echo "release-versions: TAG is required, for example make release-versions TAG=v0.0.1"; exit 1; }
	node $(KIT)/release.$(KIT_EXT) versions "$$TAG"

release-assets: ## Build the archive of every package of TAG into var/release/assets
	@test -n "$$TAG" || { echo "release-assets: TAG is required, for example make release-assets TAG=v0.0.1"; exit 1; }
	node $(KIT)/release.$(KIT_EXT) assets "$$TAG"

release-publish: ## Create the GitHub Release of TAG as a draft with the notes and the archives of release-assets; a draft of an earlier run is replaced
	@test -n "$$TAG" || { echo "release-publish: TAG is required, for example make release-publish TAG=v0.0.1"; exit 1; }
	node $(KIT)/release.$(KIT_EXT) publish "$$TAG"

release-undraft: ## Make the draft release of TAG public; run only after release-proof of TAG passed
	@test -n "$$TAG" || { echo "release-undraft: TAG is required, for example make release-undraft TAG=v0.0.1"; exit 1; }
	node $(KIT)/release.$(KIT_EXT) undraft "$$TAG"

release-coverage: ## Require every package file of the checkout to be classified in config/release.json; offline
	node $(KIT)/release.$(KIT_EXT) coverage

release-go-tags: ## Require the tag <directory>/vX.Y.Z of every Go module at the commit of TAG; offline
	@test -n "$$TAG" || { echo "release-go-tags: TAG is required, for example make release-go-tags TAG=v0.0.1"; exit 1; }
	node $(KIT)/release.$(KIT_EXT) go-tags "$$TAG"

release-backend: ## Download the build backend of the wheel packages into var/tools/wheels with its sha256 checked; ONLINE
	$(ONLINE) node $(KIT)/release-backend.$(KIT_EXT)

# --- python-venv: a virtual environment of the checkout Python, made by the uv of the checkout as uv makes it
# (scripts/kit/python-venv.mts); an existing venv of the checkout Python is kept.
.PHONY: python-venv
python-venv: ## Make the virtual environment DIR from var/tools/bin/python3 with var/tools/bin/uv venv; offline
	@test -n "$(DIR)" || { echo "python-venv: DIR is required, for example make python-venv DIR=pkg/.venv"; exit 1; }
	node $(KIT)/python-venv.$(KIT_EXT) $(DIR)

# ---- Lint (K77) ------------------------------------------------------------------------------------------------------
# Each target runs the lint of one language with the configuration that kit copies (ruff.toml, phpcs.xml.dist,
# phpstan.dist.neon, .golangci.yml, .oxlintrc.json, knip.json, config/api-extractor.kit.json) and the tools of var/tools
# (make install-tools) or node_modules (npm ci). config/layout.kit.yml checks the lint rules that live in manifests.
.PHONY: lint-python lint-php lint-rust lint-go lint-ts
lint-python: ## Lint the Python of the checkout: ruff with ruff.toml, and vulture on each package; offline
	node $(KIT)/lint-python.$(KIT_EXT)

lint-php: ## Lint the PHP of the checkout: phpcs with phpcs.xml.dist, and PHPStan with phpstan.dist.neon on each Composer package; offline
	node $(KIT)/lint-php.$(KIT_EXT)

lint-rust: ## Lint the Rust of the checkout: cargo clippy with -D warnings in each Cargo workspace; offline once the crates are downloaded
	node $(KIT)/lint-rust.$(KIT_EXT)

lint-go: ## Lint the Go of the checkout: golangci-lint with .golangci.yml, and deadcode -test, in each Go module; offline once the modules are downloaded
	node $(KIT)/lint-go.$(KIT_EXT)

lint-ts: ## Lint the TypeScript of the checkout: oxlint type-aware, knip, and API Extractor in each package with an api-extractor.json; offline
	node $(KIT)/lint-ts.$(KIT_EXT)
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
	node $(KIT)/release-consumer.$(KIT_EXT) install "$$TAG"

release-consumer-lock: ## Write the consumer manifests and locks of TAG from the archives in var/release/assets; ONLINE
	@test -n "$$TAG" || { echo "release-consumer-lock: TAG is required, for example make release-consumer-lock TAG=v0.0.1"; exit 1; }
	$(ONLINE) node $(KIT)/release-consumer.$(KIT_EXT) lock "$$TAG"

release-proof: ## Prove the released TAG from outside the checkout: release assets, consumer installs, git-tag installs, Go modules; ONLINE
	@test -n "$$TAG" || { echo "release-proof: TAG is required, for example make release-proof TAG=v0.0.1"; exit 1; }
	$(ONLINE) node $(KIT)/release-proof.$(KIT_EXT) "$$TAG"

# --- dependencies: the gate reads the manifests, the locks and the review record; the review asks the registries.
.PHONY: dependency-policy-check dependency-policy-mutation-check dependency-review
dependency-policy-check: ## Check the manifests and locks against config/dependency-policy.json and the review record; offline
	node $(KIT)/check-dependency-policy.$(KIT_EXT)

dependency-policy-mutation-check: ## Check that the dependency gate rejects each known mutation of the checkout; offline
	node $(KIT)/check-dependency-policy-mutation.$(KIT_EXT)

dependency-review: ## Ask the registries for newer stable releases and advisories; RECORD=1 records the review, UPDATE=1 updates first; ONLINE
	$(ONLINE) node $(KIT)/dependency-review.$(KIT_EXT) $(if $(RECORD),--record) $(if $(UPDATE),--update)

# --- language parity: config/parity.json declares the implementations and the units that each of them holds.
.PHONY: parity-check parity-declarations-check
parity-check: ## Run the binding of every suite in every implementation and check every parity rule of config/parity.json; offline
	node $(KIT)/parity.$(KIT_EXT)

parity-declarations-check: ## Check the parity rules of config/parity.json that need no run: symbols, bindings, tests, error codes, lists, documents; offline
	node $(KIT)/parity.$(KIT_EXT) --declarations

# --- python-lock: the PEP 751 locks of config/dependency-policy.json (pythonLocks), each with its requirements and a constraints file
# that pins every package. The writer resolves with var/tools/bin/uv (install-tools TOOLS=uv); the check never resolves.
.PHONY: python-lock python-lock-check
python-lock: ## Write every Python lock of pythonLocks with var/tools/bin/uv from its requirements and constraints; ONLINE
	$(ONLINE) node $(KIT)/python-lock.$(KIT_EXT) write

python-lock-check: ## Check every Python lock of pythonLocks against its requirements and constraints, with no network; offline
	node $(KIT)/python-lock.$(KIT_EXT) check
