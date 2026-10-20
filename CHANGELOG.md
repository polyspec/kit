<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- `make install-tools` provides the PHP of `.php-version` by discovery: a `php` on PATH of that minor, else `php<minor>` of apt, else the `opt/php@<minor>` keg of Homebrew. It writes exec wrappers for php, php-config and phpize in var/tools/bin before the Composer installs, so every repository runs the pinned PHP whatever PHP the machine puts first on PATH, and it fails with the attempts when none matches. Red: `node scripts/kit/run-tests.mts node -- tests/kit/install-php.test.mts` 0 passed, 9 failed; green: 9 passed (K283).

## 0.0.54

- An ID is a sub-item only when the part before its last -<number> is an ID of the pattern of its repository, so an ID scheme such as S-01 needs no parent S (K249-5).
- The parity declaration has no `admit` key: every implementation runs every case of every suite, so a case that one implementation skips is no longer a permanent difference (K276-1).
- config/parity.json holds every unit in every implementation: the declaration has no `profiles`, `nativeOnly`, `exclusions` or unit `profile` (the schema refuses them), R8 and the native-only half of R11 are gone, and the width and size suites hold in every implementation (K276).
- A suite or feature unit cites only the requirements that the test of each binding, or the vector file of the suite, names (R15), and only such a unit traces a requirement: a unit cannot cite every requirement of the spec to pass R13 (K275).
- The parity declaration check parses each cited spec file once: it parsed the file again for every anchor, which took eight minutes on a large spec (K274).
- config/parity.json declares requirements.pattern, and every unit cites the requirements it tests: a requirement that docs/spec defines and no unit cites fails (R13), and so does a unit that cites an undefined one (R14). A repository with implementations writes its requirement ids into its spec (K273).
- kit-gates runs the full parity check: every binding of config/parity.json runs in each implementation in CI, so a feature tested in one language and not in another fails the gates (K272).
- The kit tests follow the installed version rule, the TSX parser and the release tag step: no test expects a version comparison, every sandbox repository comes from initRepository, and no comment names a repository (K271).
- kit vendors the gates workflow `workflows/gates.yml` to `.github/workflows/gates.yml` of every repository: it installs the repository and runs `make -k kit-gates`, every check that a rule of PRINCIPLES.md is enforced by, so no repository wires the gates into its CI by hand (K270).
- The language check reads a raw string of Go or Rust as data over its lines, so Korean data in it is no identifier (K268-1).
- A repository keeps its suite target `check`, which is no fixed task, and `make install` runs the bootstrap of kit as its prerequisite `install-kit` before the install steps that a repository adds (K246-2).
- A release starts from a dispatch of the release workflow with its tag: `make release-tag` creates the annotated tag at origin/main and pushes it, and passes when the tag already names that commit, so no machine has to push a tag (K269).
- The language check and the test-markers check read JSX and TSX: they parse a script with oxc-parser, now a dependency of the package, instead of the type stripping of Node.js and acorn, which read no JSX, and walk every node of the tree by its type in `script-ast.mts` (K268).
- kit-sync, kit-check and lint-ts read the installed @polyspec/kit of any version: npm ci enforces the lock at install time by its integrity, and a local link of a kit checkout, the state of development, is no longer refused for its version (K267).
- kit 0.0.54 is released with the common standard of K243 to K266 (K263).
- The isolation test names only the other polyspec repositories: the history rewrite replaced the name of an outside project with the common word consumer, which the list refused everywhere (K266).
- The vendored knip.json allows no binary: K247 added `ignoreBinaries` php, on which knip of a repository that starts no php printed a configuration hint; the PHP extension test starts php through `execute` of process.mts, as the tool does (K247-1).
- The package tests build kit with `make kit-build`, and the scripts build and prepack of package.json run it too: K246 made `make build` the aggregate of the runtimes, which a copy without Git and the node of var/tools cannot run; the tests of the runtime targets and of the PHP extension name no other repository, as the isolation test requires (K246-1).
- The commit check refuses an AI tool as the author or the committer of a commit (`commit-ai-identity`), in a range, in the commit-msg hook and in `make commit`; the sandbox repositories of the tests name their own identity (K265).
- The commit check refuses the footer of an AI tool, a co-author or session trailer of one or a generated-with line (`commit-ai-footer`), in a range, in the commit-msg hook and in `make commit` (K264).
- A missing phpcs or PHPStan names `make install-tools`, which installs config/php-lint, instead of `make install-tools TOOLS=phpLint`, which install-tools refuses (K262).
- The layout rule suites-at-root applies: it lay among the templates of config/layout.kit.yml, which no rule extended, so no checkout ran it; the real layout test plants a suite in a package (K244-1).
- A PHP extension follows S10: it implements the PHP library `polyspec/<repository>` of `packages/php`, lies in `packages/php-ext/` with one stub `src/polyspec_<repository>.stub.php`, and is named `polyspec/<repository>-php-ext` and `polyspec_<repository>`; `php-extension.mts` checks the names and the stub hash of the arginfo header (`make lint-php-ext`), builds the extension with phpize into var/php-ext (`make build-php-ext`), writes the header with the gen_stub.php of the PHP (`make php-ext-arginfo`), and compares by Reflection what the extension registers with the PHP library before its unit tests (`make test-php-ext`); a layout rule refuses a stub elsewhere, kit's CI runs the lint and the tests, and knip allows the binary php (K247).
- The make targets of a task have fixed names that kit.mk and kit-bootstrap.mk define: `install`, `build`, `test` and `lint` run their target of each runtime of `packages/`, `build-<runtime>` runs the build of its ecosystem, and documents-check is `docs-check`; kit-check fails on a Makefile target that starts with a task's name and that kit does not define, and on a runtime without its build, test or lint target; the Claude Code hook refuses `make test`, which runs only in CI; kit's own targets are `kit-build` and `kit-install-symbols-php`, prerequisites of the fixed tasks (K246).
- The common layout fixes one place for each concern: `docs/` holds `spec/`, `operations/`, `plans/`, `rebuild/`, `features.md` and the files of a VitePress site, AGENTS, CHANGELOG and Makefile lie at the root, a folder of tests is `tests/`, and a `js` folder holds no TypeScript; kit's tool inventory moves to docs/operations/ (K245).
- `make test-<runtime> CASES=<pattern>` (`runtime-targets.mts`) runs the unit tests of each package of a runtime with the name filter of its runner; `make test-integration` and `make test-conformance` run the suites of `tests/integration/` and `tests/conformance/` of the root only in CI; a layout rule keeps the suites out of packages, and the Claude Code hook refuses a test target without CASES and a suite (K244).
- The rules check fails on a paragraph of a rule document beyond the one that introduces a section, so a rule is a list item with its check; kit's release procedure moves to docs/operations/release.md, and its AGENTS.md states the release and generated-file rules as list items (K243-1).
- The commit rules are the constant `COMMIT_RULES` of check-commits.mts, the same for every repository, and kit-check names a leftover `config/commits.json`; PRINCIPLES.md has a Workflow section with the rules of plans, items, verification and commits, and kit's AGENTS.md no longer restates them (K243).
- `make language-check` (`language-check.mts`) fails on Hangul in a comment, an identifier, an error or log message or a test name of the code, a string that is data excepted, and the commit check fails on Hangul in a commit message (`commit-language`); kit's CI runs both (K252).
- The duplication check names the command of jscpd that it runs, which the isolation test of kit reads (K248-3-1).
- `make test-markers-check` (`test-markers.mts`) fails on a test that a marker skips or narrows: `test.skip`, `it.only`, a `skip`, `only` or `todo` option of node:test or vitest read with the parser, and `t.Skip`, `unittest.skip`, `pytest.mark.skip`, `markTestSkipped` and `#[ignore]` on a line of code; kit's CI runs it (K255).
- A swallowed error fails the lint of its language: oxlint `no-empty` and `no-useless-catch`, ruff BLE001, S110 and S112, phpcs `Generic.CodeAnalysis.EmptyStatement`, clippy `let_underscore_must_use`, and errcheck of golangci-lint, each with a failing sample in the tests (K256).
- `make duplication-check` is a tool of kit.mk (`duplication-check.mts`), so every repository runs it: jscpd, now a dependency of the package, reads the code of the checkout in the formats of the runtimes outside the folders that `config/duplication.json` excludes with their reasons (K248-3).
- kit locks knip 6.42.0, @decimalturn/toml-patch 3.3.1 and ruff 0.17.1, the latest stable releases at the review of 2026-10-19 (K261).
- The CI workflow test compares `.php-version` with the PHP pin of kit instead of the literal 8.5 (K259-1).
- The commit check reads the type of a fix commit with `startsWith`, as oxlint requires (K257-1).
- The push gate refuses a pushed branch other than main that is not named `{type}/{shortname}-{checklist id}`, a worktree folder not named `{project}-{shortname}-{checklist id}`, and a local branch that main has merged, naming the command that removes it (K253).
- The commit check refuses a `fix` commit that changes no test file of a runner of kit (tests/, `*.test.*`, `*_test.go`, `test_*.py`, `*Test.php`), in a range, in the commit-msg hook and in `make commit` (K257).
- `make kit-check` fails on a symbolic link in the index of Git and names it, so no repository tracks a link that it creates (K254).
- The edits of the push gate test fail when the text holds no match, instead of leaving it unchanged (K260).
- `make commit ID= TYPE= SCOPE= SUBJECT= BODY_FILE=` commits the index with the message of an item, its body wrapped at the width of config/commits.json and its trailers kept, after the checks of the commit-msg hook (K249-4).
- An open checklist item names the commands that verify it, none of which the Claude Code hook refuses, so documents-check fails an item verified by a suite (`verification.mts`); `make item-test ID=` runs them; the checklist header is fixed as ID, Task, Deliverables, Verification and State; the hook follows a make target through its prerequisites and recipes and reads `run-tests.mts <runner> -- <args>` as that runner, so a repository's own suite target is refused as well (K249-3).
- kit pins PHP 8.4, the floor that the code and tools of the repositories need, instead of 8.5, which no code needs: `toolchain-pins.json` and `.php-version` declare 8.4, and the Composer projects of kit require `>=8.4` with the platform 8.4, or 8.4.1 for PHPUnit 13 (K259).
- The PHP symbol extractor passes phpcs: its visitor is the class `Polyspec\Kit\Symbols\PublicSymbols` of `PublicSymbols.php`, beside `extract.php`; the release of an extractor skips the vendor/ of kit's PHP lint and fails on another folder (K248-4-1).
- `make item-state ID= STATE=` moves an item along an allowed transition in both languages, sets done only when the working tree adds its line to both changelogs, writes the cause and the retry condition of a bypass and the cause of an impossible item, and refuses what the commit-msg hook would refuse (`workingItemFindings`); kit's config/commits.json declares its changelog, so the commit check requires the entry of a done item (K249-2).
- `make item-new PLAN= ID= TASK= TASK_KO= DELIVERABLES= VERIFICATION=` adds a waiting row to a checklist and its twin, a sub-item after the last sub-item of its parent, escapes a pipe of a cell, and refuses the findings of documents-check that the row would add; documents-check and the utility read the checklists through the one function `checklistsFindings` (K249-1).
- `make plan-new NAME= TITLE= TITLE_KO=` (`plan.mts`) writes a plan folder with its four files, doc-ids, language links, the checklist header and the revision markers, and refuses a name that is no slug, an existing plan and an empty title (K249).
- The comment of the Composer installer states that the commit reference pins each package and that the lock holds no archive digest, instead of claiming that Composer checks one (K258).
- A checklist row whose number of cells differs from the header of its table fails with the line and both counts, since the reading takes the state by position; the 31 such rows of kit's checklists are fixed (K242).
- kit's `make install-symbols-php` installs the packages of the PHP symbol extractor for the PHPStan of lint-php, kit's CI runs it before the lint, and `make build` leaves its vendor/ out of dist/ (K248-4).
- The export test of @polyspec/kit/test-output runs in tests/source on a built copy, so the vendored tests need no dist/ (K250-1).
- The go extractor test gives its sandbox a mise wrapper that names the installs of the checkout, which K199 builds the extractor with (K250-3).
- The K208 trust test removes CI and GITHUB_ACTIONS from the environment of the shim, since mise trusts every config file when either is set (K250-2).
- A sandbox repository of the tests sets receive.autogc to false, so a push into it starts no gc on git 2.43 (K250-4).
- The parity declaration test creates its repositories through initRepository and fails on a failed git command (K248-2-1).
- A plan is a folder `docs/plans/<plan>/` with `plan.md`, `checklist.md` and their Korean twins, and kit finds the checklists by these folders (K241): `config/checklist.json` holds only the hooks and the ID pattern; a checklist is a table with the five states, so the list format and the declared states are removed; a folder with another file or without its plan, an item ID in two checklists and a sub-item without its parent fail with the file and line; the document check again fails a document under docs/ with checklist items outside a plan folder, the check of K235 that K240 had removed with full-run; kit's execution checklist is split into the plans tool-unification and standards-enforcement, and local-links moves to docs/operations/.
- Every rule of PRINCIPLES.md and AGENTS.md ends with `Enforced by:`, and `make rules-check` (`check-rules.mts`) follows each named check from the CI workflows and the Git hooks through make, fails on a rule whose check no such point runs, and lists the rules that no tool enforces and those that a planned item will; the Claude Code hook also refuses `--no-verify`, a change of `core.hooksPath`, a loop that polls with a sleep and, in a consumer, an edit of a vendored file; kit's CI runs the PHP, Python and Go lints, the rules check and the parity declarations (K248).
- A checkout with at most one implementation folder needs no `config/parity.json`; one with two or more fails without it (K248-2).
- kit.mk defines `rebuild-check` and `rules-check`, so every repository runs them (K248-1).
- Every check step of the CI of kit runs after an earlier one failed, so one run shows every failure (K251).
- The common layout allows `.claude/`, where Claude Code reads its settings, and kit's layout allows `claude/`, the source of the vendored settings (K240-2).
- The full suite runs only in CI (K240): `make ci-targets`, a full `make parity-check`, the run of `make owner-check` and a test run that selects no test file, name or id refuse outside a GitHub Actions run (`ci-only.mts`, `test-selection.mts`); `full-run.mts`, its record, kit's `make check` and `make rerun-failed` are removed; kit vendors `.claude/settings.json`, whose PreToolUse hook (`claude-hook.mts`) refuses a Bash command that runs a suite target, a whole test runtime without a selection, or sets GITHUB_ACTIONS or CI.
- The isolation test reads the imports of a module through module-imports.mts, so a string that holds an option name such as `--import` is no import (K240-1).
- lint-ts passes again, and no module or test of kit names another repository (fsm and flowmark are in the list), the make tests assert what every make release prints, and the read-only link tests assert the behaviour of the writability that link reads, so a run as root passes (K250).
- A Python link runs no sync and changes only the linked packages (K239).
- A Python unlink restores the releases of every group and keeps the consumer project; the link checks dependencies with uv pip check, markers included (K238).
- A Python link keeps the packages the consumer installed and installs the dependencies of each linked checkout; unlink keeps them too (K237).
- A full `make parity-check` runs the full-run gate while make reads the makefiles, before any prerequisite a repository adds (K236).
- A document under docs/ with checklist items that no tracker declares refuses the full run and the gate (K235).
- kit has `make check`, its full suite through the full-run guard, and `make parity-check` without UNITS starts with `full-run gate`, which refuses while an item is waiting or active (K234).
- The full-run guard also refuses while an item is waiting (`[ ]`); only done, bypassed and impossible items may remain (K233).
- An implementation of `config/parity.json` can declare `shares`, the implementation of the same runner whose tests it runs in its own runtime; R6 accepts its bindings in that implementation's roots (K232).
- `make parity-check` folds the reports of a TypeScript coverage case that runs once per database item (`<case> [<database>]`) into that case, which passes when each report passes, as PHP data sets and Python items do; other repeated names are still R3 (K231).
- `make parity-check` matches the id that a PHPUnit feature binding declares, `<Class>::<method>` (the id PHPUnit reports) or the bare method, so an orm binding such as `RollbackTest::test_rollback_failed` passes instead of R3 not-executed; cargo reads a result that stands alone on its line after the output printed between a test's name and its result, so `identity_load` cases that connect to a database count as run (K229).
- Kit's parity declaration stays language-parity only: a consumer's interface manifest is reached through spec anchors, not a parity.json key (K227).
- `link` satisfies a dependency that the project itself provides and reports it as `workspace` instead of NOT linked: an npm workspace member that `npm query` lists at a folder of the project, and a Composer name of the root composer.json or of a path repository that it declares. A dependency that no checkout and no project package provides still fails (K226).

