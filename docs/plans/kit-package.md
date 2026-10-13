<!-- doc-id: kit-package -->
# kit as a package (K71-2)

[한국어](kit-package.ko.md)

Status: design agreed with the kit maintainer session on 2026-10-13 (review findings 1–7 applied). Work in progress.

## Why

kit is distributed today as byte copies: `make kit-sync KIT_TAG=` clones a kit tag and copies `scripts/kit/`, `tests/kit/`
and the files of `vendoredFiles` into the repository, and `.kit/kit.lock.json` records their sha256. A copied tool can
import only Node built-ins (`kit/AGENTS.md`) because a copy resolves an outside module from the repository that holds it,
so kit rebuilt a JSON Schema validator, a TOML reader, version comparison and a commit linter (plan: S1). kit also cannot
publish its TypeScript as checked JavaScript to a consumer under `node_modules`, where Node does not strip types (S9).

K71-2 makes kit the npm package `@polyspec/kit`. A repository installs it as one devDependency pinned by package-lock, and
its make targets run the built tools from `node_modules`. This removes the byte copies of the tools, so K73 can replace the
rebuilt tools with libraries that the package declares.

## What a repository holds after the switch

| Today | After |
|---|---|
| `scripts/kit/*.mts`, `tests/kit/*.mts` (copies) | gone; the tools are `node_modules/@polyspec/kit/dist/*.mjs` |
| `.kit/kit.lock.json` | gone; package-lock pins the version and its integrity |
| `include scripts/kit/kit.mk` | `include scripts/kit/kit-bootstrap.mk` (a copy), which includes the package's `kit.mk` |
| `make kit-sync KIT_TAG=` (git clone) | `make kit-sync` copies the files that must stay in the repository from the installed package |
| `make kit-test` (runs kit's tests in the repository) | gone; kit tests its package in a consumer layout in its own CI |

The files that stay copies, because they must exist before the package is installed or must sit at a fixed path:

- `scripts/kit/kit-bootstrap.mk`: stops with an error that names `make install-tools TOOLS=npm` and `make install-packages`
  while `node_modules/@polyspec/kit/dist/kit.mk` is absent; otherwise it includes it. No silent `-include`.
- The installer of the pinned npm and its imports (`install-npm`, `install-tool`, `tool-wrappers`, `digest`, `files`, and
  `toolchain-declared`, the one reader of `packageManager` and `.node-version`) under `scripts/kit/bootstrap/`, run by `make install-tools TOOLS=npm` before `npm ci`. The pinned npm must
  install the lock, because another npm can rewrite or refuse it (S4: tools run at their pins).
- `.github/workflows/release.yml`, `PRINCIPLES.md(.ko)` and the lint configuration (K77): fixed paths that their tools read.

## Bootstrap order

1. `make install-tools TOOLS=npm` (the copied bootstrap installer) first checks that the running node is the version of
   `.node-version` and stops naming both versions otherwise; then it installs the npm of `packageManager` into
   `var/tools`. Online.
2. `make install-packages` (in `kit-bootstrap.mk`) runs `var/tools/bin/npm ci`, kit included. Online, marked `$(ONLINE)`
   like every downloading target.
3. Every other target runs from the package and stays offline after step 2: `make install-tools` for the other tools,
   the checks, the release steps.

**One source per pin (S4).**
- npm: `packageManager` of `package.json` is the only declaration; `install-npm` and `toolchain-declared` already read it
  there, and `config/toolchain.json` holds no npm key. `check-toolchain` compares the installed npm with it.
- Node: `.node-version` is the pin. `engines.node` of every `package.json`, kit's included, is `>=` that version (the floor
  equals the pin), and `check-toolchain` fails while they differ.

CI and the release workflow run in that order; the consumer-layout successor test proves the order of `release.yml`.

## kit itself

- `package.json`: name `@polyspec/kit`, `type: module`, `exports` of the tool modules a repository may import, no `bin`
  unless a tool is run by name, and an explicit `files` list, so the tarball is reviewable and kit-check has a fixed list:
  `dist/` (the build also copies `scripts/kit/kit.mk` and `scripts/kit/schema/` into it, so the tools find `$(KIT)/schema`
  and a repository includes `node_modules/@polyspec/kit/dist/kit.mk`), and the copied files `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/*`,
  `workflows/release.yml`, `PRINCIPLES.md`, `PRINCIPLES.ko.md`, `config/layout.kit.yml` (K76) and the lint configuration
  files of K77 as they land.
- `tsconfig.build.json`: `scripts/kit/**/*.mts` to `dist/` with `rewriteRelativeImportExtensions`; `tsc` 7.
- Sources stay in `scripts/kit/` (the kit repository runs them directly, as today); `dist/` is a build output, ignored by
  git.
