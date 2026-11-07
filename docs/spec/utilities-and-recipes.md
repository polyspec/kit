<!-- doc-id: spec-utilities-and-recipes -->
# Utilities and examples

[한국어](utilities-and-recipes.ko.md)

## Problem

kit enforces recipes. It includes one recipe set into every repository (`scripts/kit/kit.mk`, `scripts/kit/kit-bootstrap.mk`, until K1054), and it requires the results of its checks in the shared CI. A recipe set shared by every repository has to cover each repository's case, so each new case became a branch, a switch or an override in the shared block, such as `UV_NO_CONFIG`, `MISE_*`, `unexport CARGO_TARGET_DIR`, `INSTALL_PACKAGES_EXTRA` and `npm_config_allow_remote=root`. An override on the command line or in the environment outranks the repository's own configuration. A required check refuses a case it did not foresee. Either way, the repository's only move is a workaround.

The allow-remote case shows the chain:
1. kit forced `allow-remote=root` until K1045.
2. npm refuses a URL dependency that a provider names.
3. The provider falls back to bare versions that no registry serves.
4. Each consumer declares those packages at its root, pins them again in `overrides`, and silences knip's correct "unused dependency" finding.

## What kit provides

1. **Utilities.** A utility is a script whose behaviour is set by the arguments and files it is given: a tool installer, a checker, a parity tool, a release tool. Some utilities run a repository's recipes: they run the targets that the repository names, such as the CI target runner (`ci-targets`), the worktree setup that runs the repository's own install, and the test runner. A repository runs the utilities it wants, from its own recipes. A utility runs a recipe as it is written: a wrong recipe runs wrong, and the utility does not judge it. A utility stops only when it cannot do its own job, such as a missing tool, or land on a main checkout with uncommitted changes.
2. **Examples.** `docs/examples/` shows how the repositories commonly do their work, one working example per topic:
   - how to lay out a row's worktree and work in it
   - how to write recipes: install, build, test, lint and release targets in a Makefile that run the utilities
   - how to state native settings: `.npmrc`, `uv.toml`, the `[settings]` of `mise.toml`, `.cargo/config.toml`
   - how to write the CI workflow
   - how to link sibling checkouts during development
   - how to run a checklist row from Red to commit

   An example shows one working way. A repository copies it, changes it, or ignores it.

## What kit does not do

kit forces nothing. In particular:

- kit includes no recipe into a repository.
- kit sets no setting of another tool, on the command line, in the environment, or in the environment of the tools a utility starts. A tool installer states where it puts what it installs, and that is its own job: the installer of mise names the directories of the mise it installs and the configuration file of the checkout that its shims read (`MISE_DATA_DIR`, `MISE_CACHE_DIR`, `MISE_STATE_DIR`, `MISE_CONFIG_DIR`, `MISE_GLOBAL_CONFIG_FILE`, `MISE_GLOBAL_CONFIG_ROOT`), and the Go that builds a tool under `var/tools` gets its own module cache and checksum database (`GOPATH`, `GOCACHE`, `GOFLAGS`, `GOSUMDB`). None of these chooses how the repository's tools behave. In the same way the lint of PHP gives PHPStan no memory limit (`--memory-limit=-1`), a limit of the process that PHPStan reads from no configuration file, and the autoloader that the package's Composer wrote (`--autoload-file`).
- kit requires no result in a repository's CI, hook or gate.
- kit provides no check of a repository's recipes or examples.

## Reasoning

- Each forced setting and each required result removed a choice from a repository. When the repository's case differed from what kit foresaw, the repository had nothing left but a workaround. Every override listed under Problem came from that.
- A repository's own recipe states its one case, so it needs no branch. A tool reads its native file as the tool documents it.
- An example passes on a working way without binding anyone to it.
- A check of recipes would be a new rule that kit sets over repositories, which is the same enforcement again.

## Consequence for kit

kit removes what it forces, each change as a checklist row with its Red, Green and commit. These are the forced parts today:
- **Included recipes.** Until K1054 repositories included the recipe set of `scripts/kit/kit.mk` and `scripts/kit/kit-bootstrap.mk` from the package, and AGENTS.md stated the mise environment of every recipe of kit.mk for them. The package now ships no make file: kit.mk is the recipe set of kit's own Makefile, the bootstrap is the example `docs/examples/bootstrap.mk`, and the toolchain-lock recipe names no UV_PYTHON, which the `[env]` of `mise.toml` decides.
- **Overrides inside utilities.** `bootstrap/install-mise.mts` (`miseEnvironment`) and `mise-tools.mts` (`toolsEnvironment`) set the settings of mise and uv (`MISE_LOCKED`, `MISE_AUTO_INSTALL`, `UV_*`, `UV_PYTHON`) for the tools they start until K1048, and `link.mts` and `run-tests.mts` deleted `CARGO_TARGET_DIR` until K1049. Until K1050 the lint utilities ran each tool with kit's configuration in place of the repository's own: golangci-lint with kit's `.golangci.yml`, phpcs with kit's `phpcs.xml.dist`, ruff with kit's `ruff.toml`, clippy with `CLIPPY_CONF_DIR` set to kit, and oxlint and knip with kit's `.oxlintrc.json` and `knip.json`.
- **Checks of a repository's recipes and workflows.** Until K1051 kit-check judged how recipes start tools (`recipe-tools.mts`), link steps in Makefiles and workflows (S11), the shape of ci.yml and its final `ci-passed` job (S12), `$(KIT)/<name>` in Makefiles (S15) and manifest paths (P30), and bypass-check judged Makefiles and scripts. kit-check now validates only the config files of kit's own schemas.
- **Vendored copies.** Until K1052 kit-sync wrote every entry of `kit.copies` in kit's package.json into every repository, among them `PRINCIPLES.md` and its twin, `ci-pipeline.yml`, `release.yml`, the bootstrap action, `config/layout.kit.yml`, the schemas under `config/`, `.editorconfig` and `.claude/settings.json`; kit-inject-check failed a changed copy, so the closing `required` job of the vendored pipeline bound every repository to the results of every job of the pipeline, the `kit-gates-*` gates among them. The package now ships these files as examples: a repository copies the ones it wants and owns each copy, its pipeline and that job included, and kit writes and compares none. The owner rules of kit.owners for those files, the copy exclusions of lint-ts and rebuild-check, the edit refusal of claude-hook for a copy, and the layout rule `lint-cargo-lints` with `config/cargo.schema.json` went with them.
- **Refusals.**
  - The Claude hook of `.claude/settings.json` (`claude-hook.mts`) refuses commands in every repository's sessions.
  - The git hooks that `make hooks` writes refuse commits: the commit-msg hook and the staged-generated hook, which the `commit` target also runs.
  - `ci-targets` with FINAL_RUN refuses a tree with open checklist items.
  - `land` refuses a branch whose static gates fail, and it requires its fixed gates among the prerequisites of the repository's `kit-gates`.
  - `item-state` refuses done without a changelog line.
  - `ci-setup` refuses a setup target that runs `kit-ci-setup` again.
- **Rule texts.** The `Enforced by:` lines of PRINCIPLES that name these checks (S11, S12, S13 and S15 among them) change with the removals, so the shipped PRINCIPLES never claims a check that kit no longer forces.

A part that works becomes an example in `docs/examples/` in the same change that removes it from kit. The removal ships in a new patch release of kit. A repository pins the kit release it installs, so it keeps its current release until it adopts the new one, and then writes its own recipes from the examples.
