# The recipes of kit's own Makefile, which sets KIT := scripts/kit and KIT_EXT := mts and runs the sources. No repository includes
# it and the package ships no make file (K1054); a repository may copy targets of it into its own make file, as the example
# docs/examples/bootstrap.mk shows. Every tool runs as node $(KIT)/<tool>.$(KIT_EXT).
ifeq ($(and $(KIT),$(KIT_EXT)),)
$(error kit.mk needs KIT and KIT_EXT; set both as the Makefile of kit does)
endif
ONLINE ?=


# The tools of mise.toml (K127) run from the shims of mise, var/tools/mise/shims, which need the environment of mise of the
# checkout (miseEnvironment of scripts/kit/bootstrap/install-mise.mts): every recipe runs with it, and with var/tools/bin
# (npm, npx, mise and the wrappers of the Composer projects) and the shims first on PATH. var/tools is the checkout's own
# (KIT_TOOLS, K858): a linked worktree installs its tools with its own make install.
KIT_TOOLS := $(CURDIR)/var/tools
KIT_GIT_COMMON := $(abspath $(shell git rev-parse --git-common-dir 2>/dev/null))
KIT_MAIN_CHECKOUT := $(realpath $(patsubst %/.git,%,$(filter %/.git,$(KIT_GIT_COMMON))))
# Set in a linked worktree, whose main checkout is another folder; a repository may read it.
KIT_WORKTREE := $(if $(KIT_MAIN_CHECKOUT),$(filter-out $(realpath $(CURDIR)),$(KIT_MAIN_CHECKOUT)))
export MISE_DATA_DIR := $(KIT_TOOLS)/mise
export MISE_CACHE_DIR := $(KIT_TOOLS)/mise/cache
export MISE_STATE_DIR := $(KIT_TOOLS)/mise/state
export MISE_CONFIG_DIR := $(KIT_TOOLS)/mise/config
export MISE_GLOBAL_CONFIG_FILE := $(CURDIR)/mise.toml
# mise install records the trust of the root of the global config, the home directory unless this names the checkout (K397-1).
export MISE_GLOBAL_CONFIG_ROOT := $(CURDIR)
MISE_ENVIRONMENT := MISE_DATA_DIR MISE_CACHE_DIR MISE_STATE_DIR MISE_CONFIG_DIR MISE_GLOBAL_CONFIG_FILE MISE_GLOBAL_CONFIG_ROOT
# On Windows a shim of mise starts mise.exe by its PATH name, and var/tools/bin holds only the batch wrapper mise.cmd, which
# a native shim cannot start, so the directory of the binary of mise is on PATH beside it (K820).
ifeq ($(OS),Windows_NT)
export PATH := $(KIT_TOOLS)/bin:$(KIT_TOOLS)/mise-release/mise/bin:$(KIT_TOOLS)/mise/shims:$(PATH)
else
export PATH := $(KIT_TOOLS)/bin:$(KIT_TOOLS)/mise/shims:$(PATH)
endif

# A recipe starts the pinned tools of the checkout by absolute paths, never by bare names (K171). POSIX uses the native shell
# wrappers. On Windows Make recipes run in Git Bash, which cannot execute a .cmd wrapper as a Bash command, so NODE is the
# node.exe selected by mise and NPM is that NODE with the npm-cli.js of the npm:npm that mise installs (K938). If the SDK is absent,
# ordinary recipes still point into var/tools and fail; only the bootstrap target uses the machine Node.js through BOOTSTRAP_NODE (K174).
ifeq ($(OS),Windows_NT)
KIT_MISE_BINARY := $(KIT_TOOLS)/mise-release/mise/bin/mise.exe
ifneq ($(wildcard $(KIT_MISE_BINARY)),)
KIT_MISE_ENVIRONMENT_ARGS := $(foreach variable,$(MISE_ENVIRONMENT),$(variable)="$($(variable))")
KIT_NODE_DIRECTORY := $(shell $(KIT_MISE_ENVIRONMENT_ARGS) "$(KIT_MISE_BINARY)" where node)
KIT_NPM_DIRECTORY := $(shell $(KIT_MISE_ENVIRONMENT_ARGS) "$(KIT_MISE_BINARY)" where npm:npm)
NODE := $(if $(KIT_NODE_DIRECTORY),$(subst \,/,$(KIT_NODE_DIRECTORY))/node.exe,$(KIT_TOOLS)/bin/node)
NPM := $(if $(KIT_NPM_DIRECTORY),$(NODE) $(subst \,/,$(KIT_NPM_DIRECTORY))/node_modules/npm/bin/npm-cli.js,$(KIT_TOOLS)/bin/npm)
else
NODE := $(KIT_TOOLS)/bin/node
NPM := $(KIT_TOOLS)/bin/npm
endif
else
NODE := $(KIT_TOOLS)/bin/node
NPM := $(KIT_TOOLS)/bin/npm
endif
ALINT := $(KIT_TOOLS)/mise/shims/alint
BOOTSTRAP_NODE := node

