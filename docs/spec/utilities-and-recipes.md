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

1. **Utilities.** A utility is a script whose behaviour is set by the arguments and files it is given: a tool installer, a checker, a release tool. Some utilities run a repository's recipes: they run the targets that the repository names, such as the CI target runner (`ci-targets`), the worktree setup that runs the repository's own install, and the test runner. A repository runs the utilities it wants, from its own recipes. A utility runs a recipe as it is written: a wrong recipe runs wrong, and the utility does not judge it. A utility stops only when it cannot do its own job, such as a missing tool, or land on a main checkout with uncommitted changes. A utility that fails leaves what it changed as it found it: uv-install puts back the provider links that it removed before a uv sync that fails (K1134).
2. **Examples.** `docs/examples/` shows how the repositories commonly do their work, one working example per topic:
   - how to lay out a row's worktree and work in it
   - how to write recipes: install, build, test, lint and release targets in a Makefile that run the utilities
   - how to state native settings: `.npmrc`, `uv.toml`, the `[settings]` of `mise.toml`, `.cargo/config.toml`
   - how to write the CI workflow
   - how to link sibling checkouts during development
   - how to run a checklist row from Red to commit

   An example shows one working way. A repository copies it, changes it, or ignores it.

## Local workflow jobs (K1228)

`ci-job.mts --workflow <file> --job <id>` runs the job's scripts and local composite actions in their declared order.
`--matrix <key>=<value>` selects matrix combinations; `--plan` prints the plan without executing scripts. External actions
are printed with their inputs and are not executed, so the local run requires the tools that those actions would install.

- Expressions use GitHub's `@actions/expressions`, including native coercion, property filters and built-in functions.
  The run supplies status functions and the supported values of `github`, `runner`, `matrix`, `env`, `steps` and workflow or composite
  `inputs`. A context that the local run cannot supply is refused with its name before scripts run. External action
  outputs, secrets and repository variables cannot be supplied by a local script run.
- Planned runtime refusal correction (K1228-3): a computed read of an external action's output and a dynamically
  selected unsupported shell are local capability refusals, not reproduced native step failures. They end the local job
  with status 1, bypass direct and every composite caller's continue-on-error, and admit no later user script. Owned
  process and runner-directory cleanup still finishes before the result. The shared typed local refusal also carries
  environment capability refusals, including through native error-cause wrappers. A message that merely says "refused"
  does not change an ordinary Error into this type. Real native command exits and file-validation failures retain their
  normal failure/tolerance semantics; no expression engine or general dictionary behavior is replaced.
- Environment key semantics (K1228-2): `env` keys are case-sensitive on POSIX and supported ASCII keys are case-insensitive on Windows.
  Environment merges retain the first key spelling and take the last assigned value under that comparison. The same
  merge applies to workflow, job, composite and step environments, environment-file writes and the actual spawned
  environment, including inherited process values and PATH lookup. Other expression contexts keep native case folding.
  A context-only Dictionary subclass uses a standard Map through the native public add/get/values/pairs API; parsing,
  evaluation, coercion, status functions and general dictionaries remain native. Conditions, serialization and computed
  external-output guards use the environment of the actual scope, without changing caller or sibling scopes.
- Windows local environment names are ASCII-only until a pinned native comparer supplies OrdinalIgnoreCase faithfully.
  Non-ASCII names, including names used for lookup, are refused by name before use; Unicode values remain supported on
  every platform and POSIX Unicode names remain distinct. JavaScript lowercasing is not OrdinalIgnoreCase: native invariant
  uppercasing merges micro sign µ and Greek capital mu Μ, while lowercasing keeps their keys distinct. JavaScript full
  uppercasing is not a substitute either. This boundary follows the [native comparison rule](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings).
  Remove it only when the pinned native comparer provides that rule and actual Windows Unicode-name regressions pass.
- The exact environment key `__proto__` is refused by name before scripts run when declared, and before publication when
  an environment file writes it. The pinned native JSON replacer assigns properties to a plain object and silently drops
  that key through its prototype setter. Safe record construction preserves the key until this refusal; it never silently
  deletes it. An unsupported local environment name is a capability refusal, not a native step failure: it ends the job
  with status 1, cannot be tolerated by direct or composite `continue-on-error`, and admits no later user script, even one
  with `always()`. Valid independent file-command channels are processed before the refusal propagates; owned process and
  directory cleanup still finishes. Native file-command failures such as blocked NODE_OPTIONS or malformed syntax retain
  their normal step-failure and continue-on-error semantics. Remove this boundary after the pinned native serializer
  preserves the key in the same environment serialization regressions.
