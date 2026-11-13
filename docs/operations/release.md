<!-- doc-id: operations-release -->
# Release

[한국어](release.ko.md)

The procedure of a release of kit; the rules are those of AGENTS.md.

kit is released by tag `vX.Y.Z` on a commit of `main` whose CI run concluded `ci` success. `package.json` holds the version of the
tree. A repository adopts a release by updating `@polyspec/kit` in its package-lock and running `make install-packages`.

A repository keeps its recipes in its own Makefile; the package ships no make file (K1054). On a clean checkout, the shared workflow first runs native `npm ci --ignore-scripts` of the npm version that `devEngines.packageManager` declares, from a temporary folder outside the checkout with `--prefix`, since npm 11 refuses to run in a folder whose devEngines names another version (K938-1); then it runs the existing tool installation and package installation targets. It never clones a sibling kit checkout. A local link of `../kit` uses the same installed package path; kit itself uses its own source Makefile.

Kit's native npm prepack maps its source exports and hook bin to built dist paths. The asset gate applies the same canonical producer transformation to the tagged kit manifest and compares every resulting byte; other package manifests remain byte-exact. The existing packed-consumer test runs that gate with its single native pack and installs the resulting archive. The native consumer lock can resolve compatible transitive versions differently from the development lock, so npm audit checks both exact locked graphs.

The public module subpaths include `glob`, `land`, `checklist` and `php-extension`, alongside the existing tool modules. A source checkout resolves each subpath to `scripts/kit/<name>.mts`; a packed consumer resolves the same subpath to `dist/<name>.mjs`. The packed-consumer test imports each public subpath from the installed archive and compares its exported names with the source module.

Later changes do not invalidate an earlier release's evidence. Finish the current version from its own successful CI, then bump the next version and validate it separately. A local main commit is not automatically part of a remote release: check the remote candidate and its CI. Implementation completion and owning tests do not mean publication; update a release checklist item only after the release is public.

A release is prepared and cut in three steps. (1) A commit `chore(release): Release X.Y.Z` sets the version in every release
manifest and lock, and turns the Unreleased section of `CHANGELOG.md(.ko)` into `## X.Y.Z`. Commit the version before packing:
the native packers may run package lifecycle scripts that restore version files from `HEAD`. Build all tagless candidate archives
from committed `HEAD` with `make release-candidate-assets VERSION=X.Y.Z`. This uses the same manifest validation, generated-file
handling and native packers as the tagged asset producer; it neither resolves nor creates a tag. Run
the candidate command from a clean tracked tree with no non-ignored untracked files, because package lifecycle scripts can read
build inputs outside their package directories. Commit source changes and rerun the candidate command when this check refuses.
The version change rewrites package-manager locks. A version change of a composer.json re-locks it with `composer update --lock`
in its directory, since the content-hash of `composer.lock` covers `version`. The commit passes a CI workflow of the repository on its development branch or on `main`, and is included in the history of `origin/main` before release. The release tags that exact successful commit even when main has advanced; integration does not require repeating its CI. (2) The release workflow is
dispatched with the id of that run alone (`gh workflow run release.yml -f run=<id>`, or the workflow dispatch of the GitHub API);
no push of a tag starts it. Its `make release-tag` (`release-run tag RUN`) checks the format of the run id,
reads the run of the repository of config/release.json with `gh api`, requires a completed successful push or dispatch run of a CI workflow of the repository whose
commit is on the main ref that the caller names in `RELEASE_MAIN` (a remote-tracking ref `<remote>/<branch>`, which it fetches; a call that names none exits 2, and kit.mk names `origin/main` for kit; K1102), reads `changelog` and `goModules` of config/release.json at that commit (`git show`), checking those two fields alone, and X.Y.Z from the first section `## X.Y.Z` of its change log there,
refuses a commit whose change log has none, or has entries under `## Unreleased` where config/documents.json of that commit names the changelog rule `unreleased-empty-at-release` (K1084), and tags that commit, then appends `TAG=vX.Y.Z` and `VERSION=X.Y.Z` to
`GITHUB_ENV` for the steps that follow (K924): it checks `vX.Y.Z` and the tag
`<directory>/vX.Y.Z` of every Go module below the root first, stops when one of them is at another commit, creates the missing
ones as annotated tags (`git tag -a vX.Y.Z -m vX.Y.Z`) and pushes them in one push; a tag at that commit already passes (K911), a lightweight one
too unless `annotatedTags` of config/release.json names the repository's rule that a release tag is annotated (K1084).
No test runs again: the evidence is the CI run that the id names. (3) The run of `.github/workflows/release.yml`, which is the
vendored `workflows/release.yml` itself, then checks out the tag, builds the official assets from it with
`make release-assets TAG=vX.Y.Z`, the only source for publication, publishes them on the GitHub Release as a draft and makes it
public. A repository pins that asset's URL with its integrity. A published tag is never moved.

