# Example: the bootstrap recipes of a repository that runs the tools of its installed kit (K1054). kit includes no recipe into a
# repository; this file shows one working way, which a repository may copy into its own tree, change or ignore. kit's own recipes
# are scripts/kit/kit.mk and the Makefile of the kit repository; a repository copies the targets of kit.mk that it wants into its
# own make file beside this one.
#
# The Makefile of the repository includes the copy:
#
#   include make/bootstrap.mk
#
# The make file includes the kit.mk copy and reads the tools of the installed package, so the lock is installed before the first
# make, as the kit-bootstrap action does with npm ci. The tools run from the dist of the package, whether npm installed the release
# or a link names a kit checkout that make kit-build built.
KIT := $(abspath node_modules/@polyspec/kit/dist)
KIT_EXT := mjs
ONLINE ?=

include $(dir $(lastword $(MAKEFILE_LIST)))kit.mk

.PHONY: install install-kit install-packages install-link
# install-packages runs npm ci of the lock as it is; npm reads the allow-remote and the other settings of the repository's .npmrc.
install-packages: ## Install the packages of package-lock.json, @polyspec/kit included, with the npm of var/tools; ONLINE
	$(ONLINE) $(NPM) ci

# install-link links the packages to the checkouts of the link declaration .links after every install step.
install-link: ## Link the packages to the checkouts of the link declaration (.links); PROJECT and RUNTIME select as for make link
	$(NODE) $(KIT)/link.$(KIT_EXT) link$(if $(PROJECT), --project $(PROJECT))$(if $(RUNTIME), --runtime $(RUNTIME))

# install runs install-kit first; the repository adds its own steps as prerequisites that depend on install-kit, such as
# install: app-install and app-install: install-kit. The links come last.
install: install-kit ## Install the tools and packages, then the steps of the repository, then the links; ONLINE
	$(MAKE) --no-print-directory install-link
install-kit: ## Install the mise, node and npm of mise.toml, the packages of package-lock.json, the tools and the declared symbol extractors, in that order; ONLINE
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory kit-install-declared
