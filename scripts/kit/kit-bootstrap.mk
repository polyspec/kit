# A consumer includes node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk from its installed package.
# A native npm link may connect that package to a local checkout; no sibling checkout path is required.
# Source installs use scripts/kit/*.mts, while prepack selects dist/*.mjs for packed installs.
# make install-tools TOOLS=npm installs the declared npm into var/tools, then make install-packages installs the lock.

# The folder of this installed bootstrap, whether npm resolves it to a linked source or a packed package.
KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
# Native npm source links resolve outside node_modules, where Node strips types; packed installs select dist in prepack.
KIT := $(KIT_BOOTSTRAP)
KIT_EXT := mts
ONLINE ?=

include $(KIT)/kit.mk

.PHONY: install-packages
# install-packages runs npm ci of the lock as it is, the release record, since npm-install is a target of the kit.mk that it
# installs (K511); make install links after it through install-link.
# The package-lock pins @polyspec/kit by the URL of its release asset. npm 12 refuses a dependency of a URL unless the project
# opts in; allow-remote=root allows only the URLs that package.json itself names. npm reads it from npm_config_allow_remote, the
# one source for every npm that installs or changes the lock: npm ci of install-packages, and npm install, npm audit fix and npm
# dedupe of dependency-review UPDATE=1 (K189).
install-packages dependency-review: export npm_config_allow_remote := root
# The extra lock projects of the repository, such as a tools project outside its workspaces with its own package-lock.json, are
# the make targets that INSTALL_PACKAGES_EXTRA names (K428). They run after npm ci, in order, each with make, and the first one
# that fails stops the run. They only install: make install links after them through install-link.
install-packages: ## Install the packages of package-lock.json, @polyspec/kit included, with the npm of var/tools, then the targets that INSTALL_PACKAGES_EXTRA names; only installs, never links or builds; ONLINE
	$(ONLINE) $(NPM) ci
	$(foreach target,$(INSTALL_PACKAGES_EXTRA),$(MAKE) --no-print-directory $(target) || exit $$?;)

# The link of install-link (K360, K360-1, K360-2): it needs the Go of var/tools, which the full install-tools installs, and the
# environments that the steps of the repository install, so make install runs it after all of them. KIT always comes from
# the installed package, including when native npm links it to development sources.
.PHONY: install-link
install-link: ## Link the packages to the polyspec checkouts beside the repository, with the node of var/tools, after every install of make install
	$(NODE) $(KIT)/link.$(KIT_EXT) link --siblings

.PHONY: install install-kit
# install runs the bootstrap of kit as its first prerequisite; a repository adds its install steps as later prerequisites
# that depend on install-kit, such as install: <repo>-install and <repo>-install: install-kit (K246-2).
install: install-kit ## Install the tools and packages in the bootstrap order: the npm of packageManager, package-lock.json, then the tools, then the steps of the repository, then the links (K360-2); ONLINE
	$(MAKE) --no-print-directory install-link
install-kit: ## Install the npm of packageManager, the packages of package-lock.json and the tools, in that order; worktrees reuse tools and prepare native dependencies through worktree-setup (K690); ONLINE
ifneq ($(KIT_WORKTREE),)
	@echo "[install-kit] $(CURDIR) is a worktree: it reuses tools from $(KIT_MAIN_CHECKOUT); use make worktree-setup for native offline dependency installation (K690)" >&2
	@exit 1
else
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
endif