kit ships the release workflow `workflows/release.yml` as an example; a repository that wants it copies it to
`.github/workflows/release.yml` and owns the copy (K1052). The workflow sets up the PHP of `.php-version` when
the repository declares one, runs `make release-tag` on `main`, checks out the tag and installs the kit and the packages of the
tag, then runs `make release-prepare` (the preparation that the repository's release declares with a
`release-prepare::` rule of its Makefile, none by default), `make release-tools` (the tools that config/release.json needs; a make entry adds none), `make release-tools-path` (which
puts `var/tools/bin` and the shims of mise on the PATH of the following steps and the environment of mise in theirs, so they run on the installed tools), `make release-publish` (the release as a draft, whose id it records in `<tag>.json` of the folder that `RELEASE_RECORDS` names, `var/release` in kit.mk; K1115)
and `make release-undraft TAG=<tag>`, which makes the release public. undraft reads the
draft by that id, never by its tag in the list of releases, which shows a new draft only after a while. A failed step leaves the release a
draft and fails the run.

A package that needs generated output declares each generated path in config/release.json as a `make` entry, with the target that produces it and its outputs. The pack (`make release-assets` and `make release-candidate-assets`) first refuses a checkout that differs from the commit it packs: HEAD is not the tagged commit (a candidate packs HEAD itself), a tracked or untracked path is changed, or a dependency of the checkout is linked from outside it (K939). It then deletes each declared output, runs `make <target>` in the checkout with the environment of its caller, whose PATH names the tools of the checkout (K1093), so the target calls `php-config` itself and the Makefile includes the kit that the checkout installs, and stages the outputs; afterwards it deletes them from the checkout again, so a declared path that the checkout held before the pack is removed by it. A changed or untracked path that the target leaves other than a declared output fails the pack and is named (K939). An npm package refuses a make entry: npm builds its output in the prepack script of its package.json. The target installs what it needs itself, through the lock of its repository; kit checks no lock and starts no package manager for it. The make run's PATH holds the tools of the checkout first, then the PATH of the machine. A repository whose target needs the PHP of mise installs it in its `release-prepare::` rule, for example with `make install-tools TOOLS="php"`. A `gen_stub.php` of the PHP may fetch its own pinned PHP-Parser once into `var/php-ext/gen-stub/` of the tree that builds it, which P35 does not cover since it is a tool's internal fetch. Each declared output must exist after its target and must not be tracked in Git; otherwise the pack fails and names the path (K930, K939, P34).

A package of kind `wheel` (a Python package with a `pyproject.toml`) is released as its PEP 427 wheel
`<distribution>-<version>-py3-none-any.whl`, the file name pip parses. `release-assets` builds it from the tagged commit with
`uv build --wheel`, which installs the `[build-system].requires` of the package's own pyproject.toml into an isolated build
environment; kit pins no build backend (K788). A
wheel's `Requires-Dist` is a plain `name==version`, a direct reference to the release asset of a polyspec package with the sha256
fragment, or a direct reference without a hash to a sibling (another wheel package of the same config/release.json) of the same
release. uv and pip resolve these forms when a consumer installs the wheel (docs/operations/tool-inventory.md, Sibling wheels). A Python package is not released as a git tag.

