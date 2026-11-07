# A consumer includes node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk from its installed package.
# During development that package is a plain directory symlink to the kit checkout (K761); no sibling checkout path is required.
# Source installs use scripts/kit/*.mts, while prepack selects dist/*.mjs for packed installs.
# make install-tools TOOLS=npm installs the declared npm into var/tools, then make install-packages installs the lock.

# The folder of this installed bootstrap, whether npm resolves it to a linked source or a packed package.
KIT_BOOTSTRAP := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))
# Native npm source links resolve outside node_modules, where Node strips types; packed installs select dist in prepack.
# KIT is the real path of the included kit, read once when make starts (K762): npm ci of make install puts the packed release copy
# where a link was, and every recursive make of the same run gets KIT and KIT_EXT on its command line, which overrides the copy's
# own assignments, so the whole run includes and runs the kit that the link named.
KIT := $(realpath $(KIT_BOOTSTRAP))
KIT_EXT := mts
# K993: the other direction. A run that started with the packed kit, whose KIT is the real dist folder of the package, and whose
# link then made node_modules/@polyspec/kit a link to the kit checkout would read that checkout's dist, perhaps stale, through
# the same path. So KIT is the kit the run started with while that path still is its own real path, and otherwise the folder of
# this bootstrap as it is now, the sources of the linked checkout; each recipe and recursive make reads it when it runs.
KIT_STARTED := $(KIT)
KIT_EXT_STARTED := $(KIT_EXT)
kit-moved = $(if $(filter $(KIT_STARTED),$(realpath $(KIT_STARTED))),,moved)
override KIT = $(if $(kit-moved),$(realpath $(KIT_BOOTSTRAP)),$(KIT_STARTED))
override KIT_EXT = $(if $(kit-moved),mts,$(KIT_EXT_STARTED))
KIT_MAKE := $(MAKE)
override MAKE = $(KIT_MAKE) KIT=$(KIT) KIT_EXT=$(KIT_EXT)
ONLINE ?=

include $(KIT)/kit.mk

.PHONY: install-packages
# install-packages runs npm ci of the lock as it is, the release record (K511); make install links after it through install-link.
# npm's allow-remote is the repository's own setting in its .npmrc, which npm reads for this npm ci; kit sets none (K1045).
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
# K983: install-link writes no Claude Code hook, so CI links with it; PROJECT and RUNTIME select the project and the runtime as for
# make link, so a job of one project or runtime starts no package manager of another.
install-link: ## Link the packages to the checkouts of the link declaration (.links, K869), with the node of var/tools, after every install of make install; PROJECT and RUNTIME select as for make link, and no hook is written
	$(NODE) $(KIT)/link.$(KIT_EXT) link$(if $(PROJECT), --project $(PROJECT))$(if $(RUNTIME), --runtime $(RUNTIME))

.PHONY: install install-kit
# install runs the bootstrap of kit as its first prerequisite; a repository adds its install steps as later prerequisites
# that depend on install-kit, such as install: <repo>-install and <repo>-install: install-kit (K246-2).
install: install-kit ## Install the tools and packages in the bootstrap order: the mise, node and npm of mise.toml, package-lock.json, then the tools, then the steps of the repository, then the links (K360-2); ONLINE
	$(MAKE) --no-print-directory install-link
install-kit: ## Install the mise, node and npm of mise.toml, the packages of package-lock.json, the tools and the declared parity tools (K861), in that order, in the checkout's own var/tools, a worktree's too (K858); ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory kit-install-declared
