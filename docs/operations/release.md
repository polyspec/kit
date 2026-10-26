<!-- doc-id: operations-release -->
# Release

[한국어](release.ko.md)

The procedure of a release of kit; the rules are those of AGENTS.md.

kit is released by tag `vX.Y.Z` on a commit of `main` whose CI run concluded `ci` success. `package.json` holds the version of the
tree. A repository adopts a release by updating `@polyspec/kit` in its package-lock and running `make install-packages` and
`make kit-sync`.

Consumers include `node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk`. On a clean checkout, the shared workflow first runs native `npm ci --ignore-scripts` through the exact npm version declared in `packageManager`, then runs the existing tool installation and package installation targets. It never clones a sibling kit checkout. A local `npm link ../kit` uses the same installed package path with the source bootstrap; kit itself uses its own source Makefile.

A release is cut in three steps. (1) A commit `chore(release): Release X.Y.Z` sets the version in `package.json` and
`package-lock.json` and turns the Unreleased section of `CHANGELOG.md(.ko)` into `## X.Y.Z`. The release commit also carries
the consumer locks: `make release-assets TAG=vX.Y.Z`, then `make release-consumer-lock TAG=vX.Y.Z` (ONLINE), and the manifests
and locks that it writes in `tests/release-consumer/*/` are committed with the version change, or in a following commit before
the tag (docs/operations/tool-inventory.md, Consumer install of the release archives, steps 1 and 2). The version change rewrites
`package-lock.json`, so the release commit also carries `config/dependency-review.json` that `make dependency-review RECORD=1`
(ONLINE) writes for it; CI runs `make dependency-policy-check`, which fails a lock that differs from the review (K169). A version
change of a composer.json likewise re-locks it with `composer update --lock` in its directory, since the content-hash of
`composer.lock` covers `version`; the check fails the lock that the change outdated (`composerLock`, K180, K181). The proof of the draft installs the
archives from those locks, so a tag without them fails. The commit lands on `main` and its CI concludes success; the tag goes
only on a commit whose CI concluded success and that holds those locks. (2) The release workflow is dispatched with the tag (`gh workflow run release.yml -f tag=vX.Y.Z`, or the workflow dispatch
of the GitHub API); its `make release-tag` creates the annotated tag at origin/main and pushes it, and passes when the tag is
there already (K269). A push of the tag starts the same workflow. (3) The run of `.github/workflows/release.yml`,
which is the vendored `workflows/release.yml` itself: it builds the npm archive of `@polyspec/kit` that `config/release.json`
declares, publishes it on the GitHub Release as a draft, proves it from a consumer project and makes it public. A repository
pins that asset's URL with its integrity.

A release tag is annotated: it is created with `git tag -a vX.Y.Z -m vX.Y.Z`. `release-verify` refuses a tag whose object
type (`git cat-file -t <tag>`) is not `tag`, with a line that names the tag and its kind (`commit` for a lightweight tag). A
published tag is not moved; the check runs only on the tag being released.

kit vendors the release workflow `workflows/release.yml` to `.github/workflows/release.yml` of every repository (`kit.copies` of
package.json). A repository never edits it, and `make kit-check` fails on a difference. The workflow sets up the PHP of `.php-version` when
the repository declares one, runs `make release-prepare` (the preparation that the repository's release declares with a
`release-prepare::` rule of its Makefile, none by default), `make release-tools` (the tools that config/release.json needs), `make release-tools-path` (which
puts `var/tools/bin` and the shims of mise on the PATH of the following steps and the environment of mise in theirs, so they run on the installed tools), `make release-publish` (the release as a draft, whose id it records in `var/release/<tag>.json`), `make release-proof TAG=<tag>` (the proof of the draft)
and `make release-undraft TAG=<tag>`, which makes the release public only after the proof passed. The proof and undraft read the
draft by that id, never by its tag in the list of releases, which shows a new draft only after a while. A failed step leaves the release a
draft and fails the run, so a release that cannot be installed is never public.

A package of kind `wheel` (a Python package with a `pyproject.toml`) is released as its PEP 427 wheel
`<distribution>-<version>-py3-none-any.whl`, the file name pip parses. `release-assets` builds it from the tagged commit with the
build backend that `pythonBackend` of config/toolchain.json, its one declaration, pins by its exact requirement and by the
sha256 of its wheel; `make install-tools` and `make release-backend` download that wheel into `var/tools/wheels` with the digest checked, and no build reads the network. A
wheel's `Requires-Dist` is a plain `name==version`, a direct reference to the release asset of a polyspec package with the sha256
fragment, or a direct reference without a hash to a sibling (another wheel package of the same config/release.json) of the same
release. The first two are held by the lock of the wheel (`consumers.wheel.lock`); a sibling never is. Any other form (a URL, a git
source, a range or a marker) is refused, as an npm or Composer manifest with the same form is (docs/operations/tool-inventory.md, Sibling wheels). `release-consumer` installs the lock with hashes, the
wheels of the release together with `--no-deps`, runs `pip check` and then the smoke command in a clean virtual environment. A Python package is not released as a git tag.