A release with a package of kind `composer` also publishes `packages.json` beside the archives (K871): one flat Composer repository, since release assets hold no folder. It holds each Composer package of config/release.json under its name and version as its composer.json of the commit, with a dist of type zip whose URL is the release asset of its zip and whose shasum is the sha1 of that zip. A consumer declares `{ "type": "composer", "url": "<repositoryUrl>/releases/download/vX.Y.Z/packages.json" }`; Composer reads a URL whose path contains `.json` as the file itself, and it reads the package metadata from that file, so the consumer names only the tag. The packages.json of `release-candidate-assets VERSION` names the asset URLs of the release `vVERSION`, which exist only once that release is published. Composer tooling does not write this form: Satis writes `p2/<vendor>/<name>.json` for its metadata-url and re-archives a package for a dist URL, and `composer archive` writes no repository.

## Per-platform assets (K1189)

A Rust core and its generated bindings are released as per-platform assets: an abi3 wheel, a PHP extension, an npm package
for each platform and a Go static library. config/release.json declares them with four package kinds, each with
`platforms`, a list of the platforms it is built for: `linux-x64-gnu`, `linux-arm64-gnu` and `darwin-arm64`, the names that
napi-rs gives these platforms. kit builds each with the tool of its ecosystem and pins none of them (S4):

| Kind | Manifest | Tool | Asset |
|---|---|---|---|
| `wheel-abi3` | `pyproject.toml` | `uv build --wheel`, which runs the maturin of `[build-system].requires`, with `MATURIN_PEP517_ARGS=--locked` | the PEP 427 wheel that maturin names, `<distribution>-<version>-cp<NN>-abi3-<platform tag>.whl`: a `manylinux` tag on Linux, a `macosx` tag on macOS |
| `php-ext` | `composer.json` | `cargo build --release --locked -p <package of Cargo.toml>`, with the `php` and `php-config` of the checkout in `PHP` and `PHP_CONFIG` | the PIE pre-packaged binary `php_<extension>-v<version>_php<X.Y>-<arch>-<os>-<libc>[-debug]-<nts\|zts>.zip`, which holds `<extension>.so` |
| `npm-native` | `package.json` | the napi CLI of the repository (`node_modules/.bin/napi`): `napi build --platform --release`, `napi create-npm-dirs`, `napi artifacts`, then `npm pack` | the root package `<scope>-<name>-<version>.tgz` and one platform package `<scope>-<name>-<platform>-<version>.tgz` for each platform, as npm pack names them |
| `go-static` | `Cargo.toml` | `cargo build --release --locked -p <package>` | `<vendor>-<product>-go-<version>-<platform>.zip`, which holds the `lib<name>.a` that cargo writes |

