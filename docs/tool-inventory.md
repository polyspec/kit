<!-- doc-id: tool-inventory -->
# Tool inventory

[한국어](tool-inventory.ko.md)

The shared tools exist in several implementations. This inventory records where each one lives, its size, and the
implementation that kit takes as its base. A tool is merged into kit by taking the wider behavior of the implementations,
fixing it with a kit test, and replacing every copy with the vendored file. Measured on the working trees of the five
repositories (lines).

| Tool | template | crudui | hyper | ordered-json | orm | Base of kit |
|---|---|---|---|---|---|---|
| release | `scripts/release.mjs` 388 | 357 | 317 | `scripts/release.py` 383 | `scripts/release/release.mjs` 302 | template, with the Go tag rule of ordered-json |
| push-gate | 125 | 149 | 121 | `push_gate.py` 192 | `scripts/check/push-gate.mjs` 121 | crudui |
| full-run | 199 | 240 | 246 | `full_run.py` 285 | `scripts/check/full-run.mjs` 328 | orm |
| git-hooks | 27 | none | 28 | none | none | hyper |
| holder-lock | 134 | 275 | 111 | none | none | crudui |
| check-documents | 151 | 95 | 70 | `docs_check.py` | none | template |
| owner-check | 219 | 254 | 178 | `owner_check.py` 171 | none | crudui |
| run-tests | 289 | 282 | 159 | `test.py` | none | template |
| target-report, ci-targets | 100, 52 | 73, 47 | none | `ci_run.py` | none | template |
| ci-passed | 36 | 39 | none | `ci_run.py` | `scripts/check/ci-passed.mjs` 32 | template |
| install-tools | 189 | none | none | `toolchains.py` | none | template |
| dependency state, review, gate | in kit since v0.0.2 | 317, 288, 185 | none | none | none | crudui, merged with kit |
| github-ruleset | 182 | none | 164 | none | none | removed (0.x has no ruleset) |

## Decisions

- Every tool is Node (`.mjs`). The Python tools of ordered-json are replaced and deleted.
- A repository differs from another only in `config/*.json`; a tool has no repository name or path in its code.
- `github-ruleset` is not vendored: the 0.x rule has no pull request and no ruleset, so the file and its Make targets are
  removed in template and hyper.

## Toolchains (K8.2)

`scripts/kit/install-tools.mjs` installs the declared toolchains into `var/tools`; `scripts/kit/check-toolchain.mjs`
compares the running tools with the declarations. `scripts/kit/toolchain-declared.mjs` reads the declarations, and each
installed tool has its own module (`install-python.mjs`, `install-npm.mjs`, `install-go.mjs`, `install-ruff.mjs`, `install-composer.mjs`;
cargo-audit and govulncheck keep `install-cargo-audit.mjs` and `install-govulncheck.mjs`). Every installer uses
`install-tool.mjs`: the release is built beside the target, checked there and renamed, so a second run changes nothing.
Make targets: `install-tools` (online through `ONLINE`) and `toolchain-check` (offline, `TOOLS` limits the tools).

### Declarations

| Tool | Declared in | Install or verify |
|---|---|---|
| Node.js | `.node-version` (exact) | verify |
| npm | `packageManager` of `package.json`: `npm@X.Y.Z` or `npm@X.Y.Z+sha512.<digest>` | install |
| Go | `config/toolchain.json` `go`: `versionFile`, else the `toolchain` line, else the `go` directive of `go.mod` | install |
| Rust | `channel` of `rust-toolchain.toml` (exact) | verify |
| PHP | `config/toolchain.json` `php` (minor releases), else `.php-version` | verify |
| Python | `config/toolchain.json` `python` (minor release), else `.python-version`; both must agree; `pythonBuild` names the exact release of that minor | install with `pythonBuild`, else verify |
| Composer | `config/toolchain.json` `composer` `{ version, sha256? }` | install with `sha256`, else verify |
| ruff | `ruff` of `config/toolchain.json`: the exact `version` and the `sha256` of the wheel of each platform, downloaded with the digests checked; its environment is made with `var/tools/bin/python3` | install |
| cargo-audit, govulncheck | `config/toolchain.json` `cargoAudit`, `govulncheck` | install |

