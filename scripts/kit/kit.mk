# The targets of kit that every repository includes (`include scripts/kit/kit.mk`). This file is vendored: it is copied by
# `make kit-sync`, so a change is made in kit, never in a checkout (.kit/kit.lock.json records its sha256).
KIT_REPOSITORY ?= https://github.com/polyspec/kit
ONLINE ?=

.PHONY: kit-sync kit-check kit-test

kit-sync: ## Copy the vendored files of kit at KIT_TAG into this checkout; ONLINE, it clones KIT_REPOSITORY
	@test -n "$(KIT_TAG)" || { echo "kit-sync: KIT_TAG is required, for example make kit-sync KIT_TAG=v0.0.1"; exit 1; }
	$(ONLINE) node scripts/kit/kit-sync.mjs --tag $(KIT_TAG) --repository $(KIT_REPOSITORY)

kit-check: ## Check the vendored files against .kit/kit.lock.json and the configuration against its schemas; offline
	node scripts/kit/kit-check.mjs

kit-test: ## Run the tests of the vendored tools (tests/kit); offline
	node --test tests/kit/

# --- cargo downloads: the crates of every Cargo.lock are downloaded before a check runs cargo offline.
.PHONY: cargo-downloads-check cargo-downloads-fetch
cargo-downloads-check: ## Check that the crates of every Cargo.lock are in the registry of CARGO_HOME; offline
	node scripts/kit/check-cargo-downloads.mjs

cargo-downloads-fetch: ## Download the crates of every Cargo.lock
	$(ONLINE) node scripts/kit/check-cargo-downloads.mjs --fetch
# Toolchains (K8.2): install-tools installs the declared npm, Go, ruff, Composer (with a sha256), cargo-audit and
# govulncheck into var/tools; ONLINE, because it downloads. Nothing on the machine changes. Put var/tools/bin first on PATH.
# toolchain-check compares the running tools with the declarations and fails with the expected and the running version.
.PHONY: install-tools toolchain-check

install-tools: ## Install the toolchains that the checkout declares into var/tools; ONLINE
	$(ONLINE) node scripts/kit/install-tools.mjs

toolchain-check: ## Check that the running tools are the declared versions; TOOLS limits the tools; offline
	node scripts/kit/check-toolchain.mjs $(TOOLS)
# ---- The gates: Git hooks, push gate and guard of the full run ------------------------------------------------------
# scripts/kit/git-hooks.mjs, push-gate.mjs and full-run.mjs read config/checklist.json. The target that runs the full suite
# is the repository's own: it calls `node scripts/kit/full-run.mjs run <target>...` with the targets of its suite.
COMMIT ?= HEAD
FULL_RUN_KEYS ?=

.PHONY: hooks hooks-check push-gate-commit rerun-failed

# Git runs the hooks of core.hooksPath. A checkout that tracks .githooks/pre-push sets it on every make invocation.
ifneq ($(wildcard .githooks/pre-push),)
ifneq ($(shell git config core.hooksPath),.githooks)
$(shell git config core.hooksPath .githooks)
endif
endif

hooks: ## Set core.hooksPath to .githooks, write the pre-push hook of the push gate and check the hooks
	node scripts/kit/git-hooks.mjs install

hooks-check: ## Fail while core.hooksPath is not .githooks or a hook of config/checklist.json is missing, not executable or changed
	node scripts/kit/git-hooks.mjs check

push-gate-commit: ## The push gate on COMMIT (HEAD): fail while it has an item in an active state or does not track an executable hook
	node scripts/kit/push-gate.mjs commit $(COMMIT)

rerun-failed: ## Rerun the targets of the last full run of this tree that did not pass; FULL_RUN_KEYS repeats the keys of that run
	node scripts/kit/full-run.mjs rerun-failed$(if $(FULL_RUN_KEYS), $(FULL_RUN_KEYS))
# --- Document, owner and CI report tools (rows K7 and K8.1) ---------------------------------------------------------------
.PHONY: documents-check

documents-check: ## Check the documents declared in config/documents.json: translation pairs, revisions, links, checklists; offline
	node scripts/kit/check-documents.mjs

.PHONY: owner-check owner-validate

owner-check: ## Run the checks that own the changed paths (config/owner-checks.json); PATHS="a b" or BASE=<revision> selects the paths
	node scripts/kit/owner-check.mjs $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base $(BASE))

owner-validate: ## Check that config/owner-checks.json owns every tracked path and names only existing checks; offline
	node scripts/kit/owner-check.mjs --validate

.PHONY: ci-targets ci-summary ci-passed

CI_REPORT ?= var/report/ci-targets

ci-targets: ## Run the make targets of TARGETS past failures and write the report to CI_REPORT (logs, record.json, summary.md)
	node scripts/kit/ci-targets.mjs $(CI_REPORT) $(TARGETS)

ci-summary: ## Write summary.md of CI_REPORT again from its record, also for a run that stopped; never judges the targets
	node scripts/kit/ci-targets.mjs --summary $(CI_REPORT)

ci-passed: ## Fail unless every job of RESULTS, the JSON of toJSON(needs), has the result success
	node scripts/kit/ci-passed.mjs