- The release builds the tarball with `npm pack` and attaches it to the GitHub release, as the polyspec packages do
  (`config/release.json` of kit declares the package, with work steps 3–4); a repository pins the asset URL and its
  integrity.
- kit's own Makefile includes `scripts/kit/kit.mk` with `KIT := scripts/kit` and runs the sources; a repository's
  `kit-bootstrap.mk` sets `KIT := node_modules/@polyspec/kit/dist`. `kit.mk` names every tool as `$(KIT)/<tool>`, with the
  extension that matches (`.mts` in kit, `.mjs` in dist).

## Checks

- `kit-check` compares the copied files with the files of the installed package byte for byte, and fails while the version of
  the installed package differs from the version package-lock resolves for `@polyspec/kit`.
- The consumer-layout successor test packs kit, primes an npm cache with the tarball and its dependencies, installs it
  offline into a sandbox consumer, and runs the bootstrap order and the gate targets there.
- `kit-test` runs in kit only.

## Order of work

1. Package build (`tsconfig.build.json`, `package.json`).
2. `kit.mk` with `$(KIT)`, `kit-bootstrap.mk`, the bootstrap copies, `kit-sync` and `kit-check` from the installed package.
3. The consumer-layout successor test, offline.
4. kit's CI and release workflow in the bootstrap order, and kit's `config/release.json` with its release asset.
5. One kit release; the repositories switch in K79, each announced to its owning session.

Until the release that carries the switch, the copies stay at their paths, so no repository breaks before it moves.

## What the repositories reference today

A scan of every repository that K79 switches, outside its copies (2026-10-13): crudui, fsm, hyper, ordered-json, orm,
template and flowmark (`~/Projects/flowmark`, on kit v0.0.34); ssr and template-benchmark adopt kit for the first time in
K79 and reference no kit path yet.
- Code imports one kit module: `tracked-files`. The package exports it, and the importing script imports the package.
- Every repository names kit tool paths in `.githooks/*` (written by `git-hooks`), its `Makefile`, its CI and release
  workflows, and its `config/owner-checks.json` and `config/dependency-review.json`; flowmark also in
  `tests/check-refs.test.mjs`. Each switch (K79) rewrites them to
  `$(KIT)` targets or to the package path, and the owner checks of each repository prove the hooks and workflows.

## Rulings

- `install-tools` for every tool other than npm runs from the package, after the bootstrap installed npm and the lock.
- `git-hooks` writes hooks that call make targets, not tool paths: a make target is the stable interface across kit
  versions, and a tool path is not (agreed with the kit maintainer session).
- This document lands as the first commit of K71-2, before the work that depends on it; K71-1 stays the rename and the
  types.

### Rulings of the work (2026-10-13)

- `kit.mk` runs every tool as `node $(KIT)/<tool>.$(KIT_EXT)` and stops with an error while either is unset. kit's Makefile
  sets `KIT := scripts/kit` and `KIT_EXT := mts`; `kit-bootstrap.mk` sets `KIT := node_modules/@polyspec/kit/dist` and
  `KIT_EXT := mjs`. `kit-test` moves from `kit.mk` to kit's Makefile, since a repository no longer holds `tests/kit`.
- A tool that starts another tool names it through one helper of `paths.mts`, the directory and the extension of the
  calling module, so it works from the sources and from `dist`.
- `ROOT` of the tools is the working directory, the repository root that every make target runs in, not a path derived
  from the module's own location.
- `kit-bootstrap.mk` defines `install-tools` for `TOOLS=npm` only and `install-packages` while the package is absent, and
  stops any other goal with `node_modules/@polyspec/kit/dist/kit.mk is missing; run make install-tools TOOLS=npm, then make
  install-packages`.
- The six bootstrap modules move to `scripts/kit/bootstrap/` in kit, and the other tools import them there: one copy,
  never two. They ship as sources (run outside `node_modules`) and build into `dist/bootstrap/`.
- The copy items are declared in `package.json` as `"kit": { "copies": { "<repository path>": "<package path>" } }`,
  each source also in `files`. `kit.json` is removed: `package.json` is the one source of kit's version and its copies.
- `kit-check` needs no recorded version in a copy: it fails while the installed package version differs from the version
  package-lock resolves, and while a copy differs byte for byte from the installed package's file. Both together tie
  the copies to the locked version.
- kit's own `config/release.json` and its release asset follow with the consumer-layout successor (work step 3–4): the
  package directory is the repository root, which the release schema does not accept today.

## Dependencies of kit in a consumer

Once K73 adds libraries to the package, they are transitive dependencies of every consumer. A consumer reviews its whole
lock as it does for any dependency today (orm's dependency-policy-check requires a record per package); kit adds no
trust mechanism of its own. kit's release notes list the dependency tree of the package, and each switch in K79 adds
the review records of the new packages.
