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