.PHONY: kit-install-symbols
kit-install-symbols: ## Install selected declared symbol extractors with EXTRACTORS="go php"; their pinned tools must be installed first; ONLINE
	$(ONLINE) $(NODE) $(KIT)/install-symbols.$(KIT_EXT) $(EXTRACTORS)

# The tools of the parity rules that every repository shares are kit's, so install-kit installs them from the declarations of the
# repository through their targets (K861): the symbolExtractors of config/toolchain.json. Reading a declaration judges nothing; each
# target's tool judges its install. cargo fetches the crates of a Cargo.lock itself (K1014).
.PHONY: kit-install-declared
kit-install-declared: ## Install the declared symbol extractors (install-symbols --declared) through their targets; ONLINE
	$(ONLINE) $(NODE) $(KIT)/install-symbols.$(KIT_EXT) --declared
# Toolchains (K8.2, K127): the bootstrap (TOOLS=npm) installs mise, and the node and npm of mise.toml; install-tools installs every
# tool of mise.toml at the digests of mise.lock with mise, then what mise does not install (the wheel backend and the Composer
# projects; the symbol extractors have their own targets, K861); toolchain-lock writes mise.lock. All three download, so they run ONLINE. Nothing outside
# the checkout changes. A missing tool fails the target that runs it, so no target checks the installed tools (K854).
.PHONY: install-tools toolchain-lock

# TOOLS=npm is the first step of a checkout, before npm ci installs the packages that the other tools import, so it runs the
# bootstrap installer of $(KIT)/bootstrap, which imports only Node.js built-ins.
install-tools: ## Install all locked tools or selected tool names of toolchain-mise; TOOLS=npm runs the bootstrap; ONLINE
ifeq ($(TOOLS),npm)
	$(ONLINE) $(BOOTSTRAP_NODE) $(KIT)/bootstrap/bootstrap.$(KIT_EXT)
else
	$(ONLINE) $(NODE) $(KIT)/install-tools.$(KIT_EXT) --no-self-update $(TOOLS)
endif

# toolchain-lock is mise lock (K836) with the mise of config/toolchain.json, which the bootstrap installs (make install-tools
# TOOLS=npm, K174); var/tools/bin and the shims of mise come first on the PATH of every recipe (PATH above). mise locks a pypi:
# tool with the first uv on PATH, so mise first locks uv and python, which locks nothing when mise.toml declares neither; mise lists
# a tool only once it is locked (the locked setting of mise.toml). It then installs each of them that it lists, under any key form,
# and locks the rest; uv takes the Python of the shims because the [env] of kit's mise.toml prefers a Python of the system to a
# managed one (UV_PYTHON_PREFERENCE, K1048), so the recipe names no UV_PYTHON (K1054). mise records the archives that each
# platform has.
TOOLCHAIN_LOCK_PLATFORMS := linux-x64,linux-arm64,macos-arm64,macos-x64,windows-x64,windows-arm64
toolchain-lock: ## Write mise.lock with mise lock: the digests of the tools of mise.toml for each platform of linux, macOS and Windows on x64 and arm64 that has their archive; ONLINE
	@test -x $(KIT_TOOLS)/bin/mise || { echo "[toolchain-lock] $(KIT_TOOLS)/bin/mise is missing; run make install-tools TOOLS=npm, the bootstrap that installs the mise of config/toolchain.json" >&2; exit 1; }
	$(ONLINE) $(KIT_TOOLS)/bin/mise lock uv python --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)
	tools=; for tool in uv python; do \
	  listed="$$($(KIT_TOOLS)/bin/mise ls --global --json $$tool)" || exit 1; \
	  case "$$listed" in *'"requested_version"'*) tools="$$tools $$tool";; esac; \
	done; \
	if [ -n "$$tools" ]; then $(ONLINE) $(KIT_TOOLS)/bin/mise install --locked $$tools || exit 1; fi; \
	$(ONLINE) $(KIT_TOOLS)/bin/mise lock --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)

# ---- Folder layout (S5) ---------------------------------------------------------------------------------------------
# alint (mise.toml, installed by install-tools) checks the tree against config/layout.yml, which extends
# the common rules of the repository, such as the config/layout.kit.yml that kit ships as an example, with its map.
.PHONY: layout-check
layout-check: ## Check the folder layout of the checkout (S5) against config/layout.yml with the alint of mise.toml, and that Git ignores each install directory that its recipe declares (K372, K1083), and that no tracked file is generated (K426); offline
	@test -x $(ALINT) || { echo "layout-check: $(ALINT) is missing; run make install-tools"; exit 1; }
	$(ALINT) check --config config/layout.yml --color never --compact .
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) installs var package.json=node_modules pyproject.toml=.venv composer.json=vendor
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) tracked --binary ELF --binary Mach-O --binary PE
# ---- Git hooks and merge drivers ---------------------------------------------------------------------------------------
# kit declares its hooks and merges here (K1099): no hook of its own, the merges of its changelogs and checklists (K354), and the
# drivers, which run twin-merge of this checkout. scripts/kit/git-hooks.mts installs or checks exactly what HOOK_DECLARATION names.
TWIN_MERGE_DRIVER := make --no-print-directory twin-merge MERGE="%O %A %B %P"
HOOK_DECLARATION := --merge 'CHANGELOG.md=kit-changelog' --merge 'CHANGELOG.ko.md=kit-twin' \
	--merge 'docs/plans/*/checklist.md=kit-checklist' --merge 'docs/plans/*/checklist.ko.md=kit-twin' \
	--driver 'kit-twin=$(TWIN_MERGE_DRIVER)' --driver 'kit-changelog=$(TWIN_MERGE_DRIVER)' --driver 'kit-checklist=$(TWIN_MERGE_DRIVER)'
