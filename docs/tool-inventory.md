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
installed tool has its own module (`install-npm.mjs`, `install-go.mjs`, `install-ruff.mjs`, `install-composer.mjs`;
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
| Python | `config/toolchain.json` `python` (minor release), else `.python-version`; both must agree | verify, and the minor of the ruff environment |
| Composer | `config/toolchain.json` `composer` `{ version, sha256? }` | install with `sha256`, else verify |
| ruff | the `ruff==X.Y.Z` pin of the `pyproject.toml` named by `ruff.pyproject` | install |
| cargo-audit, govulncheck | `config/toolchain.json` `cargoAudit`, `govulncheck` | install |

The shape of `config/toolchain.json` is `scripts/kit/schema/toolchain.schema.json`: `schema` (1), `comment`, `php` (list of
minor releases), `python` (minor release), `composer` (`version`, `sha256`), `go` (`mod`, `versionFile`), `ruff`
(`pyproject`), `cargoAudit`, `govulncheck` and `node` (the SHA-256 of the Node.js archive of each platform). Rust and
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
- ruff: the virtual environment of template is made with `--copies`, so it holds no link to the interpreter.
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

Files: `scripts/kit/checklist.mjs`, `push-gate.mjs`, `git-hooks.mjs`, `holder-lock.mjs`, `full-run.mjs`, `target-run.mjs`,
`schema/checklist.schema.json`, and the make targets `hooks`, `hooks-check`, `push-gate-commit` and `rerun-failed` at the end of
`kit.mk`. The base is crudui for the lock, template for the guard and the hook, and the union of all five for the trackers.

### Policy

A push is refused while an item of a tracker is in its active state (`[~]` for a checklist) in a pushed commit or in the working
tree. The states waiting `[ ]`, done `[o]` and bypassed `[!]` do not block, and the refusal says so. The pre-push hook runs the
gate. The guard of the full run refuses while an item is in the active state, while tracked files have changes, and when the
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
`states` (a state outside the list is an error) and `column` (the zero-based cell of a table row that holds the state; the last
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
| A lock of an ended holder stays until `clear`; `clear` renames the lock aside and restores it when a new holder took it meanwhile | crudui (`remove-dead`), template and hyper (`clear`) | crudui's removal under the name `clear` |
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
ordered-json. Which Markdown files are documents, its checklists, status tables and changelogs are declared in
`config/documents.json` (`scripts/kit/schema/documents.schema.json`). Each finding is one line
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
