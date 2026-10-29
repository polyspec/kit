<!-- doc-id: operations-release -->
# Release

[한국어](release.ko.md)

The procedure of a release of kit; the rules are those of AGENTS.md.

kit is released by tag `vX.Y.Z` on a commit of `main` whose CI run concluded `ci` success. `package.json` holds the version of the
tree. A repository adopts a release by updating `@polyspec/kit` in its package-lock and running `make install-packages` and
`make kit-sync`.

Consumers include `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`. On a clean checkout, the shared workflow first runs native `npm ci --ignore-scripts` through the exact npm version declared in `packageManager`, then runs the existing tool installation and package installation targets. It never clones a sibling kit checkout. A local `npm link ../kit` uses the same installed package path with the source bootstrap; kit itself uses its own source Makefile.

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
in its directory, since the content-hash of `composer.lock` covers `version`. The commit lands on `main` and its CI concludes success; only then can the real tag be
created on that commit. Build official assets from that tag with `make release-assets TAG=vX.Y.Z`; this path requires and reads the
actual tag and remains the only source for publication. (2) The release workflow is dispatched with the tag
(`gh workflow run release.yml -f tag=vX.Y.Z`, or the workflow
dispatch of the GitHub API); its `make release-tag` creates the annotated tag at origin/main and pushes it, and passes when the
tag is there already (K269). A push of the tag starts the same workflow. (3) The run of `.github/workflows/release.yml`,
which is the vendored `workflows/release.yml` itself: it builds the official npm archive from the tag, publishes it on the GitHub
Release as a draft and makes it public. A repository pins that asset's URL with its integrity.

A release tag is annotated: it is created with `git tag -a vX.Y.Z -m vX.Y.Z`. `release-verify` refuses a tag whose object
type (`git cat-file -t <tag>`) is not `tag`, with a line that names the tag and its kind (`commit` for a lightweight tag). A
published tag is not moved; the check runs only on the tag being released.

kit vendors the release workflow `workflows/release.yml` to `.github/workflows/release.yml` of every repository (`kit.copies` of
package.json). A repository never edits it; `make kit-sync` rewrites it. The workflow sets up the PHP of `.php-version` when
the repository declares one, runs `make release-prepare` (the preparation that the repository's release declares with a
`release-prepare::` rule of its Makefile, none by default), `make release-tools` (the tools that config/release.json needs), `make release-tools-path` (which
puts `var/tools/bin` and the shims of mise on the PATH of the following steps and the environment of mise in theirs, so they run on the installed tools), `make release-publish` (the release as a draft, whose id it records in `var/release/<tag>.json`)
and `make release-undraft TAG=<tag>`, which makes the release public. undraft reads the
draft by that id, never by its tag in the list of releases, which shows a new draft only after a while. A failed step leaves the release a
draft and fails the run.

A package of kind `wheel` (a Python package with a `pyproject.toml`) is released as its PEP 427 wheel
`<distribution>-<version>-py3-none-any.whl`, the file name pip parses. `release-assets` builds it from the tagged commit with
`uv build --wheel`, which installs the `[build-system].requires` of the package's own pyproject.toml into an isolated build
environment; kit pins no build backend (K788). A
wheel's `Requires-Dist` is a plain `name==version`, a direct reference to the release asset of a polyspec package with the sha256
fragment, or a direct reference without a hash to a sibling (another wheel package of the same config/release.json) of the same
release. uv and pip resolve these forms when a consumer installs the wheel (docs/operations/tool-inventory.md, Sibling wheels). A Python package is not released as a git tag.

A release with a package of kind `composer` also publishes `packages.json` beside the archives (K871): one flat Composer repository, since release assets hold no folder. It holds each Composer package of config/release.json under its name and version as its composer.json of the commit, with a dist of type zip whose URL is the release asset of its zip and whose shasum is the sha1 of that zip. A consumer declares `{ "type": "composer", "url": "<repositoryUrl>/releases/download/vX.Y.Z/packages.json" }`; Composer reads a URL whose path contains `.json` as the file itself, and it reads the package metadata from that file, so the consumer names only the tag. The packages.json of `release-candidate-assets VERSION` names the asset URLs of the release `vVERSION`, which exist only once that release is published. Composer tooling does not write this form: Satis writes `p2/<vendor>/<name>.json` for its metadata-url and re-archives a package for a dist URL, and `composer archive` writes no repository.