The shape of `config/toolchain.json` is `scripts/kit/schema/toolchain.schema.json`: `schema` (1), `comment`, `php` (list of
minor releases), `python` (minor release), `composer` (`version`, `sha256`), `go` (`mod`, `versionFile`), `ruff`
(`version`, `sha256` of each platform's wheel), `pythonBuild` (`version`, `release`, `sha256` of each platform), `cargoAudit`, `govulncheck` and `node` (the SHA-256 of the Node.js archive of each platform). Rust and
Node.js stay in their own files, which `setup-node` and `rustup` read. A tool that is not declared is neither installed nor
checked.

### Merged behaviors

- npm: the install of template (the npm of the machine runs `npm install --prefix`) and the install of hyper and
  ordered-json (the registry tarball, refused unless its SHA-512 is the declared digest) are one install that takes the
  second path when `packageManager` carries a digest. The layout is `var/tools/npm/node_modules/npm`; the wrappers `npm` and
  `npx` start `npm-cli.js` and `npx-cli.js`. A changed digest of the same version reinstalls (hyper). A tarball with a link or a
  special file is refused (ordered-json). The bootstrap npm runs without `var/tools/bin` on `PATH` (template).
- Go: the download of the toolchain module `golang.org/toolchain@v0.0.1-go<version>.<os>-<arch>` (template) now reads the
  release from three places: the version file with the consistency check of the `go` directive of `go.mod` (the file of
  crudui and orm), the `toolchain` line (ordered-json) or the `go` directive (template). The downloaded zip in
  the module cache is removed after the install, because only the unpacked toolchain is used.
- Composer: hyper installs `composer.phar` verified by its SHA-256; template, crudui and orm only verify the running
  Composer. The merged tool installs when `sha256` is declared and verifies otherwise.
- Python: crudui declares the minor release in the configuration, template and ordered-json in `.python-version`. The
  merged tool takes the configuration, else the file, and fails when both exist and differ. PHP is handled the same way
  with `.php-version` (ordered-json, orm) and the list of crudui and template; a file that is not in the list fails.
- Python: `pythonBuild` names a python-build-standalone release (its date as `release`, the exact `version`) and the SHA-256 of the
  `install_only` archive of each platform (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`). `install-tools` downloads the
  archive of this platform from that release, refuses another digest and unpacks it into `var/tools/python-build`. Each symbolic
  link of the archive (such as `bin/python3`) is replaced by a regular copy of its target, a directory link by a copied directory;
  a link to a missing file or outside the archive fails the install. The installed tree holds no link; the wrapper
  `var/tools/bin/python3` runs it. `check-toolchain`, run-tests and release-proof run `var/tools/bin/python3`, never the Python of PATH. A package whose tests import its own installed dependencies runs them with `run-tests python --venv <directory>` (K37): the runner starts `<directory>/bin/python` only when `<directory>/pyvenv.cfg` names `var/tools/python-build/python/bin` as its `home` and the environment holds no symbolic link; it refuses any other environment before the tool starts, with the fix `make python-venv DIR=<directory>` (K44) and an install with `--link-mode copy`. Measured with uv 0.12.11: `uv venv` and `uv sync` write `bin/python*` as links and have no copy mode, while `uv pip install --python <directory>/bin/python --link-mode copy` into a `--copies` environment keeps it free of links.
- Python venv (K44): `make python-venv DIR=<directory>` (`scripts/kit/python-venv.mjs`) is the way a consumer makes a virtual
  environment of the checkout Python; consumers call it instead of `-m venv`. It runs `var/tools/bin/python3 -m venv --copies
  --without-pip <directory>` and then removes the link `lib64 -> lib`. The run is idempotent: an existing `<directory>` that is
  already a venv of the checkout Python (run-tests' rule, the same Python version, platlibdir `lib`, no `lib64` in `sys.path`) is
  accepted unchanged and reported as such; any other existing `<directory>` is an error with its reason and is neither removed nor
  repaired. Evidence: CPython makes
  that link on 64-bit posix systems other than macOS, and fsm's CI on ubuntu-24.04 refused a `run-tests --venv` environment with
  `holds symbolic links (lib64)`. The removal happens only when `lib64` is exactly that link and the interpreter's `sys.platlibdir`
  is `lib`. Any other symbolic link, any other `lib64` or another platlibdir is refused, naming the path, and nothing is changed.
  The result is checked: no `sys.path` entry names `lib64`, and the rule of run-tests (`venvProblem`, in the same module) accepts
  it. A failed run removes the directory it made. The rule of no symbolic link is
  unchanged; the tool only performs the step that CPython's venv adds.
- ruff: the virtual environment of template is made with `--copies` from `var/tools/bin/python3`, so it holds no link to the interpreter.
- Verification: crudui's list of tools and its message (the declaring file, the running and the expected version, the fix),
  PHP and Python by minor release (crudui, ordered-json, hyper), exact release for the other tools, `GOTOOLCHAIN=local` and
  `RUSTUP_AUTO_INSTALL=0` (ordered-json), the evidence function `toolchainVersions` (crudui). The check also covers ruff,
  cargo-audit and govulncheck, and a run that checks no tool fails.
- Configuration data: the shape accepts the data of every repository. `php` is a list (hyper writes `["8.5"]`), `composer` is
  an object (template and crudui write `{ "version": "2.10.3" }`), and every file has `schema: 1`.

### Dropped behaviors

- hyper checked that `npm` and `composer` on `PATH` are the files of `var/tools/bin`. The policy is the declared version, which
  the version check enforces for every tool; a machine whose own npm is the declared release passes.
- hyper kept npm in `var/tools/npm` without `node_modules`; the layout of template replaces it, so one wrapper text exists.
- ordered-json's `pin TOOL` command printed a pinned version for CI. The setup actions read the pin files, and
  `declaredToolchain` returns the same values to a script.
- orm required a newline at the end of `.node-version`, `.php-version` and `.go-version`. The files are read
  trimmed; an editor setting is not a toolchain version.
- The `.tools/npm` path of crudui is replaced by `var/tools/npm` (`checkout-npm.mjs` is not vendored).

### Stays in the repository

- Playwright and Puppeteer browser installs (crudui `install-browsers.mjs`): they depend on the browsers of one project.
- crudui `install-lock.mjs`, `tool-resolution.mjs` and `run-command.mjs`: the first derives the lock of one install project,
  the second resolves the absolute paths of cargo, rustc and rustdoc for one build, and neither installs a declared toolchain.
- ordered-json `make tools`: the Rust toolchain (`rustup toolchain install`, which changes the toolchains that rustup
  manages on the machine), the crates (`cargo fetch`), the PIE phar and the JSONTestSuite checkout. kit verifies Rust and
  never installs it.
- crudui's phpDocumentor install, orm's checks of CI workflow files (`node-version-file`, `go-version-file`,
  `php-version-file`, `tools: composer:`), the minimum releases of `engines.node` and `require.php` and the path of a
  `go.mod` module: they check files of one repository, not a tool of the machine.
- The Node.js archive checksums of `config/toolchain.json` `node` are data that a repository's own download reads; kit
  accepts them and reads none.
## Gates: push-gate, full-run, git-hooks, holder-lock (K6.1)

Files: `scripts/kit/checklist.mjs`, `push-gate.mjs`, `git-hooks.mjs`, `holder-lock.mjs`, `full-run.mjs`,
`schema/checklist.schema.json`, and the make targets `hooks`, `hooks-check`, `push-gate-commit` and `rerun-failed` at the end of
`kit.mk`. The base is crudui for the lock, template for the guard and the hook, and the union of all five for the trackers.

### Policy

A push is refused while an item of a tracker is in its active state (`[~]` for a checklist) in a pushed commit or in the working
tree. The states waiting `[ ]`, done `[o]` and bypassed `[!]` do not block, and the refusal says so. The pre-push hook runs the
gate. It also checks the message of each pushed commit with the rules of `make commits-check` (`check-commits.mjs`, `config/commits.json`),
because a pushed commit cannot be rewritten. For each pushed ref, the commits are the range from the remote sha to the local sha, or, when
the remote sha is zero, the commits that no remote ref holds. A deleted ref pushes no commit and is skipped. A push with a finding is
refused, and each finding names its commit and line (`<commit>: <rule>: <message>`). The guard of the full run refuses while an item is in the active state, while tracked files have changes, and when the
record of a full run of the current tree exists. There is no pull request, merge queue or ruleset in this policy.

### `config/checklist.json`
```json
{
  "schema": 1,
  "hooks": ["pre-push"],
  "trackers": [
    {
      "path": "docs/plans/execution-checklist.md",
      "translation": "docs/plans/execution-checklist.ko.md",
      "format": "table",
      "states": ["[ ]", "[~]", "[o]", "[!]"],
      "active": "[~]"
    }
  ]
}
```

`hooks` lists the tracked hooks of `.githooks` and must include `pre-push`. A tracker has `path`, `format` (`table`: a row
`| ID | ... | state |`; `list`: an item `- [state] ID text`, indented for a sub-item) and `active`; it may have `translation`,
`idPattern` (the source of the regular expression that a task ID matches as a whole; a letter followed by letters, digits, `.` and `-` when absent), `states` (a state outside the list is an error) and `column` (the zero-based cell of a table row that holds the state; the last
cell when absent). A state is the leading `[x]` of its cell or item, or the whole cell when the cell does not start with `[`.

### Merged behaviors

| Behavior | Sources | Decision |
|---|---|---|
| Table rows with the state in the last cell | template, crudui, hyper, ordered-json | `format: table` |
| List items `- [state] ID text` with sub-items | orm | `format: list`; the title is the first sentence |
| A second tracker whose state is a word in a column (`partial` in the implementation column of the feature table) | ordered-json | `column` and `active` of a tracker; several trackers are allowed |
| A tracker without an item, a repeated ID, a state outside the declared states, or a row that is not an item is unreadable and refuses | ordered-json, orm (document checks); template ignored such rows | refuse in the gate and the guard: the wider reading never takes an unreadable document for an empty one |
| A pushed commit without the tracker file refuses | all | kept; the message names the file |
| A malformed line of the hook input refuses; a deleted ref pushes no commit; the working tree is always read | ordered-json (malformed), all (others) | kept |
| The Korean twin must hold the same IDs in the same order and the same states | orm, ordered-json (document checks) | the gate and the guard also refuse a pair that differs, because the pair is read with the same parser; the document checks of K7 keep the other rules (markers, bypass text) |
| The refusal names the file, the ID, the title and the place (pushed ref and commit, or working tree) | all | kept; it also states which states block and which do not; the commit is shown with 12 characters (ordered-json, orm; template and hyper used 7) |
| `commit <rev>` prints a GitHub annotation per line, escapes `%` and line breaks, appends to `$GITHUB_STEP_SUMMARY`, requires mode 100755 of the hook, and names a revision that is not a commit | template, crudui, hyper, ordered-json, orm | kept; it requires the mode of every hook in `hooks` (ordered-json required `pre-commit` too; the others only `pre-push`) |
| `hooks-check` fails when `core.hooksPath` differs, the hook is missing or not executable | all | `git-hooks.mjs check`; it also fails when `pre-push` has other content than the hook of the tool |
| `make hooks` sets `core.hooksPath` and checks | template, hyper, ordered-json (`hooks-install`) | `git-hooks.mjs install` also writes `pre-push` and makes the listed hooks executable; a second run changes nothing |
| Every make invocation sets `core.hooksPath` | template, orm | `kit.mk` sets it only in a checkout that tracks `.githooks/pre-push`, so a checkout without hooks is not changed |
| The content of `pre-push` | all differ in the `cd` to the top level and the comment | one content, written by `git-hooks install` and compared by `check` |
| Hooks other than `pre-push` (`pre-commit` of ordered-json, `commit-msg` of orm) | ordered-json, orm | named in `hooks` and checked for existence and mode; their content stays in the repository |
| Lock record: checkout, process ID, start time of the process, time taken, command, token; atomic link; start time tells a reused process ID from the holder | crudui | base of `holder-lock.mjs`; template and hyper recorded no start time |
| A lock of an ended holder stays until `clear`; `clear` renames the lock aside and restores it when a new holder took it meanwhile | crudui (`remove-dead`), template and hyper (`clear`) | under the name `clear`, with the claim of flowmark's spec 40 (K28): `clear` links the lock to `<lock>.<first 32 hex digits of the SHA-256 of the record>.clearing` (an existing claim refuses), removes only a lock that still holds the record it checked, and never moves the lock of a running holder; the rename aside left two holders when two clears ran at once |
| The start time of a process: `/proc/<pid>/stat` field 22 with `btime` on Linux, `ps -o lstart=` elsewhere | crudui | K28: on Linux field 22 with the boot ID of `/proc/sys/kernel/random/boot_id`, because `btime` follows the wall clock; an unreadable `/proc/<pid>/stat` (`hidepid`) asks kill(pid, 0) again and counts as running unless ESRCH. On Windows `powershell.exe -NoProfile -NonInteractive -Command` with `(Get-Process -Id <pid>).StartTime.ToFileTimeUtc()`: Node reads no creation time without a native addon, .NET reads it with `GetProcessTimes`, Windows PowerShell 5.1 ships with every supported Windows, and `wmic` is deprecated. On macOS `ps` stays: sysctl `kern.proc.pid` and `proc_pidinfo` need a native addon, and macOS has no `/proc` |
| Release on process exit, and on SIGINT, SIGTERM and SIGHUP with the status 128 + n | template | kept, as the default of an in-process holder; `run` forwards the signals to the command instead |
| `run <lock> -- <command>` exits with the status of the command; 128 + n for a signal; 127 when it does not start | crudui (`hold`), template, hyper | kept under the name `run` |
| The release fails when the token differs | template, crudui; hyper printed a message | fail |
| The lock directory is created | crudui, hyper | kept |
| Guard conditions: active item, hooks not installed, dirty tree, another run going on, record of the current tree | template, crudui, hyper, ordered-json | kept |
| Untracked files that Git does not ignore refuse the run, because the record names the tree and the tree does not hold them | ordered-json; the others looked at tracked files only | the wider check |
| One run at a time: the guard holds `var/full-run.lock` from its first read to its last write | template (`var/full-run.json.lock`), crudui (`var/locks/full-run.lock`), hyper and ordered-json (`var/full-run.lock`) | `var/full-run.lock` through `holder-lock.mjs` (ordered-json used `flock`) |
| Record `var/full-run.json`: tree, commit, result, targets with status, times and elapsed time, reruns | all but orm | kept; written to a file of the process and renamed |
| The incomplete record names its process; a running process refuses the run | template, crudui, hyper, ordered-json | the record also holds the start time of the process, so a reused process ID does not refuse a later run for good (a defect of all four) |
| `rerun-failed` reruns the targets that did not pass (failed, running, pending) of the current tree | template, crudui, hyper, ordered-json | kept |
| A further input of a run beside the tree: the commit of a dependency | hyper | `--key name=value`; the record holds `keys`, and a run and a rerun need equal keys |
| A failed target keeps its last 20 output lines in the record and prints them | hyper | kept |
| `make -k <target>` and a log per target in `var/report/full-run/targets/<target>.log`; a line after an output without a final newline starts at column 0 | template (`-k`, log), hyper (column 0, last lines) | kept |

### Dropped behaviors

| Behavior | Source | Reason |
|---|---|---|
| Texts that name pull requests, the merge queue, merge groups or the ruleset (`REASON`, the workflow `push-gate.yml` triggers, the required check `push-gate`) | template, crudui, hyper, ordered-json, orm | the 0.x policy has none of them; `commit <rev>` stays for a push from a checkout without the hook |
| The mode `hooks-check` of `push-gate.mjs` and `hooks-install` of `push_gate.py` | template, crudui, hyper, ordered-json, orm | a hook belongs to `git-hooks.mjs`; the make target keeps the name |
| Targets that are command lines (`sh -c <text>`) or argument groups after `--` | crudui, ordered-json | a record name and a log path must be stable words; a repository wraps a command in a make target |
| The run in a fresh clone of the committed tree with `make install` and a marker in the clone | crudui | it needs the repository's install command and a marker named after the repository; a repository that needs it makes a target that clones |
| The reset of the conformance evidence directory before a run | crudui | repository-specific |
| `environment` (versions of the toolchains) in the record and `summary.md` of the report | template, crudui | the toolchain commands are repository data; K8.1 merges the target report and the toolchain record |
| Selection of the targets of a rerun by the paths changed since the recorded commit, a rerun on a descendant commit, the statuses `not-run` and `crashed`, the preflight `decide`, the `claim` and `recorder` interface, and the record in `.runtime/` | orm | only orm has them, and they read the owner checks of K8; the other four agree on a rerun of the same tree |
| `flock` guard of `full_run.py` | ordered-json | replaced by `holder-lock.mjs`; all tools are Node |
| `user-lock-file` and `checkoutLockFile` | crudui | the path of the lock holds a repository name; the caller passes an absolute path |
| Progress lines of `test-progress` | crudui | a module of crudui; the gates print one line per step |
| `scripts/git/check.mjs` (commit subject format, `commit-msg` hook) and the marker and bypass-text rules of `scripts/checklist/check.mjs` | orm | not a gate; the hook is named in `hooks`, the document rules belong to K7 |
## Document checks (K7.1)

`scripts/kit/check-documents.mjs` replaces `check-documents.mjs` of template, crudui and hyper and `docs_check.py` of
ordered-json. Which Markdown files are documents, its status tables and changelogs are declared in
`config/documents.json` (`scripts/kit/schema/documents.schema.json`); its checklists are declared in `config/checklist.json` (K7.2). Each finding is one line
`<file>:<line>:<column>: <rule>: <message>`.

Merged behaviors (the wider behavior is taken):

| Concern | Implementations | Behavior in kit |
|---|---|---|
| Selection of documents | template and crudui: fixed list and directories; hyper: tracked `*.md`; ordered-json: a manifest that registers every document | tracked and new unignored Markdown files selected by `include` and `exclude` globs; a `.ko.md` file maps to its English file |
| Pair | all: English needs Korean; hyper and ordered-json: Korean needs English | both directions (`pair-missing`) |
| `doc-id` | ordered-json only | both files hold the same `<!-- doc-id: id -->` once; an id names one document |
| Revision | ordered-json only | the Korean file holds `<!-- source-sha256: ... -->` once, equal to the sha256 of the English file |
| Section identifiers | ordered-json (`<a id>` anchors) | anchors are equal in both files and appear once |
| Fenced blocks | template, crudui, hyper: content only; ordered-json: info string and content, `~~~`, unclosed fence | ordered-json behavior: info string and content are compared, both fence characters are read, an unclosed fence fails |
| Links | all: inline links; ordered-json: reference links, autolinks, `href`, a query or an escape of the repository, explicit anchors; template: `.md`, `.ko.md` and `index.md` candidates and skips `/`; crudui: rejects `/` | all link forms; code is not read; an anchor is an explicit anchor or a heading anchor; the `/` and extension-less behavior of a static site is `siteLinks` |
| Private paths | ordered-json | a path into a home directory fails (`private-path`) |
| `{{` | template (VitePress) | `interpolation` globs name the documents in which `{{` outside a fenced block fails |
| Checklist, table | template, crudui, hyper | task rows, state in the last cell, markers only in the state, other lines fail; the header separators of crudui and hyper (`:---:`) are accepted; the ID pattern is `idPattern` of the checklist |
| Checklist, list | orm | `- [o] ID text` items with sub-items and continuation lines, `Cause:` and `Retry:` for `[!]`; the Korean labels are accepted in both styles |
| Checklist pair | template and hyper compare the whole last cell; orm compares IDs and states | task IDs and state markers are compared; a bypass names its cause and retry condition in each language, and the text is translated |
| Duplicate and empty | orm, ordered-json | a repeated task ID and a checklist without tasks fail |
| Status tables | template (two shapes), crudui (6 cells), ordered-json (7 cells) | `statusTables` in the configuration: cells, closed values and patterns per cell; the English and Korean rows agree on the ID and on the closed values |
| Changelog | orm | `## Unreleased` first and once, versions `X.Y.Z` newest first and once, the same sections in both languages |

Dropped behaviors:

- The fixed document list of template and crudui and the registry manifest of ordered-json: the include globs and the
  `doc-id` marker replace them.
- The second status table shape of template (5 cells): a table has one shape, and no compatibility layer keeps the old one.
- The checks of ordered-json that read repository facts stay in the repository: the relations between the implementation,
  verification and distribution states, the evidence record of a state, the record and benchmark files, the distribution
  observations, the layout rule of the tracker section and the recursion into child repositories.
- The comparison of the changelog section with `VERSION` (orm): the release check reads the manifests and compares it.
- The `trace` and `docs` scripts of orm (`scripts/docs`, `scripts/features`) are product-specific and stay in orm.

## Owner check (K8.1-1)

`scripts/kit/owner-check.mjs` replaces `owner-check.mjs` of template, crudui and hyper and `owner_check.py` of
ordered-json. The declaration is `config/owner-checks.json` (`scripts/kit/schema/owner-checks.schema.json`).

Merged behaviors:

- Globs (`*`, `**`, `{a,b}`), the `always` tests, `$path` for a changed test file, `--paths`, `--base`, `--dry-run` and
  `--validate` are the same in template, crudui and hyper and are kept.
- Check kinds: crudui selects make targets, scripts of the root `package.json`, workspaces and package directories;
  template and hyper select make targets; ordered-json selects implementations and two named checks. kit takes the crudui
  kinds. A workspace is a `package.json` with a `test` script in a directory that `workspaces` of the root `package.json`
  names, a package directory is one outside them (crudui assumed the directory `packages/`).
- `variable` (template, hyper) passes the matched paths to the targets of a rule as a make variable.
- Targets are ordered by `CHECK_TARGETS` (template, hyper); the other checks keep the order of the declaration (crudui).
- The full-suite targets are those whose recipe starts `full-run.mjs` and those named in `fullSuite`; template's fixed names
  `check`, `rerun-failed` and the clean release check become entries of `fullSuite`.
- A rule that selects every target of `CHECK_TARGETS` fails (template). The `inputs` check is the crudui form; its
  declaration is a list of `{ check, paths }`, because the schema validator reads no object with free keys.
- Targets of a file that the Makefile includes (`include scripts/kit/kit.mk`) are known targets (new).
- A node test file runs through `scripts/kit/run-tests.mjs`, or through the make target `testTarget` with `TESTS=<files>`
  (hyper).
- Every selected check runs to its end and the failures are listed together (all implementations); no check has a time limit.

Dropped behaviors:

- `languages` and `checks` of ordered-json name that repository's builds; they become `targets` of the Makefile. Its `$module`
  becomes `$path`. Python test modules are not node tests and stay outside kit.
- `useCheckoutNpm` of crudui: the Makefile puts the npm of `var/tools` first on `PATH`; the tool starts `npm` from `PATH`.
- The bare target name as the key of `inputs` (template, hyper): the name is `make <target>` as in crudui.

## Test runner (K8.1-2)

`scripts/kit/run-tests.mjs` replaces `run-tests.mjs` of template, crudui and hyper and `test.py` of ordered-json. Its progress
reporters are `test-progress.mjs`, `node-reporter.mjs` and `vitest-reporter.mjs`; `test-load-check.mjs` is preloaded into
each node test file and `test-hooks.mjs` is the `setup` and `teardown` helper of tests.

Merged behaviors:

- Tools: `node`, `vitest`, `go`, `cargo`, `phpunit` (template and crudui) and `python` (K17); hyper has the first, the last and `vitest`. Each test
  prints its start, a line while it runs, and its result with the elapsed time; each test has its own timeout
  (`--timeout`, 30 s by default), enforced by `node --test` and vitest and by the runner for the other tools. No whole run, package or
  file has a time limit (all implementations; crudui's `go test -timeout 10m` is dropped for `-timeout=0`).
- A run in which no test passed, failed or ran out of time fails. template counted a skipped test as a test; hyper and crudui did
  not, and kit takes theirs, because a run that only skipped verified nothing. The reporters write their counts to the file in
  `KIT_TEST_RESULT` (hyper's `HYPER_TEST_RESULT`) and the runner fails when no counts arrive.
- A node test file that registers no test fails (crudui), and so does a file whose process ends before its module registered
  every test (crudui `load-check`). A Go package that started no test case is reported as skipped (crudui).
- The summary of a failed run names the error lines of the tool, and the build errors of a Go package that does not build
  (template); the timeout line names the command that it stops (crudui).
- `phpunit` runs `<cwd>/vendor/bin/phpunit`, or the vendor directory of `COMPOSER_VENDOR_DIR` (crudui), with `--php-extension`
  for an extension (template, hyper's `--extension`); a missing extension fails before the tool starts.
- A tool that cannot start fails with its command and the fix.
- `python` (K17) runs `python3 -m unittest <arguments> -v` and reads its standard error: a test prints `<description> ... `
  when it starts and its outcome when it ends, the same shape as the serial libtest output of cargo, so one parser of start
  and result lines reads both. `ok` and `expected failure` pass, `skipped` is skipped, `FAIL`, `ERROR` and `unexpected
  success` fail; a docstring line after the description keeps the id of the description. The runner applies the timeout.
- `--results <file>` (K18) writes the record of a run, passed or not, through a temporary file and a rename: the counts, every
  test as `{id, status, elapsedMs}` (`pass`, `fail`, `timeout` or `skip`), the tool, the elapsed time of the run and `inputs`,
  the `inputsDigest` of the `--inputs` paths (the `--cwd` directory by default) over the tracked and non-ignored files. The
  progress module records the tests, so the reporters of node and vitest and the parsers of the other tools need nothing
  more. A check compares `inputs` with the current files to tell a stale record.

Dropped behaviors:

- Python `unittest` runs with signal timeouts (`test.py`): the `python` tool runs `python3 -m unittest` with the timeout of
  the runner instead (K17).
- crudui's `recordSuiteRun` of a conformance record and its start of cargo through `run-rust-command.mjs`, template's
  `tools.mjs` entry of vitest, and hyper's `toolPath`: repository specific. The runner starts `cargo` and `go` from `PATH`
  (the Makefile puts `var/tools` first) and vitest from `node_modules/vitest/vitest.mjs`.

## CI report tools (K8.1-3)

`scripts/kit/ci-targets.mjs`, `target-report.mjs` and `ci-passed.mjs` replace `ci-targets.mjs`, `target-report.mjs` and
`ci-passed.mjs` of template and crudui, `ci-run.mjs` of hyper, `ci_run.py` of ordered-json, `scripts/check/ci-passed.mjs` and
`scripts/check/report.mjs`, `summary.mjs` of orm.

Merged behaviors:

- Every target runs as `make -k <target>` to its end, past failures, with its output printed and written to
  `<report>/targets/<target>.log` (template, crudui, hyper, ordered-json); the run holds `<report>.lock` (template, crudui). The
  report of an earlier run is removed first. No target has a time limit.
- hyper: `make --no-print-directory`, no variable of a calling make (`MAKEFLAGS`, `MFLAGS`, `MAKELEVEL`, `MAKEOVERRIDES`), complete
  lines of standard output and standard error that never join, `record.json` written before and after each target
  (a run that stops leaves the target that was running), a report write that never throws and is recorded in `reportErrors`
  (orm has the same rule), and the `--summary` step with `CI_STEPS` that renders the page also for a run that recorded nothing
  or did not end (`summary` of hyper and ordered-json).
- Failure lines: the lines marked `✖` with their indented detail (hyper), else the lines that state a failure without the
  passing, start and make lines (hyper, template), plus the checker lines `file:line: message` and the words of ordered-json,
  else the last lines; then how make ended. The lines `WARNING ...` of a passing target are recorded and shown (hyper, orm).
- The toolchain versions and the runner image are in `record.json` and in the summary (template's `toolchains.json` and
  hyper's `environment`).
- A log above 1 MiB keeps its head and its last 256 KiB (orm).
- `ci-passed`: the input is `RESULTS`, the JSON of `needs` (template, hyper, ordered-json; orm named it `CI_NEEDS`); each job is
  printed with its result; any result other than `success` fails with status 1; an unset or unusable input fails with status 2
  (crudui, orm); `::error` annotations are written on GitHub Actions (crudui, orm).

Dropped behaviors:

- `toolchains.json` and `summary.json` (separate files for what `record.json` holds), the group directory `var/ci/<group>`
  and the `ci-check`, `ci-pins` targets of hyper (the report directory is an argument, the PHP pin is repository specific),
  the refusal outside GitHub Actions (hyper: a run of the targets is allowed anywhere; the full suite guard belongs to the full
  run), the copy of `var/records` (ordered-json) and the environment, disk and server-log files, the case-runner protocol
  (`RUN`, `STEP`, `PASS`, `FAIL`) and the run id of the full-run report (orm): they depend on one repository's checks and stay there.
- The private lock of `ci-targets.mjs` (a file with the process id of the holder, removed as stale when the process ended) is
  replaced by `holder-lock.mjs` (K7.2): a lock of an ended holder stays until `holder-lock.mjs clear` removes it.

## Commit message check (K8.1-4)

`scripts/kit/check-commits.mjs` takes `scripts/git/check.mjs` of orm as the shared git hygiene check; template, crudui, hyper
and ordered-json state the same message format in their rules but have no check. The format and the limits are data in
`config/commits.json` (`scripts/kit/schema/commits.schema.json`).

Merged behaviors:

- orm: the subject is `type(scope): Subject (#id)`, the Subject starts with a capital letter, does not end with a period and has
  at most `subjectMax` characters; a range `<base>..<head>` or the last commit is read, a merge commit is not checked, and
  `--message <file>` checks the message being committed (the commit-msg hook) without its comment lines.
- New, from the shared rule of the repositories: a blank line follows the subject, and a body line has at most `bodyMax`
  characters (a single longer word, such as a URL, is allowed).
- New (K19): when config/checklist.json exists, a commit changes the state of at most one tracker item (a row the commit adds
  is not a change), and a commit that moves an item to the `done` state of its tracker also changes the `changelog` of
  `config/commits.json` and its translation. A commit of a range is compared with its parent; the message being committed,
  with the index against HEAD.

Version consistency and the other area checks of orm:

- `scripts/checklist/check.mjs` of orm is covered by the checklist reader of the document check (list style). `scripts/version/check.mjs`
  keeps its list of version declarations (the Cargo, Composer and npm manifests, the lock files, the contract, README,
  SECURITY and AGENTS texts) and the comparison with the file `VERSION` in orm: the declarations are product specific. The
  shared part, that every manifest has the version of the release, is the release tool (K5), and the shared part of its
  changelog check, the sections of the changelog, is the document check (K7.1).
- `scripts/repo/*.mjs` of orm (`check`, `ci`, `scripts`, `target`, `testcases`, `toolchains`, `gosource`, `node`, `probes`,
  `messages`) check the layout, the Rust target paths, the toolchains, the test cases and the form of failure messages of orm
  and stay in orm.
- `scripts/check/ci-passed.mjs` of orm is the CI report tool (K8.1-3).

Dropped behaviors:

- `ORM_GIT_RANGE`: the range is the argument `--range` (the make variable `RANGE`).
- The rule id `git.subject-format` and `contracts/rules.json`: the configuration is `config/commits.json`.

## Release tool (K5)

`scripts/kit/release.mjs` merges the release tools of the five repositories (`verify`, `versions`, `assets`, `publish`, plus
`coverage`). The repository is data in `config/release.json` (schema `scripts/kit/schema/release.schema.json`):

```json
{
  "schema": 1,
  "repositoryUrl": "https://github.com/<owner>/<name>",
  "changelog": "CHANGELOG.md",
  "changelogTranslations": ["CHANGELOG.ko.md"],
  "checks": ["push-gate", "ci-passed"],
  "packages": [{ "kind": "npm", "directory": "packages/x", "name": "@scope/x" }],
  "manifests": { "package.json": "version", "packages/x/package.json": "archive", "crate/Cargo.toml": "git-tag" },
  "notReleased": { "tests/consumer/package.json": "the reason" },
  "goModules": { "packages/go": "example.com/module/packages/go" }
}
```

`changelogTranslations` and `checks` are optional (`checks` defaults to `push-gate` and `ci-passed`). The values of
`manifests` are `archive` (the manifest of a package in `packages`), `version` (carries the version without an archive) and
`git-tag` (consumed by git tag). `goModules` maps a directory (`.` for the repository root) to the module path of its go.mod.

### Merged behaviors (the wider behavior is kept)

- Data instead of constants: `PACKAGES`, `MANIFESTS`, `NOT_RELEASED`, `GO_MODULES`, `CHECKS`, `REPOSITORY_URL` and the change
  logs of template, hyper and ordered-json are `config/release.json`. The lists are explicit; coverage detects an omission.
- `verify`: ancestor of `origin/main` and the latest run of each check (template, hyper, ordered-json, crudui, orm). The
  not-on-main finding and the check findings are reported in one message (crudui). The latest run of a check is the run with the
  greatest id, so a rerun that succeeded replaces a failed run.
- `versions`: the manifest kinds package.json, composer.json, Cargo.toml, pyproject.toml (template) and VERSION (orm); the
  module path of every declared go.mod on a root tag, not only on a Go tag (orm, wider than template); a Go module at the
  repository root (orm); further change logs that must hold the section (orm, `changelogTranslations`). A composer.json may omit
  `version` unless it is an `archive` manifest (hyper accepts the omission everywhere, template and ordered-json require the
  version everywhere; an archive must declare it because an artifact repository reads it).
- Change log section: heading, entry required, the anchor lines of the next section removed (template, hyper, ordered-json);
  the link of a long section uses the `<a id>` line above the heading, else the version without its dots (hyper,
  ordered-json); the notes limit is 125000 characters (all).
- Manifest rules (`manifestProblems`), the union of the rules: every dependency field of npm (`dependencies`,
  `devDependencies`, `peerDependencies`, `optionalDependencies`) and of Composer (`require`, `require-dev`) (crudui,
  ordered-json); no path, URL, git source or development version for any dependency (ordered-json); a package of a scope of
  this repository is one exact version and a package of the repository is the version of the tag (template); no `overrides` in a
  package.json (ordered-json); a composer.json declares the version of the tag and no `repositories` (template, orm). The
  scopes are derived from the names in `packages`, so the tool names no scope.
- `assets`: the manifests of the tagged commit pass the rules before a package is packed (ordered-json), the manifest name
  equals the name in `config/release.json` (new), and each archive carries the manifest of the commit byte for byte
  (ordered-json, crudui, orm; template compared parsed JSON). The directory is built beside the target and renamed, so a failed
  run leaves no archive.
- `publish`: `gh release create TAG --verify-tag --title TAG --notes-file` with the archives (all five); the archive names come
  from the configuration, not from a list file (orm wrote `assets.txt`).
- `coverage`: every tracked or new package.json, composer.json, Cargo.toml, pyproject.toml, go.mod and VERSION file is in
  `manifests`, `notReleased` or `goModules` (template test, orm `unlistedManifests`); a listed file that does not exist and a file
  in two lists are findings (orm, wider).

### Dropped behaviors

- crudui discovered the packages of `packages/` and skipped `private` ones: dropped for the explicit list; coverage reports
  a package file that the list omits.
- crudui failed when any run of a check was not successful, even an older failed run that was rerun: dropped, because it blocks
  a release after a successful rerun. orm ordered the runs by `started_at`: dropped for the id, which grows with creation.
- crudui and orm ran `make build`, `make typescript-build` or `scripts/package-dist.mjs` inside the release tool: dropped. The
  build of a package is a prerequisite that the repository adds to its own `release-assets` recipe, so the tool names no build.
- crudui `RELEASE_COMMIT` (assets before the tag exists) and the install of the archives as a consumer (template
  `release-consumer`, crudui `release-install`, hyper and orm `release-install`) is merged in "Consumer install of the release archives (K5.4)".
- orm output under `.runtime/release` and `assets.txt`: the output is `var/release/assets` in every repository.
- Not release steps and not merged: template `check-clean-release.mjs` (a full matrix in a clean worktree) and hyper
  `publish.mjs` (installed copies for development).
- ordered-json `release.py` is replaced by the Node tool.

### Archive names (K5.2)

- Name: `<package>-<language>-<version>.<ext>`; `@scope/name` is written `scope-name` and `vendor/name` `vendor-name`; the
  language is `npm` for an npm package and `php` for a Composer package. `@polyspec/x` is `polyspec-x-npm-0.0.5.tgz`,
  `polyspec/x` is `polyspec-x-php-0.0.5.zip` and `polyspec/x-extension` is `polyspec-x-extension-php-0.0.5.zip`. The five tools
  named archives `<package>-<version>.<ext>` (ordered-json already had the language); the language is kept because an npm
  package and a Composer package may share a name.
- `npm pack` names its output itself. The single new file in the destination is renamed to the archive name (ordered-json,
  template); zero or several new files fail with their names. crudui and orm took the name from the pack report or the
  package name; the rule for the single new file covers both and needs no npm output format.
- Zip: `git archive --format=zip -0` of the package directory at the tagged commit with `--mtime` set to the commit time and
  `TZ=UTC` (ordered-json used a fixed constant time, template the commit time, crudui, hyper and orm neither). `git archive`
  of a tree otherwise writes the current time, and a zip stores local time. A second run of the same tag writes the same
  bytes at any time and in any time zone.

### Go module tags (K5.3)

- A Go proxy resolves a module that lives below the repository root from the tag `<directory>/vX.Y.Z`, not from `vX.Y.Z`. A
  release once lacked these tags. `verify` of a tag `vX.Y.Z` now requires, for every module of `goModules` below the root, the
  tag `<directory>/vX.Y.Z` at the same commit as `vX.Y.Z`. A missing tag and a tag at another commit are findings that name
  the tag, the module path or both commits, and the command that creates the tag
  (`git tag -a <directory>/vX.Y.Z -m <directory>/vX.Y.Z <commit> && git push origin <directory>/vX.Y.Z`; a tag at another commit
  is deleted first with `git tag -d`). The findings are reported in the same message as the ancestry and the check runs.
- The step `go-tags TAG` (`make release-go-tags`) runs this check alone, offline, so the maintainer can run it after tagging.
  Before this row template and ordered-json named the tags in their release policy, and no tool of the five repositories
  checked them.
- A tag `<directory>/vX.Y.Z` releases that module alone: it needs no sibling tag and builds no archive. A module at the
  repository root (`.`) is released by `vX.Y.Z` itself and needs no further tag. The tags must exist in the checkout that runs
  `verify`, so a workflow that runs it fetches the tags.

## One checklist model (K7.2)

`scripts/kit/checklist.mjs` held the reader of the push gate and the guard (K6.1), and `scripts/kit/checklist-rows.mjs` held
the reader of the document check (K7.1). Both read the same documents (table rows `| ID | ... | [o] |`, list items
`- [o] ID text`, the states `[ ]`, `[~]`, `[o]` and `[!]`) under two configurations, `trackers` of `config/checklist.json` and
`checklists` of `config/documents.json`. There is now one reader, one configuration and one set of findings.

- `readChecklist(text, tracker, { strict })` returns `{ items, findings }`; an item is `{ id, title, state, line }` with the
  state as the document writes it (`[o]`). The lenient reading (the gate and the guard) reports a malformed row or item, a
  state outside `states`, a repeated ID and a document without an item, and `activeItems` throws on any of them. The strict
  reading (the document check) reports the same findings and also a line that is not a heading or a task, a state marker that is
  not the state of a task, a state cell that holds more than its state, a bypass without cause and retry, each with line and
  column. The messages of each reading are the ones that their tests asserted before the merge.
- `twinFindings` compares the items of a document and of its translation for both readings.
- `config/checklist.json` declares every checklist: `path`, `translation`, `format` (`table` or `list`), `idPattern`, `states`,
  `active`, `column`. `check-documents.mjs` reads its checklists from it. The key `checklists` of `config/documents.json`
  and its schema is removed, and the key `style` is `format`. A checklist without `translation` is read in English only.
- Wider behavior taken: a task ID may be followed by a code span, as `` T3.2 `parallel` ``, in both readings (the strict reader
  accepted any text after the ID; it now accepts a code span, so that a first cell such as `not an id` is a finding in both
  readings); a table row may be indented; `states` applies to the strict reading, so a checklist that declares no `states`
  accepts every state word there, where the strict reader accepted only the four states; the separators and the header are
  recognized by their position and by the cell `ID`.
- `ci-targets.mjs` holds its report with `holder-lock.mjs`; its own lock function is removed.

## Shared modules (K11)

Several tools of `scripts/kit` held their own copy of the same helper. Each helper now lives in one module that its users
import, and `tests/kit/duplication.test.mjs` fails when two files hold a function with the same normalized text of 6 lines or
more (the normalization is in the test). The base had no pair that long; the shortest pair was the 4 lines of `startReport`.

| Module | Holds | Replaces | Users |
|---|---|---|---|
| `paths.mjs` | `ROOT`, `isMain(import.meta.url)` | the root path that 22 modules computed and the `process.argv[1] === ...` test of 21 | every command and module with a default root |
| `process.mjs` | `execute`, `run`, `Stop` | `run` of release, `run` of dependency-review, the `spawnSync` calls with `encoding` and `maxBuffer` | release, dependency-review, check-toolchain, check-cargo-downloads, check-dependency-policy, git |
| `git.mjs` | `git`, `gitResult` | the `git` helper of full-run, push-gate, owner-check, kit-sync, tracked-files and target-report, and the direct `git` calls of git-hooks, check-commits, push-gate | those modules |
| `files.mjs` | `readJson`, `writeAtomic`, `jsonText`, `writeJson` | `readJson` of dependency-state, about 25 `JSON.parse(readFileSync(...))`, the temporary-file-and-rename writes of full-run, kit-sync, target-report, tool-wrappers, git-hooks and pin-python-dependency | those modules |
| `digest.mjs` | `digest`, `sha256`, `fileDigest` | `sha256` of check-documents and kit-check, `digest` of dependency-state and install-composer, the sha512 of install-npm | those modules |
| `time.mjs` | `now`, `seconds`, `compactSeconds` | `now` of ci-targets and full-run, `seconds` of full-run and target-report (`1.2 s`), `seconds` of test-progress and test-hooks (`1.2s`) | those modules |
| `version.mjs` | `compareParts`, `dottedParts`, `versionParts`, `isPrerelease`, `older`, `stableDescending` | `compare` of changelog, the version order of dependency-state, the sort of `highestStableRelease` of dependency-review; the unused `highestStable` is removed | changelog, dependency-review, check-dependency-policy |
| `findings.mjs` | `finding` | `finding` of status-table and changelog | status-table, changelog |
| `markdown.mjs` | `tableCells` | `cells` of checklist and `rowCells` of status-table; the fence scan of `changelog.sections` now uses `scanFences` | checklist, status-table, changelog |
| `schema-validate.mjs` | `SCHEMAS`, `readConfig` | the read-and-validate code of `loadConfig` in checklist and in release | checklist, release |
| `tracked-files.mjs` | `checkedFiles`, `KIT_FIXTURE` | `reviewedFiles` of dependency-state and `EXCLUDED` of release | dependency-state, release |
| `target-report.mjs` | `TARGET_NAME`, `FAILURE_LINES`, `logPath`, `startReport`, `treeId` | the same names in target-run, `LAST_LINES` of target-run, the target-name pattern of ci-targets, `git` of target-report | ci-targets, full-run |
| `toolchain-declared.mjs` | `recordedRelease` | `recordedCargoAudit` and `recordedGovulncheck`, which repeated its validation and message | install-cargo-audit, install-govulncheck |
| `tool-wrappers.mjs` | `RELEASE_OUTPUT`, `printedRelease` | the version arguments and patterns of ruff, cargo-audit and govulncheck that install-ruff, install-cargo-audit, install-govulncheck and the probes of check-toolchain each held | those modules |
| `dependency-state.mjs` | `UPDATE` | the same constant in check-dependency-policy and dependency-review | those modules |

Other duplicates removed:

- `toolchainVersions` existed twice (target-report and check-toolchain). The record of `ci-targets` now takes the releases
  of node, npm, go, rust, php and composer from `check-toolchain.toolchainVersions`, which prints `22.1.0` where target-report
  printed `v22.1.0`.
- The two `composer validate` calls of check-dependency-policy share one function.
- `cargoAuditCommand`, `govulncheckCommand` and the path of the probe in check-toolchain were three spellings of one path.

Behaviors that differ between the copies and were merged (the wider or safer one is kept):

- A failed git command reports `git <arguments> exited with <status>: <standard error>` everywhere; `check-commits` names the
  git command in the message about a range that does not resolve.
- A failed command of `dependency-review` reports the whole standard error, where it reported the last three lines.
- A target name for `ci-targets` starts with a letter or a digit, as it did for `full-run`; `ci-targets` accepted `-x`, which
  make reads as an option.
- `dependency-review` and `release` coverage skip `node_modules`, `var` and `.tools` as well as the kit fixture.
- The fence scan of a changelog closes a fence by the rule of `scanFences` (the closing fence is as long as the opening one).
- install-cargo-audit and install-govulncheck run their build through `tool-wrappers.run`, which prints the command before it
  runs and names the missing command.

Left as it is, with the reason:

- The runner of `make -k <target>` is one: `runLogged` of target-report. `target-run.mjs` and its `runMakeTarget` are removed;
  full-run runs its targets through `runLogged` and reads a pass with `targetPassed`. The wider behavior is kept: the environment
  of a calling make is removed, only complete lines are passed on, a failed write of the log is recorded. The log of a target
  of the full run starts with the command and ends with `[report] make <target> exited with status N`, as the log of a CI report
  does (task K11-1).
- The message that a configuration file is missing, in the commands `check-commits`, `check-documents` and `owner-check`, names
  the purpose of the file; the three sentences differ.
- `kit-check.walk` reads the vendored directories from the disk, ignored files included, where `trackedFiles` reads the Git view.
- The npm range functions stay in dependency-state: they implement npm's rules, not a general order of versions.

## Python lint (K8.4)

The Python lint was a target of one repository that ran `ruff check` and `ruff format --check` on its package. kit takes it as
`scripts/kit/lint-python.mjs` and `make lint-python`: ruff runs on the checkout root with `var` excluded, ruff is the one of
`var/tools/bin` at the version `ruff` of `config/toolchain.json` declares, and the rules are the `[tool.ruff]` tables of the
pyproject.toml files of the checkout, so the result does not depend on the ruff configuration of a machine. Both steps run after
a failure of the first. An undeclared ruff and a missing ruff fail with their fix.

The ruff pin is not in a pyproject.toml: a library that releases a wheel keeps its `Requires-Dist` free of ruff, and the
dependency review reads the pin of `config/toolchain.json` as a PyPI dependency; a newer ruff is set by hand with the sha256 of its
wheels.
## Consumer install of the release archives (K5.4)

`scripts/kit/release-consumer.mjs install TAG` installs all archives of a tag together in clean consumer projects outside the
repository and runs a smoke command for each package; `lock TAG` writes the manifests and locks of those projects. Files:
`scripts/kit/release-consumer.mjs`, `scripts/kit/release-consumer-config.mjs` (the rules of the configuration, called by
`release.mjs` `loadConfig`), the section `consumers` of `schema/release.schema.json`, and the make targets `release-consumer` and
`release-consumer-lock`. The base is template for the install and the lock, with the archive rule of crudui, the manifest rule of
crudui and ordered-json and the smoke checks of all five.

### `consumers` of `config/release.json`

```json
"consumers": {
  "npm": {
    "directory": "tests/release-consumer/npm",
    "smoke": { "@scope/lib": ["node", "-e", "require('@scope/lib/package.json')"] }
  },
  "composer": {
    "directory": "tests/release-consumer/composer",
    "smoke": { "vendor/lib": ["php", "-r", "require 'vendor/autoload.php';"] }
  }
}
```

`directory` holds the committed manifest (`package.json`, `composer.json`) and lock (`package-lock.json`, `composer.lock`) of the
project. `smoke` maps each package that the project installs to its command, an array of strings that runs without a shell in
the installed project. Every package of `packages` of a kind needs the project of that kind when `consumers` exists; a smoke key
is a package of that kind. A package that is not a key is copied into the project and not installed (for example a Composer
package of the type `php-ext`, which Composer does not install). The manifest files are in `notReleased` of the repository.

### Procedure

1. `make release-assets TAG=vX.Y.Z` builds the archives. `make release-consumer-lock TAG=vX.Y.Z` (ONLINE) copies each project
   into a temporary directory outside the repository with all archives of its kind, sets each installed package in the manifest
   (`"file:<archive>"` for npm, the version for Composer), runs `npm install --package-lock-only` or `composer update
   --no-install`, removes the hashes of the archives from the lock and writes the manifest and the lock back atomically. The
   archives are built in the run that installs them, so an npm entry has no `integrity` and a Composer entry an empty `shasum`;
   a registry package keeps both. A second run writes the same bytes. Run it on the release commit before the tag is pushed
   (a local tag is enough for `release-assets`).
2. `make release-consumer TAG=vX.Y.Z` requires `var/release/assets` to hold exactly the archives of the version, requires the
   manifest and the lock to name them (`dependencies.<name>` is `file:<archive>`, the lock entry has the version and the same
   `resolved`; `require.<name>` is the version, the lock entry has the version and the url `artifacts/<archive>`, and the
   manifest has the `artifact` repository `artifacts`), copies the project into a new temporary directory outside the
   repository, runs `npm ci` or `composer install`, requires every installed package at the version of the tag and runs its
   smoke command in the project. A difference names the expected and the actual value and the command that fixes it.
3. The environment has empty `npm_config_cache`, `COMPOSER_HOME` and `COMPOSER_CACHE_DIR` in the temporary directory, no
   `npm_config_offline`, `COMPOSER_DISABLE_NETWORK`, `COMPOSER` or `COMPOSER_VENDOR_DIR`, and each npm scope of this repository
   points at the unreachable registry `http://127.0.0.1:9/`. A package that a lock pins from a registry is downloaded with its
   version and integrity: that is installation, not a registry query, so the install is no offline check. Only `lock` resolves
   ranges. A Go module tag has no archive and nothing to install.

### Merged behaviors

| Behavior | Source | Merged form |
|---|---|---|
| Install in a temporary directory outside the repository with empty npm and Composer caches | template, crudui, hyper, ordered-json, orm | kept; the directory must be outside the checkout, checked by real path |
| npm project: `file:<archive>` dependencies, committed lock, `npm ci` with the scope of the repository at an unreachable registry | all | kept; the scopes are read from the names of `packages` |
| Composer project: `artifact` repository, Packagist disabled, committed lock, `composer install` | all | kept; the directory of the zips is `artifacts` (template) |
| An archive of the repository is locked by name and version only: no `integrity`, an empty `shasum` | all | kept; found by the archive name in `resolved` and in the url |
| The offline settings of the recipes are removed for the install | crudui, hyper, ordered-json, orm (environment); template (`--offline=false`) | the environment variables are removed |
| `--ignore-scripts --no-audit --no-fund` and `--no-plugins --no-scripts` | template, crudui, orm | kept; `--fetch-retries=0` (crudui, hyper) too, so an unreachable registry fails at once |
| The installed version of every package equals the version of the tag | crudui, template | kept for every smoke key, npm from `node_modules` and Composer from `installed.json` |
| `lock` writes the manifests for the version of the tree | crudui, ordered-json | kept; the committed manifest keeps its other fields |
| A smoke command per package: a module load, a class load, a build | template, orm, ordered-json, hyper | the command comes from the configuration |
| A manifest or lock that names other archives fails and names the lock command | template, hyper, ordered-json | kept, with the expected and the actual value of each difference |
| A Go module tag installs nothing | crudui | kept |

### Dropped behaviors

| Behavior | Source | Reason |
|---|---|---|
| Building the archives inside the install (`packTree`, `buildAssets`, `git stash create` of the working tree) | template, crudui, hyper, ordered-json, orm | `release.mjs assets` builds the archives of a tag; the install reads `var/release/assets`, so a check never installs an archive that no release builds |
| Downloading the release archives of other repositories into the project | orm, hyper | kit names no repository; a dependency of another repository is pinned in the lock by URL, integrity or shasum, and the install downloads it as any registry package |
| `--allow-remote` settings of npm for a URL dependency | hyper | a workaround of one npm release (npm/cli#9818); no repository setting is merged, so a lock with a remote tarball needs an npm that accepts it |
| `--workspaces=false` | crudui | the project is outside every workspace |
| The sample application that the project builds, and `composer show --available` of a `php-ext` package | hyper, template | a smoke command runs in the installed project and reads no file of the repository; a check of such a package belongs to the package |
| The Python test class `InstallFromAssets` and `install_fixtures.py` | ordered-json | replaced by the Node tool |

### Limitations

- `smoke` does not have to list every package: a package without a key is copied and not installed or checked.
- The locks hold the dependencies that the archives declared when `lock` ran; a changed dependency needs `lock` again.

## Release proof (K5.5)

`scripts/kit/release-proof.mjs TAG` (`make release-proof TAG=vX.Y.Z`, ONLINE) proves a released tag from outside the
repository. The release workflow of `templates/release.yml` runs it after `release-publish` in the same job, so a failed proof fails that run;
a developer may run it for any released tag. It is no offline check. No tool of the five
repositories had a counterpart; the install of the archives is `installConsumers` of K5.4. It stops at the first failed step and
prints `✔ <what>` for each step that passed. A failure names the command with its status and error, or the expected and the
actual value.

For a tag `vX.Y.Z`:

1. `gh release view TAG --repo HOST/OWNER/REPO --json assets` (from `repositoryUrl`) lists exactly the archives that
   `packages` declares for the version; the failure names the missing and the unexpected names.
2. `gh release download` writes the assets into a temporary directory; `installConsumers` installs them in clean npm and
   Composer projects with the committed manifests and locks of the checkout and runs the smoke commands of `consumers` (run it
   in a checkout of the tag, whose consumer projects name the archives of the version).
3. Each manifest with the mode `git-tag` installs from the tag in a temporary directory, with the command of
   `proof.gitTag`: a Rust crate as the git dependency `<name> = { git = "<repositoryUrl>", tag = "TAG" }` of a temporary crate
   with its own target directory and the smoke command (for example `cargo check`) in that crate. A Python package is not a
   git-tag manifest: it is a `wheel` package whose wheel is an archive of step 2 (K29).
4. Each Go module of `goModules` has the tag `<directory>/vX.Y.Z` (the module at the root `vX.Y.Z`) on the remote
   (`git ls-remote --tags <repositoryUrl>`) and `go list -m <module>@vX.Y.Z` with `GOFLAGS=-mod=mod`, `GOPROXY=direct` and an empty
   `GOPATH` prints `<module> vX.Y.Z`.

A tag `<directory>/vX.Y.Z` releases that Go module alone: the release must list no archive and only step 4 runs for that module.

### `proof` of `config/release.json`

```json
"proof": {
  "gitTag": {
    "rust/Cargo.toml": { "kind": "rust", "name": "name", "smoke": ["cargo", "check"] }
  }
}
```

Every manifest with the mode `git-tag` in `manifests` needs an entry when `proof` exists, and `release-proof` fails without one.
`kind` is `rust` for a `Cargo.toml`; a `pyproject.toml` with `kind` `python` is refused. `smoke` is an array of strings that runs without a
shell. The smoke commands of the archives are `consumers` of K5.4.

### Limitations

- The proof stops at the first failed step.
- The Rust step uses the `CARGO_HOME` of the machine for the registry crates that the crate needs; only the crate and its target
  directory are new. The Go step uses a new `GOPATH`, so it downloads the module.
- The install of the archives reads the manifests and locks of the checkout; a checkout of another version fails at the first
  difference, naming `make release-consumer-lock`.

## Wheel packages (K29)

A package of kind `wheel` is a Python package, declared in `packages` with its directory and its project name (`name`), and its
`pyproject.toml` is an `archive` manifest. Its archive is the PEP 427 wheel `<distribution>-<version>-py3-none-any.whl`; the
distribution escapes each run of characters other than word characters and dots as `_`, so `kit-fixture` at `0.0.1` is
`kit_fixture-0.0.1-py3-none-any.whl`, the name pip parses.

- `release-assets` builds the wheel from a copy of the directory at the tagged commit (`git archive`) with
  `var/tools/bin/python3 -m pip wheel --no-deps --no-index --no-cache-dir --find-links var/tools/wheels -w <output> <source>`,
  with `SOURCE_DATE_EPOCH` set to the time of the commit. `--no-index` makes the directory the only source, so no build reads the network.
- The build backend is pinned in `buildBackend` of `config/release.json`: `requirement` is the exact requirement of the backend
  (`setuptools==84.0.0`, which the `[build-system] requires` of the pyproject must equal) and `sha256` is the digest of its wheel
  from the PyPI release. `make release-backend` (ONLINE) downloads it with
  `pip download --no-deps --only-binary :all: --require-hashes` into `var/tools/wheels` from a requirement file that holds the digest;
  `release-assets` checks the digest of the file before each build and refuses another. The download is the one network step of a
  wheel package, and it runs before a release.
- `release-assets` refuses a wheel whose `Requires-Dist` is not a plain `name==version`: a URL, a git source, a range or a marker
  (`; extra == ...` or `; python_version ...`) fails with the line and its form. `release-versions` requires the `version` of
  `[project]` in the pyproject.toml, as for every archive manifest.
- `release-consumer` installs the wheel into a clean virtual environment of `var/tools/bin/python3` with
  `pip install --no-input --disable-pip-version-check --no-index --require-hashes --no-deps -r <requirements>`; the requirement file
  names the wheel of the run with the sha256 of its file. It checks the version that `pip show` prints and runs the smoke command of
  `consumers.wheel`. A wheel has no committed lock.

```json
"consumers": { "wheel": { "smoke": { "kit-fixture": ["python", "-c", "import kit_fixture"] } } },
"buildBackend": { "requirement": "setuptools==84.0.0", "sha256": "<sha256 of setuptools-84.0.0-py3-none-any.whl>" }
```

## Language parity (K33)

`scripts/kit/parity.mjs` checks that every implementation of a repository holds the same units. `config/parity.json` declares
the implementations, which is the one source of the language set of the repository, the profiles that group them, and the
units. The declaration holds no state such as done or planned: the checker takes every fact from the tree.

- It runs the binding of each suite in each implementation itself and keeps an in-memory ledger of the runs and of the cases
  that each run reported. It reads no saved report.
- It reads the exported symbols from the extractor snapshot of each implementation.
- It reads the error codes from the generated artifact of each implementation.

### Trust boundary

The checker trusts three inputs that it does not produce itself. Other checks close each one:

- **The symbol snapshot** of each implementation. The repository's interface check regenerates it from the source and fails
  on a difference. That check must run before `parity-check`.
- **The generated error-code artifacts.** The repository's generator check regenerates them from the catalog and fails on a
  difference. That check must also run before `parity-check`. The parity check compares the committed artifacts with the
  catalog, and it does not regenerate them.
- **The PASS lines that a harness prints** for itself (node, php, python and cargo). The checker cannot tell a printed PASS from
  a passed case. The shared test harness of each language prints the line only after the case passed, and review keeps each
  binding on that harness. Go events come from `go test` itself.

Make targets: `parity-check` runs the bindings and checks every rule. `parity-declarations-check` checks every rule except R3
and runs nothing. Both are offline, print a line for each step and each finding, and exit with 1 when a finding exists.

| Module | Concern |
|---|---|
| `parity.mjs` | the command, and the order of the rules |
| `parity-declaration.mjs` | the schema, the references of the declaration, and the finding |
| `parity-units.mjs` | R1, R2, R4, R5, R6, R8, R11 |
| `parity-ledger.mjs` | R3: the runs of the bindings and the ledger |
| `parity-runners.mjs` | the native command of each runner and the cases of its output |
| `parity-errors.mjs` | R7 |
| `parity-text.mjs` | R9, R10 |

### Rules

Every finding fails the check. A finding names its rule, unit, implementation and place (a file, or file:line).

| Rule | Finding |
|---|---|
| `declaration` | The declaration has one of these defects. No other rule runs on such a declaration. <br>- It breaks `scripts/kit/schema/parity.schema.json`. <br>- It names a missing file, or an unknown implementation or profile. <br>- A profile narrower than every implementation has no `reason`, or only one unit uses it. <br>- An implementation is in no profile, or a root is the whole repository. <br>- A binding belongs to an implementation outside the unit's profile. <br>- A go or cargo binding has no `symbol`, or a go symbol does not match `^Test\w*$`. <br>- A case name repeats, holds whitespace, or holds `/` in a unit with a go binding. <br>- A `nativeOnly` symbol is not exported. <br>- An exclusion names a pair that the unit binds. <br>- A pattern has no group. <br>- The catalog pattern does not read a line of the catalog, or a catalog or artifact pattern reads no code. |
| R1 missing-implementation | An API unit has no symbol of an implementation of its profile, the symbol is not in the snapshot, or the symbol is not exported. |
| R2 missing-binding | A suite unit has no binding of an implementation of its profile. |
| R3 not-executed | The binding cannot start, exits with a status other than 0, or the cases that passed are not exactly the cases of the suite file. Each binding runs twice, so a second run with another exit status, another case or another result is also R3. The finding lists the failed, skipped, missing and extra cases and the differences between the runs. A Go package that does not build adds its compiler output. |
| R4 undeclared-suite | A file of the `suites` globs is the file of no suite unit. |
| R5 undeclared-test | A file of the `tests` globs of an implementation is the test of no binding of that implementation. |
| R6 misplaced-test | The test of a binding lies outside the `roots` of its implementation and outside the `comparators`. Or a file of the `testPatterns` of a runner lies outside the roots of every implementation of that runner and outside the `comparators`. The vendored `scripts/kit` and `tests/kit` are kit's own and are not checked. |
| R7 error-catalog | An implementation of the `errors` profile declares no codes, or its codes differ from the catalog (missing or extra codes). |
| R8 exclusion | An exclusion. It never counts as holding the unit, so the check fails until the item that it names removes it. |
| R9 language-set-drift | A list in another file that `languageLists` declares differs from its profile, or its pattern matches nothing. |
| R10 docs-count | A document of `documents` counts the implementations with a number that no profile has, or lists three or more implementation names that are no profile. |
| R11 undeclared-public | An exported symbol of a snapshot is declared neither by an API unit nor by a `nativeOnly` entry of its implementation. |

### Runners

| Runner | Command | Cases |
|---|---|---|
| `go` | `go test -json -count=1 -run ^<symbol>$ ./<directory>` in the nearest directory with `go.mod` | the `pass`, `fail` and `skip` events of the direct subtests `<symbol>/<case>` |
| `cargo` | `cargo test --manifest-path <crate>/Cargo.toml --test <name>` for `<crate>/tests/<name>.rs`, else `--lib`, then `-- --exact <symbol> --nocapture --test-threads=1` | the harness lines of standard output and standard error |
| `node`, `php`, `python` | `node <test>`, `php <test>`, `var/tools/bin/python3 <test>` in the root of the checkout | the harness lines of standard output |

A harness line is `PASS <unit>/<case>` or `FAIL <unit>/<case>`, optionally followed by a space and other text. This is the format
of the shared test harness of each language. A `FAIL` line of a case counts over a `PASS` line. A case name holds no whitespace,
and in a unit with a go binding it holds no `/`, because Go nests the names of subtests at `/`.

With `--nocapture`, libtest prints `test <name> ... ` without a line break. The first line that a Rust test prints continues that
line, so the cargo runner reads a harness line after this prefix.

An implementation can replace the program of its runner with `command`. A command that holds a `/` is a path relative to the root
of the checkout, such as the Python of a virtual environment; otherwise it is a name on PATH. `args` go after `test` for go and
cargo, and before the test file for node, php and python, such as `-d extension=<library>` for one PHP implementation. `env`
sets variables for the runs of that implementation only, over the environment of the check.

### Declaration

`config/parity.json`, validated against `scripts/kit/schema/parity.schema.json` (`make kit-check` validates it too):

| Key | Content |
|---|---|
| `implementations` | `name`, `runner` (`go`, `cargo`, `node`, `php`, `python`), `roots` (its directories; never the whole repository), `tests` (at least one glob of its test files), `command`, `args`, `env` (`name`, `value`), `symbols` (the snapshot), `errors` (`file`, `pattern`: the generated codes) |
| `profiles` | `name`, the `implementations` that it groups, and `reason`, which a profile narrower than every implementation needs |
| `suites` | globs of the shared vector files |
| `comparators` | the directories of the checks that compare the outputs of several implementations |
| `testPatterns` | for each `runner`, the `globs` of its test files across the repository |
| `units` | `id`, `kind` (`suite` or `api`) and `profile`. A suite has `file`, `cases` (a path of `$` followed by `.<key>` and `[*]` steps) and `bindings` (`implementation`, `test`, `symbol`). An API unit has `symbols` (`implementation`, `symbol`). |
| `nativeOnly` | `implementation`, `symbol` and `reason` of an exported symbol that only one implementation has |
| `exclusions` | `unit`, `implementation`, `reason` and `item`, the checklist item that removes the exclusion |
| `errors` | `profile` and `catalog` (`file`, `pattern`) |
| `languageLists` | `file`, `pattern` (its first group holds the list; the words of the group are the names) and `profile` |
| `documents` | `globs` and `nouns`, the words that a count precedes (`languages`, `언어`) |

A pattern is a regular expression that is applied to each line (flags `gm`), and its first group is the value. A count is digits,
an English number word up to twelve, or a Korean native numeral up to 열, followed by one of the nouns. A list is three or more
implementation names, joined by `,`, `and`, `or`, `/`, `및`, or the particles `와` and `과`. The snapshot of an implementation is a
JSON object that maps each symbol id to an object with a boolean `exported`.

The catalog pattern applies to each line of the catalog that is not blank and is not a comment (a line that starts with `#` or
`//`). It must match every such line, so no code escapes it. A line that the pattern matches without its group holds no code,
such as the other fields of an entry. An example is `^- code: (\w+)$|^  \w+: .*$`.

A profile narrower than every implementation removes the omitted implementations from its units. Every run prints such a
profile with what it omits and its reason. At least two units use it; a one-unit profile would be an exclusion that never fails.

### Wiring a repository

1. After `make kit-sync`, write `config/parity.json`. Declare every implementation, the profiles, a suite unit for each vector
   file, an API unit for each public concept, and an exclusion with its checklist item for each unit that an implementation does not
   hold yet.
2. Make each language harness print `PASS <unit>/<case>` for each case of a suite. In Go, run each case as the subtest
   `<symbol>/<case>`.
3. Make the extractor of each implementation write its snapshot with `exported`, and generate the error codes of each
   implementation from the catalog.
4. Add `parity-declarations-check` and `parity-check` to the checks of the repository. Run them after the checks that regenerate
   the symbol snapshots and the error-code artifacts (the trust boundary). The `make kit-sync` copy already holds the targets.

```json
{
  "schema": 1,
  "implementations": [
    { "name": "go", "runner": "go", "roots": ["packages/go"], "tests": ["packages/go/**/*_test.go"],
      "symbols": "contracts/symbols/go.json", "errors": { "file": "packages/go/codes.go", "pattern": "^\\tCode\\w+ = \"(\\w+)\"$" } },
    { "name": "python", "runner": "python", "roots": ["packages/python"], "tests": ["packages/python/tests/*.py"],
      "symbols": "contracts/symbols/python.json", "errors": { "file": "packages/python/codes.py", "pattern": "^\\w+ = \"(\\w+)\"$" } }
  ],
  "profiles": [{ "name": "client", "implementations": ["go", "python"] }],
  "suites": ["tests/**/vectors.json"],
  "comparators": ["tests/conformance/check"],
  "testPatterns": [
    { "runner": "go", "globs": ["**/*_test.go"] },
    { "runner": "python", "globs": ["**/test_*.py"] }
  ],
  "units": [
    { "id": "codec", "kind": "suite", "profile": "client", "file": "tests/codec/vectors.json", "cases": "$.vectors[*].name",
      "bindings": [
        { "implementation": "go", "test": "packages/go/codec_test.go", "symbol": "TestCodecVectors" },
        { "implementation": "python", "test": "packages/python/tests/test_codec.py" }
      ] },
    { "id": "host-decode", "kind": "api", "profile": "client", "symbols": [
        { "implementation": "go", "symbol": "packages/go/hostcodec.go::HostDecode" },
        { "implementation": "python", "symbol": "packages/python/codec.py::host_decode" }
      ] }
  ],
  "exclusions": [],
  "errors": { "profile": "client", "catalog": { "file": "docs/errors.yaml", "pattern": "^\\s*- code: (\\w+)$" } }
}
```

## Python locks: PEP 751 pylock.toml (K36)

The dependency gate reads a Python lock only in the standard format of PEP 751 (status Final, resolution 31 March 2025),
`pylock.toml` or `pylock.<name>.toml`, named in `pythonLocks` of `config/dependency-policy.json`. uv.lock is not read: it is
uv's own format, and a repository that releases a wheel needs a lock that every installer reads.

Writers measured with uv 0.12.11 and pip 26.2.1: `uv export --format pylock.toml --frozen --no-emit-project -o <lock>` and
`pip lock`. uv installs from the file with hash checks; pip refuses a `vcs` entry in it. Both set `created-by`.

### Rules

- The file is read by `scripts/kit/pylock.mjs` (`readPylock`), a reader for the TOML subset that these writers produce. Node has
  no TOML reader and kit imports only Node built-ins, so no TOML library is reused; a construct outside the subset (a multi-line
  string, an unknown escape, a duplicate key) fails with its line.
- `lock-version` is `"1.0"`; another version fails the gate.
- Each lock's sha256 is recorded in `config/dependency-review.json`, as a lock of any other ecosystem is.
- A registry package (`sdist` or `wheels`) is a dependency of the lock: its name and version are recorded, its latest stable
  release is queried from PyPI, and its advisories are read from the PyPI release JSON (`vulnerabilities`) of its locked
  version. Every `sdist`, `wheels` and `archive` file carries a `sha256`, and the gate fails when one does not.
- A `vcs` package (git) is pinned by its `commit-id`, which must be 40 hexadecimal digits. The record holds its URL,
  `requested-revision` and `commit-id`, and the gate fails when the lock and the record name another commit. A git package is
  not queried for advisories or releases.
- A package with no source table, or a `directory` package, fails the gate: a consumer exports the lock with
  `--no-emit-project`, so a local package has no release to review.
- `created-by` is required. The fix of an outdated release or an advisory names the tool that wrote the lock: for uv,
  `uv lock --upgrade-package <name>` then the export again; for pip, `pip lock`. A lock with another or no `created-by`
  gets a fix that names the missing tool. The review never rewrites a lock itself (`UPDATE=1` skips these packages).
- A consumer that adopts this release adds `"pythonLocks": [...]` to `config/dependency-policy.json` (a list, empty when it
  has no lock). The field is required, with no compatibility path.

### Limitations

- The reader supports the lock writers' subset only; a lock that another writer produces with a construct outside it fails
  until the reader reads it.
- A `directory` package is refused, not reviewed.