.PHONY: hooks hooks-check

twin-merge: ## The merge drivers that make hooks declares: kit-twin of a Korean changelog or checklist (K354), kit-changelog of CHANGELOG.md, whose Unreleased entries it puts newest first (K354-1), and kit-checklist of a checklist, which merges its task rows by ID (K354-3); git runs it with MERGE="<base> <ours> <theirs> <path>"; offline
	@$(NODE) $(KIT)/twin-merge.$(KIT_EXT) $(MERGE)

hooks: ## Install the hooks folder, hooks, merges and merge drivers that HOOK_DECLARATION names, and check them (K1099)
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) install $(HOOK_DECLARATION)

hooks-check: ## Fail while a hook, merge or merge driver that HOOK_DECLARATION names is not installed (K1099)
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) check $(HOOK_DECLARATION)

# --- Rules: every tool has its class (S1) and every rule names the check that enforces it (K248) --------------------------
.PHONY: lint-js build-php-ext lint-php-ext test-php-ext
# The tasks build, test and lint and the runs of each runtime are the repository's own targets (K246, K1106): its Makefile calls
# runtime-targets.mts with the runner and the roots it selects, and kit's Makefile gives the tasks their prerequisites.

# oxlint lints the JavaScript as it lints the TypeScript.
lint-js: lint-ts

# The PHP extension of packages/php-ext (php-extension.mts, S10): one build with phpize, the check that src/config.m4 names the
# extension and that the arginfo header of each stub, when present, carries its stub hash, the generated headers during the
# temporary build, and the declaration test before its unit tests. A repository without an extension passes them, so every CI runs them.
# The paths of the extension are the recipe's arguments (K1103): the extension folder, the build folder and, with --library, each
# PHP library whose declarations it matches; kit has none.
PHP_EXTENSION_LAYOUT := --extension packages/php-ext --build-dir var/php-ext --skip vendor --skip node_modules
build-php-ext: ## Build packages/php-ext with phpize into var/php-ext/<extension>.so, the extension of src/config.m4, after the arginfo check; ONLINE (gen_stub.php may fetch its PHP-Parser once)
	$(ONLINE) $(NODE) $(KIT)/php-extension.$(KIT_EXT) build $(PHP_EXTENSION_LAYOUT)

lint-php-ext: ## Check that src/config.m4 names the extension and the stub hash of each arginfo header that is present (S10, K1075); offline
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) check $(PHP_EXTENSION_LAYOUT)

test-php-ext: build-php-ext ## Compare the declarations of the built extension with the PHP library, then run its unit tests with CASES=<pattern>; offline
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) test $(PHP_EXTENSION_LAYOUT) -- --roots packages/php-ext

.PHONY: case-sensitive-runner-smoke
case-sensitive-runner-smoke: ## Smoke the standard Node runner with a temporary verified case-sensitive directory; offline
	CASE_SENSITIVE_ENV=KIT_CASE_SENSITIVE_SMOKE_DIR $(NODE) $(KIT)/runtime-targets.$(KIT_EXT) case-sensitive-smoke tests/kit/standard-case-sensitive-smoke.mts

.PHONY: kit-gates
# The gates of every repository, whose partitions below the CI pipeline (workflows/ci-pipeline.yml) runs past failures, so that one run shows every failure
# (K270): each make target that a rule of PRINCIPLES.md is enforced by.
kit-gates: layout-check docs-check rules-check owner-validate rebuild-check language-check test-markers-check duplication-check parity-declarations-check parity-check suppression-check divergence-check lint-ts lint-php lint-python lint-go lint-rust lint-php-ext test-php-ext ## Run every gate of kit; the CI pipeline runs its partitions in CI

# CI partitions the same gate set so each job installs only the tools it uses. `kit-gates` remains the complete local/consumer
# entry point above; these targets are only the disjoint workflow partitions, and the parity job checks every implementation in
# one run.
.PHONY: kit-gates-static kit-gates-parity kit-gates-runtime-ts kit-gates-runtime-php kit-gates-runtime-python kit-gates-runtime-go kit-gates-runtime-rust kit-gates-runtime-php-ext
# kit-gates-static is also the self-diagnosis of a repository before a push (K998): wherever it is a goal, a push or the shared
# job of CI, it runs each gate past a failure, so one run names every gate that fails, and ends with a line when every gate passed.
ifneq ($(filter kit-gates-static,$(MAKECMDGOALS)),)
MAKEFLAGS += -k
endif
kit-gates-static: layout-check docs-check rules-check owner-validate rebuild-check language-check test-markers-check duplication-check parity-declarations-check suppression-check divergence-check ## Run the shared gates; the self-diagnosis of a repository before a push, past failures
	@echo "[kit-gates-static] every shared gate passed"