A `php-ext` package also declares `php`, the PHP minors it is built for (`["8.4", "8.5"]`), since the extension ABI differs for
each minor. Its composer.json names `php-ext.extension-name` and lists `pre-packaged-binary` in `php-ext.download-url-method`,
so that PIE looks for the binary among the assets of the release. PIE finds that release by the version of the package
(`releases/tags/<version>`) and names the asset with the same version, so packages.json lists a `php-ext` package under the
version `vX.Y.Z`, the tag, with the dist of the source archive of the tag (`https://api.github.com/repos/<owner>/<repository>/zipball/vX.Y.Z`).
An `npm-native` package names `napi.binaryName` and `napi.targets` in its package.json, the configuration that the napi CLI reads;
the targets are the Rust triples of its platforms (`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `aarch64-apple-darwin`),
and its `optionalDependencies` name `<name>-<platform>` at the version of the release for each platform and no other platform
package. The root package selects its platform package at run time; it is packed from the copy of the tagged tree with the
outputs of its make entries and `--ignore-scripts`, since those entries build what it carries, and it carries its package.json
byte for byte.

Before it builds anything, every set checks the manifest of every native package of config/release.json, whichever set builds
that package: the name of each manifest, `napi.binaryName`, `napi.targets` and the `optionalDependencies` of an `npm-native`
package, and `php-ext.extension-name` and `pre-packaged-binary` in `php-ext.download-url-method` of a `php-ext` package. One
failure names every problem it finds, so each runner of the matrix fails with the same message before cargo, maturin or the
napi CLI runs, and a manifest that a tool would reject is not found only after another asset of the set was built (K1196).

A native package may declare make entries (`generated`), as a Composer or wheel package does. A build of a native kind reads
the Cargo workspace of the repository, so it runs in a copy of the whole tagged tree (`git archive` of the commit), into which
the outputs of the make entries are copied at their paths; cargo writes into a target folder of the run, outside the checkout,
and the copy and the folder are removed after the run.

The assets of a release are built in sets, one set per run of `release-assets`, since each platform builds its own:

- The set without a platform: the archives of the `npm`, `composer` and `wheel` packages, the root package of each `npm-native`
  package and `packages.json`. `RELEASE_PLATFORM` is not set.
- The set of a platform: the `wheel-abi3`, `go-static` and `npm-native` platform assets of `RELEASE_PLATFORM`.
- The set of a platform and a PHP minor: the `php-ext` asset of `RELEASE_PLATFORM` for `RELEASE_PHP`. The PHP of the checkout
  must be that minor.

A set builds only on its own platform: the platform of the machine (Node.js `process.platform` and `process.arch`, glibc on
Linux) must be `RELEASE_PLATFORM`, since no tool cross-compiles here. A set whose platform no package declares, or a PHP minor
that no `php-ext` package declares for that platform, fails. `release.mts sets` (`make release-sets`) prints the sets as the
`include` list of a GitHub matrix, `{"platform": "<platform or empty>", "php": "<minor or empty>"}`, and writes it as `sets` to
`GITHUB_OUTPUT` when that is set. `release-run tag` writes `tag=vX.Y.Z` and `version=X.Y.Z` to `GITHUB_OUTPUT` beside
`GITHUB_ENV`, so a later job of the workflow reads the tag.

`publish` requires the files of every set in the asset folder: each file whose name kit predicts, and for a wheel-abi3 and a
php-ext asset one file that matches its name pattern, since maturin chooses the platform tag and the PHP decides the thread
safety; the pattern of a wheel admits the platform tags of its own platform alone, so the wheels of two platforms are two
assets. A missing file, a pattern that matches two files and a file that no asset names each fail. Each package asset carries
the label `<vendor>-<product>-<runtime>-<version>`, followed by `-<platform>` for a platform asset and by `-php<X.Y>-<platform>`
for a php-ext asset (P39).

`workflows/release.yml` builds the sets in a matrix: the job `tag` tags the commit, checks the tag out and runs `make
release-sets`; the job `assets` runs for each set on a runner of its platform (`ubuntu-24.04` for linux-x64-gnu and the set
without a platform, `ubuntu-24.04-arm` for linux-arm64-gnu, `macos-15` for darwin-arm64), sets up the PHP minor of the set, runs
`make release-assets` with `RELEASE_PLATFORM` and `RELEASE_PHP` and uploads the folder; the job `publish` downloads every folder
into one asset folder and runs `make release-publish` and `make release-undraft`.

`make release-tools` runs install-tools for a per-platform package, which installs the toolchain of rust-toolchain.toml with
rustup and the tools of mise.lock, such as the Python and uv that run maturin (K1190). The napi CLI of an npm-native package is a
devDependency of the repository, which `make install-packages` installs; release-tools fails before it installs anything when
`node_modules/.bin/napi` is missing, and names that fix. kit downloads none of these tools itself (K865).