- The fingerprint of a Python editable wheel counts only the directories of tracked or new, not ignored, files, so a container's git-ignored var/ directories below a read-only checkout no longer change it and the host-built wheel is reused (K225).

- A word of a parity binding `command` may reference the invoking environment as `${NAME}`, resolved when the bindings run by the rule of the implementation's `command`, `args` and `env`: an unset or empty NAME is an R3 finding that names it, and that binding runs nothing. The runs printed `${NAME}` literally before (K223).
- `link` installs every Python project of a synced environment, the consumer's own and each workspace member with or without polyspec deps, through its editable wheel, as it installs a provider (K224): the sync is `uv sync --locked --no-install-project` (`--no-install-workspace` in a uv workspace root), so it no longer builds a project in place, which failed with `os.utime` on a read-only consumer checkout. Every wheel is resolved before the sync, so a missing one leaves the environment untouched. The wheel is built under `var/link/wheels/<name>/<fingerprint>/` where the package folder is writable, reused when read-only, and a read-only folder with no wheel fails with `stale prebuilt wheel <name> (fingerprint <fp>): run kit link on the host`. `check` verifies its installed wheel fingerprint. `unlink` still restores with the full `uv sync --locked` (K224).

- `link` links Python providers through editable wheels (K222): each provider is installed with `uv pip install --no-deps` from its wheel under `var/link/wheels/<name>/<fingerprint>/`, after `uv sync --locked`, instead of `-e` with an `--overrides` file. The wheel is built where the checkout is writable, through its pyproject backend in an isolated `uv run`, so a read-only checkout (a container mount) installs a prebuilt wheel and never writes into the tree; a missing prebuilt wheel there fails with `stale prebuilt wheel <name> (fingerprint <fp>): run kit link on the host`. `check` fails when the installed wheel has another fingerprint than the checkout. `restore` and `link` share the sync.