kit-gates-parity: parity-check ## Run the full parity gate in its own job
kit-gates-runtime-ts: lint-ts ## Run the TypeScript gate
kit-gates-runtime-php: lint-php ## Run the PHP gate
kit-gates-runtime-python: lint-python ## Run the Python gate
kit-gates-runtime-go: lint-go ## Run the Go gate
kit-gates-runtime-rust: lint-rust ## Run the Rust gate
kit-gates-runtime-php-ext: lint-php-ext test-php-ext ## Run the PHP extension gates

.PHONY: kit-ci-plan kit-ci-setup kit-ci-context-prepare kit-ci-context-cleanup
kit-ci-plan: ## Validate config/ci.json and write the runtime, tool and target plan to GITHUB_OUTPUT for the CI pipeline
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --plan

kit-ci-setup: ## Run the locked setup targets declared by config/ci.json; GROUP=shared|parity|parity-binding|runtime, RUNTIME=<runtime> or IMPLEMENTATION=<name>
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --setup $(GROUP) $(if $(filter parity-binding,$(GROUP)),$(IMPLEMENTATION),$(RUNTIME))

kit-ci-context-prepare: ## Run the optional repository context preparation target for GROUP and RUNTIME
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --context-prepare $(GROUP) $(RUNTIME)

kit-ci-context-cleanup: ## Run the optional repository context cleanup target for GROUP and RUNTIME
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --context-cleanup $(GROUP) $(RUNTIME)

.PHONY: suppression-check
suppression-check: ## Fail on a tracked suppression of a lint finding (eslint-disable, oxlint-disable, noqa, @phpstan-ignore, phpcs:ignore, nolint, allow) that states no reason in the form of its tool (P8, K334); offline
	$(NODE) $(KIT)/suppression-check.$(KIT_EXT)

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
# The rules of kit for divergence-check (K1079): the kinds of reason of a configuration exception and the refused feature states.
DIVERGENCE_RULES := --reason-kind generated --reason-kind fixture --reason-kind test --reason-kind harness --reason-kind ecosystem --reason-kind external --feature-state partial --feature-state unsupported
divergence-check: ## Fail on an implementation that diverges through a branch on the runtime, a narrowing of its run, a partial or unsupported feature, or an exception without a kind of reason (K315, K1079); offline
	$(NODE) $(KIT)/divergence-check.$(KIT_EXT) $(DIVERGENCE_RULES) --roots

.PHONY: language-check
language-check: ## Fail on Hangul in a comment, an identifier, an error or log message or a test name of the code (K252, K1088); offline
	$(NODE) $(KIT)/language-check.$(KIT_EXT) --forbid '\p{Script=Hangul}'

.PHONY: test-markers-check
test-markers-check: ## Fail on a test that a marker skips or narrows: test.skip, it.only, t.Skip, unittest.skip, markTestSkipped, #[ignore] (K255); offline
	$(NODE) $(KIT)/test-markers.$(KIT_EXT)

.PHONY: duplication-check
duplication-check: ## Fail while a piece of code exists twice, by the formats, minimum lines, ignore-patterns and exclusions of config/duplication.json (jscpd, K248-3, K1104); offline
	$(NODE) $(KIT)/duplication-check.$(KIT_EXT)

.PHONY: rebuild-check rules-check

# The tool sources of kit for rebuild-check (K1080): its scripts and generators, each glob quoted so the shell expands none.
REBUILD_SOURCES := --source 'scripts/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source '**/*_generate.go' --source '**/*.generate.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'benchmarks/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'examples/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'tests/fixtures/*/generate.*'
# The files among the sources that are no tool source (K1080): the .d.ts declarations and the tests (the test files of check-commits),
# but a generator of a fixture at tests/fixtures/<name>/generate.* stays a tool source.
REBUILD_EXCLUDES := --exclude '**/*.d.ts' --exclude '*/**/{test,tests}/**' --exclude 'test/**' --exclude 'tests/**/{*_generate.go,*.generate.*}' --exclude '**/*.{test,spec}.{js,jsx,ts,tsx,cjs,cts,mjs,mts}' --exclude '**/{*_test.go,test_*.py,*_test.py,*Test.php}'
rebuild-check: ## Check that every tool that config/rebuild.json declares, and every tracked file of the --source globs of REBUILD_SOURCES that no --exclude glob of REBUILD_EXCLUDES drops, has its class: ecosystem, replaced, record or policy (S1, K1080); offline
	$(NODE) $(KIT)/rebuild-check.$(KIT_EXT) $(REBUILD_SOURCES) $(REBUILD_EXCLUDES)

rules-check: ## Check that every rule of PRINCIPLES.md and AGENTS.md names a check that a CI workflow or a Git hook runs (K248); offline
	$(NODE) $(KIT)/check-rules.$(KIT_EXT)

# --- Document, owner and CI report tools (rows K7 and K8.1) ---------------------------------------------------------------
.PHONY: docs-check