- Environment source evidence is the runner's [platform comparer](https://github.com/actions/runner/blob/8cfa1049f86781d141056082d73802d56cd2b433/src/Runner.Common/Util/VarUtil.cs),
  [step context selection](https://github.com/actions/runner/blob/8cfa1049f86781d141056082d73802d56cd2b433/src/Runner.Worker/StepsRunner.cs)
  and [case-insensitive setter](https://github.com/actions/runner/blob/8cfa1049f86781d141056082d73802d56cd2b433/src/Sdk/DTPipelines/Pipelines/ContextData/DictionaryContextData.cs).
  Linux source CI owns the native environment smoke; macOS and Windows bootstrap run the same target on their actual
  platform. A Mac run of the Windows merge algorithm is a policy unit test, not native Windows process evidence.
- A quoted expression literal decodes every doubled single quote once, including literals used in `format` and step
  conditions (K1228-1). The pinned lexer decodes only the first pair, so the adapter derives STRING token values from
  their validated raw lexemes and preserves their original lexemes and ranges. Tokenization, syntax rejection, parsing
  and evaluation remain native. Remove this adapter when the pinned lexer passes the same repeated-escape regressions
  without normalization; correcting its already-decoded token value would decode the first pair twice.
- Workflow inputs are bound before planning or running scripts (K1233). Repeated `--input name=value` arguments
  split at the first `=`, preserve empty text and later `=` characters, and bind case-insensitively to declared names.
  This CLI binding policy follows the expression context's case-insensitive lookup; duplicate input names and declarations
  that differ only by case are refused. Boolean arguments are exactly `true` or `false`; number arguments follow finite
  JSON number syntax without whitespace; string arguments remain text. Defaults must already have their declared type.
  Expression defaults are refused rather than treated as literal text, because the local runner does not supply their
  native default-evaluation context. Input declarations without an explicit supported type are refused. A declaration
  whose lowercased name collides with an own property of Object.prototype is also refused by name: the pinned native
  Dictionary silently drops those keys. This boundary does not reject a name merely because its original casing names a
  prototype property; the native lookup lowercases it first. Remove this boundary after the pinned native Dictionary
  preserves these keys in evaluation and serialization regressions.
- The selected `workflow_call` declaration supplies its documented implicit defaults: false, zero and empty text for
  boolean, number and string. Required inputs without a declared default need an explicit value. A `workflow_dispatch`
  declaration supports boolean, number, string, choice and environment inputs; choice values must belong to its options,
  and environment values are text without querying GitHub. A dispatch input without a declared default needs an explicit
  value even when optional, because this local runner does not establish the native omitted value. Unknown names, invalid
  types, missing values and unsupported declarations fail before any script runs, including in `--plan`.
- A sole input-capable event declaration is selected automatically, even when the workflow declares other events.
  `--input-event workflow_call` or `--input-event workflow_dispatch` selects between both declarations; a job that reads
  inputs while both remain unselected is refused. Repeating `--input-event` or selecting an absent declaration is refused. This selects local input
  declarations and does not fabricate a GitHub event or enable `github.event` values. Typed workflow inputs reach the
  workflow and job environment, job conditions, matrices, defaults, outputs and steps. Composite actions shadow them with
  their own string inputs. Composite preflight masks caller inputs instead of guessing inner input values; the runtime
  guard checks computed external-output producers against the actual bound composite inputs before their script runs.
  Reusable caller jobs remain refused; run a job from the called workflow itself.
- Each script receives fresh `GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH` and `GITHUB_STEP_SUMMARY` files. Outputs belong to
  their step; environment changes and path entries reach subsequent steps. Output and environment files accept both
  `name=value` and delimited multiline values. A malformed file command fails its step; independent valid channels still
  apply their changes so cleanup steps can use them.
- A failed step skips subsequent conditions without a status function. Conditions with `failure()`, `always()` or
  `!cancelled()` retain their native meaning; a tolerated failure keeps its failure outcome and success conclusion.
  The job fails if an untolerated step failed, even when its remaining cleanup steps succeed.
- Matrices apply their axes, exclusions, inclusions and fail-fast setting. A job that reads `needs.<job>.outputs` first
  runs that dependency. Other dependency properties and outputs of matrix jobs are refused because a local run cannot
  reproduce the outcome of a complete CI run or the matrix combination that finishes last.
- The run owns its script processes and runner temporary directories. Interruption stops further step admission,
  terminates and awaits the owned processes, and then removes their directories. A process must finish cleanup while its
  runner directory still exists.

## Installer command verification (K1232)

Installer command tests observe the local service's archive attempts, the downloader's settled result, its owned helper
close and the installer close. A total elapsed-time deadline does not decide success: native process startup can take
longer than a download retry. The download library owns its request limits, and owned process cleanup retains its declared
termination grace. An injected test clock may advance while the first archive response is withheld; this must neither kill
the installer nor replace its result. Tests release that response, observe the aborted attempt and successful retry, and
then verify publication and process cleanup.

Fixtures remain available until the owned commands close. A test closes its proxy's upgraded connections and awaits server
close before removing their files, including when an assertion fails. Cooperative helper termination and escalation are
verified by native lifecycle tests independently of download speed; no test adds a second deadline to that lifecycle.

## Case-sensitive test directories (K1231)

A test that needs case-distinct names receives a directory whose filesystem passes the actual two-name probe before the
test runs. Darwin keeps its disk image under the caller's temporary parent, but creates its empty mountpoint under the
native user temporary directory that `getconf DARWIN_USER_TEMP_DIR` reports. Disk Arbitration can reject a mountpoint on a
volume that ignores ownership, so a caller-selected temporary storage volume cannot also choose the native mountpoint.
The mounted image holds every test file; only the empty mountpoint directory uses native temporary storage. Linux and
Windows keep their existing directory provisioning.

The run owns the image storage directory and the mountpoint directory separately. It detaches the image before removing
either directory. A failed or uncertain detach retains both directories and reports both paths, the command failure and
the required cleanup order. Failure to discover a nonempty absolute native temporary directory fails before attachment;
it does not substitute a guessed path or skip the case probe.

## Command resource lifetime (K1231-1)

An asynchronous command resource scope owns its resources from provisioning through cleanup. Its controlled action awaits its
owned normal commands; it does not leave unawaited work using the resource. The action must settle before cleanup starts; a
returned promise keeps the resource alive until it settles. Normal completion and action failure both await cleanup. If the
action and cleanup fail, the caller receives both errors.

Interruption closes normal command admission immediately, requests termination of owned work groups, and awaits their child
close and cleanup. The harness then waits for each active resource scope to finish its cleanup before exiting with status 130
for SIGINT or 143 for SIGTERM. A resource cleanup callback receives a runner that is valid only while that callback executes.
Its commands remain owned and awaited; they are cleanup, not newly admitted work. A retained cleanup runner cannot start a
command after its callback ends.

The runtime runner preserves native arguments and inherited standard input. It keeps its result directories and its
case-sensitive test filesystem until the associated native runner has closed. It restores the selected environment value
and detaches an image before removing its mountpoint or image storage.
With an explicit result report, the native test runner places its private counts and extension configuration inside the report
parent, creates that parent when absent, and removes the private directory before hashing report inputs. Without a report it
keeps the caller temporary-directory placement. Neither form changes the child temporary-directory environment.
A cleanup failure reports the resources that remain; it never turns an interrupted or failed run into success.

## Native event identity (K1091)

A native event parser preserves the framework's complete test identity. For PHPUnit TeamCity messages,
`TestRef.id` is the fully qualified class, method and data set from `locationHint`, without its leading namespace
separator; `TestRef.name` retains the native display name. The parser keeps simultaneous event flows separate.
Two classes in different namespaces remain distinct even when their class basename, method and data set are equal.
Repositories own their explicit invocation, selection and expected case inventory. This utility adds none of those policies.

## Merge drivers of the twins (K1197)

`make hooks` declares the merge drivers `kit-twin`, `kit-changelog` and `kit-checklist` (`twin-merge.mts`, K354). A Korean twin
takes the revision marker of its English file as git merges that file, so the driver reads the English file on the three sides of
the merge that git runs. In a merge, the default way that a branch lands, theirs is the commit that git merges, which git names to
the driver in the variable `GITHEAD_<commit>` of its environment, since it writes `MERGE_HEAD` only after the merge stopped, and
the base is `git merge-base HEAD <commit>`. In the rebase that `make land` runs on a branch behind `main` (K495-1), theirs is the commit that the rebase
applies, the last of `rebase-merge/done`, and the base is its parent. Any other operation, such as a cherry-pick, names neither,
and the driver fails, naming the merge. A driver that cannot merge a file, because its sides are unknown or because a task row of
a checklist changed differently on both sides, writes the conflict of `git merge-file` into the file, with the markers of both
sides, and exits 1, so the work file never holds one side alone without a sign of the other.

## Commit names in documents (K1210)

`commit-names-check.mts` is the check that no tracked Markdown file names a Git commit: a release and a lock pin a commit, and a
name written in a document is a wrong value once the history changes. A repository whose rules forbid such a name runs it from its
own recipe, `$(NODE) $(KIT)/commit-names-check.$(KIT_EXT) --except '<glob>'`, and declares each path that it does not read with a
`--except <glob>`; lock files and workflows are no Markdown and are never read. It prints one line `<file>:<line>:<column>: names
the Git commit <name>` for each finding and exits 1; a run that reads no Markdown file fails.

- Boundary: a candidate is a run of 7 to 40 lowercase hexadecimal digits that no ASCII letter and no digit touches on either side.
  Three joins make the run a part of a longer word, which is no candidate: a `.` between the run and a letter or a digit (a file
  name, a version, a decimal), and a `-` or a `_` between the run and a neighbouring run of hexadecimal digits only (a UUID, a digest
  written in groups, a date). Every other character ends the name, `:`, `=`, `@`, `#`, `/` and a `-` or `_` before a word that is
  not hexadecimal included.
- Content: a candidate that holds both a digit and a letter is a commit name. A candidate of digits only, or of letters only, is a
  commit name only when a marker stands directly before it on its line: the word `commit`, `commits`, `sha`, `rev` or `revision`
  in any case, followed by optional spaces, at most one of `:`, `=` and `/`, optional spaces and at most one backtick; or a `@`,
  followed by at most one backtick. A number of 7 or more digits is most often a date, a size or a run id, so it is no name
  without a marker.
- Accepted misses: an unmarked name of digits only or of letters only, also after the word `at`, which precedes sizes and dates as
  well; a name in uppercase digits; a name that a `-` or a `_` joins to a word of hexadecimal digits only.
- Accepted findings that are no commits: every other word of 7 to 40 hexadecimal digits with a digit and a letter, such as a
  SHA-1 digest of a file. Such a path is declared with `--except`.

## What kit does not do

kit forces nothing. In particular:

- kit includes no recipe into a repository.
- kit sets no setting of another tool, on the command line, in the environment, or in the environment of the tools a utility starts. A tool installer states where it puts what it installs, and that is its own job: the installer of mise names, unless its caller passes another environment, the directories of the mise it installs and the configuration file of the checkout that its shims read (`MISE_DATA_DIR`, `MISE_CACHE_DIR`, `MISE_STATE_DIR`, `MISE_CONFIG_DIR`, `MISE_GLOBAL_CONFIG_FILE`, `MISE_GLOBAL_CONFIG_ROOT`); it gives Go no environment, writes no other file into `var/tools` and removes no trust that mise recorded (K1092). None of these chooses how the repository's tools behave. The lint of PHP gives PHPStan the autoloader that the package's Composer wrote (`--autoload-file`), without which PHPStan cannot resolve the calls of the package. A flag such as `--locked`, `--profile minimal` or `--memory-limit=-1` is the caller's: the utility passes the arguments its caller gives and none of its own (K1097).
- The lint of Rust runs one clippy step in the folder of each Cargo workspace of the checkout and gives every step the arguments that precede the first `--workspace-args`. `--workspace-args <folder>` gives the arguments that follow it, up to the next `--workspace-args`, only to the step of the workspace in `<folder>`, the repository-relative folder of its Cargo.toml (`.` for the root), after the arguments of every step. A folder that holds no Cargo workspace of the checkout, and a `--workspace-args` without a folder, fail the lint before any step runs, naming the workspaces of the checkout. So an `--exclude` of a package reaches only the workspace that holds the package, and cargo warns of no exclusion that means nothing in another workspace (K1195).
- kit requires no result in a repository's CI, hook or gate.
- kit provides no check of a repository's recipes or examples.

## Work that is not kit's (K1219)

kit starts the rules that a repository made: the targets, the checks and the release steps that the Makefile and the configuration
of the repository declare. kit does not do the work of a repository in its place: what a repository builds, packs, tags, proves
and publishes, in which order and with which values, is stated by the files of the repository, so a utility whose code decides
those steps, or that holds the layout of one kind of package, is no part of kit. kit is no package manager: installing,
downloading, resolving a version and building or packing a package are the work of npm, Composer, cargo, go, uv, mise and rustup,
and a utility starts them with the arguments of the recipe. The local links are part of kit as a development tool: they join the
checkouts of a developer to each other, and no release reads a link (K591, K869).

### Removed

- `link.mts packages <dir> python|npm` (K1217). It printed the polyspec packages that the manifests of a folder declare, as the
  arguments of `uv sync --no-install-package`. It was a surface of the link that nothing used: no recipe called it.
- The export `./link-folders` of the package (K1218). It gave a test of a repository the functions that replace an install folder
  by a link. It was a surface of the link that nothing used: no file of a repository imported it.
- `release.mts go-modules` with `release-go-module.mts` and the target `release-go-modules` (K1220). They made, from the commit of a
  tag, a commit that adds the generated files and the static library of each platform of a Go module, tagged it
  `<directory>/vX.Y.Z` and ran `go test` of a consumer at that tag. Which files the tag of a Go module carries, and what proves
  it, is the release of the repository. Its recipe holds `git read-tree`, `git update-index --add --cacheinfo`, `git write-tree`
  and `git commit-tree` on an index of its own, `git tag -a <directory>/vX.Y.Z <commit>` and `git push <remote> <tag>`, with the
  checks that it wants before them.
- The per-platform package kinds `wheel-abi3`, `php-ext`, `npm-native` and `go-static` of config/release.json with
  `release-native.mts`, the asset sets (`RELEASE_PLATFORM`, `RELEASE_PHP`, `release.mts sets`, the target `release-sets`), the
  matrix of the example release workflow and the example `workflows/release-candidate.yml` (K1221). The code of kit decided how a
  Rust core and its bindings are built and packed for each platform (cargo, maturin through uv build, the napi CLI, the PIE
  archive, llvm-strip), the names of those assets, the jobs of the workflow and the runner of each platform. That is the build
  and the release of the repository. Its recipe runs those tools itself and writes the archives into the asset folder, and its
  workflow states its own matrix; `release.mts assets` builds the `npm`, `composer` and `wheel` packages, as before.
- `contracts` of config/release.json (K1222). Before an archive was built, the release ran the contract tool of the repository as
  `<check> <file> --release` for each declared file. The argument `--release` and the place of the check in the release are
  knowledge of one contract tool. The recipe of the repository runs its contract check before it starts `release-assets`.
- The cargo build of `php-extension.mts` (K1223). For an extension folder with a Cargo.toml and no `src/config.m4`, `build` read
  the extension name from `php-ext.extension-name` of composer.json and ran `cargo build --release --locked -p <package>` with the
  php and php-config of the checkout. How an extension that cargo builds is built is stated by the recipe of its repository.

## Reasoning

- Each forced setting and each required result removed a choice from a repository. When the repository's case differed from what kit foresaw, the repository had nothing left but a workaround. Every override listed under Problem came from that.
- A repository's own recipe states its one case, so it needs no branch. A tool reads its native file as the tool documents it.
- An example passes on a working way without binding anyone to it.
- A check of recipes would be a new rule that kit sets over repositories, which is the same enforcement again.

## Consequence for kit

kit removes what it forces, each change as a checklist row with its Red, Green and commit. These are the forced parts today:
- **Included recipes.** Until K1054 repositories included the recipe set of `scripts/kit/kit.mk` and `scripts/kit/kit-bootstrap.mk` from the package, and AGENTS.md stated the mise environment of every recipe of kit.mk for them. The package now ships no make file: kit.mk is the recipe set of kit's own Makefile, the bootstrap is the example `docs/examples/bootstrap.mk`, and the toolchain-lock recipe names no UV_PYTHON, which the `[env]` of `mise.toml` decides.
- **Overrides inside utilities.** `bootstrap/install-mise.mts` (`miseEnvironment`) and `mise-tools.mts` (`toolsEnvironment`) set the settings of mise and uv (`MISE_LOCKED`, `MISE_AUTO_INSTALL`, `UV_*`, `UV_PYTHON`) for the tools they start until K1048, and `link.mts` and `run-tests.mts` deleted `CARGO_TARGET_DIR` until K1049. Until K1050 the lint utilities ran each tool with kit's configuration in place of the repository's own: golangci-lint with kit's `.golangci.yml`, phpcs with kit's `phpcs.xml.dist`, ruff with kit's `ruff.toml`, clippy with `CLIPPY_CONF_DIR` set to kit, and oxlint and knip with kit's `.oxlintrc.json` and `knip.json`.
- **Checks of a repository's recipes and workflows.** Until K1051 kit-check judged how recipes start tools (`recipe-tools.mts`), link steps in Makefiles and workflows (S11), the shape of ci.yml and its final `ci-passed` job (S12), `$(KIT)/<name>` in Makefiles (S15) and manifest paths (P30), and bypass-check judged Makefiles and scripts. Until K1070 kit-check validated each config/<name>.json against the schema of kit of that name; kit-check is gone, and each tool validates the configuration it reads.
- **Vendored copies.** Until K1052 kit-sync wrote every entry of `kit.copies` in kit's package.json into every repository, among them `PRINCIPLES.md` and its twin, `ci-pipeline.yml`, `release.yml`, the bootstrap action, `config/layout.kit.yml`, the schemas under `config/`, `.editorconfig` and `.claude/settings.json`; kit-inject-check failed a changed copy, so the closing `required` job of the vendored pipeline bound every repository to the results of every job of the pipeline, the `kit-gates-*` gates among them. The package now ships these files as examples: a repository copies the ones it wants and owns each copy, its pipeline and that job included, and kit writes and compares none. The owner rules of kit.owners for those files, the copy exclusions of lint-ts and rebuild-check, the edit refusal of claude-hook for a copy, and the layout rule `lint-cargo-lints` with `config/cargo.schema.json` went with them.
- **Refusals.** Until K1053 these refused:
  - The Claude hook of `.claude/settings.json` (`claude-hook.mts`) refused commands in every repository's sessions, and `make link` and `make hook` wrote it into the settings of each checkout and of the workspace folder.
  - The git hooks that `make hooks` wrote refused commits: the commit-msg hook and the staged-generated hook, which the `commit` target also ran. `make item-test` and docs-check refused a Verification command that the Claude hook refused.
  - `ci-targets`, `owner-check`, run-tests without a selection, the suites of runtime-targets and a full `parity-check` refused to run outside CI unless FINAL_RUN named a clean committed tree.
  - `land` refused a branch whose static gates or commit rules failed, and it required its fixed gates among the prerequisites of the repository's `kit-gates`.
  - `item-state` refused done without a changelog line, and a move to verifying or done without a passing Verification.
  - `ci-setup` refused a setup target that ran `kit-ci-setup` again.
  - `run-tests --venv` refused an environment whose Python was not the checkout's.
- **Parity.** Until K1129 kit read `config/parity.json` and checked how the implementations of a repository relate: shared units, requirement citations, test names and ids, public symbols, divergence and test markers (parity-check, parity-declarations-check, divergence-check, test-markers-check), with parity jobs in the CI pipeline. Delete parity: kit does not check how implementations relate; each repository runs its own tests.
- **Owner refusals.** Until K1131 owner-check refused, whatever the repository declared or passed, a target whose recipe text started ci-targets and a rule that selected every target of the make variable CHECK_TARGETS, each as the full suite. It now refuses only the targets that the repository's own `fullSuite` names.
- **Verification cells.** Until K1132 docs-check (verification.mts) required every open item of a checklist with a Verification column to name a command in backticks there and refused a pipeline, with no flag that a repository's recipe could leave out, unlike its other checklist rules. docs-check requires no command; `make item-test` still runs the commands that a cell names.
- **Rule texts.** The `Enforced by:` lines of PRINCIPLES named these checks (S11, S12, S13 and S15 among them) and changed with each removal; until K1055 the text of PRINCIPLES also bound every repository to kit's pipeline (S12), to the gates of kit (P31) and to changes made only in kit. The shipped PRINCIPLES now claims no check that kit no longer forces.

A part that works becomes an example in `docs/examples/` in the same change that removes it from kit. The removal ships in a new patch release of kit. A repository pins the kit release it installs, so it keeps its current release until it adopts the new one, and then writes its own recipes from the examples.