- `make parity-check UNITS="<id> …"` runs only the named units of `config/parity.json`: `scripts/kit/parity.mts --unit <id>` (repeatable) runs their bindings through the same runner, cwd and reader as a full run and reports their outcomes with the normal ledger lines. The cross-unit rules that need every unit (R1, R2, R4 to R11) do not run, and the output says so in one line. An id that no unit holds is an error that names it, with no run (K221).

- `link` links a private npm package of a provider checkout like any other: the `package.json` `name` of a manifest is provided whether or not it is `private`, since `private` stops publishing and says nothing about local linking, so the copy that npm installed from the tgz is replaced with a link and `check` passes. An npm package of any scope, such as `/*`, is linked when a provider provides its name, not only `/*` (K220). Two manifests of one name still fail with both, as before (K220).

- `run-tests python --module <name>` runs the Python tests through that module (`python -m <name> …`) in place of `unittest`, so a repository whose tests run through its own harness, such as orm's `packages.python.tests.testcase`, counts the cases of the harness with the same reader. The module is read only for the python tool (K219).

- `run-tests node` counts the cases that a helper module registers (a case function that calls `test()`, such as orm's `caseTest`) for the test file that `node --test` runs. node runs the files one at a time (`--test-concurrency=1`), so each case belongs to the file whose group event opened it, and a file of helper-registered cases no longer fails with `the file ran no test case`. A run in which no test ran still fails (K218).

- `nodeEvents` of `scripts/kit/test-output.mts` (`@polyspec/kit/test-output`) reads the lines of the node:test reporter of parity (parity-node-reporter.mts) into a sink, as goEvents, cargoEvents, pythonEvents and phpunitEvents read the output of their tools. The language-parity check reads the node cases through it, and a consumer counts the node:test cases of a run the same way; a run with no case reads none (K217).

- A parity binding names the command that runs it with `command`, an argv array that replaces the default command of its runner, such as `["make", "feature-check", "ITEM=…"]` for a feature that needs its own environment. The runner still reads the output of that command as it reads its default, the field is accepted on every unit kind, and a command that cannot start or exits with a status other than 0 is an R3 finding that names it, with no fallback to the default command (K216).

- `make parity-check` reads the timed cargo harness (libtest-mimic with timing, as the orm testcase crate prints it), whose outcome comes on the line after the test name, so a rust binding whose declared cases all pass counts each of them as passed (it counted 0 before). A suite run counts only the declared cases that passed, so the count never exceeds the declared number; an exit-0 run without a declared case fails and names it, and a failed run that names no test prints the last 20 lines of its output (K215).

- `make parity-check` runs a go feature with `-run ^(<top>|…)$`, one alternation of the top-level test names of its ids (the part before the first `/`), instead of the whole package, so a package of feature units runs its tests once per test file and a failure in an unrelated test no longer fails every unit. A suite run keeps its symbol (K214).

- `make parity-check` names the failing tests that a feature run reports outside its ids when the run exits with a status other than 0, read from `go test -json` (the fail events with a Test name) and from the node:test reporter; a run whose output names none says so (`failed outside the ids: no test name readable from the output`), where it used to print only the exit status (K213).

- `link.mjs link|check|unlink --project <dir>` reads the manifests of `<dir>` itself, tracked by Git or not, so an installation under a git-ignored tree (var/example/installation) links its npm copies without a package-lock.json. A `<dir>` with no manifest, or a declared polyspec package that a checkout provides and the run does not link, fails with a named error instead of exiting 0 (K212).

- `make install-tools` records the trust of the mise.toml of the checkout with `mise trust` in its state dir, and no environment variable trusts it; the python extractor of parity runs in a new worktree without the variable (K208).

- The rustdoc schema of the Rust symbol extractor reads format 61 (`format_version` 61, `macro` as a string), the format of the Rust nightlies of config/toolchain.json; R1 extraction failed on it (K207).

- `make install-tools` builds the go symbol extractor with `GOWORK=off` and in the Go environment of mise (`-mod=readonly`, GOPATH and GOCACHE under var/tools). The extractor is a module of its own under node_modules of the consumer, so the root `go.work` of a consumer, which does not list it, stopped its build with "current directory is contained in a module that is not one of the workspace modules listed in go.work" (template), and its module and build caches went to those of the machine (K196).

- R10 of `make parity-check` no longer reads a number after each or 각각 as a count of the implementations of its sentence ("Go module, Rust crate, PHP package, PHP extension, Python package도 각각 한 구현이다"), nor a run of implementation names with another item of its enumeration on both sides as a list of implementations ("Node.js, npm, Go, Rust, PHP minor version, Composer"); both true sentences of template failed the check (K197).

- `make install-tools` builds the go symbol extractor with the go of the consumer by its absolute path, the bin/go of the install that `mise where go` prints in the consumer root, instead of the shim of mise. In a consumer that links kit, the extractor sources resolve into the kit checkout, where the shim read kit's own mise.toml and stopped with "Config files in …/kit/mise.toml are not trusted" (template, K199).

- `make link`, `make link-check` and `make unlink` (scripts/kit/link.mts) make the local links of 0.0.x development (docs/plans/local-links.md): the main checkouts that `CHECKOUTS` names provide the packages, each provider is built with the prerequisites of its release-assets, the copies that npm's hidden lockfile and Composer's installed.json record become links to the provider folders, the Python packages are installed editable with one uv install with dependencies and an --overrides file, and each Go module gets a git-ignored go.work that go reads by itself. `make install-packages` neither builds nor links (K201, K205).

- `make parity-check` runs vitest with `--dir` set to the root of the implementation that holds the test. From the checkout root, vitest's discovery followed var/tools/mise/state/trusted-configs, a trust record of mise that links to the home folder, into old copies of the same test, so a case was reported twice (template, K202).

- The links of `make link` (scripts/kit/link.mts) link only packages pinned at 0.0.x

- `link.mjs` takes the checkouts as arguments and reads no environment variable (K205): `link.mjs link|check [--project <dir>] <checkout>...`, `unlink [--project <dir>]`. A consumer without kit runs `node <kit checkout>/dist/link.mjs`.

- `link` reports a Python provider as linked only when the environment holds its editable install. The installed state is read by the venv's own python (PEP 610 direct_url.json and the PEP 660 `__editable__` marker of RECORD) and again after each install; it used to trust the `uv pip freeze` path of the wheel, which a non-editable install shares, so a venv with the site-packages copy printed `linked`. Such a venv now fails NOT linked (K230).

## 0.0.53

- `make release-proof` checks that the release lists the asset of each sibling a wheel requires and compares no URL. It compared the sibling's URL with the URL that the draft lists, but GitHub lists the assets of a draft under an `untagged-` URL until the draft is published, so the first release with a sibling wheel failed its proof (crudui v0.0.6). The URL of a sibling, the asset URL of the tag, is checked before the release builds (K195).

## 0.0.52

- `config/owner-checks.json` takes `importers` and `modules` in an owner rule: a changed path runs the node tests of the `importers` globs that import it, directly or through other modules, as the import graph of owner-check reads them (`module-imports.mts`: amaro, acorn, acorn-walk; relative imports, re-exports, `import()`, `require()`, `import.meta.resolve('<specifier>')` and `siblingTool(import.meta.url, '<name>')`); `modules` names the modules that stand for a path that is no module, such as a schema or a fixture. `make owner-validate` fails on a path of such a rule that no test imports. kit's own rules use it: a change of a module of scripts/kit ran `make kit-test`, the whole tool suite, and now runs the tests that import it; the package files run the checks that read them (K191).

- make kit-check fails a repository that needs PHP and has no `.php-version`: a Composer package or the Composer consumer of `config/release.json`, or `php` of `config/toolchain.json`. The release workflow set up the PHP of `.php-version` only and otherwise kept the PHP of the runner, so a repository that pinned PHP elsewhere released with the PHP of Ubuntu and failed its release proof. The release workflow now runs make kit-check after make install-packages, before any release step (K193).

### Consumer migration

A repository that needs PHP and has no `.php-version` declares it with its PHP minor release, such as `8.5`, the minor of `php` of `config/toolchain.json` when it lists one, and runs make kit-sync for the new release workflow (K193).

For K191 nothing is required: a repository whose owner rule runs its whole test suite for a source change can declare `importers` with the globs of its node tests instead, and name a tool that a test only starts through `import.meta.resolve` (K191).

## 0.0.51

- make toolchain-check fails when mise.lock names a uv lock sidecar (`uv = { path = ".mise/locks/<tool>/<version>" }` of a `pypi:` tool) that Git does not track, or a tracked file of it is missing. mise's documentation says to commit the sidecar folder with mise.lock, and `mise install --locked` of a checkout without it fails with "dependency sidecar … No such file or directory"; a repository that deleted or never committed it now gets the finding with the fix (K192).

- make lint-ts keeps an ignore of the copy of knip.json only where knip needs it, as knip itself decides: a first run of knip with the reporter `knip-ignore-hints.mts` gives knip's configuration hints of the ignores that matched no issue, and those are left out of the configuration of the lint. A repository whose scripts import `@polyspec/kit` got the hint "Remove from ignoreDependencies" for the copy, which it cannot fix; it now gets none. This replaces the filter by the declared packages of K176, which the same run covers (K188).

- make dependency-review UPDATE=1 runs its npm commands (npm install, npm audit fix, npm dedupe) with allow-remote=root, the setting of npm ci in make install-packages: `kit-bootstrap.mk` exports `npm_config_allow_remote=root` to both recipes as the one source of the setting. npm audit fix ran without it and refused the URL-pinned `@polyspec/kit` with EALLOWREMOTE; the recipe of install-packages is now `npm ci`, which reads the same setting (K189).

- make python-lock with the `pyproject.toml` of a wheel package of config/release.json as its source leaves out of the resolution each requirement that names a sibling (another wheel package of the configuration) by the URL of its release asset, exactly the requirements that wheel-dependencies classifies as sibling links: uv runs with `--excludes` of their names, and make python-lock-check leaves them out of its comparison. Such a URL exists only once the release publishes it, so the lock failed on a 404 and a wheel that depends on a sibling could not be locked; a URL requirement that names no sibling is resolved and checked as before (K190).

- kit-check's recipe-tools check fails on a recipe line that already contains `KIT_MAKE_REFERENCE_`, the placeholder it puts in place of a make reference while shell-quote splits the line. Such a word was read as a reference: one beyond the references of the line became an empty word and was dropped, one within them took the word of another; the line now fails with its text and the fix, rename that variable (K187).

### Consumer migration

A repository whose mise.toml declares a `pypi:` tool commits the `.mise/locks/` folder that `make toolchain-lock` writes, with mise.lock; one that deleted it runs `make toolchain-lock` again (K192).

## 0.0.50

- The php bindings of parity run the PHPUnit of the vendor directory that Composer gives their package, as run-tests and lint-php do (composer-vendor.mts): the package's own, or that of the nearest Composer project above it. A Composer monorepo, whose root composer.json requires its libraries through path repositories and installs one root `vendor/` (K163), reported every php binding as R3 not-executed with "`<package>/vendor/bin/phpunit` does not exist"; it now runs them, and a package with no vendor directory up the tree still fails with the fix (K178).
- kit-check's recipe-tools check (K171) splits a recipe line by the quoting rules of the POSIX shell: a quoted string is one word, and a `|`, `;` or `&&` inside quotes is no operator. A help line such as `@echo "build-ts|go|…"` was reported as starting go by its bare name, and had to be reworded; it passes now, and `foo | node x` still fails (K179).
- A release that sets the version of a composer.json re-locks it with `composer update --lock` in its directory: the content-hash of `composer.lock` covers `version`, so a version bump alone leaves a stale lock, which `make dependency-policy-check` fails (`composerLock`). The release procedure of AGENTS.md and docs/operations/tool-inventory.md says so, and `make dependency-policy-mutation-check` gains the mutation of a version change without a new lock, which the gate must reject (K180).
- make dependency-policy-check checks every Composer manifest of the checkout: a tracked composer.json that `composerPlatforms` does not name, and that no path repository of a manifest it names provides (K168), fails with the rule `composerCoverage`. Before, a repository that listed no Composer platform ran `composer validate --strict` on none of its manifests, so a lock that a version bump outdated stayed stale through a release. A manifest that kit writes, the symbol extractor project that kit ships and the Composer consumer project of `config/release.json` are not checked (K181).
- `config/owner-checks.json` takes `ciExempt`: the make targets of its owner rules that the CI workflow of the repository does not run, each with its reason. kit's CI workflow test requires a step for every other owner target; kit's CI now runs make toolchain-check, kit-check and release-coverage, whose failures stayed hidden until a local run, and exempts hooks-check, which needs the local core.hooksPath that make install-hooks writes (K183).
- The recipe-tools check of kit-check splits a recipe line into shell words with the `parse` of shell-quote 1.12.0, a new dependency of kit, instead of a splitter of its own (K179); the words of every recipe of kit and of the existing cases are the same, and a nested make function such as `$(if $(RANGE),--range $(RANGE))` no longer yields the stray command `if` (K184).
- run-tests, lint-php and the php runner of parity ask Composer for the vendor directory of a Composer project: `composer config vendor-dir`, run with the Composer of mise.toml of the checkout in the folder of the composer.json, offline, instead of kit's copy of the rule (K163, K178). `config.vendor-dir` of a composer.json, which kit ignored, now counts besides `vendor` and `COMPOSER_VENDOR_DIR`; the search for the nearest Composer project above a package stays. These tools now need the Composer of mise.toml (`http:composer`), which make install-tools installs (K184).
- `kit-bootstrap.mk` defines `$(NODE)`, the node of the checkout that the bootstrap installs, before the package is installed, as it defines `$(NPM)`. A recipe of the repository that runs before kit.mk exists, such as a step that install-packages needs, got an empty `$(NODE)` and had to name var/tools/bin/node itself (K185).
- run-tests phpunit runs the PHPUnit of the nearest Composer project at or above `--cwd` that has one, as parity and lint-php do (K178), through the same function of composer-vendor.mts. A package of a Composer monorepo, which has no vendor directory of its own, had to pass the root as `--cwd`; it now runs from its own folder (K186).

### Consumer migration

Each composer.json that make dependency-policy-check reports under `composerCoverage` gets an entry `{ "manifest": "<path>", "php": "<minimum PHP>" }` in `composerPlatforms` of `config/dependency-policy.json`, with `config.platform.php` of the manifest set to that PHP, a lock that `composer update --lock` writes for it, and `make dependency-review RECORD=1` (ONLINE); a published package of a Composer monorepo is instead required through a path repository of the root (K181). A release that sets the version of a composer.json runs `composer update --lock` in its directory before `make dependency-review RECORD=1` (K180).

## 0.0.49

- `ignore` of `config/knip-entries.json` declares the files that are not code of the repository, and neither knip nor oxlint reads them: make lint-ts gives oxlint an `--ignore-pattern` for each glob, as it does for the copies of kit, besides adding it to the `ignore` of knip. Such a file, such as an input of the tests of a build tool that is broken on purpose, no longer fails the type-aware rules of oxlint on its unresolvable imports; the same violation outside a declared glob still fails (K172).
- make install-vscode exits after its download. `@vscode/test-electron` 3.1.0 left a `tar -xzf -` child of a failed download attempt ("aborted") running, so the install hung after a retry succeeded, until the CI job's timeout. The install runs the download in a process of its own and kills its process group when the download settles; a download whose every attempt fails fails the install with the error of `@vscode/test-electron` (K173).
- A test that imports the build output of its package (`../dist/…`) counts for knip as a use of the source once `tsconfig.json` references the build project; kit adds no option for it, since knip honours TypeScript project references and its `paths` miss a dist that exists (K175).
- make toolchain-lock runs before the node of the checkout exists. In 0.0.48 it ran `var/tools/bin/node`, which the bootstrap installs from the node that `mise.lock` pins, so a repository whose `mise.lock` did not pin node yet could neither lock nor bootstrap. The node of the machine (`$(BOOTSTRAP_NODE)`) now starts it, and it installs the mise of `config/toolchain.json` itself, as the bootstrap does (K174).
- knip prints no configuration hint about the copied `knip.json` (K176). make lint-ts keeps each `ignoreDependencies` entry of knip.json (`@polyspec/kit`, oxlint, oxlint-tsgolint, jscpd) only when a package.json of the repository, the root or a workspace of `config/knip-entries.json`, declares it, and knip.json has no `ignoreBinaries` any more: no copy of kit runs a binary that knip reports, and node, git, python3 and cargo are global binaries of knip. knip always reads `var/lint-ts/knip.json`.
- The dependency review reads the groups of `[dependency-groups]` (PEP 735) of each pyproject.toml of `pythonManifests`, besides `build-system.requires` and the extras, with each `{ include-group }` resolved as PEP 735 specifies; a requirement that only a dependency group declared, such as a test-only one, escaped the review. `make dependency-review UPDATE=1` already pinned it, and the review and pin-python-dependency now read the arrays through one module (K177).

### Consumer migration

Run `make kit-sync`, which writes `knip.json` without `ignoreBinaries` (K176). Then each binary that make lint-ts reports as an unlisted binary, such as make, go, php, composer, rustup or shasum that a script or test of the repository runs, goes into `binaries` of `config/knip-entries.json` with its reason (K176).

A pyproject.toml of `pythonManifests` pins each requirement of its dependency groups exactly (`name==version`), as it does its extras, and an include-group names a group of the file; then `make dependency-review` records them, and the gate fails until it does (K177).

A file that oxlint reported and that is not code of the repository goes into `ignore` of `config/knip-entries.json` with its reason, instead of a disable comment or an ignore of oxlint (K172). A repository that installs VS Code takes the fix of make install-vscode with the kit update; nothing changes in its configuration (K173). A package whose tests import its `dist` and whose exports knip reports unused keeps its build in a tsconfig of its own with `outDir`, `rootDir: src` and `composite: true`, and lists it in `references` of `tsconfig.json`, which keeps the tests; `docs/operations/tool-inventory.md` shows the setup (K175).

A repository whose `mise.lock` does not pin node, as one that moves from 0.0.47, runs in this order (K174):
1. `make install-packages`, which installs this kit.
2. Declare node in `mise.toml` as the 0.0.48 note describes, then `make toolchain-lock`, which writes the node of `mise.lock`.
3. `make install-tools TOOLS=npm`, which installs mise, that node and npm into var/tools.
4. `make kit-sync` and `make install-tools`, which run the node of the checkout.

## 0.0.48

- The copied `.github/workflows/release.yml` pins actions/checkout v7.0.1, actions/setup-node v7.1.0 and shivammathur/setup-php 2.40.0, each by the full SHA of its release; setup-php had been pinned by the SHA of the moving tag v2. The two majors change none of the inputs that the workflow passes (K169).
- Each checkout runs its own Node.js (K171). `node` is a tool of `mise.toml`, at the pin of kit, and `mise.lock` pins the archive of each platform; `.node-version` is gone, and the layout of kit no longer allows it. `make install-tools TOOLS=npm` starts with any node of the machine and installs the mise of `config/toolchain.json`, then the node of `mise.toml` with it, then the npm of `packageManager`; `var/tools/bin/node` runs that node by its absolute path, and the wrappers npm and npx run npm with it, so `npm ci` and every later step run the node of the checkout. The bootstrap no longer compares the running node with a declaration. `make toolchain-check` runs `var/tools/bin/node` and names `make install-tools TOOLS=npm` as the fix. `config/toolchain.json` no longer accepts `node`.
- kit.mk starts each tool of the checkout by its absolute path: `$(NODE)` (`var/tools/bin/node`), `$(NPM)` and `$(ALINT)`; `$(BOOTSTRAP_NODE)` is the node of the machine, which only starts the bootstrap. make 3.81, the make of macOS, looks up a recipe line without shell syntax on the PATH that make started with, not on the PATH that kit.mk exports, so every `node $(KIT)/…` recipe ran the node of the machine on a Mac. `make kit-check` fails a recipe of the Makefile that starts a tool of the checkout (a wrapper of var/tools/bin or a command of `mise.toml`) by its bare name (K171).

- kit pins Node.js 26.12.0 (`scripts/kit/toolchain-pins.json`), the newest release: `node` of `mise.toml` must be it and `engines.node` of every `package.json` `>=26.12.0`. Each checkout installs it into var/tools when it takes this kit, so no machine's node changes (K169, K171).

### Consumer migration

Run:
- `make kit-sync`, which writes `.github/workflows/release.yml` (K169, K171) and the copies of `scripts/kit/bootstrap` and `scripts/kit/kit-bootstrap.mk` (K171).
- `make toolchain-lock`, after the change below, then `make install-tools TOOLS=npm` and `make install-tools` (K171).

Change:
- Move the Node.js release from `.node-version` to `node = "26.12.0"` in `[tools]` of `mise.toml`, set `engines.node` of every `package.json` to `>=26.12.0`, and delete `.node-version`; CI's setup-node reads `node-version-file: mise.toml` (K171).
- Remove `node` from `config/toolchain.json`, with any download of the repository that read it; mise installs the node (K171).
- Start each tool of the checkout in a recipe of the Makefile by its absolute path, with the variables of kit.mk (`$(NODE)`, `$(NPM)`, `$(ALINT)`) or `$(CURDIR)/…`, never by its bare name; `make kit-check` names each such line (K171).

## 0.0.47

- The copied `.oxlintrc.json` fails a non-null assertion as an error (`typescript/no-non-null-assertion`): a value whose type admits undefined or null, such as an entry of a list or a group of a regular expression under `noUncheckedIndexedAccess`, is read with a check. kit reads it with `present` of `scripts/kit/present.mts`, which throws with the expression that it expected, and its tests with `known` of `tests/kit/known.mts`, which asserts it (K156).
- The type-aware rules of the copied `.oxlintrc.json` apply to TypeScript files only (`**/*.{ts,mts,cts,tsx}`, an oxlint `overrides` entry), as typescript-eslint's `disableTypeChecked` turns them off for JavaScript: the `no-unsafe-*` rules, `no-unnecessary-type-assertion`, `no-floating-promises` and the type-aware rules of the correctness category. In a plain .js or .mjs file every untyped parameter is `any`, so 0.0.46 reported thousands of findings that only meant that the file is JavaScript. `ban-ts-comment`, `no-explicit-any`, `no-non-null-assertion` and the rest of correctness still apply to every file (K170).

### Consumer migration

Run:
- `make kit-sync`, which writes `.oxlintrc.json` (K156, K170).

Fix:
- Nothing for the JavaScript files that 0.0.46 reported: after make kit-sync the type-aware rules no longer read them, and a TypeScript file is linted as before (K170).
- Each `!` that `make lint-ts` now reports, never with a disable: destructure the value and check it, or read it with a throwing accessor of the repository that names what it expects (K156).

## 0.0.46

- The copied `.oxlintrc.json` forbids the escape hatches from the types of TypeScript as errors: `typescript/ban-ts-comment` forbids `@ts-ignore` and `@ts-nocheck` and requires a description after `@ts-expect-error` (`// @ts-expect-error: <why>`), and `typescript/no-explicit-any` and `typescript/no-unnecessary-type-assertion` fail an explicit `any` and a type assertion that changes nothing. A repository had silenced tsc with `@ts-expect-error` on code that type-checks and with casts. `readJson` of the copy `scripts/kit/bootstrap/files.mts` returns `unknown` instead of `any` (K155).
- In a consumer, `make lint-ts` leaves the copies of kit out of oxlint: one `--ignore-pattern` for each file of `kit.copies` of the installed package, the record that make kit-sync writes and make kit-check compares byte for byte. kit lints its copies with its own tsconfig and the types of node; in a consumer oxlint-tsgolint checked them outside the project, where every `node:*` import is `any`. An installed kit that is not the version of package-lock.json fails make lint-ts with the finding of make kit-check. The copies `scripts/kit/bootstrap/files.mts` and `digest.mts` take bytes as `NodeJS.ArrayBufferView` again, which K150 had narrowed only for that lint (K157).
- `make dependency-policy-mutation-check` fails with one finding when a `go.work` uses a module whose go.mod Git does not track, such as an ignored clone of a sibling repository: it names go.work and the `use` path and states that a committed go.work may only use tracked modules. The copy of the check holds the tracked files only, so it had thrown ENOENT with a stack while reading that go.mod (K160).
- `config/knip-entries.json` declares a dependency of the root that no JavaScript imports and only make runs, such as the template compiler that hyper installs by its URL for its recipes, in `ignoreDependencies` (`{ "<package>": "<reason>" }`), and make lint-ts adds it after the `ignoreDependencies` of knip.json in `var/lint-ts/knip.json`: knip does not read a Makefile, so it reported the dependency unused (K159).
- The copied `.oxlintrc.json` turns `oxc/number-arg-out-of-range` off: it allows 0 to 20 fraction digits for `toFixed` and `toExponential` and a precision of 1 to 21, the limits before ES2018, which raised them to 100 (ECMA-262 `Number.prototype.toExponential`), so it failed valid code such as `toExponential(25)`. oxlint 1.88.0, the latest release, and oxc main keep the old limits, and no oxc issue reports it (K161).
- Every JSON that a tool of kit reads, a file or the output of a command, is validated against a schema file of `scripts/kit/schema` (JSON Schema 2020-12, the strict Ajv2020 of `schema-validate.mts`) and typed by ajv's type guard, never cast: `readConfig<T>(root, file, schema)`, `readJsonFile<T>` and `parseJson<T>(text, schema, source)` return T or throw a `SchemaError` that names the file or the command and the JSON Pointer of each error of ajv, and `readConfigFindings<T>` gives a check those lines as findings. `readConfig` now throws instead of returning `{ value, errors }`, and its caller names T. New schemas describe the parts of package.json, package-lock.json, composer.json, composer.lock, knip.json and of the output of gh, npm, composer, go, cargo, pip, vitest and rustdoc that kit reads, and the records that kit writes itself. A manifest of a repository that breaks them, such as `workspaces` that is not a list, now fails with the file and the JSON Pointer. The bootstrap, which runs before ajv is installed, reads a JSON object with `readJsonObject` of the copy `scripts/kit/bootstrap/files.mts` and checks each field. `scripts/kit/kit-check.mts` is the example caller (K158).
- `make lint-php` runs PHPStan on a Composer package with the autoloader that Composer gives its files: the `vendor/autoload.php` of the package, or of the nearest Composer project above it, such as the root development composer.json of a Composer monorepo that requires its libraries through path repositories; `COMPOSER_VENDOR_DIR` names another vendor directory, as for the PHPUnit of run-tests, and both resolve it with `scripts/kit/composer-vendor.mts`. It required `<package>/vendor/autoload.php`, which a library of such a monorepo, with no lock and no vendor/ of its own, never has. A package with PHP files and no autoloader in it or above it still fails, now naming the project that may install it (K163).
- `config/knip-entries.json` declares in `ignore` (`{ "<glob>": "<reason>" }`) the files that are unused by design, such as a sample source file that a site shows and nothing runs or imports, each glob relative to the root with its reason, and make lint-ts adds them after the `ignore` of knip.json in `var/lint-ts/knip.json`, knip's documented option for such files. An undeclared unused file still fails (K162).
- The copied `.golangci.yml` turns staticcheck `ST1005` ("error strings should not be capitalized") off: a polyspec error string is a cross-port message of the repository's spec, which every port returns byte for byte, so it keeps the spec's capitalization. The other checks are the default of golangci-lint 2. It also sets `issues.max-same-issues` and `issues.max-issues-per-linter` to 0, so every finding is reported: the default caps of 3 issues of the same text and 50 of one linter hid 118 of 121 findings in a repository (K164).
- `run-tests phpunit` takes `--php-extension` more than once and loads each extension with its own `-d extension=<path>`, PHP's own way, in the given order, so an extension loads after one that it depends on; each is checked as built before the tool starts. A repository can load two extensions, one depending on the other, in one PHPUnit run (K165).
- The copied `.oxlintrc.json` fails every unsafe flow of `any` as an error: `typescript/no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access` and `no-unsafe-return` fail an any value as an argument, an assignment, a callee, the object of a member access or a return value, and `typescript/no-unsafe-type-assertion` fails a type assertion that narrows a type. kit reads its JSON through its schemas (K158), narrows an unknown value by a check, reads a value that it knows to be there with `present` of `scripts/kit/present.mts` and an errno code with `errorCode` of `process.mts` (K157).
- `make python-lock` runs the uv shim with the mise environment of the checkout, as `make python-venv` does, so `node scripts/kit/python-lock.mts` outside make no longer fails with `Config files in <checkout>/mise.toml are not trusted`; the real tests of the Python tools give their own calls of a shim the same environment (K157).
- The build backend of the Python wheels has one declaration, `pythonBackend` of `config/toolchain.json`, which is a tool pin: install-tools installs it, and `make release-backend`, `release-assets` and the wheel build read it there. `buildBackend` of `config/release.json` is gone from its schema. A repository that declared only `buildBackend` had no backend installed by install-tools, so its release failed in release-assets (`setuptools-84.0.0 wheel is missing`). A `config/release.json` with a `wheel` package or the wheel consumer and no `pythonBackend` now fails `make kit-check` and the release with the fix (K166).
- `make release-coverage` takes the files that kit writes as not released, derived from kit's own record, so no repository classifies them: a copy of `kit.copies` of the running package, such as `config/php-lint/composer.json`, the Composer project of PHPUnit, `config/phpunit/composer.json`, and the lock tree of mise under `.mise/locks/`, such as `.mise/locks/<tool>/<version>/pyproject.toml`. The copied `config/layout.kit.yml` allows the root `composer.json` and `composer.lock` of a Composer monorepo, as it allows `package.json` and `package-lock.json` (K167).
- `make dependency-review` reviews the requirements of the published packages of a Composer monorepo: the first-party requirements of a root composer.json of `composerPlatforms` are its `require` and `require-dev` and the `require` of each package that a `path` repository provides (a path dist entry of the root lock), at the versions of the root lock, and the review runs `composer outdated --locked --all --format=json` once at the root and keeps those packages. `--direct` counted only the requirements of the root, so a requirement of a published package, such as symfony/console, dropped out of the review. A library that only a third-party package requires is still not reviewed. `UPDATE=1` raises a requirement of a published package with `composer require --no-update` in its directory and `composer update --with-dependencies` at the root (K168).

### Consumer migration

Run:
- `make kit-sync`, which writes `.oxlintrc.json` and the copies of `scripts/kit/bootstrap` (K155, K157, K161, K166).
- `make kit-sync`, which writes `.golangci.yml`, then `make lint-go`: it now reports every finding that the caps had hidden, each fixed in the code (K164).
- `make dependency-review RECORD=1` in a Composer monorepo, which records the requirements of the published packages; `make dependency-policy-check` fails until the record holds them (K168).

Add:
- `ignoreDependencies` in `config/knip-entries.json` for each root dependency that only make runs, such as `@polyspec/template-compiler` (hyper), with its reason (K159).
- `ignore` in `config/knip-entries.json` for each file that knip reports unused by design, such as a sample that a site shows, with its reason (K162).

Fix:
- Each new finding of `make lint-ts` in the code, never with a disable: a `@ts-ignore` or `@ts-nocheck` and a cast or `any` that silences tsc go, and the code is typed so that tsc passes; a `@ts-expect-error` that a test needs states the error it expects (K155).
- A `go.work` that `make dependency-policy-mutation-check` reports: commit the go.mod of the module that it uses, or remove the `use`; a local clone of a sibling repository goes into an uncommitted go.work or `GOWORK` (K160).
- Each manifest or configuration that a tool now refuses with a JSON Pointer of its schema, such as a package.json whose `workspaces` is an object or a composer.json whose `repositories` is an object: write it in the form of the schema (K158).
- A library of a Composer monorepo that held a lock or a vendor/ of its own only for `make lint-php`: drop them and run `composer install` in the root development project, whose vendor/ now serves the lint (K163).
- Each new finding of `make lint-ts` of the `no-unsafe-*` rules in the code, never with a disable or a cast: read JSON through a schema or narrow the unknown value of `JSON.parse` by a check, and catch an error as unknown and check it with `instanceof Error` (K157).
- The tsconfig of the repository: include every TypeScript file that `make lint-ts` lints, the scripts and benchmarks too, and exclude `scripts/kit`, the copies of kit. A file outside the project has no types, so each call of an import there fails `typescript/no-unsafe-call` (K157).
- `buildBackend` of `config/release.json`, which `make kit-check` now refuses: move it to `pythonBackend` of `config/toolchain.json` (`{ "requirement": "<name>==<version>", "sha256": "<sha256 of its wheel>" }`) and run `make install-tools` (K166).
- The entries of `notReleased` in `config/release.json` for files that kit writes (`.mise/locks/…`, `config/php-lint/composer.json`, `config/phpunit/composer.json`) and `composer.json` and `composer.lock` in `vars.root_files` of `config/layout.yml`: drop them, since kit covers them now; `make kit-sync` writes `config/layout.kit.yml` (K167).

## 0.0.45

- knip.json ignores the binaries of the runtimes that polyspec pins by mise or by its setup, php, composer, python3, cargo, node and git, besides make, go, rustup and shasum: a script that spawned php or composer was an unlisted binary. A system tool of one repository, such as Apple `container`, is declared with its reason in `binaries` of `config/knip-entries.json` (`{ "<name>": "<reason>" }`), which make lint-ts adds to `ignoreBinaries` as it adds `entries` to the entries; `entries` is now optional (K152).
- `make dependency-policy-mutation-check` copies `go.work` and `go.work.sum` with the dependency files: without them a module whose only requirement is another member of the workspace was asked for a go.sum that it cannot have, so the check failed on template (`tools/showcase/adapters/go`) while `make dependency-policy-check` passed (K153).
- `config/knip-entries.json` declares a nested npm project with a package.json of its own as a knip workspace: `workspaces` maps its directory to its reason, its `entries` relative to it and its `ignoreDependencies` (each dependency that no JavaScript of it imports, such as one that only Rust tests load), each with a reason, and make lint-ts adds it to `workspaces` of `var/lint-ts/knip.json`. As root entries its dependencies were unlisted at the root (ssr `packages/build/tests/fixtures`); knip's Svelte plugin compiles its `.svelte` files (K154).

### Consumer migration

Run:
- `make kit-sync`, which writes knip.json (K152).

Add:
- `binaries` in `config/knip-entries.json` for each system tool of the repository that a script spawns and knip reports as an unlisted binary, such as `container` (hyper) or `gmake` (template), with its reason (K152).
- `workspaces` in `config/knip-entries.json` for each nested npm project, such as ssr `packages/build/tests/fixtures`, with its reason, entries and ignored dependencies, instead of declaring its files as root entries (K154).

## 0.0.44

- A tool of kit resolves the repository root itself, the top level of the Git work tree of its working directory, so a tool started below the root, as `npm -w` starts it in a package directory, reads and writes the paths of the repository; `ROOT` of `paths.mts` is now `repositoryRoot()`, read on its first use, and a tool that needs the root fails outside a Git work tree (K144).
- `config/release-assets.json` pins the release archives of other polyspec repositories once, each with its version, URL (`{version}`), sha256 and directory under the ignored var/; `make release-assets-fetch` (ONLINE) downloads each one that var/ lacks with its sha256 checked and extracts a zip with `unpack`, `release-assets.mts version <name>` gives a Makefile the version, and `consumers.composer.polyspec` of config/release.json puts the release zips of polyspec dependencies into the artifact repository of the Composer consumer, which release-tools fetches (K140).
- A repository adds knip entries without editing the copy knip.json: `config/knip-entries.json` maps each file that make runs outside the layout entries to its reason, and make lint-ts runs knip with knip.json and those entries (`var/lint-ts/knip.json`); knip.json holds no comments any more, so lint-ts reads it as JSON (K145).
- `layout-root-files` adds the root files of a repository to the list of kit: config/layout.yml sets only `vars: { root_files: "{a,b}" }`, a glob alternation of its own files, and make layout-check fails on an override of the `paths` of that rule (`layout-root-files-additive`), which replaced the list of kit (K145).
- `make install-tools` installs the Rust toolchain of `rust-toolchain.toml` with its components by `rustup toolchain install --no-self-update` in the checkout, which reads the file: rustup 1.28 no longer installs it as cargo first runs, so every CI job that ran cargo failed with `toolchain '1.99.0-x86_64-unknown-linux-gnu' is not installed`. A missing rustup fails with its install, and `make toolchain-check` names a toolchain that is not installed with the fix `make install-tools` (K151).
- `make install-tools` removes every file of `var/tools/bin` that kit no longer writes, such as the `go`, `gofmt`, `python3` and `alint` wrappers of kit 0.0.38: those tools now come from mise, and the old wrappers, first on PATH, shadowed the shims of mise. It keeps mise, npm and npx of the bootstrap and the wrappers of the declared Composer projects (K149).
- The copies `scripts/kit/bootstrap/files.mts` and `digest.mts` take bytes as `Uint8Array` instead of `NodeJS.ArrayBufferView`: a consumer's tsconfig does not cover the copies of kit, so oxlint-tsgolint checked them without the types of node, and the unresolved type failed `typescript/no-redundant-type-constituents` in ordered-json on 0.0.43 while kit's own lint passed. Run make kit-sync (K150).
- ruff keeps its cache in `var/ruff` by `cache-dir` of the copied `ruff.toml`: `make lint-python` left `.ruff_cache` at the repository root, which layout S5 refuses unless ignored. Run make kit-sync and remove `.ruff_cache` (K147).

### Consumer migration

Run:
- `make kit-sync`, which writes `ruff.toml` and the copies of `scripts/kit/bootstrap` (K147, K150), then `make install-tools`, which installs the Rust toolchain of `rust-toolchain.toml` and removes the stale wrappers of `var/tools/bin` (K151, K149). A CI job that runs cargo runs `make install-tools` before it.

Remove:
- `.ruff_cache` at the root, and its entry in `.gitignore` if one was added for it (K147).

Add:
- `config/knip-entries.json`: declare each file that make runs outside the layout entries of knip.json, such as a test probe, with its reason (`{ "schema": 1, "entries": { "<glob>": "<reason>" } }`), instead of leaving it unused (K145).
- `config/release-assets.json` for each release archive of another polyspec repository that the repository downloads, and `make release-assets-fetch` in its install target; remove the own downloader (hyper `scripts/template-assets.mts` and `config/template-assets.json`, fsm the `composer-artifacts` recipe and `config/composer-artifacts.txt`). A Makefile that needs a tag reads it with `$(shell node $(KIT)/release-assets.$(KIT_EXT) version <name>)`; a destination lies under var/, so a Composer `artifact` repository names that directory (K140).
- `consumers.composer.polyspec` in config/release.json for a Composer consumer that installs a polyspec dependency, with `require` of its version in the consumer composer.json, instead of an inline package repository; run make release-consumer-lock again (K140).

Change:
- `config/layout.yml`: replace an override of the `paths` of `layout-root-files` by `vars: { root_files: "{a,b}" }` that names only the root files of the repository, such as `- id: layout-root-files` with `vars: { root_files: "{tsconfig.build.json}" }`; make layout-check fails on the override (K145).

## 0.0.43

- parity runs a cargo binding whose test is tests/<name>/main.rs as `--test <name>`, Cargo's layout of a test target with modules, and counts the other files of tests/<name>/ as modules of that binding rather than tests of no binding (K148).
- knip takes the files that make runs as entries by the layout: the scripts under `scripts/` with the copies of kit, the programs of `benchmarks/` and every node:test file, and `@polyspec/kit`, which the Makefile includes, is no unused dependency; kit lints itself with make lint-ts in CI and fixed what it found, among them the template literal of `scripts/kit/bootstrap/install-mise.mts` that failed the lint of every consumer. Run make kit-sync (K142).
- `make dependency-review` and `make dependency-policy-check` name a missing configuration file (`config/dependency-policy.json is missing; …`) and end with status 1 instead of failing with the stack trace of the read; every other error keeps its stack (K146).
- mise.toml may declare cargo-nextest (`"github:nextest-rs/nextest" = { version, version_prefix = "cargo-nextest-" }`) and cargo-deny (`cargo-deny`, the aqua backend of the registry of mise): mise.lock pins their native binaries for every platform and make toolchain-check reads their `--version`; kit refused both before (K143).
- run-tests stops the whole process group of the tool, with SIGKILL after a 5 s grace period, at a test's timeout and when the runner itself is interrupted (SIGINT, SIGTERM, SIGHUP); an interrupted runner left the tool and the processes it started, such as the interpreter behind the mise shim, running as orphans (K141).
- `no-floating-promises` allows the top-level registrations of node:test (`test`, `describe`, `it`, `suite`) with the option `allowForKnownSafeCalls` of typescript-eslint, since the runner awaits them; a real floating promise in a test still fails. Run make kit-sync (K138).
- API Extractor no longer reports `ae-missing-release-tag`: polyspec tags no export with `@public` or `@beta` and writes no trimmed rollup, so `make lint-ts` failed every package on it; run make kit-sync (K139).
- parity reads the cases of a cargo binding whose test target runs libtest-mimic (`harness = false`), which pads each test name to the longest one before `...`; it read none of them (K136).
- A php suite binding names its test method as `symbol`, `<class>::<method>` of a fully qualified class: parity runs that method alone with `--filter`, and each data set `<method> with data set "<case>"` of its data provider is the case `<case>`. Before, a data set mapped to no case and every other test of the file was an undeclared case of the unit (K137).

### Consumer migration

Change:
- A php suite binding whose cases are the data sets of one test method declares `"symbol": "<Namespace>\\<Class>::<method>"`; a binding whose cases are test methods `test_<case>` stays as it is.

## 0.0.42

- The bootstrap writes `var/tools/go.mod`, so the Go of mise and its test sources under `var/tools` are a module of their own that `./...` of a repository whose root is a Go module does not walk (K135).
## 0.0.41

- mise.lock pins the archives of linux-arm64 and macos-x64 too, every platform on which the bootstrap installs mise; 0.0.39 and 0.0.40 failed make install-tools on ARM Linux runners (K134).
## 0.0.40

- kit-sync removes a file of `scripts/kit/` that the package no longer declares, such as `scripts/kit/bootstrap/bootstrap-npm.mts` after 0.0.39, and kit-check names one (K133).
- make toolchain-lock locks the tools of mise.toml with `mise lock --global`, since the environment of mise names that file as the global configuration; 0.0.39 wrote no lock in a repository without one (K127).
- The release workflow runs `make release-prepare` before `make release-tools`: a repository declares the preparation that its release needs with a `release-prepare::` rule of its Makefile (K132).

### Consumer migration

Add:
- A repository whose release needs a preparation, such as the checkout of a sibling release, declares it with `release-prepare::` in its Makefile instead of a step of the workflow.

## 0.0.39

- A shim of mise runs the tool that the checkout pins from any working directory: the environment of mise names the checkout's mise.toml as the global configuration (K127).
- The principle review of 0.0.38 (K129): a Go module with no stable release, an npm advisory range and a tracker of a revision are reported or fail by name instead of reading as empty; every npm workspace pattern is read; a module that go.work resolves needs no go.sum; the PHP lint is a tool only of a repository that declares PHP; the ts extractor gets its standard library; go.mod and go.work are indented with tabs; a failed case of a nested test run is reported with its whole error.
- The status tables, changelog sections, release notes, checklists and parity prose are read from the mdast tree (K130).
- `@polyspec/kit` exports the tool APIs that repositories import: `tracked-files`, `test-hooks`, `test-progress`, `run-tests`, `holder-lock`, and `install-vscode`, which needs its optional peer `@vscode/test-electron` (K79).
- The tools that kit installed with release installers of its own are installed by mise from `mise.toml` at the digests of `mise.lock` (K127): Go, Python, uv, ruff, alint, golangci-lint, deadcode, govulncheck, cargo-audit, Composer and vulture. The bootstrap installs mise after the npm of `packageManager`, by the sha256 of `config/toolchain.json` `mise`; `make toolchain-lock` writes `mise.lock`; `make install-tools` runs `mise install --locked` and then installs the wheel backend, the Composer projects and the Rust channels of `exceptions`. Every recipe of kit.mk runs with the environment of mise of the checkout and its shims first on PATH, and nothing outside the checkout changes.
- check-toolchain runs the tools of `mise.toml` from their shims, requires `mise.lock` to pin every archive by its sha256 for linux-x64 and macos-arm64 (a `go:` tool, govulncheck and deadcode, by the checksum database of Go), and compares the go and the python minor of `mise.toml` with the pins of kit (K127).

### Consumer migration

First adoption: `scripts/kit/kit-bootstrap.mk` is itself a copy, so `make` fails until it exists. After `npm install` adds the pinned `@polyspec/kit`, run `node node_modules/@polyspec/kit/dist/kit-sync.mjs` once in the root of the repository; it writes every copy, the Makefile's include among them. From then on use `make kit-sync`.

Add:
- `advisoryExceptions` in `config/dependency-policy.json` for the advisory 1241202 of sprintf-js, which `@polyspec/kit` brings through `@microsoft/api-extractor` and which no release fixes, with the reason and removal condition that kit declares for itself.
- `config/toolchain.json` `mise`: the version and the sha256 of the archive of each platform, as kit declares them; `make install-tools TOOLS=npm` installs it.
- `mise.toml` with the tools that the repository installs, each at an exact release and Go and Python at the pins of kit; then `mise.lock` and, for a `pypi:` tool, `.mise/locks/`, written by `make toolchain-lock`. Declare the `checksum` of an `http:` tool, such as Composer, in `mise.toml`.
- `mise.toml`, `mise.lock` and `.mise` to the root of `config/layout.yml` where it overrides the root lists.

Change:
- CI steps that run make need no PATH of their own: kit.mk puts `var/tools/bin` and the shims first; `make release-tools-path` also writes the environment of mise to `GITHUB_ENV`.

Delete:
- From `config/toolchain.json`: `python`, `pythonBuild`, `uv`, `ruff`, `vulture`, `alint`, `golangciLint`, `deadcode`, `composer`, `cargoAudit`, `govulncheck` and `go`; `.python-version`.
- Tool names after `make install-tools`: it installs every tool of `mise.lock`.

Proof: `make install-tools TOOLS=npm`, `make install-packages`, `make toolchain-lock`, `make install-tools`, then `make toolchain-check` pass.

## 0.0.38

- kit is the npm package `@polyspec/kit`: a repository installs it with `make install-tools TOOLS=npm` and `make install-packages`, includes `scripts/kit/kit-bootstrap.mk`, and holds as copies only the files of `kit.copies`; `make kit-sync` writes them from the installed package and `make kit-check` ties them to the version of package-lock.json (K71-2).
- kit's tools and tests are TypeScript (`.mts`), checked by tsc 7.0.2 (K71-1); `make kit-test` fails when a run changes the checkout (K71-2-1).
- kit's tools use ecosystem libraries in place of rebuilds: ajv for schemas, picomatch for globs, smol-toml for TOML, pip-requirements-js for PEP 508, semver and @renovatebot/pep440 for versions; Composer versions come from composer's own `latest-status`; npm install-links copies are no longer read (K73, K100, K112–K116).
- Every kit tool is classified in `config/rebuild.json`, and the tools kit keeps carry a rebuild record in `docs/rebuild/` (K74).
- parity: feature units on runner test ids, fixed per-runner test conventions, files named like tests must be bound, spec anchors for profile reasons, a vitest runner, symbol extraction (Go, TypeScript, PHP, Python, Rust on a declared nightly), case directories and `.~` steps, Markdown lists and prose names (K75, K42, K43).
- Lint configuration for every ecosystem (phpcs PSR-12, phpstan disallowed calls, Composer policy, Rust workspace lints, golangci-lint with gomoddirectives, deadcode, ruff with TID251, vulture, oxlint with tsgolint, knip, API Extractor, `.editorconfig`); an advisory without a fixed release is accepted only by a recorded exception with its reason and removal condition (K77).
- check-toolchain checks the pins kit ships, floors equal to the pins, declared exceptions with scope, reason and retry, the TypeScript pin and `.npmrc` link keys, and names the signal that ended a tool (K78, K118).
- The editor boundary checker and the VS Code installer of the integration tests (K80).
- Markdown is read with mdast and micromark, owner-check reads make's database, pyproject pins are edited with toml-patch, wheel metadata comes from pip's report, govulncheck is read as SARIF, duplication is found by jscpd, and the unused TAP reader is removed (K120–K126).
- release coverage refuses a `file:` dependency that names no folder of the repository; only the npm release consumer project names the archives of its smoke (K129).
- Node 26.11.1.

### Consumer migration

Add:
- `@polyspec/kit` as a devDependency pinned to this release's asset URL with its integrity, in package.json and package-lock.json.
- `include scripts/kit/kit-bootstrap.mk` in the Makefile, in place of `include scripts/kit/kit.mk`.
- The copies that `make kit-sync` writes: `scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/`, `workflows/release.yml`, `PRINCIPLES.md(.ko)`, `config/layout.kit.yml`, `ruff.toml`, `phpcs.xml.dist`, `phpstan.dist.neon`, `.golangci.yml`, `.oxlintrc.json`, `knip.json`, `config/api-extractor.kit.json`, `.editorconfig`.
- `config/checklist.json` for the repository's checklist, where missing; `rust-toolchain.toml` at the Rust pin, where the repository has Rust.

Change:
- `.node-version` 26.11.1 and `engines.node` `>=26.11.1`; Composer `require.php` `>=8.5` and `config.platform.php` `8.5`; `requires-python` `>=3.14`; go.mod `go 1.27.2` with no toolchain line; Cargo `rust-version` `1.99.0`; `typescript` `7.0.2`, with any other version declared as an exception.
- `config/parity.json`: `symbols` is `{ extractor, entry }`; narrow profiles and `nativeOnly` entries carry `spec` anchors; `config/toolchain.json` names `symbolExtractors` where Go or PHP symbols are extracted.

Delete:
- The vendored `scripts/kit/*`, `tests/kit/*`, `.kit/kit.lock.json` and every `kit.json` reference.
- The `.npmrc` keys `install-links` and `bin-links`; `replace` in go.mod (siblings use go.work); nested ruff configurations.

Proof: `make install-tools TOOLS=npm`, `make install-packages`, then `make kit-check toolchain-check layout-check documents-check owner-validate` pass; the checks that still fail are recorded in the repository's checklist.
