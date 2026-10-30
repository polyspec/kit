<!-- doc-id: operations-release -->
# Release

[한국어](release.ko.md)

The procedure of a release of kit; the rules are those of AGENTS.md.

kit is released by tag `vX.Y.Z` on a commit of `main` whose CI run concluded `ci` success. `package.json` holds the version of the
tree. A repository adopts a release by updating `@polyspec/kit` in its package-lock and running `make install-packages` and
`make kit-sync`.

Consumers include `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`. On a clean checkout, the shared workflow first runs native `npm ci --ignore-scripts` through the npm version that `devEngines.packageManager` declares, then runs the existing tool installation and package installation targets. It never clones a sibling kit checkout. A local `npm link ../kit` uses the same installed package path with the source bootstrap; kit itself uses its own source Makefile.

Kit's native npm prepack maps its source exports and hook bin to built dist paths. The asset gate applies the same canonical producer transformation to the tagged kit manifest and compares every resulting byte; other package manifests remain byte-exact. The existing packed-consumer test runs that gate with its single native pack and installs the resulting archive. The native consumer lock can resolve compatible transitive versions differently from the development lock, so npm audit checks both exact locked graphs.

The public module subpaths include `glob`, `parity-declaration`, `land`, `parity`, `checklist` and `php-extension`, alongside the existing tool modules. A source checkout resolves each subpath to `scripts/kit/<name>.mts`; a packed consumer resolves the same subpath to `dist/<name>.mjs`. The packed-consumer test imports each public subpath from the installed archive and compares its exported names with the source module.

Later changes do not invalidate an earlier release's evidence. Finish the current version from its own successful CI, then bump the next version and validate it separately. A local main commit is not automatically part of a remote release: check the remote candidate and its CI. Implementation completion and owning tests do not mean publication; update a release checklist item only after the release is public.

A release is prepared and cut in three steps. (1) A commit `chore(release): Release X.Y.Z` sets the version in every release
manifest and lock, and turns the Unreleased section of `CHANGELOG.md(.ko)` into `## X.Y.Z`. Commit the version before packing:
the native packers may run package lifecycle scripts that restore version files from `HEAD`. Build all tagless candidate archives
from committed `HEAD` with `make release-candidate-assets VERSION=X.Y.Z`. This uses the same manifest validation, generated-file
handling and native packers as the tagged asset producer; it neither resolves nor creates a tag. Run
the candidate command from a clean tracked tree with no non-ignored untracked files, because package lifecycle scripts can read
build inputs outside their package directories. Commit source changes and rerun the candidate command when this check refuses.
The version change rewrites package-manager locks. A version change of a composer.json re-locks it with `composer update --lock`
in its directory, since the content-hash of `composer.lock` covers `version`. The commit lands on `main` and its CI run of `.github/workflows/ci.yml` concludes success. (2) The release workflow is
dispatched with the id of that run alone (`gh workflow run release.yml -f run=<id>`, or the workflow dispatch of the GitHub API);
no push of a tag starts it. Its `make release-tag` (`release-run tag RUN`) checks the format of the run id and the repository of
config/release.json, reads the run with `gh api`, requires a completed successful push or dispatch run of ci.yml on `main` whose
commit is on `origin/main`, reads `changelog` and `goModules` of config/release.json at that commit (`git show`), checking those two fields alone, and X.Y.Z from the first section `## X.Y.Z` of its change log there,
refuses a commit whose change log has none or has entries under `## Unreleased`, and tags that commit, then appends `TAG=vX.Y.Z` and `VERSION=X.Y.Z` to
`GITHUB_ENV` for the steps that follow (K924): it checks `vX.Y.Z` and the tag
`<directory>/vX.Y.Z` of every Go module below the root first, stops when one of them is at another commit, creates the missing
ones as annotated tags (`git tag -a vX.Y.Z -m vX.Y.Z`) and pushes them in one push; a tag at that commit already passes (K911).
No test runs again: the evidence is the CI run that the id names. (3) The run of `.github/workflows/release.yml`, which is the
vendored `workflows/release.yml` itself, then checks out the tag, builds the official assets from it with
`make release-assets TAG=vX.Y.Z`, the only source for publication, publishes them on the GitHub Release as a draft and makes it
public. A repository pins that asset's URL with its integrity. A published tag is never moved.