# The document checks of a repository after the check of kit (K419): the repository adds a make target with DOCS_CHECKS += <target>,
# and docs-check runs check-documents and every target of DOCS_CHECKS, each whatever the status of the others, then fails naming
# those that failed. The recipe is expanded when it runs, so a DOCS_CHECKS that the Makefile sets after the include counts.
DOCS_CHECKS_BEGIN = $(if $(strip $(DOCS_CHECKS)),status=0; failed=; )
DOCS_CHECKS_END = $(if $(strip $(DOCS_CHECKS)), || { status=1; failed=check-documents; }; for target in $(DOCS_CHECKS); do $(MAKE) --no-print-directory $$target || { status=1; failed="$$failed $$target"; }; done; if [ $$status -ne 0 ]; then echo "[docs-check] failed:$$failed" >&2; fi; exit $$status)
# The rules of kit for check-documents (K1081): items outside a plan folder are a finding.
DOCUMENT_RULES := --checklist-place --private-path /Users/ --private-path /home/ --kit-rows
docs-check: ## Check the documents declared in config/documents.json: translation pairs, revisions, links, and the checklists of config/checklist.json, then the document checks that a repository adds with DOCS_CHECKS += <target> (K419); offline
	$(DOCS_CHECKS_BEGIN)$(NODE) $(KIT)/check-documents.$(KIT_EXT) $(DOCUMENT_RULES)$(DOCS_CHECKS_END)

.PHONY: plan-new plan-split item-new item-edit item-state item-test commit

# The plan utilities (plan.mts, K249) read their values from the environment, where make puts its command-line variables.
plan-new: ## Write the plan NAME=<slug> into docs/plans/<slug>/ with TITLE and TITLE_KO: plan.md, checklist.md and their Korean twins; offline
	NAME_PATTERN='^[a-z][a-z0-9-]*$$' $(NODE) $(KIT)/plan.$(KIT_EXT) plan-new

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
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION CAUSE RETRY CAUSE_KO RETRY_KO) DONE_STAYS=1 $(NODE) $(KIT)/plan.$(KIT_EXT) item-edit

item-state: ## Move the item ID to STATE in both languages along an allowed transition; done needs its changelog line, bypassed CAUSE, RETRY, CAUSE_KO and RETRY_KO, impossible CAUSE and CAUSE_KO; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-state

item-test: ## Run the commands of the Verification cell of the item ID in order; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-test

commit: ## Commit the index for the item ID as TYPE(SCOPE): SUBJECT (#ID) with the body of BODY_FILE wrapped, after the checks of the commit-msg hook; offline
	$(NODE) $(KIT)/plan.$(KIT_EXT) commit

.PHONY: documents-stamp

documents-stamp: ## Write the source-sha256 of each English document into the Korean twins that PATHS names, after their translation matches; with no PATHS list the twins whose source moved (K877); offline
	$(NODE) $(KIT)/documents-stamp.$(KIT_EXT) $(PATHS)

.PHONY: owner-check owner-validate

# The owner rules of kit itself: every tracked path has an owner (K1112).
OWNER_RULES := --every-path

owner-check: ## Run the checks that own the changed paths (config/owner-checks.json); PATHS="a b" or BASE=<revision> selects the paths
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) $(OWNER_RULES) $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base $(BASE))

owner-validate: ## Check that config/owner-checks.json owns every tracked path and names only existing checks; offline
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) $(OWNER_RULES) --validate

.PHONY: ci-targets ci-summary ci-passed

CI_REPORT ?= var/report/ci-targets

# Each target runs with make -k only when the caller runs make -k ci-targets (K1098).
ci-targets: ## Run TARGETS past failures, wherever it is started, each with -k under make -k; write CI_REPORT (logs, record.json, summary.md)
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) $(if $(findstring k,$(firstword -$(MAKEFLAGS))),-k) $(CI_REPORT) $(TARGETS)

ci-summary: ## Write summary.md of CI_REPORT again from its record, also for a run that stopped; never judges the targets
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) --summary $(CI_REPORT)

ci-passed: ## Fail unless every job of RESULTS, the JSON of toJSON(needs), has the result success or skipped; FAIL_SKIPPED=1 fails a skipped job too (K1111)
	$(NODE) $(KIT)/ci-passed.$(KIT_EXT)

# The steps of a release (scripts/kit/release.mts, config/release.json). release-tag tags the commit of the successful CI run RUN
# with vX.Y.Z, X.Y.Z the newest section of the change log of that commit, and the Go module tags (K911, K924); TAG is that tag
# vX.Y.Z, which release-tag appends to GITHUB_ENV with VERSION. The release workflow runs the steps in this order.
.PHONY: release-prepare release-tools release-tag release-assets release-candidate-assets release-publish release-undraft release-coverage

# kit's own release names its main ref, its asset folder and the folder of its release records, which the release tools take
# from the caller and never fix (K1102, K1115).
RELEASE_MAIN ?= origin/main
RELEASE_ASSETS ?= var/release/assets
RELEASE_RECORDS ?= var/release

# Freeze the native candidate before CI; the release then tags the exact commit of its successful run without another test run.
.PHONY: release-candidate
release-candidate: ## Prepare the VERSION archives of the committed candidate before CI
	RELEASE_ASSETS="$(RELEASE_ASSETS)" $(NODE) $(KIT)/release-run.$(KIT_EXT) prepare "$(VERSION)"

