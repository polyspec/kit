# The bootstrap of kit in a repository: `include ../kit/scripts/kit/kit-bootstrap.mk` in its Makefile, the file of the kit
# checkout beside it (K614); it includes the kit.mk beside it, which runs the sources of that checkout, so a change of
# a source reaches the repository with no build (K613). The packages are installed in two steps, both online: `make install-tools
# TOOLS=npm` installs the npm of packageManager into var/tools with the installer of scripts/kit/bootstrap beside this file, then
# `make install-packages` installs package-lock.json with it.

# The folder of this file, the scripts/kit of the kit checkout, which holds the sources that the repository runs (K614, K613).
KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
# KIT is the scripts/kit of the kit checkout beside the repository, whose .mts sources node runs with their types stripped: they lie
# outside node_modules, where node strips no types, and a release packs dist instead (prepack, K613). KIT_EXT is their extension.
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
# environments that the steps of the repository install, so make install runs it after all of them. KIT is the kit checkout beside
# the repository when there is one (K348-1), so the link is that of the kit the repository develops against.
.PHONY: install-link
install-link: ## Link the packages to the polyspec checkouts beside the repository, with the node of var/tools, after every install of make install
	$(NODE) $(KIT)/link.$(KIT_EXT) link --siblings

.PHONY: install install-kit
# install runs the bootstrap of kit as its first prerequisite; a repository adds its install steps as later prerequisites
# that depend on install-kit, such as install: <repo>-install and <repo>-install: install-kit (K246-2).
install: install-kit ## Install the tools and packages in the bootstrap order: the npm of packageManager, package-lock.json, then the tools, then the steps of the repository, then the links (K360-2); ONLINE
	$(MAKE) --no-print-directory install-link
install-kit: ## Install the npm of packageManager, the packages of package-lock.json and the tools, in that order; a worktree installs nothing (K519); ONLINE
ifneq ($(KIT_WORKTREE),)
	@echo "[install-kit] $(CURDIR) is a worktree, which installs nothing: it runs the tools of the main checkout $(KIT_MAIN_CHECKOUT), and make worktree-setup links its node_modules to the main checkout's (K519)" >&2
	@exit 1
else
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
endif