kit vendors the release workflow `workflows/release.yml` to `.github/workflows/release.yml` of every repository (`kit.copies` of
package.json). A repository never edits it; `make kit-sync` rewrites it. The workflow sets up the PHP of `.php-version` when
the repository declares one, runs `make release-tag` on `main`, checks out the tag and installs the kit and the packages of the
tag, then runs `make release-prepare` (the preparation that the repository's release declares with a
`release-prepare::` rule of its Makefile, none by default), `make release-tools` (the tools that config/release.json needs; a make entry adds none), `make release-tools-path` (which
puts `var/tools/bin` and the shims of mise on the PATH of the following steps and the environment of mise in theirs, so they run on the installed tools), `make release-publish` (the release as a draft, whose id it records in `var/release/<tag>.json`)
and `make release-undraft TAG=<tag>`, which makes the release public. undraft reads the
draft by that id, never by its tag in the list of releases, which shows a new draft only after a while. A failed step leaves the release a
draft and fails the run.

A package that needs generated output declares each generated path in config/release.json as a `make` entry, with the target that produces it and its outputs. The pack (`make release-assets` and `make release-candidate-assets`) first refuses a checkout that differs from the commit it packs: HEAD is not the tagged commit (a candidate packs HEAD itself), a tracked or untracked path is changed, or a dependency of the checkout is linked from outside it (K939). It then deletes each declared output, runs `make <target>` in the checkout with the tools of the checkout on its PATH (toolsEnvironment), so the target calls `php-config` itself and the Makefile includes the kit that the checkout installs, and stages the outputs; afterwards it deletes them from the checkout again, so a declared path that the checkout held before the pack is removed by it. A changed or untracked path that the target leaves other than a declared output fails the pack and is named (K939). An npm package refuses a make entry: npm builds its output in the prepack script of its package.json. The target installs what it needs itself, through the lock of its repository; kit checks no lock and starts no package manager for it. The make run's PATH holds the tools of the checkout first, then the PATH of the machine. A repository whose target needs the PHP of mise installs it in its `release-prepare::` rule, for example with `make install-tools TOOLS="php"`. A `gen_stub.php` of the PHP may fetch its own pinned PHP-Parser once into `var/php-ext/gen-stub/` of the tree that builds it, which P35 does not cover since it is a tool's internal fetch. Each declared output must exist after its target and must not be tracked in Git; otherwise the pack fails and names the path (K930, K939, P34).

A package of kind `wheel` (a Python package with a `pyproject.toml`) is released as its PEP 427 wheel
`<distribution>-<version>-py3-none-any.whl`, the file name pip parses. `release-assets` builds it from the tagged commit with
`uv build --wheel`, which installs the `[build-system].requires` of the package's own pyproject.toml into an isolated build
environment; kit pins no build backend (K788). A
wheel's `Requires-Dist` is a plain `name==version`, a direct reference to the release asset of a polyspec package with the sha256
fragment, or a direct reference without a hash to a sibling (another wheel package of the same config/release.json) of the same
release. uv and pip resolve these forms when a consumer installs the wheel (docs/operations/tool-inventory.md, Sibling wheels). A Python package is not released as a git tag.

A release with a package of kind `composer` also publishes `packages.json` beside the archives (K871): one flat Composer repository, since release assets hold no folder. It holds each Composer package of config/release.json under its name and version as its composer.json of the commit, with a dist of type zip whose URL is the release asset of its zip and whose shasum is the sha1 of that zip. A consumer declares `{ "type": "composer", "url": "<repositoryUrl>/releases/download/vX.Y.Z/packages.json" }`; Composer reads a URL whose path contains `.json` as the file itself, and it reads the package metadata from that file, so the consumer names only the tag. The packages.json of `release-candidate-assets VERSION` names the asset URLs of the release `vVERSION`, which exist only once that release is published. Composer tooling does not write this form: Satis writes `p2/<vendor>/<name>.json` for its metadata-url and re-archives a package for a dist URL, and `composer archive` writes no repository.