# release-prepare is the preparation that a repository's release needs before release-tools, such as the checkout of a sibling
# release: kit declares it with no recipe, and a repository adds its own with a release-prepare:: rule of its Makefile (K132).
release-prepare:: ## Prepare what the release of this repository needs before release-tools; a repository declares it with release-prepare::
	@:

release-tools: ## Install the tools that config/release.json needs for the release (npm, Composer, Python and uv, Go), and check cargo when a git-tag proof needs it; ONLINE
	$(ONLINE) $(NODE) $(KIT)/release-tools.$(KIT_EXT)


release-tools-path: ## Append var/tools/bin and the shims of mise to GITHUB_PATH and the environment of mise to GITHUB_ENV for the steps that follow; the release workflow runs it after release-tools
	@test -n "$$GITHUB_PATH" || { echo 'release-tools-path: GITHUB_PATH is not set; run it in the release workflow between steps'; exit 1; }
	@test -n "$$GITHUB_ENV" || { echo 'release-tools-path: GITHUB_ENV is not set; run it in the release workflow between steps'; exit 1; }
	@echo "$(KIT_TOOLS)/mise/shims" >> "$$GITHUB_PATH"
	@echo "$(KIT_TOOLS)/bin" >> "$$GITHUB_PATH"
	@for name in $(MISE_ENVIRONMENT); do echo "$$name=$$(printenv $$name)"; done >> "$$GITHUB_ENV"

release-tag: ## Create and push the annotated tag vX.Y.Z, X.Y.Z the newest section of the change log, and the tag <directory>/vX.Y.Z of every Go module at the commit of the successful CI run RUN of ci.yml on main, or pass for a tag there already, and append TAG and VERSION to GITHUB_ENV when it is set (K269, K911, K924); with AUTO, as the workflow_run of a green CI starts it, only the version commit of the top version releases, a commit whose top version is tagged elsewhere passes with nothing to release, and any other fails naming the version commit (K987); reads the run with gh
	@test -n "$$RUN" || { echo "release-tag: RUN is required, for example make release-tag RUN=123"; exit 1; }
	RELEASE_MAIN="$(RELEASE_MAIN)" $(NODE) $(KIT)/release-run.$(KIT_EXT) tag "$$RUN"$(if $(AUTO), --auto)

release-assets: ## Build the archive of every package of TAG, and packages.json of its Composer packages (K871), into RELEASE_ASSETS (K1102); ONLINE, since uv build installs the build-system.requires of a wheel package
	@test -n "$$TAG" || { echo "release-assets: TAG is required, for example make release-assets TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS="$(RELEASE_ASSETS)" $(ONLINE) $(NODE) $(KIT)/release.$(KIT_EXT) assets "$$TAG"

release-candidate-assets: ## Build the archive of every package from committed HEAD for VERSION, and packages.json of its Composer packages (K871), into RELEASE_ASSETS (K1102); ONLINE, since uv build installs the build-system.requires of a wheel package
	@test -n "$$VERSION" || { echo "release-candidate-assets: VERSION is required, for example make release-candidate-assets VERSION=0.0.1"; exit 1; }
	RELEASE_ASSETS="$(RELEASE_ASSETS)" $(ONLINE) $(NODE) $(KIT)/release.$(KIT_EXT) candidate-assets "$$VERSION"

release-publish: ## Create the GitHub Release of TAG as a draft with the notes and the files of release-assets, the archives and packages.json; a draft of an earlier run is replaced
	@test -n "$$TAG" || { echo "release-publish: TAG is required, for example make release-publish TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS="$(RELEASE_ASSETS)" RELEASE_RECORDS="$(RELEASE_RECORDS)" $(NODE) $(KIT)/release.$(KIT_EXT) publish "$$TAG"

release-undraft: ## Make the draft release of TAG public
	@test -n "$$TAG" || { echo "release-undraft: TAG is required, for example make release-undraft TAG=v0.0.1"; exit 1; }
	RELEASE_RECORDS="$(RELEASE_RECORDS)" $(NODE) $(KIT)/release.$(KIT_EXT) undraft "$$TAG"

release-coverage: ## Require every package file of the checkout to be classified in config/release.json; offline
	$(NODE) $(KIT)/release.$(KIT_EXT) coverage

# --- python-venv: a virtual environment of the checkout Python, made by the uv of the checkout as uv makes it
# (scripts/kit/python-venv.mts); an existing venv of the checkout Python is kept.
.PHONY: python-venv
python-venv: ## Make the virtual environment DIR from the python3 of mise.toml with its uv venv; offline
	@test -n "$(DIR)" || { echo "python-venv: DIR is required, for example make python-venv DIR=pkg/.venv"; exit 1; }
	$(NODE) $(KIT)/python-venv.$(KIT_EXT) $(DIR)

# --- link: the local links of 0.0.x development (docs/operations/local-links.md, K201, K205, K869). The git-ignored .links
# of the checkout itself (K1118) names the checkouts that provide the packages (scripts/kit/link.mts); PROJECT, when given, names the consumer whose manifests directly in it
# are linked, else the whole tree of the checkout. Native package managers connect declared development sources;
# application requirements remain their inputs and link invokes no product build target (K664); link-check
# lists each provided folder that is a copy or links elsewhere; unlink only removes the links, and make install restores the locked
# installs (K856). link writes a git-ignored go.work at each Go module, which go reads by itself; unlink removes it.
.PHONY: link link-check unlink
link: ## Connect provided development sources through native package managers, using application source declarations and compatible requirements (PROJECT names the consumer); no product build target; offline
	$(NODE) $(KIT)/link.$(KIT_EXT) link $(strip $(if $(PROJECT),--project $(PROJECT)) $(if $(RUNTIME),--runtime $(RUNTIME)))

link-check: ## Fail while the links differ from the link declaration (.links, K869): a declared folder that is not a link to its provider, a link that it does not name, a go.work whose uses differ, or a declared package with no installed folder (K888); link writes no Claude Code settings (K960); offline
	$(NODE) $(KIT)/link-check.$(KIT_EXT) $(if $(PROJECT),--project $(PROJECT))

# WORKTREE_DECLARATION (K1107): kit's own worktree of a row, ../<main checkout>-<NAME>-<ID> on <TYPE or fix>/<NAME>-<ID> from main; a
# worktree without node_modules first gets npm ci of the npm of var/tools, then make install and make link-check run in it.
# WORKTREE_ENVIRONMENT (K858): the worktree runs its own tools in a make of its own, so the recipe drops the flags of this make
# (MAKEFLAGS, MFLAGS, MAKELEVEL) and the var/tools of this checkout from PATH; kit's declaration, which worktree-setup only runs.
WORKTREE_MAIN = $(patsubst %/.git,%,$(shell git rev-parse --path-format=absolute --git-common-dir))
WORKTREE_DECLARATION = --folder $(WORKTREE_MAIN)-$(NAME)-$(ID) --branch $(or $(TYPE),fix)/$(NAME)-$(ID) --base main --prepare 'test -d node_modules || PATH="$(KIT_TOOLS)/bin:$$PATH" $(NPM) ci --ignore-scripts' --make install --make link-check
WORKTREE_ENVIRONMENT = env -u MAKEFLAGS -u MFLAGS -u MAKELEVEL PATH="$$(printf '%s' "$$PATH" | awk -v RS=: -v ORS=: -v tools='$(KIT_TOOLS)' 'index($$0, tools) != 1' | sed 's/:$$//')"
.PHONY: worktree-setup
worktree-setup: ## Create or reuse the worktree that WORKTREE_DECLARATION names and run its preparation and make targets in it (K858, K869, K1107); ONLINE
	$(ONLINE) $(WORKTREE_ENVIRONMENT) $(NODE) $(KIT)/worktree-setup.$(KIT_EXT) $(WORKTREE_DECLARATION)

# WORKTREE_STOP (K441): a repository sets WORKTREE_STOP to the make target that stops the servers of its worktree (the server-stop target of
# orm). land runs it, with make in the worktree, before it removes the worktree; a failing stop keeps the worktree.
.PHONY: land
land: ## Land the branch BRANCH on main (K394): rebases it on main in its worktree when main has moved and refuses a conflict (K1100), merges it fast-forward under a lock, runs the WORKTREE_STOP targets of its worktree, removes the worktree, kept while it has an uncommitted change or a process runs in it (K429), and deletes the branch; runs no gate and judges no commit (K1053); offline
	$(NODE) $(KIT)/land.$(KIT_EXT) $(BRANCH) main


# uv-install follows application source/workspace declarations with native locked sync and installed-distribution checks.
.PHONY: uv-install
uv-install: ## Install declared Python sources in DIR with one native uv sync and check installed distributions; the recipe passes --locked and SYNC passes its uv sync flags as written (K850, K1097)
	UV_SYNC="--locked $(SYNC)" $(ONLINE) $(NODE) $(KIT)/uv-install.$(KIT_EXT) $(DIR)

unlink: ## Remove the links of PROJECT and the go.work files that link wrote, of the runtime of RUNTIME when given; make install restores the locked installs, Python's included; offline
	$(NODE) $(KIT)/link.$(KIT_EXT) unlink$(if $(PROJECT), --project $(PROJECT))$(if $(RUNTIME), --runtime $(RUNTIME))

# The release uses the released versions (K343), so its Go runs without the go.work of the links.
release-prepare release-tools release-tag release-assets release-candidate-assets release-publish release-undraft release-coverage: export GOWORK := off
# The archive builds build the tree of the repository, so the go.work that it tracks, its own workspace and not a link, is their GOWORK;
# naming it also hides the git-ignored go.work that link writes in each module (K774). A repository that tracks none builds with GOWORK
# off.
release-assets release-candidate-assets: export GOWORK = $(if $(shell git ls-files go.work 2>/dev/null),$(CURDIR)/go.work,off)


# ---- Lint (K77) ------------------------------------------------------------------------------------------------------
# Each target runs the lint of one language with the configuration of the repository, which each tool reads by its own
# discovery (K1050), and the tools of var/tools (make install-tools) or node_modules (npm ci). config/layout.kit.yml checks the lint rules that live in manifests.
.PHONY: lint-python lint-php lint-rust lint-go lint-ts
lint-python: ## Lint the Python of the checkout: ruff with ruff.toml, and vulture on each package; offline
	$(NODE) $(KIT)/lint-python.$(KIT_EXT)

lint-php: ## Lint the PHP of the checkout: phpcs with phpcs.xml.dist, and PHPStan with phpstan.dist.neon and no memory limit on each Composer package; offline
	$(NODE) $(KIT)/lint-php.$(KIT_EXT) --memory-limit=-1

lint-rust: ## Lint the Rust of the checkout: cargo clippy --locked in each Cargo workspace, with the lints of its Cargo.toml
	$(NODE) $(KIT)/lint-rust.$(KIT_EXT) --locked

lint-go: ## Lint the Go of the checkout: golangci-lint with .golangci.yml, and deadcode -test, in each Go module; offline once the modules are downloaded
	$(NODE) $(KIT)/lint-go.$(KIT_EXT)

lint-ts: ## Lint the TypeScript of the checkout: oxlint and knip with the configuration of the repository, and API Extractor in each package with an api-extractor.json; offline
	$(NODE) $(KIT)/lint-ts.$(KIT_EXT)
# --- language parity: config/parity.json declares the implementations and the units that each of them holds.
# Without UNITS the check is a full run.
.PHONY: parity-check parity-declarations-check
parity-check: ## Run every parity binding and check every rule; UNITS="<id>..." selects units and IMPLEMENTATIONS="<name>..." selects runtime bindings and support files (support files run when UNITS is empty), while static declaration checks stay global; offline
	$(NODE) $(KIT)/parity.$(KIT_EXT) $(foreach unit,$(UNITS),--unit $(unit)) $(foreach implementation,$(IMPLEMENTATIONS),--implementation $(implementation)) --roots

# The parity declaration is the source of the native implementation list. Generate an explicit phony target per implementation so
# repository setup prerequisites, existing files and a consumer's `.PHONY` declarations cannot bypass the provider recipe.
# The first install goals run before the checkout's Node wrapper exists. They do not need generated phase targets; defer their
# declaration read until a later gate invocation, after the conventional `TOOLS=npm` bootstrap has installed Node. Any mixed
# bootstrap and gate invocation, and every ordinary target, still validates and enumerates the declaration here.
KIT_BOOTSTRAP_GOALS := install install-kit kit-install install-packages toolchain-lock install-tools
KIT_BOOTSTRAP_ONLY := $(if $(strip $(MAKECMDGOALS)),$(if $(filter-out $(KIT_BOOTSTRAP_GOALS),$(MAKECMDGOALS)),,1),)
ifneq ($(filter install-tools,$(MAKECMDGOALS)),)
ifneq ($(TOOLS),npm)
KIT_BOOTSTRAP_ONLY :=
endif
endif
ifneq ($(KIT_BOOTSTRAP_ONLY),1)
ifneq ($(wildcard config/parity.json),)
KIT_PARITY_IMPLEMENTATIONS := $(shell NAME_PATTERN='^[a-z][a-z0-9-]*$$' $(NODE) $(KIT)/parity.$(KIT_EXT) --make-targets || echo __KIT_PARITY_TARGETS_ERROR__)
ifneq ($(filter __KIT_PARITY_TARGETS_ERROR__,$(KIT_PARITY_IMPLEMENTATIONS)),)
$(error config/parity.json implementation names could not be read safely; fix the parity declaration)
endif
endif
endif
KIT_PARITY_BINDING_TARGETS := $(addprefix parity-bindings-,$(addsuffix -check,$(KIT_PARITY_IMPLEMENTATIONS)))
.PHONY: parity-api-check $(KIT_PARITY_BINDING_TARGETS)
parity-api-check: ## Run the global API and static parity phase
	$(NODE) $(KIT)/parity.$(KIT_EXT) --phase api
define KIT_PARITY_BINDING_RULE
parity-bindings-$(1)-check: ## Run native bindings for implementation $(1)
	$$(NODE) $$(KIT)/parity.$$(KIT_EXT) --phase bindings --implementation $(1)
endef
$(foreach implementation,$(KIT_PARITY_IMPLEMENTATIONS),$(eval $(call KIT_PARITY_BINDING_RULE,$(implementation))))

parity-declarations-check: ## Check the parity rules of config/parity.json that need no run: symbols, bindings, tests, error codes, lists, documents; UNITS="<id>..." reports only the findings of the named units, their schema findings included, and of config/parity.json itself (K400, K400-1); RULES="<rule>..." reports only the findings of the named rules, by id or name, and of config/parity.json itself (K414); IDS="<requirement>..." reports only the findings that name one of the requirement ids, and of config/parity.json itself (K414-1); offline
	$(NODE) $(KIT)/parity.$(KIT_EXT) --declarations $(foreach unit,$(UNITS),--unit $(unit)) $(foreach rule,$(RULES),--rule $(rule)) $(foreach id,$(IDS),--id $(id)) --roots
