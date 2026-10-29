<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

## 0.0.74

- Release Kit 0.0.74 with K831, K832, K833, K834, K835, K836, K837, K839, K840, K871, K873 and K876 (K880).
- The K661-6 runner checkout cases of the link tests expect the manifest path finding of K773 in place of the lock-source finding that K831 deleted, and the checklist test derives the plan folders and their count from docs/plans/*/checklist.md instead of pinning three, so a new plan folder breaks no test (K876).
- make lint-php accepts the polyfill guard in an autoload file: a namespaced `if (!function_exists('<name>'))` or `if (!defined('<name>'))` with no elseif or else, whose body is only the declaration of that name, as in the bootstrap files of symfony/polyfill-*; any other guard still fails (K873).
- make toolchain-lock is `mise lock` in kit.mk for each platform of linux, macOS and Windows on x64 and arm64 that has the archive; it first locks and installs the uv and the python that mise.toml declares, as mise lists them, and names that Python as UV_PYTHON, so uv locks with neither the machine uv nor a managed Python of the home. scripts/kit/toolchain-lock.mts is gone. It runs the mise that the bootstrap installs: a checkout whose mise.lock pins no node runs make install-tools TOOLS=npm, make toolchain-lock, then make install-tools TOOLS=npm again (K836).
- A release with a Composer package publishes packages.json beside its archives: one flat Composer repository that holds each Composer package of config/release.json at the release version, with the release asset URL of its zip and the sha1 of the zip, so a consumer reads it as a composer repository at releases/download/<tag>/packages.json and names only the tag (K871).
- The PHP arginfo project of PHP-Parser 5.0.0 requires nikic/php-parser 5.0.0 exactly, as the one of 5.6.1 does, so Composer refuses a lock whose parser does not satisfy that requirement, in place of the deleted compare (K833); the link-state-check tests drop the K696 case and a comment that K831 left (K837).
- kit reads the channel of rust-toolchain.toml as declared, `stable` or `1.90` among them; rustup judges it, and kit no longer refuses a channel that is not <major>.<minor>.<patch>, nor, in make install-tools, a rust-toolchain.toml without a channel or with fields of another type: it passes what is declared to rustup (K840).
- kit no longer refuses a mise.toml key of a tool that it does not run, nor an http: tool without an https url and a version: mise judges its own configuration, and kit checks the tools that it runs only (K839).
- kit takes the releases of mise.toml as declared and no longer judges mise.lock: the exact-release refusal, the lock-digest check of make toolchain-lock and the sidecar check of make toolchain-check are gone, since `mise install --locked` checks the lock and its sidecars itself (K835).
- The PHP lint tools take the phpcs and phpstan releases that config/php-lint/composer.lock records as it records them; kit no longer refuses a lock whose release is not <major>.<minor>.<patch> (K834).
- The PHP arginfo install no longer compares the nikic/php-parser release of the php-arginfo/<release> lock with the release that gen_stub.php names: the folder is chosen by that release, so the compare judged the folder against its own name (K833).
- link-state-check no longer judges the content of tracked locks: a Cargo.lock or package-lock.json entry of a polyspec package by a path or a link is no finding, since the lock is its package manager's record (K831).
- `make test-go CASES=<pattern>` in a repository with a tracked go.work passes the pattern to its one workspace go test as `-run`, as the per-module runs do, so a local run of selected Go tests is no longer refused as unselected (K832).

## 0.0.73

- Release Kit 0.0.73 with K826, K827 and K830 (K829).
- The Windows process step of platform-bootstrap has a 10-minute limit, and the process-group tests that start real processes a 60-second timeout, so a hang fails by its limit instead of holding the job (K830).

- The PHPUnit test listing of a run (runtime-targets, K390-1) passes the autoloader of the run to the deadline prepend, so it no longer ends with "the PHPUnit Composer autoloader is missing" (K827).
- A uv install that drops a linked Python package leaves the dev folder byte-identical: kit unlinks before every uv install (K539), and a real-uv case now pins the drop (K826).

## 0.0.72

- CI installs with the package managers only: the gates workflow, kit-gates, kit-gates-parity and the CI of kit run no make link, no link-state-check and no package-link toolchain; links and their check belong to development (K824). Consumer step: drop any make link or link-state-check step from your own CI.
- Release Kit 0.0.72 with K820, K821, K822, K824 and K825 (K823).
- Release, tag creation and FINAL_RUN no longer refuse a commit whose checklist rows are in [~] or [v]; a row state is a record, and the CI of the tagged commit proves a release (K825).
- Release Kit 0.0.72 with K820, K821, K822, K824 and K825 (K823).
- Consumer step of K788: Python declarations in config/parity.json name each symbol by its import path, such as polyspec.<package>.app.App, not by a name relative to the entry (K823).
- The Windows runner of platform-bootstrap runs the go shim of mise through Git Bash make, so kit CI proves the PATH of K820 (K822).
- worktree-setup installs the Composer projects of a worktree as plain composer install does, with Composer's own cache and network, and prepares go.work before Composer (K821).
- On Windows kit.mk puts the directory of the binary of mise on PATH beside var/tools/bin, so a shim of mise starts mise.exe instead of failing with "program not found" (K820).

## 0.0.71

- Release Kit 0.0.71 with K818 (K819).
- documents-stamp writes only the marker line after the doc-id line; a source-sha256 marker shown as an example in the body stays unchanged (K818).

## 0.0.70

- Release Kit 0.0.70: the shackles are deleted and the harness stays (K817).
- The wheel build creates its build folder before uv build writes into it (K816).
- The shared job of the gates workflow computes no commit range and passes no RANGE to kit-gates-static, which no target reads since commits-check is deleted (K815).
- layout-check checks a symlinked install folder, such as a worktree link to the install of main, as the link: `vendor` in .gitignore ignores it, and git no longer refuses the pathspec as beyond a symbolic link (K814).
- The release wheel build copies only the wheel into its output, without the .gitignore of uv build, and the real-tool tests build Python packages as uv does, with the network and no kit wheel folder; the tests of the deleted revision finding, legacy Composer projection and consumers field are aligned (K813).
- The toolchain-check target test reads the node path that kit.mk resolves, so it passes in a worktree, which runs the tools of the main checkout (K792).
- plan no longer refuses forms: item-state takes any declared state, item-new takes any id and writes rows that docs-check judges afterwards, and make commit takes an empty index, a new row on main and a missing body file to git. The done state needs a line with the id in each changelog, committed or not (K808).
- release no longer checks versions: `release-versions`, the version of each manifest against the tag and the exact version of an own dependency are deleted; the package managers resolve them. Consumer step: drop any `make release-versions` step of a workflow of its own (K812).
- worktree-setup no longer refuses a worktree by the form of its name, id or type, a Composer manifest or vendor outside the worktree, a Python environment that it did not create, or a release archive folder that the worktree already holds; it no longer removes an old Composer projection (K811).
- docs-check reads each document on its own and keeps only the checks of a broken result: unique anchors, closed fences, links, private paths, interpolation, the checklist reading, status table cells and changelog order. The pair rules are deleted: `pair-missing`, `doc-id`, `revision` (source-sha256), the twin equality of anchors, fences, checklists, status tables and changelogs, `plan-folder`, and the staged twin check of make commit and the pre-commit hook (K809).
- kit-check reads only the configuration against the schemas of kit, the PHP that a PHP repository declares and the tool recipes. The names of the targets, the runtime targets, the CHECK_TARGETS suite, the tracked links, the lint selection of the owner rules and the retired files are the repository's own and no longer checked (K810).
- Delete the K315 cause filter: item-state no longer refuses a bypassed or impossible cause that cites a release, a flake, an unrelated failure, the environment or a kit row. The tests that pinned it are deleted (K806).
- land no longer runs a failing gate again on main as a baseline (K631): a gate that fails in the worktree refuses the branch. A path that no owner declares selects no gate instead of refusing the land (K807).
- Keep only the commit rules that guard a result: the AI footer and identity, the Red line of a done row and the test of a fix. Delete the subject form, language, identity, row, type, state, changelog, generated and twin rules of a commit, `commits-check` with its range mode and CI step, config/commit-identity.json, the pre-merge-commit hook and the no-op commit-gates hook. Consumer step: `make hooks`, then `git rm .githooks/pre-merge-commit config/commit-identity.json` and drop any `commits-check` step of a workflow (K805).
- Delete the push gate: push-gate.mts, the pre-push hook, `make push-gate-hook` and `push-gate-commit`, and the rule that config/checklist.json lists pre-push. A push is not checked; the message rules run at commit. release-verify checks `ci-passed` when config/release.json names no checks. A repository removes .githooks/pre-push with git rm, drops pre-push from `hooks` of config/checklist.json, and removes a CI job or a release check named push-gate. (K804)
- Delete the consumer install and the proof of a release (release-consumer.mts, release-consumer-config.mts, release-proof.mts, `make release-consumer`, `release-consumer-lock`, `release-proof`), the `consumers` and `proof` sections of config/release.json, the lock step of release-run prepare and the file: dependency form check of release-coverage; installing a release is the consumer's package manager's work. release-tools runs only install-tools. A git-tag parity owner is a `git-tag` Cargo.toml of `manifests`, named by its `[package].name`. A repository removes `consumers` and `proof` from config/release.json and its tests/release-consumer projects. (K798)
- The python parity symbols declare only their entry again: the distribution is the [project].name of the nearest pyproject.toml upward from the entry, and the `distribution` field is deleted (K803).
- lint-rust runs cargo clippy through link cargo with the sibling checkouts, so a linked consumer lints its Rust against the polyspec crates of its siblings, not the git tags of its lock; link cargo passes its --config options after the subcommand, since cargo passes a --config before it to no external subcommand such as clippy. (K802)
- Build wheels with uv build from each pyproject build-system.requires; delete pythonBackend, release-backend and the backend pin checks. The python parity extractor reads the installed file list of the distribution that a new `distribution` field of config/parity.json names, run by the python of the project's own .venv, which the repository's non-editable install made; kit installs nothing. (K788)
- Delete the reference-transaction hook of K495, the pid record of the pre-commit hook and KIT_MAIN_WRITER: main moves by any fast-forward, as git allows. Delete the row-id clash check of commit and land (K497, row-ids.mts); a clash of rows is git's merge conflict. A repository removes its tracked .githooks/reference-transaction with git rm. (K801)
- Delete the S10 rule that an application on a userland framework is its own Composer package, and its layout-check (library-frameworks.mts); a PHP library may require any package. (K800)
- kit-check no longer compares the copies of kit with the installed package, nor checks that the package is installed and locked; it checks the configuration only. (K799)
- The deleted-test commit gate is gone: a commit that deletes a test file needs no Replaced-By, Archived-To, Provider-Test-Replacement or Removed-With trailer. (K797)

## 0.0.67

- Prepare the Kit 0.0.67 release. (K795)
- Removed-With passes a deleted test only when the test itself names the deleted file, so an unrelated file deleted alongside opens no gate. (K793)
- The commit-type check of K449 reads a Markdown document as a document in every folder, and a release commit may stage uv.lock beside the other locks. (K791)
- Delete wheel-dependencies, pylock.mts, python-lock with make python-lock and python-lock-check, config/dependency-policy.json with its schema, and consumers.wheel.polyspec of config/release.json; release-consumer installs each wheel lock with uv pip install -r <pylock>, which checks its hashes, and a repository locks Python with uv lock or uv export. (K789)

- Delete dependency-review, dependency-state, version.mts, pin-python-dependency and composer-provider-entries with their records; npm, composer, uv, cargo audit and govulncheck report outdated and vulnerable dependencies. (K786)

- Delete dependency-policy-check and dependency-policy-mutation-check; npm ci, composer install and uv sync --locked verify the locks. (K784)
- Run PHP library tests through Composer's own autoload and install Composer tool projects with composer install in place; delete php-library-autoload and the install staging. (K790) `run-tests --without-library` and its end-of-run check that no library source was included are gone; an extension run uses the Composer project and PHPUnit of the package as they are.

- The release manifest check keeps only the tag version of the repository own packages; the form of every other dependency, including the polyspec release asset URL of K777, is the package manager's to resolve. (K785)

- worktree-setup prepares the environment of each tracked locked uv project, at uv workspace dir with UV_PROJECT_ENVIRONMENT or .venv, and no environment of the pypi: tools under .mise/locks, which a worktree runs from the main checkout. (K781)

- layout-check owns the S10 rule that a PHP library requires no application framework; dependency-policy-check no longer checks it. (K783)

- The ignore check of config/release-assets.json accepts a folder when it or one of its ancestors is ignored, so release-assets runs in a worktree whose archive directories link to the main checkout. (K780-1)

- A commit that deletes a test together with the behaviour it tested passes the deleted-test gate with Removed-With: <path>, naming the non-test file that the parent tracked and the commit deletes. (K787)

- worktree-setup makes each release archive directory of config/release-assets.json one directory link to that of the main checkout, in place of the copy of var/composer-artifacts, and a worktree refuses make release-assets-fetch. (K780)

- worktree-setup prepares the environment of each tracked locked uv project, at uv workspace dir with UV_PROJECT_ENVIRONMENT or .venv, and no environment of the pypi: tools under .mise/locks, which a worktree runs from the main checkout. (K781)

- push-gate does not count a branch whose worktree has uncommitted changes as merged, so a row that another session just started no longer refuses every push. (K782)

- Prepare the Kit 0.0.66 release. (K775)

## 0.0.66

- The go.work release test creates its repository through initRepository, and the release asset test names no other repository, as every kit test does. (K779)

- Only release-assets and release-candidate-assets run with the go.work that the repository tracks; the dependency review, the dependency policy and the other release targets run with GOWORK off again, so they read the lock of each module as it is released. (K778)

- The release check of a manifest accepts a dependency on a polyspec package named by its GitHub release asset URL at an exact version, and refuses every other URL. (K777)

- The link-state-check and go benchmark test fixtures name no repository or package beyond the case. (K776)

- A release target and the dependency review run with the go.work that the repository tracks; GOWORK is off only when it tracks none, so the go.work files that link writes stay excluded. (K774)

- link-state-check reports a tracked composer.json, package.json or pyproject.toml that links a package by a path outside the repository. (K773)

- A Python provider whose distribution is installed gets its package folder linked when uv sync left the folder missing. (K772)

## 0.0.65

- Prepare the Kit 0.0.65 release. (K770)

- The tests that the full CI of the 0.0.65 candidate failed follow K755, K760, K761, K762 and K765, and S11 names a check that a gate runs. (K771)

- uv-install installs a project locked by pylock.toml and no uv.lock with uv pip install -r, as its own install does, so worktree-setup prepares such a project. (K769)

- make link writes the node_modules/.bin links of each linked npm package from the linked package.json, so a bin such as polyspec-kit-hook runs the checkout's source. (K767)

- worktree-setup links each installed Composer provider folder to its checkout after its offline install, as for npm. (K766)

- make link and uv-install make each installed Python polyspec package folder one directory symlink to its checkout, as for npm and Composer; no editable build runs, so linking needs no build backend. (K765)

- make link links each Python provider with uv pip install --no-deps, so a provider that declares a sibling by its release URL links offline; uv pip check judges the dependencies. (K763)

- A linked consumer runs the sibling kit for the whole make install, also after npm ci replaces the linked kit folder with the release copy. (K762)

- make link writes each installed npm and Composer polyspec package as one plain directory symlink to its checkout, with no npm link or composer update; link-check judges the polyspec packages a linked provider loads. (K761)

- run-tests go ends a benchmark at its result line, which it prints, or at the next benchmark or its package, since go test -json emits no pass event for a benchmark. (K760)

- The Windows bootstrap unpacks with the bsdtar of Windows, so it works under Git Bash, whose GNU tar reads `D:` as a remote host. (K759)

- commit-deleted-test judges a provider linked to its sibling checkout by that checkout, and a copy by the lock. (K758)

- rules-check reads a gates step that names `${{ matrix.runtime }}` as one run for each runtime, so the runtime lint rules of a consumer are reached. (K757)

- The kit-mk tests expect the main checkout tools that a worktree runs, so they pass in a worktree. (K756)

- The release workflow no longer repeats kit-check; the passed CI run of the tagged commit, which release-verify requires, already holds it. (K755)

- stopGroup returns only after the stopped group has ended, also when it needed SIGKILL. (K754)

- Classify the Playwright reporter for rebuild-check and create the release-run test remote through initRepository. (K753)

## 0.0.64

- Prepare the Kit 0.0.64 candidate, native consumer lock and dependency review before its single release CI run. (K752)

- Take the Composer archive version from the tag and prove consumers with native package repository metadata; source composer.json stays unchanged. (K748)

- Run Playwright Test through run-tests with the project-local CLI and a kit reporter for each case. (K747)

- Add make release-candidate and make release, which publish the exact commit of a successful CI run without a second version or test cycle. (K749)

- Accept a deleted test that names a locked, installed provider test with Provider-Test-Replacement; unverified references are still refused. (K746)

- Pass the channel, profile, components and targets of rust-toolchain.toml to rustup, so an installed toolchain gains a missing component. (K750)

- Run test-go over every go.work module in one go test, so a build-only module is no longer an empty run. (K751)

- Write scalar CI plan outputs bare so the copied workflow selects its parity jobs, and plan no parity job for one undeclared implementation; select the gate runner. (K745)

## 0.0.63

- Prepare the Kit 0.0.63 candidate, native consumer lock and dependency review before release CI. (K744)

- Scope native source linking to each runtime CI job while preserving full parity preparation and strict installed-source verification. (K743)

- Fix clean-checkout npm bootstrap by deferring parity target enumeration until an ordinary gate invocation; retain strict mixed-goal validation. (K742)

- Prepared Kit 0.0.62 with native candidate packaging, locked consumer installation and a current dependency review. (K741)

## 0.0.62

- Update reviewed stable dependency pins and native toolchain digests with a clean advisory record. (K740)

- Run workspace and infrastructure tests through the standard runner with owned case-sensitive resources and native process cleanup. (K739)

- Honor native PHPUnit case deadlines through supported namespaced event extensions and preserve explicit watchdog settings. (K738)

- Include changed direct exact Composer requirements in source updates without treating platform constraints as packages. (K737)

- Prepare worktree Python environments through native locked uv synchronization and declared source overlays. (K736)

- Accept exact Python unittest discovery file patterns while rejecting a later broad pattern. (K735)

- Provide mandatory full or API/binding parity gate partitions with safe Make target generation and exact recipe validation. (K734)

- Distinguish successful Go helper packages with no test files from skipped named tests and empty test runs. (K733)

- Scope PHP arginfo verification to full toolchain checks and native extension builds. (K732)

- Run consumer shared, runtime and parity gates in independently prepared jobs with declared locked setup. (K731)

- Prepare and clean up declared CI resource contexts around mandatory provider gates, including failed preparation and verification. (K731-1)

- Add verified Windows bootstrap and native Make/process execution with pinned Node, npm, Go and Rust. (K730)

- Prepared Kit 0.0.61 from successful CI with native candidate packaging, locked consumer installation and a refreshed dependency review. (K729)

## 0.0.61

- Install the native PHP parser where temporary consumer fixtures resolve it and assert the concrete cause-loss diagnostic emitted by PHPStan raw output. (K728)

- Reject caught-exception cause loss with a locked native PHPStan rule and document the executable language-specific error checks and their limits. (K727)

- Run each TypeScript violation fixture through its explicitly declared owner step while keeping every finding assertion and real full-pipeline positive, negative and routing coverage. (K726)
- Declare the PHP parser used by native autoload lint and compare broken-repository failures against the running Git diagnostic instead of version-specific wording. (K725)
- Restore exact PHP/Composer, Go, Python and PHP extractor prerequisites for the CI shards that use them, and retain the forbidden-input rule after moving its negative-test fixture. (K724)
- Support selected pinned tool installation through TOOLS with validated prerequisites, preserve unrelated installations, and let each CI job prepare only its own required environments. (K723)
- Split the parity test file into two independent CI shards, preserving all 132 test titles and bodies exactly once and sharing their fixtures without duplication. (K722)
- Fix parity phase fixture types, remove duplicated phase blocks, and isolate nested Make probes from parent shard variables so empty-selector checks cannot recurse into their own CI group. (K721)
- Split parity CI into public API/static checks and selected native binding phases, preserving every static rule and the default complete check. (K720)
- Verify host-native public API forms against their own release artifact while retaining shared behavior, executable requirement tracing and complete public symbol coverage. (K719)
- Run Kit unit tests in six parallel CI shards and source tests in nine explicit groups, enforcing exact-once test coverage and the final success gate. (K718)
- Extract effective public PHP trait members on consuming classes, including nested composition, aliases and visibility/precedence adaptations, while keeping internal trait declarations hidden. (K717)

- Aligned mixed deferred-requirement expectations and preserved requirement markers in native PHP fixture rewrites, keeping the failure and cleanup assertions intact. (K716)

- Preserve bindings for explicitly held requirements, report held units without executing or counting passing cases, and reject mixed active/deferred requirements. (K715)

- Read all explicitly declared public API inputs, including per-crate Rust features, and reject partial extraction instead of accepting an incomplete symbol inventory. (K714)

## 0.0.60

- Included the existing Korean principles link to the canonical English standards plan in the release. (K711-1)

- Kept Cargo fetch expectations aligned with the provider checker lock and installed the Go proof stub at the selected checkout tool path, preserving offline, failure and version assertions. (K713)

- Added tagless candidate archives from committed HEAD through the existing npm, Composer, generated PHP and wheel producers; candidate builds reject uncommitted source, while tag creation and publication keep their CI gates. (K712)

- Commits may record a final checklist state reachable through legal working-tree transitions; item-state still permits only one edge per operation. Regressions cover a committed waiting-to-done path, refusal of a direct waiting-to-done operation and refusal to reopen done items. The retained-branch lifecycle tool is classified as repository policy. (K708-1)

- Prepared Kit 0.0.60 with a tagless native npm candidate, consumer lock and current dependency review. The local consumer installation and offline policy check passed; no release tag was created. (K711)

- The PHP extension builder keeps compiler warnings and the make failure cause without replacing the previous module; the focused fake-tool regression passes 1/1 and verifies temporary cleanup. (K709-1)

- Push and release gates now distinguish development from verification, enforce verification before release or tag creation, and preserve declared retained branches. The focused K708 regressions passed 19/19; the release file initially passed 47 tests and had seven failures caused by its fixture resolving a mise shim as Go. After correcting the fixture to select Go outside `var/tools`, the seven affected tests passed. (K708)

- The existing `cargo-downloads-fetch` installs the provider's locked Rust checker dependencies for consumer offline lint, and deduplicates the lock when run from Kit itself. The focused regression passes 1/1, and the ORM consumer install fetched all three ORM locks and the Kit checker lock. (K710)

- The existing PHP extension CLI is public as `@polyspec/kit/php-extension`, with no change to its command or arguments. Its output/source-copy/configure argument case passes 1/1, the packed mapping passes 1/1, and the installed archive imports the module from dist (1/1). (K709)

- Five shared helper APIs are explicit package subpaths in source and published installs. The packed manifest maps them to `dist`; the pack transformation passes 1/1 and the offline consumer installation imports all five and matches their exports to source (1/1). (K707)

- Expected native Composer failures keep their diagnostics without GitHub Actions error annotations. CI `make kit-test` on `1aa82aea27a871743a4fa81684328431aa0de99e` emitted annotations for the three expected failures (exit statuses 2, 2 and 1); the focused K681 regression passes 1/1. (K706)

- Publish 0.0.59 after main CI passes all 1,441 unit and 187 source cases. Release run 40448452188 verifies the tag, proves the draft consumer installation, and makes the release public. (K677-7)

## 0.0.59

- Install locked Rust crates before each independent CI job runs offline checks. The two native Rust cases fail with an empty Cargo registry and pass after the declared installation; the three affected workflow cases pass. (K705)

- Prepare 0.0.59 with independent CI jobs and the required kit summary, locked native consumer installation, and complete Python backend fixtures. Workflow tests pass 16/16, affected parity cases 124/124 and the real Python symbol case 1/1. Public CI and release proof remain required by K677-7. (K677-6)

- Python symbol extraction reports project lookup failures instead of treating
  a failed stat as no project. Red: the K704 missing-entry case returned the
  extractor process error rather than the project lookup error; green: K704
  passes (1 case), while the K701 package-discovery case still passes. (K704)

- File URI path checking keeps malformed URI fallback behavior and rethrows
  unexpected parser failures. Red: the K699 regression accepted an unexpected
  parser error (1 test); green: the regression passes (1 test). (K703)

- Parity bindings can append runner arguments without replacing the native
  reporter; bindings with different arguments run separately, and `command`
  cannot be combined with binding `args`. Red: the K702 regression failed on
  undeclared binding arguments (1 test); green: the test passes (1 test).
  (K702)

- Python symbol extraction follows setuptools package discovery and excludes
  generated modules outside the declared package selection. The K701 fixture
  fails before the fix by exposing excluded modules and passes afterward (1
  test); the ORM source extraction lists 673 symbols with no generated-model
  symbols. (K701)

- Parity execution can select implementations while static declaration checks still cover every implementation; empty, unknown and no-binding selections fail, and the default still runs all bindings. Red: the K700 test ran all five implementations after selecting Go. Green: the K700 test passes (1 test). (K700)


- Parity declaration path checks preserve non-file URI values and inspect file URL runner paths for checkout escapes. (K699)

## 0.0.58

- Refreshed kit 0.0.58 consumer locks and advisory review after the provider lint and descendant cleanup fixes (K677-5).

- TypeScript lint resolves its declared tool executables from the installed provider and exposes the native type-aware backend bin directory. Linked, nested and hoisted installations run without consumer-created bin links; the catch-step fixture declares the same native dependencies. (K698)

- Command results wait for descendant process group cleanup even when a descendant closes its pipes on SIGTERM. The regression rejects executing descendants while allowing terminated zombies awaiting the system reaper (K430-2).

- Prepared kit 0.0.58 with Composer development path locks and exact multi-symbol API bindings, native consumer locks and advisory review. (K677-4)

- API bindings accept either the existing scalar symbol or a nonempty unique list of exact public symbols. R1 checks every member and R11 covers the complete declared surface; duplicate implementation bindings remain invalid. (K697)



## 0.0.57
- Composer development locks accept external polyspec path packages in both dependency sections. Installed source links remain checked separately; release consumer locks must still name the release archive URL. The local-path release regression preserves that rejection (K696).

- A short PHPUnit class id matches a namespaced test class at its exact class-name boundary; FQCNs, bare methods and provider data sets keep their exact selection. Red: the K695 regression failed because the generated filter omitted the namespace prefix accepted by PHPUnit. Green: the K695 unit passes (1 test), with changed-file type-aware oxlint and docs-check (K695).

- Prepared kit 0.0.57 with the isolated PHP parity runner correction and refreshed native consumer lock and dependency review. (K677-3)

- PHP extension parity uses the existing isolated Composer library-test autoloader, preserves extension arguments and removes temporary installs after both attempts or a support-file failure. Pure library runs and bindings with explicit commands keep their existing execution. (K677-2)

- The parity regression verifies cleanup after both successful and failed attempts and leaves the library vendor directory unchanged. (K677-2)
- Composer development locks accept external polyspec path packages in both dependency sections. Installed source links remain checked separately; release consumer locks must still name the release archive URL. The local-path release regression preserves that rejection (K696).

- A short PHPUnit class id matches a namespaced test class at its exact class-name boundary; FQCNs, bare methods and provider data sets keep their exact selection. Red: the K695 regression failed because the generated filter omitted the namespace prefix accepted by PHPUnit. Green: the K695 unit passes (1 test), with changed-file type-aware oxlint and docs-check (K695).

- The Rust parity runner selects the Cargo target named by an explicit manifest path and maps sibling modules to the existing `tests/<name>/main.rs` target. Conventional `tests/<name>.rs` and library fallbacks remain. Red: K694 selected `--lib` for an explicit integration binary and for its test modules. Green: K148 and K694 pass (2 tests), with typecheck, changed-file type-aware oxlint and docs-check (K694).

- PHP feature bindings run only the exact methods grouped for their file. Bare and qualified method ids, FQCNs and provider data sets use escaped PHPUnit filters; the parity ledger still requires every selected id and ignores unselected test failures. Red: the K692 regression failed because an unselected failing method ran from the shared file. Green: the exact K692 unit passes (1 test); changed-file oxlint and docs-check pass (K692).

- A fix commit may cite a valid Red result from an existing regression test without changing that test file in the fix; a fix with missing or malformed Red or No-Red remains rejected. The focused commit unit checks both the valid Red path and the existing No-Red path. Red: K693's source-only fix regression failed at a6a485e8; Green: the K693 unit passes (1 test), with changed-file oxlint and docs-check (K693).

- CI acceptance retains the complete earlier failure reports and the final successful run 40366841110: all 44 steps, 1425 kit tests and 182 source tests pass with zero failures, timeouts or skips. Release verification independently accepts the public annotated v0.0.56 tag; the entire local suite was not repeated for each fix (K686).

- Kit 0.0.56 is public after its own CI passed all 44 steps (1425 kit and 182 source tests, no failures, timeouts or skips) and release run 40371683313 passed archive generation, external consumer proof and publication. The annotated tag and asset are available on the GitHub Release; the failed 0.0.55 tag remains unchanged (K677).

## 0.0.56

- Native advisory review includes the separately resolved npm release-consumer lock as well as the development root lock. Red: adding its declared audit scope exposes the missing review entry. Green: native review records all six current locks with no advisories, including the four consumer-only transitive versions; the offline dependency gate passes without exceptions (K677-1).
- This version carries the native source/worktree package management, optional installed-package bootstrap, runner cleanup and dependency review changes of the unpublished 0.0.55 candidate. Its existing tag is retained after the asset gate rejected the normal prepack transformation; the corrected validator is included here (K677).

- The parity ledger records malformed reporter output as an R3 failure of its binding and continues with remaining suite and feature bindings; the node reporter parser stays strict. Red: the selected K691 unit aborted on `exit 0`; Green: the K691 regression passes (1 test), and docs-check passes (K691).
- Kit release archive validation shares the canonical prepack manifest transformation for source exports and the native hook bin. Every remaining byte, including names, versions, dependencies and scripts, is still compared with the tagged source; other npm and Composer manifests remain byte-exact. Red: the normal transformed kit manifest fails assets at b343be7a. Green: five selected release/prepack units pass, including six unexpected kit manifest mutations and existing generic-package mutation checks; changed-file type-aware lint and docs-check pass (K686-6). The existing real packed-consumer case now runs its single native pack through release.assets and installs that same tarball; its selected source run passed in 167.6 seconds without another build or pack.

## 0.0.55

- npm source-link fixtures use generic provider identities while preserving transitive graph selection, all declared dependency sections, overrides, linked-source idempotence and ancestor-workspace resolution. Production code and the repository isolation rule are unchanged. Red: the isolation naming case fails at 90c812ec. Green: that case and three selected npm cases pass; changed-file type-aware lint and docs-check pass (K686-5).

- Native link fixtures follow the existing-environment source-only contract: no locked sync, one selected-provider editable transaction, explicit extras and exact source paths, with no --no-deps. The uv fixture consumes every editable argv and separates extras from paths without resolving dependencies. The shared owner-file run found an omitted worktree Python environment and an obsolete relative-link representation requirement; the fixtures now prepare that environment and require a symbolic npm link, exact provider identity, passing read-only diagnostics and unchanged declarations. Local Red: K657-3 fails at 0c100506 when the old stub treats [extra] as part of a directory. Green: K657-3 passes; one owner-file run collected 72 passes and two failures, then both failed cases pass after their fixture corrections. Changed-file type-aware lint and docs-check pass; this local evidence does not identify an uncollected CI failure (K686-4).

- The Go worktree source fixture prepares its consumer through a native offline npm install with a declared local kit dependency and passes the pinned npm command to both setup calls. This removes its manual installed-package link while retaining every Go workspace, unpublished-module, repeated-link and main-isolation assertion. The fixture migration was missed in K690; its owning real test fails before this correction and passes afterward (K690-1).

- The final candidate itself was prepared with the new native offline worktree path: npm and both Composer projects installed from the shared caches, link-state-check passed, and both working trees retained no tracked changes. This preparation ran no product rebuild or full test suite; whole-candidate CI and publication remain separate acceptance steps (K655).

- Worktree preparation delegates npm dependency trees to native offline npm ci with the main project’s configured cache and declared-root URL policy, then reconnects sources through the existing native npm helper. Composer uses its shared native environment/cache and selected manifest/vendor settings, creating its own packages, records, bins and autoload; legacy projections are removed without following links into main, and immutable archive inputs use filesystem copy/cloning before installation. Tools remain reused and uv behavior is retained. The storage tradeoff is explicit. Red: the two native-preparation unit cases fail at d3d16d3a; green: 18 unique owner units and the tiny real npm and Composer worktree cases pass, with main bytes/locks unchanged, cache-only repeat behavior, type-aware lint, typecheck and docs-check verified (K690).
- Package-test preparation retains six isolated native install/build consumers and the existing per-process primed download cache. The dependency-root test now states its actual ownership contract, and the source-export comment distinguishes checkout imports from packed dist imports. Verification: review of the helper and its three caller files; behavior and assertions are unchanged, so the expensive package tests are not rerun for wording (K678). Verification also passed make docs-check; the review is complete.
- Python source linking requires an existing native environment and connects selected editables without reconciling the release lock. The explicit uv installer retains its locked sync before the shared native source backend, so a new local dependency can be connected without rewriting or inventing a development lock. Red: K689-3 fails at 47436bb6 because source linking first resolves the stale release graph. Green: the selected unit and real existing-environment case pass, while the locked installer still rejects the stale lock; changed-file type-aware lint passes (K689-3).
- Python source installation follows known local runtime dependency names and submits selected editables in one native uv transaction, including explicit root requirement extras. uv resolves compatible external dependencies without blanket --no-deps; native dependency, source-path and selected-provider completeness checks remain. Red: K689-2 fails at 7f1c091d because the development beta requires an unpublished local child and cached setuptools that are not installed. Green: the selected unit and real native case pass, including unchanged release URL/hash lock and live child-source edits; changed-file type-aware lint passes (K689-2).

- The release candidate also retains the native Python editable overlay and platform diagnostic handling, with selected-provider completeness and control-flow regressions. Lint cleanup failures retain original diagnostics and subsequent checks. These later fixes have their own prospective child registrations and owning evidence (K655).

- The corrected 0.0.55 candidate includes the native ownership, advisory, isolated-target and process-cleanup fixes. A new online native review covers all five exact locks without advisories; newer-tool notices remain informational. Owning checks are recorded above; successful candidate CI and public consumer proof remain pending (K655).
- Pre-test builder exit triggers existing process-group cleanup while awaiting output drain, so pipe-holding descendants no longer block completion. The focused builder orphan-pipe and failed-build cases pass; changed-file type-aware lint and typecheck pass (K682-1).
- Normal test-tool exit triggers the same cleanup without waiting for a case or gap deadline. Its focused orphan-pipe case preserves exit 0, final output and passing test counts while leaving no active group members. The timeout, interruption and lost-parent cleanup guards also pass (K682-2).
- Candidate status distinguishes completed native ownership fixes and the four corrected CI owners from pending whole-candidate CI/publication. At reconciliation, the legacy worktree dependency projection and existing land timeout were assigned K690/K685 rather than claimed as completed; their later implementation and owning evidence are recorded separately (K679).
- Source-mode helpers and release installation now have explicit native validation boundaries. Release bootstrap requires no sibling checkout, source npm-install requires selected development providers, and readonly link checks do not claim universal peer/version validation. No resolver or new runtime enforcement was introduced (K683).
- Run-result input hashing treats the root selector `.` as all tracked and new non-ignored files, using the existing Git file list. Ignored output stays excluded and unknown input paths still fail. Selected CLI runs with --results and no --inputs now write their actual passing report. Red: both root/report regressions fail at 1a31679b; green: three owning digest/report cases and changed-file type-aware lint pass (K687).
- Cargo source commands, Make recipes and the standalone test runner omit inherited CARGO_TARGET_DIR while retaining explicit native target arguments and other environment settings. Native metadata confirms distinct default targets for main and its Git worktree without compiling crates or changing Cargo.lock. Red: four target-isolation owner cases fail at d83b6c61; green: those four cases and five source/holder/locked-graph regressions pass, with changed-file type-aware lint and typecheck (K676).
- Dependency review updates execute native commands without synthesizing Composer provider entries, scratch manifests, version overrides or pre/post-update lock metadata patches. Application-selected manifests and declared repositories remain native inputs; failed resolution leaves the lock unchanged. Retired provider-entry entry points fail with native migration guidance. Fourteen synthesis-specific cases are replaced by five native ownership regressions, retaining graph resolution, transitive/path/VCS declarations, real versions, platform failures, repeat lock stability and release-lock boundaries. Red: native validation changed application lock metadata before failing at e6475a05; green: 12 selected review/update cases, two advisory/gate cases, type-aware lint and docs-check pass (K681).
- Online dependency review explicitly runs native npm audit with offline mode disabled. Audit payloads must contain vulnerabilities and must not contain the native error discriminator, so failed transport cannot replace a successful review with an empty finding set. A pinned native npm experiment with an isolated cache and a closed loopback endpoint confirms inherited offline mode returns a false zero while the explicit online audit fails. Red: the owning boundary cases fail at c960e2fa; green: selected boundary, vulnerability, empty-output and schema units plus the native experiment pass; typecheck and changed-file lint pass. Offline gates still read committed reviews only (K684).
- npm advisory reviews retain each affected native audit node path and its exact locked-copy version. A safe top-level copy is never substituted for a vulnerable nested copy; missing node versions retain the native range. Review and offline gate findings name the affected node. Existing lock/package/advisory exceptions still cover every matching copy rather than individual paths. Red: the nested-copy case records the safe 8.3.4 top-level version at 80a3a877; green: selected attribution, fallback and schema cases, typecheck and changed-file lint pass (K680).
- Go and Cargo pre-test builds have no whole-operation deadline. The runner logs their command start, live output, exit status and elapsed time; a failed build still prevents test execution. Case deadlines, cancellation, lost-parent detection and process-group cleanup remain separate. Red: the clock-advance boundary case fails at e7fc0116; green: four build-owner cases and three timeout/interruption/parent-loss cleanup cases pass, with changed-file type-aware lint and typecheck (K682).
- Python editable source verification rejects a selected local provider that is absent from the native installed-distribution list, including an empty or unrelated-only list. Existing real-path checks remain, while unused providers and valid release-only installations are unaffected. Red: the K689-1 case fails with a missing expected exception at 87b23676; green: the selected owning unit and changed-file type-aware lint pass. This patch does not extend transitive, unpublished-package or marker selection coverage (K689-1).

- Warning metadata is diagnostic only when the warning call result is ignored. Calls used as conditions, assigned values or returned predicates remain platform findings; the existing diagnostic warning and direct platform/architecture branch checks stay intact. Red: all three consumed-result regressions fail at e3ff712d; green: four focused divergence cases and type-aware lint pass (K688-1).
- Lint steps retain original tool output and exit failures when owned temporary-directory cleanup fails, report cleanup as a step failure and continue later steps. A deterministic cleanup seam verifies successful and failing tools without permission-sensitive fixtures. The original PHPStan cleanup commit 83a07531 used parent K686; K686-3 was registered afterward before this follow-up. Red: two cleanup-owner cases fail at 15162952; green: four focused lint cases and type-aware lint pass (K686-3).
- Land awaits Make, rebase, merge and worktree removal operations through the existing command runner without a whole-Make deadline. Command starts, live output, results and elapsed times are visible; parent-loss and process-group cleanup remain active, and the main comparison lock stays held through its awaited gate. Document checks report phase progress without changing their findings or default programmatic output. Red: the live gate progress case times out at a4db4dc7; green: all 26 land owner cases, the document progress case, changed-file type-aware lint and typecheck pass (K685).
- Local Python providers are installed with uv's native editable operation after excluding only their release-wheel installation from the locked sync. The release URL, hash and lock stay intact; an offline fixture verifies that the environment imports the declared source (K689).
- The divergence checker ignores `process.platform` and `process.arch` only when they describe warning metadata, while retaining findings for runtime branches. Red: the focused K688 case failed at `16ecc178`; green: `make item-test ID=K688` passes on the committed fix (K688).
- Legacy bootstrap assertions now verify the exact consumer Node/native npm-bin hook command, executable source and packed-dist command targets with identical settings, and the installed-package workflow before Make. The workflow check reuses the recording-npm fixture, preserving exact npm selection and the kit source exception without installs or builds. Red: the three prior path assertions fail at 380a23a5; green: the three selected owner cases and changed-file type-aware lint pass (K686-2).
- The npm provider-selection fixture creates each source package through its existing provider helper, including its manifest, before transitive graph traversal. Selection assertions remain unchanged, and production code is unchanged. Red: the owning case at 77eb86c8 fails with a missing transitive package.json; green: the selected case passes with the complete native package inputs (K686-1).
- Reconciled all 31 pre-existing non-complete checklist items against current code and decisions. Historical IDs remain intact, obsolete coupled publication is retired, native ownership rules replace synthetic-link wording, and actual gaps receive K680–K686. The audit records code/test inspection separately from executed verification and identifies K671 as implementation-time registration (K679).
- Release handoff distinguishes native source-link ownership, superseded sibling bootstrap, implementation evidence and public release acceptance. The release checklist stays open on failed CI; changes outside the published 0.0.55 tag require a subsequent version and its own verification. Local-link documentation retains npm lock reading. Cargo target inheritance and package-test setup costs remain explicit follow-ups (K675).
- npm idempotence checks Node's actual resolution paths, so a workspace package reuses an already-correct source link from an ancestor `node_modules`. Missing or shadowed source paths still go through native npm linking (K674).
- Repeating local npm linking is a no-op when every selected installed provider resolves to its source; a wrong or missing source still runs native npm linking. The offline source-graph case with a release URL override and the wrong-target repair case pass (K673).

- Transitive npm graph fixtures use generic editor, language, storage and codec identities in package names, paths and release URLs. Dependency edges, workspace layout, release overrides and exact source assertions remain intact. Red: isolation fails on product-specific identities at 377c06b1; green: isolation and the focused K672 selector/native graph checks pass, with changed-file type-aware lint (K672-1).
- The Cargo fallback fixture allows the native offline update preflight and separately verifies that source refusal prevents the requested command and releases its holder. Red: the owning fallback case fails at cdb95b63; green: all four selected Cargo source cases pass (K671-8).

- The rebuild inventory classifies the native Cargo metadata source helper and describes current npm and uv installation commands. Dependency, document, generated-file, link-state and npm tests use generic package, path and URL fixtures; isolation and all original semantic assertions remain intact. Red: the classification and isolation owner cases fail at 89ee79f8; green: 26 selected owning cases pass (K671-5).
- Installed-package bootstrap integration is complete: source links remain optional, shared files are regular package-managed copies and release/gates use package-first setup. Owning workflow, native source/packed hook, copy, npm and rule tests pass. All 25 PHP extension owner tests also pass with the retained tokenizer fix. Main CI and release publication are pending (K671).
- Worktree link fixtures carry their own Composer vendor-directory response and prepared native Python source declarations. Missing make targets accept both GNU make diagnostic quote styles while missing prerequisites and other make failures remain errors. Red: the worktree case and GNU make 4 K583 case fail at 76a52fa8; green: four selected link cases, the real GNU make 4 K583 unit, typecheck and changed-file type-aware lint pass (K671-7).
- Native npm linking no longer disables package-lock reading: an offline locked registry range keeps its native tarball resolution instead of querying the registry again. --no-save retains the release manifest and lock. No legacy-peer-deps bypass is introduced; correct-source idempotence is defined by K673/K674. Native npm link may accept an incompatible linked peer; the focused fixture records that npm ls detects it, without adding a resolver or a new installation gate. Red: the locked-range case fails with ENOTCACHED at 89ee79f8; green: locked-range, peer observation and the existing release-to-source case pass, with changed-file type-aware lint (K671-6).
- Bootstrap documentation and rules require the installed package path and regular shared copies, retaining optional native npm source links. The native npm lock records the hook command. Workflow units (16), rule units (13), document and rule checks pass (K671).
- Python linking skips projects without declared polyspec dependencies instead of syncing an ambient uv workspace. The owning unit fails at 14c67f38 and passes with the guard (K670-4).
- Release version commits allow manifest and lock metadata without allowing implementation changes under chore(release). The owning unit fails at 14c67f38 and passes with the fix (K670-3).
- The install-packages unit fixture holds bootstrap and kit.mk under node_modules/@polyspec/kit and includes that installed-package path. Its dry run still verifies npm ci of the release lock without invoking source linking. Red: the standalone bootstrap fixture fails at 89ee79f8 because kit.mk is absent; green: the single K511 case and changed-file type-aware lint pass (K671-4).
- Release and gates bootstrap consumer package locks with the exact packageManager npm before Make, without lifecycle scripts during bootstrap; the regular toolchain and package lifecycle installation follows. Kit itself uses its source Makefile and skips installing a published copy of itself. Gates use the standard root checkout and retain install, native linking and every gate target. No floating or tag-based sibling source clone remains. Thirteen unchanged workflow cases passed; three new package-first execution and root-layout cases pass, including consumer command arguments, explicit cache and kit skip; changed-test type-aware lint passes (K671-3).
- The installed kit bootstrap supports native npm source links and packed installs without a mandatory sibling checkout. npm owns the polyspec-kit-hook command link; prepack changes its source target to dist while Claude settings retain identical consumer-local command bytes. Two pack-owner units and one native source/packed consumer case pass, including allowed commands and hook refusal. Changed-file type-aware lint and typecheck pass (K671-1).
- Shared principles, editor settings, Claude settings and release/gates workflows are regular copies from the installed kit package. Synchronization atomically replaces managed symlinks even when their bytes match, leaves their providers unchanged and writes nothing on repeat. Tracked shared links no longer require or receive a sibling-checkout exception, and synchronization refuses the kit source checkout before consumer cleanup. Red: four focused copy-policy cases fail on the old behavior; green: those four owning cases and type-aware lint pass (K671-2).
- npm source linking follows the selected providers' transitive local npm dependencies and disables workspace-wide reification during the consumer link. This keeps a linked package's local dependency graph on source even when a workspace override names a release URL. The focused selector and offline native npm fixture pass (K672).
- Arginfo generation retains the declared PHP configuration. Disabling it with -n removed tokenizer on PHP installations that load it as a shared module. Red: the K670-1 unit fails when -n drops tokenizer; green: it generates the fixture header (K670-1).
- Cargo source linking updates only locked sibling crates offline in the generated development lock before metadata and the requested command. Red: metadata selected the cached ordered-json v0.0.9 release for a compatible v0.0.10 sibling; green: the K664-3-1 regression and native offline locked metadata run select the local source, while the tracked release lock stays unchanged (K664-3-1).

- Release preparation rebuilds the 0.0.55 npm archive after the Composer owner correction and regenerates the native consumer lock from that new archive. The archive bytes change while the dependency graph and consumer lock remain unchanged. A fresh review covers all five current locks without advisories; dependency-policy-check, release-versions and docs-check pass. Main CI and publication remain pending (K666).
- The PEP 751 unlink test starts from explicit native editable metadata instead of performing a source-link sync without uv.lock. It still verifies that unlink requests the pinned release and its interpreter. Native source linking requires the application uv.lock; a pylock.toml alone does not enable a new source-installation mode. Red: the prior setup unexpectedly runs uv sync --locked; green: the single K401-1 case and changed-file type-aware lint pass (K666).
- Shared-link fixtures retain missing and wrong-source failures in check mode while expecting native first installation and repair in mutation mode. Red: the three K529, K643 and K590 cases fail at be6d847e. K529 and K643 pass after contract updates. K590 passes after preserving the Composer root owner and explicitly removing the member-local npm install to verify root fallback, missing-source diagnostics and native repair (K666).

- Release preparation packs the current 0.0.55 source with native npm and regenerates the consumer lock from that archive. The packed dependency declarations match its native consumer lock entry; the current dependency review covers five exact lock contents with no advisory. dependency-policy-check and release-versions pass. Publishing and main CI acceptance remain pending (K655).
- Native tool fixtures and CI input declarations cover supported Go, PHP, Git, dependency-review, module-path and workspace-hook contracts. Their owning checks pass; complete CI verification remains the release gate (K661).

- npmSourceFolders selects known providers declared by dependencies, devDependencies, optionalDependencies or peerDependencies even before an install exists, and retains installed transitive providers. It only selects inputs for native npmLink; it writes no install records or synthetic locks. The selector unit and a real unpublished-source install pass; type-aware lint and typecheck pass (K664-5).
- A native npm source test installs a local 0.0.1 release in main and its worktree, then uses npmLink to consume the 0.0.2 source in the worktree only. Two link runs have identical observable installation state; subsequent source edits are visible without relinking while both release manifests and locks, the provider manifest and main remain unchanged. The single source case passes with native npm, and type-aware lint passes. npm wrapper behavior is unchanged (K664-5).
- Cargo development commands verify the workspace sources selected by native metadata before executing the requested command; a sibling release fallback fails with native path or compatible requirement guidance. The holder lock covers the lock copy, metadata and command, rejecting concurrent writers, and execution arguments remain intact. The common metadata graph options preserve features, manifest, config, offline mode and target filtering; package execution scope remains a separate native concern. Target-directory inheritance is unchanged and requires a separate isolation follow-up. Red: fallback and concurrent writer cases fail at 8684ef0a; green: 10 owning units and one native unreleased path case with repeated source and lock checks pass (K664-3).
- Go source linking reconciles native go.work use directives with go work edit instead of deleting workspace and checksum state. Worktree setup copies local state only initially and remaps main-checkout module paths to its own sources, including inherited tracked workspace paths. A real Go fixture verifies provider edits, a new unpublished module, repeated link/setup state, and unchanged main sources/manifests/sums. Red: the worktree program fails at 86fa740f because its module is absent from the copied absolute-path workspace; green: the native case and owning Go unit cases pass (K664-4).
- Shared linking runs native installation of declared npm and Composer sources before missing-folder inspection, so a first installation creates installation folders and records instead of falsely reporting an absent package. The focused shared-link regression fails without the integration and passes with it (K664).
- Python development installation runs native uv sync --locked against the application source/workspace declarations once, then checks installed distributions with uv pip check. Previously uninstalled declared libraries are included; no installed-package filter or kit-generated manifest, version or distribution metadata remains. Native source resolution is authoritative, including virtual projects; pip check validates installed distributions rather than a virtual root. Three unit cases and one real uv case pass, covering release-to-development source selection, a newly declared library, repeat state, live source edits and installed-consumer exact-version failure; changed-file type-aware lint passes (K664-1).
- Composer source selection includes newly declared local dependencies before their installed folders exist and follows the application-selected development manifest. Composer creates an initial lock with native resolution, then limits updates to local packages and their dependencies. A released 0.0.1 dependency switches to compatible 0.0.2 development source and a never-released package through real native links; source edits need no release, repeat manifest/lock/metadata/autoload state is identical, and incompatible exact requirements retain native errors. Red: the new-package unit returned locked instead of linked; green: five owner units/integration cases and type-aware lint pass (K664-2).
- Worktree rebuilds resolve the public link export of the installed source or packed kit; the workspace hook path follows the running module. Source-path ownership checks pass seven cases, both tool-export fixtures and rebuild ordering pass, and changed-file type-aware lint passes (K661-9).
- Dependency isolation recognizes type declaration packages actually read by the native TypeScript compiler for kit tools, separately from runtime imports, commands and peers. Unused type packages remain rejected and test-only imports do not count as tool usage. Red: the dependency-use case rejects required @types/picomatch; green: three owning isolation cases and type-aware lint pass (K661-10).
- The parity overlap test checks the finding count, shared requirement, both conflicting suites and merge guidance rather than its complete sentence. The Python lock test checks missing uv and installation guidance independently. Release coverage distinguishes the application-owned PHP lint manifest from kit-written files. Red: all three owning cases fail at fc0fccc2; green: all three pass and the changed files pass type-aware lint (K661-8).
- Dependency contract tests leave version selection, local paths and installation form to native package managers. The security gate still rejects unreviewed lock changes and reviewed vulnerabilities; package scoping selects advisory findings, and a Python Git pin is recorded by review and protected by the full lock fingerprint. The seven former gate expectations fail at fc0fccc2; seven current-contract cases and their type-aware lint pass. Native install behavior remains owned by npm-install.test.mts and composer-install.test.mts (K661-7).
- Workspace hook discovery distinguishes an explicit GitHub Actions checkout, including nested checkouts, from an interactive development workspace. The writer and checker share that decision; dependency-link checks remain active, and workspaces outside the runner checkout still reject missing, modified and non-executable hooks. Red: root and nested runner cases fail at fc0fccc2; green: 11 owning link cases, typecheck and docs-check pass (K661-6).
- Dependency review fixtures accept a complete review with no advisories when a newer release exists, while retaining the newer-release details and update guidance assertions. Red: five owning cases fail at fc0fccc2; green: the five selected cases pass (K661-5).
- Git test sandboxes initialize main independently of machine defaults while preserving explicit branch options. Six fixture files use the shared native initializer, which keeps maintenance disabled and test identities local. Red: the K524, K583 and shared-initializer cases failed with init.defaultBranch=master at c3f0a859; green: seven owning plan and sandbox cases pass under that same default (K661-4).
- Local-link procedures distinguish native source development from exact released dependency installation in CI and permit dependency releases independently. They describe native npm links, application-declared Composer path repositories and development locks, uv editables and offline worktree environments. Development rules require reporting nonstandard package-management requests with a conventional alternative. The English/Korean documents pass docs-check (K657).
- The fresh-checkout verification installs and builds in setup, then consumes the built public tracked-files API without recursively running kit-test or source-test. The smoke helper preserves process-group cleanup, a failed command and both output streams. Red: the K659 regression invoked the kit-test trap and failed with exit 43; green: eight focused smoke and diagnostic cases pass, and typecheck passes. After setup-boundary integration and local disk recovery, the actual fresh-checkout verification passes with installation and build in 54.4 seconds, the API case in 0.1 seconds and teardown in 3.0 seconds: 2 passed, 0 failed and 0 timed out, without a recursive suite (K659).
- The fresh-checkout verification installs and builds in setup, then consumes the built public tracked-files API without recursively running kit-test or source-test. The smoke helper preserves process-group cleanup, a failed command and both output streams. Red: the K659 regression invoked the kit-test trap and failed with exit 43; green: eight focused smoke and diagnostic cases pass, and typecheck passes. After the runner setup-boundary integration, the fresh installation smoke passes npm bootstrap and package installation but fails tool installation because the local disk has no space left; package API integration verification remains pending (K659).
- The fresh-checkout verification installs and builds in setup, then consumes the built public tracked-files API without recursively running kit-test or source-test. The smoke helper preserves process-group cleanup, a failed command and both output streams. Red: the K659 regression invoked the kit-test trap and failed with exit 43; green: eight focused smoke and diagnostic cases pass, and typecheck passes. The fresh installation smoke still meets the runner's 30-second setup-gap refusal; that runner integration remains pending (K659).
- Python worktree environments are created and installed by uv from explicit offline freeze requirements; only editable project paths within the main checkout map to the worktree. uv owns configuration, scripts and installed metadata, while the main environment and shared tool caches remain in place. Existing legacy environments are refused before modification, and installation errors retain uv diagnostics. Red: the K533 owner test found no native requirements record at the parent; green: four selected Python owner tests and one real uv source test pass (K657-4).
- uv installs local Python distributions as native editables after the locked sync; source changes remain visible and uv owns distribution metadata. Legacy package-folder links are refused before any uv command can write through them. Red: the uv-install owner test expected an editable command but observed only sync at d190e3f5; green: six owner tests and the real uv editable source test pass. Shared linking delegates Python to uv, and its three Python integration cases pass, including read-only legacy-link findings (K657-3).
- Real-tool source fixtures include ecosystem manifests, case requirement ids, generated-file declarations and a native PHP wrapper. They resolve worktree tools through the shared path APIs, use the PHP extractor’s installed Composer autoloader, retain legacy declared-copy lint coverage explicitly, and reject retired Composer shadow manifests. Red: the owning fixtures fail at 65582113; green: 15 owning real-tool cases pass (K661-3).
- Go module decoding accepts null Require and Replace directive sets as well as arrays. PHP arginfo preparation belongs to extension development, while kit prepares its extension fixtures through an explicit install target; fixture discovery uses the installed generator and parser, and parser-selection tests use platform-independent inputs. Red: the null Go output and PHP library-only install units failed at 2d18f681; green: 58 owning unit tests and typecheck pass (K661-1).
- Document checks recognize explicit external Markdown item references without needing their checkouts, while bare and kit item references remain validated. Release coverage classifies the PHP lint project, the release workflow retains its archive preflight and bootstrap order, source and packed exports are checked separately, and package build assertions name both PHP arginfo parser projects. The focused document and workflow tests and release coverage pass; the package build runs in the final suite (K661-2).
- Composer source linking uses the application's explicit path repositories and selected development manifest; Composer manages its real lock, installed metadata and autoload. No synthetic manifest, version alias or runtime-record reconciliation remains. Native Composer/PHP integration and source-link owner cases pass; locked release installation remains separate (K657-2).
- Native npm audit fix updates only the transitive fast-uri 3.1.8 to 3.1.9 and markdown-it 14.3.2 to 14.3.3 within the existing dependency constraints, with no manifest version change. The actual review covers all five locks with no advisory, and removes the stale sprintf-js exception. Native npm audit reports zero vulnerabilities; dependency-policy-check and the policy-to-review advisory case pass. The newer ruff release remains informational (K660).
- The tool declaration includes cargo-audit 0.22.2 for the Rust lock advisory review. make toolchain-lock generated its native mise lock entries for the four supported platforms; the seven declaration and lock unit tests pass. The tool is installed through make install-tools in the main checkout, not copied from another checkout (K660).
- The dependency gate rejects unaccepted known advisories from the current lock review, and stale, incomplete or duplicate review coverage. Dependency review fails on advisory findings, stale advisory exceptions and incomplete queries while newer releases alone remain informational. Accepted advisories retain their reason and removal condition in output. Red: dependency-advisory.test.mts exit 1 at 2d18f681; green: 12 advisory and Cargo units, typecheck and docs-check pass (K660).
- Declared setup and teardown operations report structured lifecycle events to the node reporter and its exit watchdog. Gap and exit watches pause only for these operations and resume afterwards; case timeouts, missing-test failures and leaked-process cleanup remain enforced. Red: the K662 setup and gap regressions failed at 65582113; green: the three K662 setup/gap/failure regressions, typecheck and docs-check pass (K662).
- npm local source links are created by npm link with a project-local prefix, with npm owning its links and installed metadata. The release manifest and lock remain unchanged; edits to a linked source are visible on repeated runs. Red: npm-install.test.mts failed before the native link call at 80e3c56e; green: the npm and shared link unit tests pass 71 of 71, including a real npm source-edit case (K657-1).
- Explicit `FINAL_RUN=1` accepts a clean committed tree with waiting checklist items, refuses active items or dirty trees, and preserves the normal CI report path (K658).
- Parity requirement tracing defers an id only while the exact item in its declared English checklist is `[!]` and its task names that id; active gaps remain R13 findings, and invalid, active or duplicate references are rejected (K656).

### 2026-10-26 — Completed checklists permit an explicit local final run (K654)

- The existing suite guard accepts FINAL_RUN=1 after every checklist item is terminal and both checklist languages are readable and agree. Waiting or active items, missing checklists and malformed records refuse the run with their paths and states. ci-targets retains its normal report and propagates the supported final mode to the test runners; ordinary local suites remain refused.
- PHP arginfo installation discovers gen_stub.php under the PHP API extension directory when the prefix build directory has no generator. Red: the K652 API-directory fixture fails on the prefix-only discovery; green: it passes (K652).
- `make land` states when the candidate and main gates both fail and prints the candidate gate's stdout and stderr, while preserving K631's continuation policy (K631-1).
- Parity declarations resolve a feature coverage part against roots it contains, require exactly one implementation owner, and still reject tests outside that part (K650).
- Parity can bind an exact tracked native test file embedded in an implementation root to one external-oracle unit, while sibling tests remain implementation-owned (K651).
- A commit or a land into kit builds no dist: consumers run the sources of kit (K613), and npm's prepack builds dist at release, so the kit build of linked-build.mts (K551, the kit part of K609) is removed (K646).
- `make commits-check` refuses an id in a commit Subject only when it differs from the final id: the same id written twice names its one row, so a pushed commit that repeats its id needs no rewrite (K648).
- `make commits-check` accepts `Archived-To: <sha>` for a deleted test only when the commit's item is held and that reachable archive contains every deleted test with identical content; `Replaced-By` still works (K647).
- divergence-check matches PHP function_exists probes against function declarations in implementation roots: declared functions remain coexistence findings regardless of namespace, while undeclared runtime capabilities such as pg_connect and pcntl_signal_dispatch are allowed (K644).
- divergence-check matches global and namespaced function_exists probes to declarations across PHP implementation roots, while an undeclared external namespaced capability is not mistaken for an ORM implementation (K645).
- link and link-state-check take a Python package that is installed editable from its sibling checkout as linked, by the direct_url.json of its dist-info, and report one installed editable from another folder (K643).
- `make commits-check` judges the source-sha256 stamps of the Korean twins on the tip of its range only, the tree that land merges and docs-check reads: a middle commit whose stamp a rebase left stale, and a later commit of the branch stamps again, is no finding (K642).
- pack-manifest.mts has its test, and it and linked-build.mts have their classes in config/rebuild.json, so make owner-validate and make rebuild-check pass (K641).
- `make duplication-check` leaves out the files that `config/generated.json` declares generated, its `paths` and `exceptions`: a file that orm-gen or another generator writes repeats its template for each input, and a second list of the same files in `config/duplication.json` is not needed (K640).
- Each PHP-Parser Composer project of kit has its own name, polyspec/kit-php-arginfo-5.0.0 and polyspec/kit-php-arginfo-5.6.1, so link's sibling scan finds one provider per package and make install-link runs in every consumer again (K639).
- `parity-declarations-check --id` retains R2 missing bindings for units that cite the selected requirement, so intersecting `--id` with `--rule` cannot hide a finding (K638).
- install-tools stages the PHP-Parser release that the gen_stub.php of the declared PHP names, from a locked Composer project of kit for each release: scripts/kit/php-arginfo/5.0.0 for PHP 8.4 and 5.6.1 for PHP 8.5, so a repository that declares PHP 8.5 installs (K637).
- Parity feature units can explicitly scope a requirement to multiple coverage parts of one feature; each implementation needs its own test binding, and every owner must be named or explicitly share tests with a named implementation (K635).
- divergence-check treats Go GOOS/GOARCH as diagnostic metadata only when the machine value is consumed solely by a machine field in fmt.Fprintf; an actual platform branch remains a finding (K636).
- make land resolves a rebase conflict that is only the source-sha256 line of Korean twins: it keeps one line, stamps it again with make documents-stamp and continues the rebase; a conflict in any other line still refuses (K634).
- The PHP extension build passes the php-config of the checkout to configure, which otherwise takes the php-config first on PATH; a module built for PHP 8.5 no longer fails to load into the PHP 8.4 of .php-version (K632).
- make land passes a gate that fails on main too, with a note that its own row fixes it, and refuses only a gate that main passes; the comparison of output lines between the branch and main, with its special cases for progress lines, temporary folders and jscpd summaries, is deleted (K631).
- The test of the linked sources reads package.json through readFixture, so make lint-ts reports no unsafe assertion (K633).
- The PHP extension tests build with the PHP of .php-version, kit's own var/tools/bin wrappers, instead of the PHP first on PATH, whose gen_stub.php may need another PHP-Parser than kit pins; they no longer pass or fail by the PATH of the session (K630).
- A repository runs the sources of the kit checkout beside it: kit-bootstrap.mk sets KIT to its scripts/kit and KIT_EXT to mts, the exports of package.json and the Claude hook name the sources, and a change of a source reaches a consumer with no build; npm pack writes the dist exports, bootstrap and hook into the packed package (prepack) and restores them after (postpack) (K613).
- make worktree-prune is deleted: make land removes the worktree of every merged branch in which no process runs (K626), and no consumer imports prune any longer (orm T238) (K612).
- The tests of release and of the PHP extension pass lint-ts again: no useless escape in a string, and the fixture configuration is narrowed by a type guard instead of an assertion from any (K629).
- The worktrees that make land removes after its merge are those of branches with commits of their own, all in main: a fresh branch made from main for a row about to start is kept, though main contains it (K628).
- The PHP extension builder publishes to a caller-selected absolute module path and accepts declared source-copy and configure arguments, so per-run builds use the shared staging logic (K247-3).
- PHP extension builds stage declared tracked shared C sources into their temporary package, and Composer archives include the same source from the tagged tree (K247-2).
- make commit keeps a Red or No-Red line of the body as a line of its own wherever it stands, so a statement that follows a sentence is no longer joined into it and refused (K627).
- make land merges a branch while a process runs in its worktree, since it reads the branch: it keeps that worktree and its branch with the list of the processes, and the next land removes every clean worktree of a branch that main contains in which no process runs (K626).
- The red of a row is stated, not recorded: the commit that moves a row to done names its red in its body, `Red: <command> exit <n> at <sha>`, or states `No-Red: <reason>` for a change that no test can show, and commits-check checks only that one of the two lines is there; a fix that states No-Red needs no test file. The recorder is deleted: var/plan/<ID>.json, make item-red, the gate runs of item-state, the refusal of done without a record and the hash of the test files that a rebase invalidated (K624).
- worktree-setup links the main checkout's var/composer-artifacts, the artifact repository that a composer.json names, as one directory symlink, so Composer runs in a worktree; docs/operations/local-links states what a symlink cannot do for a worktree (K622).
- `make worktree-link-state` prepares a worktree's linked installs and runs `link-state-check` without rebuilding product packages; `worktree-setup` keeps rebuilding first (K619).
- catch-check-rust no longer reports a narrow Err arm: an arm with a guard, such as `Err(error) if error.kind() == NotFound => {}`, or one whose inner pattern names an error variant handles one named error and leaves every other to a later arm; an empty arm of every error, `Err(_)` or a binding, is still a finding (K620).
- kit-check accepts the tracked links of PRINCIPLES.md, its twin, .editorconfig and .claude/settings.json to the matching files of ../kit, the second exception of the rule that a repository creates no link, and still reports every other tracked link (K621).
- kit-check reads the fixed tasks of kit-bootstrap.mk from the kit that runs, since a repository holds no copy of it after K614 (K617).
- An extension of a repository without a PHP library, whose packages/php is an application such as fsm's test bed, is named by its own composer.json polyspec/<repository>-php-ext and matches no library declaration; its names, stub and arginfo header are checked as before, so lint-php-ext no longer refuses it (K616).
- worktree-setup gives a worktree the git-ignored go.work and go.work.sum that link wrote beside each go.mod of the main checkout, so its Go build reads the sibling checkouts instead of a release of a sibling module in the module cache (K615).
- kit copies only config/layout.kit.yml and the three schemas that it names, which alint must read inside a repository; a repository includes the kit-bootstrap.mk of ../kit, the PHP lint is read from kit, and PRINCIPLES.md, its twin, .editorconfig and .claude/settings.json become links to ../kit (K614).
- The check-rules test names a phrase that P10 and P38 state, where it named phrases those rules no longer hold, and the help of worktree-setup no longer states the disk floor that K596 removed (K611).
- Concurrent PHP extension library tests prepare separate Composer fixtures and remove them after PHPUnit exits, so overlapping runs cannot replace each other's vendor symlinks or autoloaders (K610).
- land refreshes what the linked consumers read after its merge, as a commit on main does: in kit a build input builds dist, elsewhere a stale linked package is rebuilt; make commit and land share linked-build.mts (K609).
- The refusal of a done without a recorded red no longer advises item-red BEFORE=, which K608 removed (K608-1).
- item-red runs the Verification on the tree of the row and takes no BEFORE=: the swap to an old commit, its build and its checks (K389-1, K389-3, K525, K553, K556) are removed, and the red of an old fix is taken by hand with git (K608).
- The Red-Gate and Red-Test lines of a commit name the head where item-red ran the Verification, and the proof of a red is that record; the merge-base, where the Verification may pass, and the ancestry check are gone (K562).
- kit passes its own lint-ts, layout-check, owner-validate and rebuild-check: unused imports go, catch-check-rust has its S9 exception, workspace lints and owner, and every tool has its class (K606).
- dependency-policy-check passes --packages only for PACKAGES of the command line, so a repository whose Makefile names its own PACKAGES runs the gate on every package (K605).
- `make land` runs selected static gates once, then fast-forwards and safely removes the branch and worktree without running a build before or after the merge (K603).
- Parity declarations trace requirements owned by a tool's exact native tests without registering the tool as a shared runtime implementation (K604).
- dependency-policy-check judges no Composer lock against its manifest and no coverage of composer.json by the Composer platforms (K180, K181): the installs of the polyspec packages are links, so the lock records a release that the development manifest has left (K602).
- land counts only the clone blocks of duplication-check as its findings, so a line of jscpd that describes the run, such as its detection time, refuses no land (K599).
- land counts the time line that ends a jscpd report as no finding of duplication-check, so an identical clone set is not refused as new (K600).
- worktree-setup links a provided package of another checkout as the one symlink to that checkout's folder, as the main checkout holds it, never to the main checkout's entry, and replaces such an earlier link (K598).
- worktree-setup refuses no worktree for the free disk and trims no Go build cache: the floor of 30 GB and the trims of K538 and K538-1 are removed, by the user's ruling (K596).
- A Composer package is linked when its folder of the vendor is a symbolic link, so the dependency review does not compare it with its registry; the code of composer.link.json and composer.link.lock, which link no longer writes, is removed (K595).
- link-state-check judges only that each install location is the right symbolic link, with the release record of the tracked locks, go.work and the Claude Code hook; the mise trust, merged branches and the build of a provider are no findings of it (K594).
- kit.mk wraps no compiler and sets no cargo jobs: the sccache wrapper of K581, which no repository used, is removed (K593).
- uv-install keeps the package links: its uv sync passes --inexact and --no-install-package for each package whose folder is a symlink, so uv never writes through a link; the release of the links before uv and the held packages of K539, K545 and K554 are removed (K592).
- Each installed polyspec package is one directory symlink to the package folder of its checkout, the user's rule; the per-file trees of Python (K541) and npm (K558), the dependency links of K574 and the declared file: links of K578 and K579 are removed (K591).
- link takes the installed folders of a workspace member with no lock of its own, an npm workspace member or a Composer package of a root path repository, from the project whose lock installs it, instead of asking the member for its own (K590).
- link links each runtime dependency that a linked npm package of another repository declares and the consumer cannot resolve, and theirs in turn, to the folder that the provider checkout installed, and link-state-check names a missing one; no lock is rewritten (K574).
- The type packages of the modules that the shipped sources import, @types/picomatch and @types/semver, are dependencies of the package, so a consumer that type-checks those sources through the per-file links finds them (K582).
- A land whose main moved while its gates ran reruns only the gates that the paths of the moved commits select, commits-check and the build; a gate whose inputs no moved commit touched keeps its result, so parallel lands no longer chase main (K580).
- A commit on main whose files change a build input of an npm package with a built output rebuilds the repository when that output is stale, so the checkouts that link the main checkout live find its build fresh (K583).
- An npm package that the consumer declares by a file: dependency on a tarball, which npm unpacks into a real folder, becomes the per-file link tree of its provider, not a link to the tarball; only a dependency on a folder stays the link of K578 (K579).
- A checkout whose mise.toml declares sccache compiles Rust through one cache under the var/tools of the main checkout, which every worktree shares, capped at 5G; cargo runs half the cores unless the caller sets CARGO_BUILD_JOBS (K581).
- Under the disk floor worktree-setup trims the Go build cache oldest first until the floor is met, sparing the files of the last 10 minutes, since parallel builds keep the whole cache younger than two hours (K538-1).
- The build of main after a merge, and the run of a gate on main that a land compares with, run under their own main build lock after the land lock is released, so the next land merges while main builds (K572).
- The package exports ./link-folders with providedFolders, linkFolders and folderFindings, so a consumer's test builds the per-file link tree of K558 with kit's code (K576).
- An npm package that the consumer declares itself as a file: or link: dependency stays the one link to the declared path that npm writes, not a tree of per-file links, and link turns such a tree back into that link (K578).
- make item-red judges a failing summary in which no test ran only when it names a build or a load that failed, so a check finding after a step that runs no test is a red, while a compile or load failure is still refused by its own error line (K540-2).
- link makes the folder of an npm package of another repository a folder of per-file links without the provider's node_modules, so a node run with --preserve-symlinks resolves the package's dependencies from the consumer's node_modules (K558).
- The land lock covers only the check that main is still the commit that the gates ran on and the fast-forward: the gates and builds of independent lands overlap, a commit on main waits only for a merge, and a land whose main moved rebases and runs its gates again, up to three times (K571).
- The catches of kit without a binding that read any failure as missing or absent (the dependency policy, the document check, the divergence check, the folder links, the parity declaration and the test selection) narrow to the class or errno that means their outcome and rethrow the rest (K559).
- land reads only ESRCH as a land that no longer runs, and the document check fails when the checklists of the kit checkout cannot be read, instead of a note (K559).
- catch-check refuses a catch clause without a binding, which cannot inspect what it caught, unless the line before it states the reason with `// catch-any -- <reason>` (K561).
- The catches of kit that read any failure as missing, absent, not running or a note narrow to the class or errno that means their outcome and rethrow the rest (K559).
- Divergence-check evaluates a multiline PHP assertion as one assertion, while still reporting environment probes used in branches (K543-1).
- land excludes ANSI-colored jscpd aggregate Total summary rows from duplication finding comparisons when scan totals change, while preserving clone findings (K570).
- PHP extension stub parsing ignores namespace text inside comments when identifying explicitly internal classes (K569-1).
- PHP extension declaration checks honor explicitly internal stub classes and compare PHP `self` types by their declaring class; undeclared public classes still fail (K569).
- land recognizes ANSI-colored jscpd per-language summary rows when comparing duplication-check findings, while preserving clone details as findings (K394-5).
- land compares duplication-check findings without recognized per-language jscpd statistics rows, while newly added clone blocks still refuse integration (K394-4).
- The Claude hook follows a runner command forwarded after `--` by a Node wrapper, so exact Cargo native cases are recognized through Make targets. An `--exact` run needs a selected test name; no-selection and workspace runs remain refused locally (K568).
- Parity R12 distinguishes feature bindings by implementation and native case id, so one implementation can bind separate database cases from the same test file. It still rejects a repeated case id and duplicate suite or API entries; feature runs execute every declared id twice (K567).
- Parity owner scopes derive applicability from declared coverage parts and release artifacts, preserving shared requirements across clients; Cargo feature bindings run only their exact native test id (K566).
- The gates workflow builds a freshly cloned sibling Kit before consumer installation, so the consumer bootstrap can load its dist (K565).
- dependency-policy-check accepts a remote package tarball when the exact name and URL are supplied by root overrides for a direct root or workspace dependency; unrelated package names, URLs and transitive-only overrides still fail (K564).
- recipe-tools keeps POSIX parameter expansions intact while finding shell commands, so a valid usage expression no longer stops toolchain-check; K563 fails before the fix and passes after it (K563).
- PHP extension builds generate arginfo offline from the installed parser, and Composer archives materialize generated headers from the tagged stub with deterministic ZIP metadata (K560).
- The commit gate installs the staged lock of each nested npm project already installed in the checkout, offline, so gates resolve the dependencies of that staged project (K404-1-2).
- make item-red judges a failing Verification by the cause of its failure: only a failing run of the test runner is judged by its tests, so a check that reports a finding after passing tests is a red, while a timeout or a build, compile or load failure before any test still proves none (K540-1).
- docs/operations/release-structure.md reviews the release structure of kit: a stable bootstrap layer, configurations by reference, copies only where a tool requires them, and batched releases in dependency order (K194).
- The vendor/composer of a worktree holds every file of the main checkout's, the installed records and InstalledVersions.php as files of the worktree, so PHP reads the worktree's install paths (K557).
- make item-red BEFORE= refuses on main and runs in the worktree of the row, since it swaps the files of the tree (K556).
- worktree-setup gives a worktree every Python environment of the main checkout wherever the repository keeps it, as var/python, with its editable installs naming the worktree's sources (K555).
- Under the disk floor, worktree-setup trims the entries of the Go build cache unused for two hours, reports the bytes freed, and refuses only when the disk is still under the floor (K538).
- A commit on main of the kit package that changes an input of its build runs make kit-build, so dist, which consumers link live, follows its sources (K551).
- make item-red BEFORE= swaps the changed test files too when the Verification runs only gates of kit-gates, so a lint fix in a test file proves its red (K553).
- uv-install links every provided package that the environment holds from its checkout, also when its folder is missing, and reinstalls none, so it reads no network and no cache (K554).
- run-tests builds the tests of go and cargo before it runs them, under a build bound of 20 minutes, so compiling no longer counts as a gap without a test; a build that fails or outlives its bound stops the run with its output and its own message (K549-1).
- uv-install reinstalls the held packages offline from uv's cache in a run of its own, naming a wheel that the cache lacks, and leaves the project that it installs out (K548).
- worktree-setup writes the Composer bin proxies of a vendor into the worktree, so every vendor binary of a worktree autoloads the worktree (K550).
- divergence-check passes a test statement that asserts its environment and holds no branch, and still flags a probe in a branch (K543).
- The gap watch of run-tests bounds the start of a test process by a start-up bound of 120 s, and the gaps after the process reports that it is up by the test timeout, so the start of an interpreter on a loaded machine no longer fails a passing run; a process that never reports up is stopped at the start-up bound with its own message (K549).
- The turn of the event loop that the test-exit-deadline preload awaits around each test uses the setTimeout of the process start, so a test that mocks the timers no longer hangs its hook (K547).
- uv-install reads the provided packages that an environment holds from their dist-info records and reinstalls each, also when its folder is gone (K545).
- The events of a node test reach run-tests when the test ends, also when the test blocks the event loop: the test-exit-deadline preload turns the loop once before and after each test, so a file of synchronous tests that together outlast the deadline is no longer stopped while it passes; tests/kit/lint-ts.test.mts no longer fails at 30 s (K546).
- uv-install reinstalls each provided package whose links it releases before uv sync, and fails naming a package that ends without its folder, instead of a silent pass (K544).
- make item-red and make item-state record as red only a test or a gate that runs and fails: a command that was not found (exit 127), a run whose tests timed out and none failed, and a run that failed before any test (a build, compile or load failure) are refused with the reason and record nothing (K540).
- link makes each provided Python package folder a real folder of per-file links into the provider, so no uv install writes through a link into a provider checkout, and the release of the links before uv reaches nested links (K541).
- No catch without a statement passes the lints: lint-ts runs catch-check (oxc-parser) and refuses a catch clause or .catch callback without a statement, which oxlint no-empty passes when it holds a comment; lint-rust runs catch-check-rust (a syn crate of the package, built offline) and refuses such an Err(..) arm or `if let Err(..)` branch, which clippy does not lint. ruff S110, phpcs EmptyStatement and staticcheck SA9003 already cover Python, PHP and Go (K537).
- owner-validate checks no glob of the owner rules that kit ships against the paths of a consumer, which holds only some of them, such as the hooks that it commits (K542).
- link and uv-install remove the package links of a Python environment before each uv install, so uv never writes through a link into a provider checkout (K539).
- make item-red BEFORE= builds the repository at BEFORE when the swap changes a build input, and again after the restore, so a test that imports a build proves its red (K525).
- make commit on main and the registration of item-new on main hold the lock of land, so they and a land queue instead of one finding the change of the other (K524).
- lint-go judges deadcode over the union of the build tags of a module, so a function that the files of one tag reach is no finding of another run (K536).
- link-state-check accepts the mise trust of the main checkout in a linked worktree, treats a branch whose worktree has uncommitted changes as in use, and judges in a linked worktree only its own branch (K532).
- kit-check verifies that the owner rules select, for each source path of a language whose lint is a gate of kit-gates, that lint and duplication-check, so land lints what it lands (K534).
- worktree-setup gives a worktree every npm project and Python environment that the main checkout installed, linked to the main checkout's with the repository's own sources from the worktree (K533).
- makeVenv names the missing uv or Python of the checkout and the install that provides it again: it checks uv, then python3, before it resolves them, so the check of K393-1 no longer hides the message (K535).
- land waits for the exit of each make it runs, not for the close of its output, and stops a run past its deadline of 30 minutes with the target named (K531).
- link takes the uv workspace members of its project folder, reads COMPOSER_VENDOR_DIR before config.vendor-dir as Composer does, maps a member's hatchling sources to its installed package path, and fails with the name of a declared polyspec package that has no installed folder, in link and check (K529).
- worktree-setup gives a worktree a node_modules of links to the main checkout's packages, with the repository's own workspace packages linked into the worktree, so a worktree tests its own TypeScript (K530).
- The claude-hook reads the script of sh, bash, zsh and dash -c with all its rules, so a loop that sleeps there is refused as it is outside (K528).
- suppression-check reads a Rust allow or expect through its closing )], so the reason of an attribute that rustfmt writes over several lines counts (K527).
- make npm-install runs npm ci with allow-remote=root, as install-packages does, so a consumer lock that names the release of kit installs (K526).
- The gates of a commit and of a land read the owner rules that kit ships, as owner-validate does, and kit.owners owns every hook that make hooks writes, so a consumer commits its hooks (K522).
- make worktree-setup gives each Composer project of a worktree a vendor folder of links to the main checkout's packages and an autoload of its own, so the repository's own classes load from the worktree (K521).
- A requirement that docs/spec defines twice fails every parity declarations check, scoped runs included, and the finding names the file and line of both definitions (K520).
- uv-install, link and link-state-check take the members of a uv workspace root that a checkout names among its Python providers, so an installed member is linked (K518).
- A parity check scoped to units leaves out the units that break the schema, names them and runs its rules on the rest, so a scoped run never passes without running (K517).
- A linked worktree runs the tools of its main checkout and installs nothing: the mise data dir, installs, shims and var/tools/bin are the main checkout's with the worktree's own mise.toml, so make land from a worktree finds pypi:vulture; install-tools and install-kit refuse in a worktree, and worktree-setup links node_modules instead of running make install (K519).
- The owner rules that kit ships own no lint configuration that kit no longer copies, so a consumer after kit-sync passes owner-validate (K514-2).
- make land lands into the checkout that has main checked out, wherever it is called from, and fails naming the missing main checkout when none has main (K516).
- polyspec-lock-check and config/polyspec.json are removed: a tracked lock records the release of each polyspec package, and the gates clone the sibling repositories that the release URLs of the tracked locks name (K515).
- kit-check names each lint configuration that kit no longer copies and that the repository still holds, with make kit-sync as its fix (K514-1).
- make item-new on main commits the registration of its row in one docs(plan) commit with BODY_FILE, refusing before it writes anything without BODY_FILE or with another change staged (K499-2).
- Each lint reads its configuration from the kit package (ruff.toml, phpcs.xml.dist, phpstan.dist.neon, .golangci.yml, clippy.toml, .oxlintrc.json, knip.json); kit-sync removes these copies and config/api-extractor.kit.json from a repository (K514).
- land runs make build on the merge result in the worktree before main moves and refuses a branch whose build fails, merging nothing (K513).
- The link writes nothing into .git: the consumer's .gitignore ignores /.claude/settings.local.json, and link-state-check names the file while Git does not ignore it, so a sandboxed worktree links (K512).
- The Python folder link reads the environment that uv syncs, UV_PROJECT_ENVIRONMENT when it is set (limepie's python/var/venv), else .venv, so its polyspec packages are linked (K448-14).
- install-packages of the bootstrap installs package-lock.json with npm ci again, so a checkout without kit.mk, as a CI runner, installs @polyspec/kit; make install links after it (K511).
- The link contract (docs/operations/local-links.md) states the folder link: a polyspec package counts as installed at its release, the install is followed by a direct relative symlink of the folder, a copy is forbidden, no step judges a version, and a worktree links its tool and dependency folders to the main checkout (K448-4).
- `make link` links the installed polyspec packages of every tracked project of the checkout, a nested Composer project such as hyper's examples/board included; the tests, the fixtures and the release consumer keep the install that they test (K447).
- The push gate checks the message and the identity of each pushed commit and the checklists of the pushed tip once, and the Markdown of a checklist text is parsed once, so a backup push of hundreds of commits no longer re-runs every commit check and looks hung; the item, row and twin rules of each commit stay with the commit-msg hook and land's commits-check (K510).
- The row-ID check of land and of a commit on a branch compares with main only the rows that the branch adds or changes since it forked, so a branch behind a main that restated a row is no longer refused (K497-1).
- `link --project <dir> --siblings` and `check --project <dir> --siblings` write and check the claude-hook entry of a consumer that has no polyspec checkout beside it, before the early return that the link and check take then (K498-4).
- `make commit` on main reads the rows of HEAD whatever the size of the checklist, so a state change of orm's checklist (over 1 MB) is no new row, and a checklist of HEAD that git cannot read fails the commit with its cause (K499-1).
- K452-1 is closed (K452-1): the probe of each PHP extension is committed and verified on the committed tree.
- K452-1 is done (K452-1): each PHP extension is probed before the run starts, and one that does not load fails naming its path and the running PHP.
- A PHP extension run probes each --php-extension before PHPUnit starts: one that does not load names its .so path, what PHP reports (the API it was built for), and the running PHP, instead of testing the library silently on the wrong PHP (K452-1).
- K452 is done (K452): the extension run of run-tests passes the package phpunit.xml as --configuration, so the bootstrap loads as in the library run.

### 2026-10-22 — The extension run gives PHPUnit the package configuration (K452)

- The link is the folder (K448): `make link`, `npm-install`, `composer-install` and `uv-install` install the tracked lock as it is, then replace each installed package folder that a checkout provides (node_modules, vendor, site-packages) with a direct relative symlink to it, removing a copy; no composer.link.json, file: spec, editable wheel or package-manager resolution remains in the link, and nothing outside those folders is written. kit enforces no version or pin (S4): link-state-check judges only a copy or a wrong link (and K507's release record, which now takes a release tarball and the repository's own packages), dependency-policy-check drops sharedPin, local, tagged, latest, stale, the PHP platform pins, the constraint check, the review record and the advisories, toolchain-check compares no release, and dependency-review reports without failing. Run `make link` once after the update.
- `make land`, and `make commit` on a branch, refuse a checklist row whose ID main holds with another task, unless the ID is the row of the branch itself, and name the next ID that neither main nor any local branch holds (K497).
- `scripts/kit/run-tests.mts` passes the package's `phpunit.xml` (or `phpunit.xml.dist`) as `--configuration` to an extension run (K452), so the bootstrap it names loads as in the library run, and the orm-like test that calls a bootstrap function no longer fails under the extension. Red: `node --test --test-name-pattern=K452 tests/kit/run-tests.test.mts` fails before the fix on 6d3db7685abd; green: passes, and the 62 tests of the file pass.
- The Claude Code hook entry that `link --project` writes into `<dir>/.claude/settings.local.json` names the node of the kit checkout, so the link and its check agree whatever node runs each of them; the check reports a missing kit node (K498-3).
- `make commit` on main refuses a checklist row of a new item that the index stages there, and names the branch route for its registration; a land of a main checkout with a staged change is already refused (K499).
- K509: `make polyspec-lock-check` exempts a polyspec name that config/polyspec.json declares for the project folder of the tracked manifest, so a consumer that declares its kit package passes the gate (K509). Red: `node --test --test-name-pattern=K509 tests/kit/polyspec-lock.test.mts` failed on 1096cb67 (the declared @polyspec/kit was a finding); green: the file passes 10 of 10.
- `make land` rebases a branch that main has left behind onto main in its own clean worktree, under its lock, and runs its gates on the rebased commits, so a land that waited for another lands instead of asking for a rebase; a rebase that conflicts is aborted and refused, naming the files (K495-1).
- `make composer-install DIR=<project> CHECKOUTS="<checkout>..."` takes the checkouts that provide the polyspec packages of the Composer project after DIR, so the install names its repositories and needs no sibling discovery; `NO_DEV=1` keeps working with them (K501). Red: `node --test --test-name-pattern=K501 tests/kit/link.test.mts` failed on aff8cbac: the CLI refused the checkout argument with its usage message.
- K507: `make link-state-check` refuses a tracked Cargo.lock, package-lock.json or composer.lock that records a polyspec package with a path or link source instead of its release source (a Cargo package with no source, a link or file: resolved, or a Composer path dist), naming the file, the package and the release-source form, so the tracked lock stays the release record (K507). Red: `node --test --test-name-pattern=K507 tests/kit/link-state-check.test.mts` failed on f68fe82e (three path locks passed unnoticed); green: the file passes 25 of 25.

### 2026-10-22 — The Composer shim of a checkout runs with the toolchain environment of kit (K508)

- The K459 test of land gives its fixture a build target, which land runs after the merge since K453, so the test is green on main again (K504).
- K508 is closed: its red and green are recorded above (K508).
- `tests/kit/dependency-review.test.mts` runs the Composer shim of a checkout with kit's toolchain environment (`toolingEnvironment`), which gives the shim the trust and the directories of the checkout (K508). Without it the shim fails with "mise.toml are not trusted". Red: `node --test --test-name-pattern=K508 tests/kit/dependency-review.test.mts` fails before the fix on 51969e466b9f; green: passes.
- K490: The review record names the dependencies that the tracked composer.json declares; a link manifest adds none (K490). Red: make item-red ID=K490 exit 1 (vendor/linked recorded). Green: make item-test ID=K490 passes under make, lint-ts passes. (K490).
- `link --project <dir>` writes the kit hook entry of `<dir>/.claude/settings.local.json` before the packages are linked, and whatever their result, so a checkout without installs gets the hook (K506).
- K492: The kit Go pin is go1.27.3, the release without the advisory GO-2026-6809; mise.toml, the lock, the pins file, the symbols go.mod and the tool inventory name it. Red: make item-red ID=K492 exit 1 (kit pin 1.27.2). Green: make item-test ID=K492 passes under make. (K492).
- `make land` holds a lock for its whole run, so a second land waits for the first, and refuses its merge when main moved while its gates ran, naming the commits that moved it; `make hooks` writes a reference-transaction hook that refuses a move of main except by make land (`KIT_MAIN_WRITER`) or by a commit whose pre-commit hook passed, so a manual `git merge --ff-only`, `git reset` or `git commit --no-verify` on main is refused; run `make hooks` once (K495).
- K448-5-2: `make cargo-fetch` resolves and fetches the patched graph in the link state (var/link) without --locked, so a sibling whose dependencies are ahead of the locked release no longer fails the fetch; the tracked Cargo.lock and Cargo.toml stay unchanged, and a run without siblings stays a plain locked fetch (K448-5-2). Red: `node --test --test-name-pattern=K448-5-2 tests/kit/link.test.mts` failed on 9f3a0ff8 (the fetch ran with --locked); green: the K448, K489 and K440 tests pass (15 of 15).
- K478: the tracked polyspec-lock check uses link's repository-scoped package ownership, allowing the packages of its own workspace and keeping external sibling findings (K478). Red: `node --test-name-pattern=K478` on 8f487225 exit 1 (both own-workspace tests); green: the K478 tests pass.
- K478-1: a tracked package manifest symlink that resolves outside the checkout gives no ownership to a locked external 0.0.x polyspec package (K478-1). Red: the K478-1 test with the outside-checkout guard removed exit 1; green: the K478-1 test passes.
- `link --project <dir>` writes the Bash PreToolUse hook of the claude-hook of the kit that runs it into the untracked `<dir>/.claude/settings.local.json`, keeps its other keys, and ignores the file through the Git exclude of `<dir>`; `link check --project <dir>` names the file while the hook is missing (K498).
- `make npm-install` copies the project's `.npmrc` into its temporary install folder, so npm installs with the configuration of the project, such as `legacy-peer-deps=true` for platform peers that the checkouts provide (K502). Red: `node --test --test-name-pattern=K502 tests/kit/npm-install.test.mts` failed on 71ef287d: the npm of the install found no `.npmrc`.
- The PHP application example names no framework product: S10 of PRINCIPLES.md and its Korean twin, and the K359 and K425 rows of the common-standard checklist, name a PHP console application as the example of an application on a userland framework, not a framework product (K477). Red: make text-absent FILE=PRINCIPLES.md TEXT="Symfony Console CLI" exit 2 before the fix; green: the same run after it (K477).
- `dependency-policy-check` takes `--packages <name,...>` (`make dependency-policy-check PACKAGES=`) and reports and fails only on the findings that name those packages; the unscoped gate is unchanged (K493).
- `make npm-install` takes `ADD=<checkout>...`, which links each named package folder from the start even when the project does not declare its package, as a file: dependency of the temporary manifest; the tracked package.json and package-lock.json name none of them (K485).
- K491: The dependency test fixtures run in the environment of their test, not of make: MISE_LOCKED is dropped, and a fixture tool is the one PATH finds outside the checkout's var/tools, so the shims of the checkout no longer recurse into mise (K491). Red: make item-red ID=K491 exit 1 under make (go shim recursion, ruff not in the lockfile); green: make item-test ID=K491 passes under make, lint-ts passes. (K491).
- The K205 test of link asserts that install-packages runs `npm-install DIR=.` and that npm-install runs `npm ci`, the install recipe of kit-bootstrap since K448-8, in place of the stale `$(NPM) ci` line, so the test passes on main (K500).
- K448-5-1: `make cargo-fetch` patches a sibling crate only when the consumer's Cargo.lock names it, so an unused crate no longer records a patch.unused entry in the tracked lock and --locked accepts it (K448-5-1). Red: `node --test --test-name-pattern=K448-5-1 tests/kit/link.test.mts` failed on f57380a8 (the patch was written for an unnamed crate); green: the K448, K489 and K440 tests pass.
- `make link` re-makes an npm link whose target is absolute, and that resolves to its provider, as a link relative to its folder, the form that link writes and the rules of kit name; the target form is decided in `docs/operations/local-links.md` (K326-3).
- `make npm-install` takes the package folders of a checkout that has them, never the checkout itself, so a root whose package.json carries its package's name (ordered-json) links packages/js (K494-2). Red: `node --test --test-name-pattern=K494-2 tests/kit/npm-install.test.mts` failed on f57380a8, linking the root.
- `make npm-install` links a sibling package that the lock names only transitively, with a release URL, by declaring it as a file: dependency, so no release is fetched (K484).
- `make uv-install ... STATE=<dir>` writes the editable wheels of the install under the absolute folder STATE, so an install writes nothing into a source checkout that is mounted read-only; without STATE the wheels stay under var/link of the consumer, and a relative STATE is refused (K488). Red: `node --test --test-name-pattern=K488 tests/kit/uv-install.test.mts` failed on 5d6f9a96 with EACCES at the mkdir of the consumer's var/link.
- `make npm-install` takes a `CHECKOUTS` entry that provides no npm package, such as a PHP-only fork, and links nothing from it, as `link` does with the same list; only an entry that is no existing directory is refused (K494-1). Red: `node --test --test-name-pattern=K494-1 tests/kit/npm-install.test.mts` failed on 2fbe521f, refusing the composer-only checkout.
- K489: `make cargo-fetch` patches a sibling checkout's crates only when that checkout declares its repository (config/release.json) or the consumer's Cargo.lock names one of its crates, so an unrelated polyspec checkout beside the consumer no longer stops the fetch with "declares no repositoryUrl" (K489). Red: `node --test --test-name-pattern=K489 tests/kit/link.test.mts` failed before the fix with that error; green: the same command passes 1 of 1.
- `make npm-install` takes repository roots in `CHECKOUTS` and finds their package folders under packages/ itself, as for the sibling checkouts, so a consumer passes the checkouts it links and never walks a provider's layout; a checkout that is neither a package folder nor a root with package folders is refused (K494). Red: `node --test --test-name-pattern=K494 tests/kit/npm-install.test.mts` failed on ce55629e with "is a repository root, not a package folder".
- `make item-red BEFORE=` refuses a red that only a missing new module makes: a Verification whose failing runs name only files that the change adds, which the tree of `<rev>` lacks, is not a red of the old behaviour, so the refusal names the file and asks for a test through an entry that exists on both sides (K389-3).
- `make uv-install` links each given checkout whose name the project declares from the start, whatever the name, and excludes it from the sync by that name, so a sibling named limepie-contracts is no release; `SYNC="<flags>"` passes `--no-install-project` and `--all-groups` to uv sync and refuses any other flag (K487). Red: `node --test --test-name-pattern=K487 tests/kit/uv-install.test.mts` failed on 747470df: the limepie-contracts checkout was installed as its release, and SYNC flags were ignored.
- K442 is done: its row is [o] in this commit, whose red is the K442 test of the pre-fix commit cc8707a9^ (item-edit has no CAUSE and RETRY, so the test fails with `[plan] VERIFICATION is empty`, exit 1; recorded by `make item-red BEFORE=cc8707a9^`) and whose green is the K442 test of this commit (K442).
- `npm-install` replaces the contents of an existing node_modules and keeps the directory, so a node_modules that is a mount point installs (K486).
- K439-6: composer-provider-entries takes the version Composer's writer resolved when the tracked version breaks a locked requirement, such as a fork pinned by polyspec/orm (K439-6). K468-2's rule narrows to a tracked version that satisfies every locked requirement, by link-owner's ruling. Red: node --test --test-name-pattern=K439-6 tests/kit/dependency-review.test.mts exit 1 (the tracked 1.0.0 was kept); green: the owner file passes 31 of 31 under make, lint-ts passes. (K439-6).
- `make composer-install` takes `NO_DEV=1`, which installs the tracked lock with `--no-dev` for a production install (K483-2).
- `composer-install` and `npm-install` refuse a declared polyspec package that has no checkout, in every mode, naming the package, and run no npm ci or composer install in its place (K483-1).
- K448-13: npm-install finds a sibling package up to three folders down under packages/, so a repository that keeps a package at packages/server/ts (hyper) provides it and npm never fetches the release (K448-13). Red: node --test --test-name-pattern=K448-13 tests/kit/npm-install.test.mts exit 1 (the package was not linked and npm ci fetched it); green: make item-test ID=K448-13 passes, the npm-install file passes 10 of 10, lint-ts passes. (K448-13).
- A PHP application package (composer type project) is outside the S10 extension run and runs its own tests under test-php as its own package (K433).

### 2026-10-21 — worktree-setup rebuilds the packages before its link-state-check (K482)

- K460 is done: its row is [o] in this commit, whose red is the K460 test run with the progress change stashed and whose green is the K460 test of this commit (K460).
- A run with a skipped test fails and names each skipped case: `run-tests` prints `skipped cases: <names>` on its summary line and exits 1, as for a failed test, so a skip is not a verification (K460). A run whose tests all skipped fails too.
- K457 is done: its row is [o] in this commit, whose red is the K457 test run with the fix stashed (the dollar sign of a make variable is expanded: `item-test` names `run  and $HOME`, exit 1) and whose green is the K457 test of this commit (K457). `make item-new` and `make item-edit` pass each text to the tool as written, so a dollar sign, a parenthesis or a quote reaches the checklist unexpanded (K457).
- `make uv-install DIR=<project> CHECKOUTS="<checkout>..."` installs a consumer's uv environment in place of uv sync: each polyspec package that a checkout provides is excluded from the sync and installed as the editable link of its checkout, so no polyspec release is installed, and a declared polyspec package with no checkout is refused before uv runs (K448-3). Red: `node --test --test-name-pattern=K448-3 tests/kit/uv-install.test.mts` failed on 428ec1f7 with "does not provide an export named 'uvInstall'".
- K439-5: composer-provider-entries keeps the source and the notification-url of a tracked lock entry when Composer's writer does not write them for a path repository, so a provider entry keeps the release source it recorded (K439-5). Red: node --test --test-name-pattern=K439-5 tests/kit/dependency-review.test.mts exit 1 (the source was dropped); green: the file passes 30 of 30 under make, including K439-5, and lint-ts passes. (K439-5).
- `scripts/kit/worktree-setup.mts` runs the link rebuild of the worktree (`link rebuild .`, K482) after `make install` and before `make link-state-check`, so a fresh worktree is built and not reported stale (K482). The rebuild runs the link tool the worktree holds: kit's own `scripts/kit/link.mts`, or the installed `node_modules/@polyspec/kit/dist/link.mjs` of a consumer. The K348 fixture gets the consumer tool. Red: `node --test --test-name-pattern=K482 tests/kit/worktree-setup.test.mts` fails before the fix on 9f7954d54d16 (no rebuild, the check reads no build); green: passes, and the whole `tests/kit/worktree-setup.test.mts` passes.
- The commit-msg check refuses a docs or chore commit that stages code, a test, a script or a recipe, and names the paths, so a fix is committed with its own type (K449).
- `make npm-install` gives each relative file: dependency of the project to npm as an absolute path from the project folder,
  since it installs from a temporary copy of the manifest, so those links resolve after the install (K448-12).
- `make npm-install` without given checkouts looks for a provided package in the package folders of each sibling repository
  (packages/<x>), not only at its root, so it links @polyspec/template from template/packages/ts instead of running npm ci (K448-11).
- K481: generated Composer link manifests express linked exact versions as caret ranges while each path repository keeps the provider's actual version, so strict validation passes without changing the tracked manifest. Real Composer tests prove stale link locks and ordinary exact-version manifest warnings still fail validation (K481).
- K480: Python editable wheels accept listed packages resolved by a default package-dir alongside named mappings, preserve both the import root and finder, and still refuse unmapped packages without a default. Red: both mixed-mapping cases failed with the missing-prefix refusal on the unchanged implementation. Green: all three focused regressions passed (K480).
- K479: generated Composer link requirements use exact provider versions, reject missing or malformed provider versions, and preserve declared constraints and tracked manifests. Path repositories use the same provider version for undeclared packages, not a stale tracked lock; forks retain their conflict-checked exact linked-provider pin (K379-2). Red: the focused regression reported `*` instead of `0.0.1`; the final baseline run had 7 behavioral failures. Green: all 12 focused K479 tests passed, including K379-2 (K479).
- K476: Go workspace discovery, go.mod and go.work readers now run checkout mise shims with the checkout mise environment, so dependency-review does not invoke a managed Go shim with a bare process environment (K476).
- K435-1: Go and PyPI targeted releases now have focused tests for registry validation and exact update planning, and a completeness test keeps coverage aligned with every target-release handler (K435-1).
- K439-3-1: the K439-3 real-Composer test now uses the checkout's declared Composer and fails with the install-tools fix instead of skipping when it is unavailable; its verification runs through run-tests, which refuses the skipped-only case (K439-3-1).
- K468-2-1: the Composer regression fixture validates parsed lock entries through unknown-valued elements, so `make lint-ts` passes without unsafe JSON assignments (K468-2-1).
- K468-2: offline Composer provider-entry resolution uses an exact version required by a sibling package when a provider has no declared version; Composer resolves the strict requirement, while the rewritten tracked lock keeps its existing version field (K468-2).
- K468-1: when a consumer workspace and a sibling both provide the same package name, provider discovery keeps the consumer's own package; the sibling no longer causes a duplicate-provider failure or takes ownership (K468-1).
- K464-2: a sibling without a readable committed main, or a checkout without a readable committed HEAD, fails shared-pin evaluation as a finding instead of progress-only output (K464-2).
- K464-1-1: removed the unused working-tree source reader and imports after shared-pin comparison moved to committed tracked sources; `make lint-ts` passes (K464-1-1).
- K464-1: the sibling rule compares tracked Composer pins from the current committed HEAD and each sibling's committed main, independently of generated Composer link files. Link files remain in scope for runtime platform and validation rules (K326-2). The focused K464 tests cover generated-link disagreement, a genuine tracked mismatch, and an uncommitted tracked-lock edit (K464-1).
- K475: the provider entries of a tracked composer.lock resolve a consumer `vcs` repository through the sibling checkout whose `origin` names the same repository, as a path repository of that checkout, so `make dependency-review UPDATE=1` runs offline (COMPOSER_DISABLE_NETWORK) and fails naming a vcs repository that no sibling checkout names. Red: the K475 test of `tests/kit/dependency-review.test.mts` fails before the fix (Composer cannot reach the repository offline) (K475).
- K469-1 is done: its row is [o] in this commit, whose red is the K469-1 test run with the guard stashed (install-tools wrote through a symbolic var) and whose green is the K469-1 test of this commit (K469-1). `make install-tools` refuses a var that is a symbolic link, so a worktree keeps its own var/tools and its own mise state.
- K469 is done: its row is [o] in this commit, whose red is the K469 test run with the fix stashed (the staged tree has no trust of its mise.toml, so mise refuses it) and whose green is the K469 test of this commit (K469). The staged tree of a commit on main or of land trusts its mise.toml in the mise state of its checkout, and removes that trust before the tree is removed, so the gates run there instead of mise refusing the untrusted config.
- K474 is done: its row is [o] in this commit, whose red is the K474 test run with the fix stashed (a gate whose baseline failed with `Error 127` passed as failing on HEAD too) and whose green is the K474 test of this commit (K474). A gate run that fails for an environment reason (a signal, `Error 126` or `Error 127`, or no finding line) is refused with its own output, and it is never compared with a baseline.
- K454 is done: its row is [o] in this commit, whose red is the K454 test run with the fix stashed and whose green is the K454 test of this commit (K454).
- A node file that ends at its deadline with a test still running stops the child processes that its tests started, a plain child and one that leads a process group of its own, before it exits (K454). `stopGroup` stops the descendants of the run outside its group the same way, before it signals the group, since a descendant that leads its own group is reparented to launchd once the group leader ends (K454).
- K465 is done: its row is [o] in this commit, whose red is the K465 test run before the fix (the workspaces of the root were dropped, with exit 0) and whose green is the K465 test of this commit (K465). `make npm-install` keeps the workspaces that the root declares in its temporary manifest, anchored to the project, so their links resolve to the project folders; the temporary folder lies under the real path of tmpdir(), since npm drops a workspace whose path crosses /var to /private/var; an install that leaves a dangling link of the project fails (K465).
- K473: the vendored gates workflow clones each repository that config/polyspec.json declares beside the project, at its default branch, before install, and runs `make link` before the gates. A declaration names its `repository` as owner/name (schema), so CI of a repository with a 0.0.x polyspec package has the sibling checkouts that the link model needs. Red: the K473 tests of `tests/kit/gates-workflow.test.mts` and `tests/kit/polyspec-lock.test.mts` fail before the fix (K473).
- K437-1 is done: its row is [o] in this commit, whose red is the K437-1 test run with the old assertion and whose green is the K437-1 test of this commit (K437-1).
- The K437 test of a node file whose top-level await never settles accepts the deadline message that the run reports: the gap watch of `run-tests` (K371-1) ends the run at the same deadline first, with `no test started within 2 s`, so the test asserted a file-side text that never appears under `run-tests`. The test now requires the run to end at its deadline with exit status 1, to name the file and one of the two deadline messages, and to finish before its limit (K437-1).
- K380-2-1: the K380-2 amend test names in its fixture commits only the row `T1-1` that the fixture tree holds, so `commit-row` passes on main and the test checks the amend it names (K380-2-1). Red: `node --test --test-name-pattern=K380-2 tests/kit/git-hooks.test.mts` exits 1 on 66a4fb26 (commit-row: the subject names K380-2); green: `make item-test ID=K380-2-1` passes (1 test, none skipped) (K380-2-1).
- K468 is recorded as done in this commit: its row moves from [~] to [o], and its changelog line is the one above (K468).
- K468 is done: its row is [o] in this commit, whose red is the K468 test run before the fix and whose green is the K468 tests of this commit (K468). A tracked Composer, npm or pylock file names no 0.0.x polyspec package: the declarations live in config/polyspec.json, `make polyspec-lock-check` fails on a tracked name, and link installs each declared package from its sibling checkout (K468).
- K464: the sibling rule of `make dependency-policy-check` reports a version mismatch of a direct dependency only from the checkout that is off its reviewed target in config/dependency-review.json, and both checkouts when both are at their targets and the targets differ; it reads a sibling from its committed main, names a sibling it cannot read as not evaluated, and no finding text carries the review date, which stays in the progress output (K464).
- K455 is done: its row is [o] in this commit, whose red is the K455 test run before the fix and whose green is the K455 test of this commit (K455).
- `config/rebuild.json` names a class for each of the 23 tools that `make rebuild-check` reads, so the check passes on main; a tool without a class fails the check with its path. The composer-constraint rebuild record (`docs/rebuild/composer-constraint.md`) names the npm search that it rests on (K455).
- K404-1-1: the commit gate on main reads the document checks over the same sibling checkouts that `make land` reads: its temporary snapshot of the index lies beside the checkout and not in the system temporary folder, so `check-documents` resolves the kit checklists of the sibling as land does, and a row that names a kit item the kit checklists lack is refused on main (K404-1-1). Red: `node --test --test-name-pattern=K404-1-1 tests/kit/git-hooks.test.mts` exits 1 on b0a99e5c (the commit on main is accepted); green: `make item-test ID=K404-1-1` passes (1 test, none skipped) (K404-1-1).
- K453 is done: its row is [o] in this commit, whose red is the K453 tests run before the fix and whose green is the K453 tests of this commit (K453).
- `make land` runs `make build` in the main checkout after the fast-forward, so the ignored dist/ holds the merged sources; a failing build fails land. `link-state-check` names each linked npm provider whose build is stale (K453).
- `make land` reads the processes of a worktree with `lsof -nP`, which skips the name lookups that took 5.6 s per call against 0.4 s (K453).
- K459 is done: its row is [o] in this commit, whose red is the K459 test run before the fix and whose green is the K459 test of the fix commit (K459).
- K459: `make land` runs `dependency-policy-check` when a changed path is a dependency manifest or lock (`package.json`, the lock files, `pyproject.toml`, `Cargo.toml`, `go.mod`, requirements files), whatever the owner declaration of the repository names: `owner-check` appends the globs of `scripts/kit/dependency-files.mts` to the declaration, so a change to `package.json` no longer lands with no review entry (K459). Red: `node --test --test-name-pattern=K459 tests/kit/land.test.mts` exits 1 on b0a99e5c (`package.json` selects no gate: missing expected exception); green: `make item-test ID=K459` passes (1 test, none skipped) (K459).
- K439-4-1: the provider entries of a tracked composer.lock are written before the commands of an update run on it, so a stale polyspec entry (php >=8.5 of an older release, as polyspec/ordered-json 0.0.9 in crudui) no longer fails Composer's platform check of a tracked update of another package; `runUpdateSteps` of `scripts/kit/dependency-review.mts` writes the entries before and after the plan (K439-4-1). Red: `node --test --test-name-pattern=K439-4-1 tests/kit/dependency-review.test.mts` exits 1 on 18cf55d5 (the tracked update fails: polyspec/orm 0.0.18 requires php >=8.5); green: `make item-test ID=K439-4-1` passes (1 test, none skipped) (K439-4-1).
- K462 is done: its row is [o] in this commit, whose red is the K462 test run before the fix and whose green is the K462 test of this commit (K462).
- `link.mjs providers <checkout>...` prints each npm provider of the checkouts as a name, a tab and its package folder, sorted by name, by the rules that link reads the providers with (the excluded paths left out, a package folder before its repository root), so a consumer takes the folder of a polyspec package from the kit instead of copying the rule (K462).
- K439-4: composer-provider-entries resolves the scratch project with the consumer's own repositories: the provided packages come first, then the consumer's repositories, whose path urls resolve against the consumer folder; packagist stays disabled, and a consumer path repository that is not a readable folder fails naming it. A root requirement that only such a repository provides (crudui, orm, template) no longer fails with "not in remote repositories" (K439-4). Red: `node --test --test-name-pattern=K439-4 tests/kit/dependency-review.test.mts` exits 1 on 3554285c (2 of 2 fail: the root requirement is not found, and the unreadable repository passes unnoticed); green: `make item-test ID=K439-4` passes (2 tests, none skipped), and the K439-3 test still passes (K439-4).
- K463 is done: its row is [o] in this commit, whose red is the K463 test run before the fix and whose green is the K463 test of this commit (K463).
- `make land` on the command line refuses a gate that fails with its exit status, as the function does: the entry point of land.mts runs after every constant of the module is initialized, so a refused gate is no longer reported as `Cannot access 'endOf' before initialization` (K463).
- K448-10 is done: its row is [o] in this commit, whose red is the K448-10 test run before the fix and whose green is the K448-10 tests of this commit (K448-10).
- `make npm-install` rewrites each `overrides` entry of the manifest that names a provided package, at any depth, to the checkout folder of its direct dependency, so npm accepts the temporary manifest (EOVERRIDE is no longer raised for a package named in both `dependencies` and `overrides`, the form of limepie node/contracts), and no asset spec of a provided package stays in it; the other overrides of the manifest are kept instead of dropped (K448-10). npm docs (package.json, overrides): an override of a direct dependency must have the same spec as the dependency.
- K458 is done: its row is [o] in this commit; its change is the fix commit 12e458ca, whose red is f925cb58 and whose green is the K458 test of that commit (K458).
- K458: the sibling comparison of `make dependency-policy-check` names each checkout by its repository, not its folder, so a finding of a worktree `<repo>-NAME-ID` reads as the finding of main and `make land` no longer counts it as new; `repositoryName` of `scripts/kit/link-providers.mts` gives the name. Red: `node --test --test-name-pattern=K458 tests/kit/dependency-policy.test.mts` fails on f925cb58 (the worktree finding names `repo-x-K1`); green: `make item-test ID=K458` passes (1 test, none skipped) (K458).
- K326-2: while a Composer project is linked, every Composer rule of `make dependency-policy-check` (the platform, the K415 locked requirements, `composer validate` and the review-record versions) judges `composer.link.json` and `composer.link.lock`, and unlinked it judges the tracked files; one selection function, `scripts/kit/composer-project.mts`, serves every rule and the review. Red: `node --test --test-name-pattern=K326-2 tests/kit/dependency-policy.test.mts` fails on 8ad71384 with the tracked lock's `psr/log requires php >=8.5.0` finding while the link lock is clean; green: `make item-test ID=K326-2` passes (1 test, none skipped) (K326-2).
- K404-1: the pre-commit hook runs the gates of `make land` on the staged tree of each commit on main and refuses only a finding that HEAD lacks, naming it; the pre-merge-commit hook refuses a merge commit on main, so main moves by commits and fast-forwards only (K404, K446, P10, P38). `make commit` runs those gates once, through that hook (K404-1).
- K448-9 is done: its row is [o] in this commit; its change is the fix commit 76ac1d3f, whose red is 4a420f07 and whose green is the K448-9 tests of that commit (K448-9).
- `make npm-install DIR=<project> CHECKOUTS="<package folder> ..."` forwards each given checkout to the tool, which links it in explicit mode, so a consumer outside the polyspec workspace (a temporary clone under TMPDIR) no longer runs npm ci of its lock. A repository root given instead, a folder with package folders under `packages/`, is refused and the refusal names those package folders; a folder with no package.json is refused too (K448-9). Red: `node --test --test-name-pattern=K448-9 tests/kit/npm-install.test.mts` ran npm ci of the lock with CHECKOUTS given, on 4a420f07.
- K371-1-1 is done: its red is recorded on fb5dfef0 (the base 9177fbab with the test) and its green on the current tree; the entry above holds both (K371-1-1).
- K439-2-1: the K439-2 test of `tests/kit/dependency-review.test.mts` takes the Composer that the checkout declares in mise.toml, which `make install-tools` installs, and fails naming `make install-tools` when it is missing or cannot run, instead of skipping with "no Composer on this machine"; the `COMPOSER_BIN` override is gone (K439-2-1). Red: `node scripts/kit/run-tests.mts node -- --test-name-pattern=entries.are.Composer tests/kit/dependency-review.test.mts` exits 1 with the Composer shim removed ("1 skipped, no test ran"); green: `make item-test ID=K439-2-1` passes (1 test, none skipped), and the missing case fails naming make install-tools. (K439-2-1).
- K371-1-1: the tests cover a node file that never reports a test and never yields to its event loop, which the file-side watch of test-exit-deadline cannot end; the runner's gap watch (K371-1) ends it at the timeout with `no test started within N s after <last event>`, and a file that holds a handle and reports no test, with or without a name pattern that matches no test, ends the same way. The supervisor's 29 h run predates K371-1: the kit dist of 14:42 has no gap watch, so kit must be built again for consumers. Red: on the base 9177fbab (the K371-1 sources reverted) `node --test --test-name-pattern=K371-1-1 tests/kit/run-tests.test.mts` fails: the busy file ran its 20.2 s and ended as `no test ran`. Green: `make item-test ID=K371-1-1` passes (2 tests, none skipped). The kevent-idle shape of the supervisor was not reproduced (see the report). (K371-1-1).
- K441-1: `make land` and `make worktree-prune` count a process as running in a worktree only when its working directory, an open file or its executable lies in it (read with lsof, which is now required); a path that only its command line names is no use of it, so an unrelated `du -sh` no longer blocks a land. `make worktree-prune` keeps a merged worktree that such a process uses, as `make land` refuses it (K441-1). Red: `node --test --test-name-pattern=K441-1 tests/kit/land.test.mts` exits 1 (the arguments of two processes counted: 201, 205) and `node --test --test-name-pattern=K441-1 tests/kit/worktree-prune.test.mts` exits 1 (the worktree with a live cwd process removed); green: `make item-test ID=K441-1` passes (2 tests, none skipped). (K441-1).
- K440-1: the Claude Code hook of `link --siblings` runs the node of the kit checkout only when that node resolves through links to an executable regular file, one predicate that the writer and `link-state-check` share. The writer refuses a missing or non-executable node before it writes, leaves an existing hook byte-identical, and names `make -C <kit realpath> install-tools`; `link-state-check` fails with one message per drift class: hook missing, hook content differs, node missing or not executable (K440-1). Red: `node --test --test-name-pattern=K440-1 tests/kit/link.test.mts` exit 1 (2 of 3 fail: the content drift and the non-executable node pass unnoticed); green: `make item-test ID=K440-1` passes (3 tests, none skipped). (K440-1).
- K371-1: run-tests bounds every interval without a test event by the per-test timeout, for node, vitest, go, cargo, phpunit and python. Before the first test, between tests and after the last one, the runner stops the tool's process group at the timeout, as at a test timeout, and prints `no test started within N s after <last event>` with the elapsed time of the run; the run fails. No whole run has a time limit. Red: `node --test --test-name-pattern=K371-1 tests/kit/run-tests.test.mts` fails on bc80fb67 (4 of 4: a python import and a go shim that sleep past the timeout pass; the gap watch module is missing); green: `make item-test ID=K371-1` passes (4 tests, none skipped). (K371-1).
- kit-check also finds PHPUnit started behind env (with its assignments and options), exec, command or the -c string of sh, bash, zsh and dash, and phpunit.phar (K436-1). Red: `node --test --test-name-pattern=K436 tests/kit/recipe-tools.test.mts` fails on 7b4825eb (4 of 5 findings); green: passes.
- kit-check refuses a recipe command that starts PHPUnit outside run-tests, PHPUnit itself or a php interpreter that runs it, with the variables of make expanded (K436): only run-tests stops a hung PHPUnit test, since it ends the process group at the test's timeout, while PHPUnit's enforceTimeLimit cannot interrupt a test that waits inside libpq. Red: `node --test --test-name-pattern=K436 tests/kit/recipe-tools.test.mts` fails before the change (no such check; orm has 37 such commands); green: passes, and the recipes of kit have no finding.
- K439-3: composer-provider-entries resolves the scratch project of Composer's writer from the tracked lock: the consumer's composer.json and composer.lock are its base, the provided packages are its path repositories, and Composer updates only those packages, offline, so a transitive requirement such as nikic/php-parser comes from the lock and not from packagist (K439-3). Red: node --test --test-name-pattern=K439-3 tests/kit/dependency-review.test.mts exit 1 (the transitive requirement is not found without the lock); green: make item-test ID=K439-3 passes (1 test, none skipped). (K439-3).
- `make cargo-fetch DIR=<project>` fetches a consumer's Cargo crates in place of `cargo fetch --locked`: the polyspec crates that a sibling checkout provides are patched to their paths from the start, so no git tag of a sibling crate is fetched; `link-state-check` names it for a recipe that fetches a lock with a polyspec crate (K448-5).
- K435: `make dependency-review UPDATE=1 TARGETS=<file>` takes the target versions of a batch from a JSON file with the snapshot moment of the registries (dependency-targets.schema.json): each named dependency moves to exactly its target, an unnamed one stays as it is, a target that the registry lacks or that breaks the PHP policy fails before any dependency changes and names it, and RECORD=1 records the snapshot moment (K435). Red: node --test --test-name-pattern=K435 tests/kit/dependency-review.test.mts exit 1 (4 of 4 fail before the fix: TARGETS is not read); green: the same command passes 4 of 4 (K435).
- K440: `link --siblings` writes the Bash PreToolUse hook of the claude-hook of the kit checkout into the workspace folder's `.claude/settings.json`, keeping its other settings, and `link-state-check` fails while that hook is missing, so a session started in the workspace folder is guarded (K440). Red: node --test --test-name-pattern=K440 tests/kit/link.test.mts exit 1 (the workspace folder holds no hook); green: make item-test ID=K440 passes (4 tests, none skipped). (K440).
- K440-2: the Claude Code hook of `link --siblings` runs the node of the kit checkout only when that node resolves through links to an executable regular file, one predicate that the writer and `link-state-check` share. The writer refuses a missing or non-executable node before it writes, leaves an existing hook byte-identical, and names `make -C <kit realpath> install-tools`; `link-state-check` fails with one message per drift class: hook missing, hook content differs, node missing or not executable (K440-2). Red: `node --test --test-name-pattern=K440-2 tests/kit/link.test.mts` exit 1 (2 of 3 fail: the content drift and the non-executable node pass unnoticed); green: `make item-test ID=K440-2` passes (3 tests, none skipped). (K440-2).
- K441: `make land` and `make worktree-prune` run the `WORKTREE_STOP` target of the Makefile of a worktree before they remove the worktree, and `make land` keeps the worktree and fails naming the target and its output when that target fails; `make worktree-prune` lists each process whose command line names a folder of a removed worktree, by pid and path, and kills none (K441). Red: `node --test --test-name-pattern=K441 tests/kit/land.test.mts` and `node --test --test-name-pattern=K441 tests/kit/worktree-prune.test.mts` exit 1 on the base (the servers are not stopped and no process is listed); green: `make item-test ID=K441` passes (3 tests, none skipped).
- `make npm-install` links the packages that a given checkout provides whatever its origin, and a package that the lock names only transitively, through an override, and a declared polyspec package with no checkout fails instead of npm ci (K448-7).
- K439-2: composer-provider-entries writes the provider entries with Composer's own lock writer, offline, on the consumer's declared platform, so a rerun on the lock it wrote changes nothing and a provider that demands more than the platform fails naming both (K439-2). Red: node --test --test-name-pattern=K439-2 tests/kit/dependency-review.test.mts exit 1 (the license form of the manifest); green: make item-test ID=K439-2 passes under make with the toolchain Composer (2 tests, none skipped). (K439-2).
- K440-1: kit ignores the `go.work` and `go.work.sum` that `link` writes into each Go module, kit's own tools included (scripts/kit/symbols/go), so `link` no longer fails with "not ignored by Git" before it writes the workspace hook of K440 (K440-1). Red: `node --test --test-name-pattern=K440-1 tests/kit/link.test.mts` exits 1 (scripts/kit/symbols/go/go.work is not ignored); green: `make item-test ID=K440-1` passes, and `make link` in the checkout writes the hook.

### 2026-10-21 — install-packages installs with make npm-install (K448-8)

- `install-packages` of `scripts/kit/kit-bootstrap.mk`, which every consumer's `make install` reaches, runs `make npm-install DIR=.` in place of a bare `npm ci` (K448-8), so a sibling-provided polyspec package that the lock pins from a release URL is linked from the start and no release is fetched. Red: `node --test tests/kit/install-packages.test.mts` fails on the base (the recipe runs `npm ci`); green: passes, and `tests/kit/npm-install.test.mts` passes.
- `make composer-install` and `make npm-install` run online, as every install target of kit.mk does, so a consumer that
  exports COMPOSER_DISABLE_NETWORK or npm_config_offline for its checks still installs the third-party packages of its lock (K448-6).
- `make npm-install DIR=<project>` installs a consumer's npm packages in place of npm ci: a polyspec package that a sibling checkout provides is linked from the start, through a temporary manifest, with no release fetched and no tracked file written (K448-2).

### 2026-10-21 — A package-dir prefix mapped to "." links its listed subpackages (K398-3)

- K448-5: Register K448-5 as an item: cargo links the sibling crates of a polyspec checkout from the start, through a [patch] path, so no local install materialises a released crate (K448, the cargo part). Its red and green come with the link tests. (K448-5).
- `scripts/kit/link.mts` accepts a static `package-dir` whose prefix maps to `.` while only its subpackages are listed in `setuptools.packages` (K398-3): each listed package resolves through the longest package-dir prefix it starts with, and the finder of the editable wheel maps names through the longest prefix and gives the parents of a prefix a namespace package with no folder of its own, so `limepie.module.x.src` resolves into the folder and nothing is written there. A listed package that no prefix maps is still refused. Red: `node --test --test-name-pattern=K398-3 tests/kit/link.test.mts` fails before the fix on f6e6f254a6b2 (the link refuses the package-dir); green: passes, and the other K398 tests pass.
- K379-2: The link writes a fork at the exact pin that the consumer or a linked provider requires (require and require-dev), as its tag, and fails naming both pins when they differ (K379-2). Red: node --test --test-name-pattern=K379-2 tests/kit/link.test.mts exit 1 (the link manifest took the lock version 2.6.0); green: the link tests pass, 82 of 82 in the file, including K379-2. (K379-2).
- `make commit` on main reads the findings of a gate as `make land` does, without the progress lines that a kit tool prints
  with its name in brackets, so a progress line that differs from HEAD does not refuse a commit (K446-4).
- `make land` and `make commit` on main run each gate with `make -s`, so the recipes that make echoes, which differ between
  checkouts, are not read as findings that HEAD lacks (K446-3).
- K439-1: composer-provider-entries recomputes the platform and platform-overrides of each composer.lock from the composer.json of its directory, and leaves every release-consumer lock untouched (K439-1). Red: node --test --test-name-pattern=K439-1 tests/kit/dependency-review.test.mts exit 1 (the export and the recomputation are missing); green: the file passes 15 of 15, including K439-1. (K439-1).

### 2026-10-21 — A static package-dir is linked by a finder of the editable wheel (K398-2)

- `scripts/kit/link.mts` links a Python provider whose pyproject maps a package to a folder of its own in a static `package-dir`, listing the package in `setuptools.packages` (K398-2): the editable wheel writes a finder, `__editable___<dist>_finder.py`, which maps the package name to its folder, and the `.pth` imports and installs it; the folder is not written and no source is copied. A `package-dir` that is not a static map of strings, or maps a package that `setuptools.packages` does not list, is still refused. Red: `node --test --test-name-pattern=K398-2 tests/kit/link.test.mts` fails before the fix on 0ad7267f7793 (the link refuses the package-dir); green: passes, and the 82 tests of `tests/kit/link.test.mts` pass.
- `make land` and `make commit` on main read one key for a finding under the real and the logical path of a checkout, so an unchanged finding is not refused for the path it names (K446-2).
- `make commit` on main compares each selected gate with HEAD, as `make land` does, and refuses only the findings that HEAD lacks, so a finding that HEAD already has does not block an unrelated change (K446-1).
- A recipe that runs composer install of a lock is refused even with the link step after it, and names make composer-install,
  which links the sibling-provided polyspec packages from the start (K448-1).
- `make commit` on main runs the static gates that `make land` selects for the staged paths and commits nothing when one fails,
  and the commit-msg check no longer refuses a commit while HEAD is main, so work is done on main directly, as the owner decided
  when K404 was retired (K446).
- `make composer-install DIR=<project>` installs a Composer project in place of composer install: where sibling checkouts
  provide polyspec packages of its lock, it writes composer.link.json and composer.link.lock and installs from them, so the
  released metadata of a linked package (such as polyspec/orm 0.0.18 requiring php >=8.5) is never read; without a sibling, as
  in CI, it runs composer install of the tracked lock; link reads the polyspec packages of a fresh project from its lock (K432).
- A tracked composer.lock that kit writes holds the manifest of each polyspec provider that a sibling checkout provides
  (require, autoload and the other fields of its composer.json), not the metadata of an old release, while its version, dist
  and source stay: `dependency-review UPDATE=1` applies it, and `make composer-provider-entries` rewrites every tracked lock
  with it alone, so no lock keeps a release's `php >=8.5` (K439).
- The link installs the consumer's own Python projects under --project from the editable wheel of K398 too, with --no-deps,
  and rewrites their direct_url.json to the editable record of their folder, so it writes nothing into a checkout that a
  container mounts read-only; no `uv pip install -e` remains, and the refusals of K398 apply to them (K398-1).
- The link of a fork keeps the version that the consumer pins: the link manifest gives the path repository of a fork checkout
  the exact pin of the consumer's composer.json as its tag (2.6.0-p1 as v2.6.0-p1), not a release that the lock recorded
  before the pin, so Composer takes the fork from forks/<name> in the partial update (K379-1).
- runCommand of `./run-command` takes an option onLine(stream, line), which receives each complete line of a piped stdout or
  stderr as it arrives and the last line without its newline when the stream ends, so a caller can stream parallel commands
  with a prefix of each while the output is still collected under maxOutputBytes (K430-1).
- A parity runner or symbol extractor whose tool the checkout lacks reports it as the error of its run, an R3 or R1 finding
  that names the tool and run make install, instead of ending parity-check and parity-declarations-check with an uncaught
  error, which K393-1 had caused in a checkout without python3 (K393-2).
- `make text-absent FILE=<path> TEXT=<text>` fails, naming each line, while a tracked file holds the literal text, and passes
  once it is gone: the red of a row whose whole change is text, which P19 now states, together with the rule that a change
  corrects the comments and documents it makes stale in its own commit; the text reaches the tool through its environment,
  so a backquote or a `$( )` in it runs nothing (K431).
- `make parity-declarations-check UNITS=` scopes the schema findings of config/parity.json too: a finding at `/units/<index>`
  counts only when that unit is named, so a row that adds the requirement of one unit proves its red and green while other
  units still break the schema; the run then says that the other rules need a declaration that passes the schema (K400-1).
- The kit package exports `./run-command`: runCommand runs one command to its end with no time limit in its own process group,
  stops what it leaves in the group when it exits and the running commands when the caller is interrupted, captures its output
  up to a limit, and returns its status, signal, elapsed time and start error; failureOf states a failure in one line, and
  stopGroup moved into process-group.mts for it and run-tests (K430).
- P10 is enforced by `.githooks/pre-push` only, and no Enforced by line of PRINCIPLES.md names a path under tests/ or scripts/,
  which a consumer that takes PRINCIPLES.md as a copy of kit lacks, so `make rules-check` passes after a kit-sync (K359-2).
- `make land` leaves its own ancestors, such as the make and the shell that run it, out of the processes of the worktree,
  so a shell that changed into the worktree before it ran make land does not refuse the branch (K429-1).
- `make land` refuses a branch while a process runs from its worktree, a process whose command line names a path in it (such
  as the --datadir of a test database server) or whose working directory lies in it, naming each pid and command, before any
  gate runs; nothing is merged, removed or deleted then (K429).
- `make land` counts no progress line of a kit tool as a finding of a gate that fails on main too: it compares every stderr
  line and the stdout lines but those that start with the name of a kit tool in brackets (`[parity] tools root ...`), so a
  linter's findings on stdout still count (K394-3).
- `make dependency-policy-check` fails a package-lock.json entry resolved from a remote tarball URL (an http(s) `.tgz` that is
  not registry.npmjs.org) that no package.json of the lock root or its workspaces names by that URL, naming the lock line,
  the package and the URL, so the refusal of npm ci under allow-remote=root (K189) shows first; the fix declares the package
  with its URL at the root (K427).
- `make install-packages` runs, after its npm ci, the make targets that the variable INSTALL_PACKAGES_EXTRA of the repository
  names, such as the install of a tools project outside its npm workspaces with its own package-lock.json, with the same npm
  and allow-remote setting; they only install, `make install` links after them, link-state-check asks them for no link step,
  and the release workflow installs them through install-packages (K428).
- `generated-files tracked`, which `make layout-check` runs, fails each tracked path with a generated segment, an executable
  object header or a generated-file header (a first comment line, a shebang left out, that matches `Code generated .* DO NOT
  EDIT`), naming the path, unless config/generated.json declares it an exception; the staged check of the hook cannot see a
  file committed before it existed (K426).
- A Red-Gate or Red-Test line names the merge-base of HEAD and main, which the rebase of a row branch on main keeps as an
  ancestor of the fix, so a row whose red was recorded on its branch closes after the rebase that `make land` needs; and
  `make item-red BEFORE=` takes a tree whose changelogs the close of the row has changed (K389-2).
- `make item-red BEFORE=` restores the mode of each file that it swaps with its bytes, so an executable file that BEFORE lacks,
  such as a Git hook, comes back executable (K389-1).
- P24 names `make commits-check` and S10 `make dependency-policy-check`, the checks that K424 and K425 built, in place of their
  planned items, so `make rules-check` passes on main again (K359-1).
- `make commits-check` and the commit-msg hook fail a commit whose id `(#<id>)` is no item of a checklist of docs/plans in
  the tree of that commit (rule commit-row), so a change starts from its registered row (P24); the commit that registers the
  row adds it and passes, and the first commit of a repository is exempt (K424).
- `make dependency-policy-check` fails a PHP library of S10 whose composer.json requires an application framework
  (symfony/console, symfony/framework-bundle, symfony/http-kernel, laravel/framework, laminas/laminas-mvc) in require, naming
  the manifest and the package: the application is its own Composer package that requires the library (K425).
- `make parity-declarations-check IDS="<requirement>..."` reports only the findings that name one of the requirement ids,
  intersected with UNITS and RULES, with the findings of config/parity.json itself; an id that no unit cites fails the run,
  so a row that moves the citations of a few requirements can prove its red (K414-1).
- The link installs a Python provider from an editable wheel that kit writes itself into `var/link/python` of the consumer,
  with no build backend: the wheel holds the metadata of the provider's pyproject.toml and a .pth that names its import root,
  and no source, so the link writes nothing into a provider folder that a container mounts read-only; a provider whose
  metadata needs its backend is refused, with no fallback to `uv pip install -e` (K398).
- Every tool of kit that starts php, node, npm, composer, go, python or uv takes it from the checkout through one helper
  (`toolCommand` of mise-tools.mts: `var/tools/bin`, then the shim of mise of the checkout) and fails with run make install
  when it is missing, never falling back to PATH; the bootstrap npm installer keeps the node of the machine, and cargo stays
  on PATH (K393-1).
- `make dependency-policy-check` compares the pins of the packages that the repository and a sibling checkout both require
  directly, in the install locks at their roots, and fails a package locked at another version or from another source,
  naming both locks with the line of the entry; a transitive package and a lock under tests/ or fixtures/ are not compared,
  and without a sibling, as in CI, nothing is compared (K378).
- PRINCIPLES.md states the working guidelines of the owner with their checks: work reaches main only by `make land` (P10,
  P38), a worktree per row made over 30 GB of free disk and removed after the merge (P10), the full suite only on the order
  of the conductor (P20), subagents on Haiku 5.5 with one row each and their results verified (P22), rows before work (P24,
  planned K424), no deferral (P36), results only after their check (P37), and the PHP library of S10 as library code only
  (planned K425) (K359).
- `make item-red ID=` runs the Verification of an active row after its test is written and before its fix, requires a failure and
  records it; `make commit` writes it as a Red-Test line into each commit of the row, and the done state of `make item-state`
  requires the record or such a line in the history, which holds on an ancestor of the parent after a rebase.
  `make item-red ID= BEFORE=<rev>` proves the red of a row committed without a record, on the sources of `<rev>` (K389).
- A binding of `config/parity.json` may declare `runner` with `reason`: its test runs with the program, arguments and output parser
  of that runner, and it still counts as the binding of its implementation for R2 and R3, so a PHP extension whose contract a node
  test of its C engine checks can bind; a runner without a reason, or a reason without a runner, is a finding of the declaration
  (K422).
- `link --siblings` links the main checkouts in the folder `forks/` beside the checkouts as providers of the packages that their
  manifests name, whatever their origin, and a fork is linked at its own pin (such as 2.6.0-p1), which the 0.0.x rule of polyspec
  packages does not cover (K379).
- The layout of kit declares the files that kit link writes at the root of a linked checkout (`composer.link.json`,
  `composer.link.lock`), so a linked worktree passes `make layout-check` as its main checkout does (K423).
- The real layout tests pass again with the check of the install directories in `make layout-check`: their fixture runs
  the tools of kit with its node and ignores its install directories (K372-1).
- The real TypeScript lint tests K170 and K172 pass again: their fixtures no longer fail tsc beside the rule that each test
  proves, an untyped parameter and a broken input that the tsconfig of the fixture now leaves out (K417).
- `make unlink` restores a Python project locked with `pylock.toml`: it reinstalls the locked releases of the linked packages
  from the pylock into the environment, and names a linked package that the pylock does not hold (K401-1).
- docs-check reads a K-id after the name of a sibling repository, as `template-benchmark K79-3`, as the item of that
  repository, and in a repository whose own ids are K-ids only `kit K<n>` as a kit item (K374-1).
- A test of kit fails when a module of kit reads beside itself a file or folder that kit-build does not ship into dist, and
  the sandbox of the kit-build test takes the folders that the build ships from the Makefile (K421).
- run-tests runs the Python tests with a runner of kit, standard library only, that gives each test its own timeout and prints
  the elapsed time of each, so no environment needs a new package; `docs/operations/tool-inventory.md` states per language what
  gives a test its timeout (K371).
- The prepare-commit-msg hook of kit prints nothing on a commit, which it only records; an error still prints (K380-3).
- `make lint-php` reads each file of an `autoload.files` entry with the PHP parser and fails, with file and line, on
  anything but namespaced functions and constants, as S2 asks (K377).
- docs-check fails, with its file and line, a checklist row that names a kit item that the checklists of kit do not hold,
  read from kit itself or from the kit checkout beside a consumer (K374).
- `make layout-check` fails on an install directory that Git does not ignore (`node_modules` beside a `package.json`, the vendor
  of a Composer project, `var`, `.venv` beside a `pyproject.toml`), naming it and the `.gitignore` to change; a Go vendor folder
  stays legitimate (K372).
- `make layout-check` passes on kit main again: `config/layout.yml` excepts from S9 the Python helper of the marker check
  and the PHP file that PHPUnit prepends, which only a program of their language can be (K420).
- test-markers-check takes its Python helper beside its own module, and kit-build ships `markers/` in dist, so the check
  reads the Python tests of a consumer, which holds no `scripts/kit` (K345-1).
- The link writes the link manifest and lock of every Composer project that it reports linked, also of one that it finds
  linked from its installed vendor, and `link check` fails while a linked project lacks them, so dependency-review never
  takes a linked project for unlinked (K392-3).
- `dependency-policy-check` checks each package of a tracked Composer lock against the `php` and `ext-*` of the
  `config.platform` of its `composer.json`, and names a package whose requirement the platform does not meet (K415).
- `link check` reads the modules that the go.work of a consumer module uses from that go.work, so a module of a tracked
  workspace that does not require another module of it no longer fails the check with not a known dependency (K399-1).
- The commit-msg check of an amend compares the index with the parent of the amended commit: `make hooks` writes a
  `prepare-commit-msg` hook that records the amend, so an amend that restages a document of a fix commit with its test
  passes; git gives `-C HEAD` the same arguments, so it is checked the same way (K380-2).
- The checklists merge row by row, by the id of each row: `make hooks` declares the driver `kit-checklist` for
  `docs/plans/*/checklist.md`, and `kit-twin` merges its twin alike, so a row that main closes is kept once beside the rows
  that a branch appends after it, and a row that both sides changed differently is a conflict that names it (K354-3).
- `make docs-check` runs check-documents and then every document check that a repository adds with
  `DOCS_CHECKS += <target>`, each whatever the status of the others, and fails naming those that failed (K419).
- `make dependency-review` scans a Go module with its nearest go.work: the one beside it, which the link writes, else a
  tracked go.work of a parent folder that uses it, so a module of the workspace of the repository resolves its own modules (K418).
- P8 is enforced rule by rule: phpcs refuses an error silenced with `@`, oxlint a catch that throws without the caught
  error as its cause, the build of a PHP extension a dropped result that must be checked (`-Werror=unused-result`), and the
  gate `make suppression-check` every suppression of a lint finding that states no reason (K334).
- The generated-file check refuses a file whose content is an executable object (ELF, Mach-O thin or fat, PE), whatever its
  path, unless `config/generated.json` declares it: at commit time from the index, and in `commits-check` from each commit (K416).
- `commits-check` runs the generated-file and the Korean twin checks of the pre-commit hook on every commit of its range,
  besides the message and identity checks, so a commit made with `--no-verify` fails the gate and the pre-push (K351).
- `make parity-declarations-check RULES="<rule> ..."` reports only the findings of the named rules, by id or name, and those
  of `config/parity.json` itself; with UNITS too, the findings that both select (K414).
- A gate command of a Verification takes the make variables after its target, as `make parity-declarations-check RULES=R9`,
  so a gate scoped by UNITS or RULES is the recorded red of a fix row and its Red-Gate line proves it (K357-2).
- `link rebuild` runs `composer dump-autoload` on the link files of each linked Composer project of the consumer, so its
  autoload names only files that exist after a provider removed one (K347).
- test-markers-check reads the markers of a Python file from its syntax tree, with the ast module of the Python of the
  checkout, so a skip marker inside a string literal or a docstring is no finding (K345).
- The twin driver merges `CHANGELOG.ko.md` and computes its marker as git merges `CHANGELOG.md`, by the merge attribute of
  that file: a checkout whose hooks still merge it with union keeps a current twin through a rebase (K354-2).
- A branch has commits of its own when its reflog records a commit made on it, so a fresh branch that a rebase moved onto a
  newer main is no longer taken for merged by `make worktree-prune` and `make link-state-check` (K381-1).
- run-tests starts its runner with the environment of mise of the checkout (`toolsEnvironment`), so an owner test run
  through run-tests in a shell reads the trust and the tools of the checkout as it does under make (K411).
- `make install` of kit also installs the packages of the PHP symbol extractor (`kit-install`), so a worktree that
  `make worktree-setup` makes runs `make lint-php` (K412).
- `make lint-php` passes on kit main again: the lines over the 120 characters of phpcs in four PHP files of kit are
  wrapped, with the same symbols and leaks from the extractor (K413).
- The parity declarations report each document of `docs/spec` that defines no requirement id (rule R19
  `spec-without-requirement`), naming the file (K337).
- The Reflection compare of test-php-ext also reads the constants that the extension registers, and fails on one that the
  PHP library does not define, as it already did for a class or a function outside the library (K338).
- python-venv accepts an environment whose home is the Python of the shared installs of the main checkout, which a
  worktree runs since K387, so the install of the Python of a new worktree no longer fails (K387-1).
- install-tools wraps `php-fpm` of the `sbin` of the PHP of `.php-version` beside php, php-config and phpize, and
  toolchain-check refuses a recipe or script that starts `php-fpm` or `php-cgi` by its bare name from PATH (K341).
- `make item-state` refuses a bypassed or impossible cause that names a release, a version tag, "not reproducible", a flake,
  "transient", "unrelated" or "environment" unless it cites a kit row, and a commit that deletes a test needs a
  `Replaced-By:` line naming the test that covers the same requirement (rule `commit-deleted-test`) (K339).
- A worktree reads the installs of mise of the main checkout of its repository (`MISE_SHARED_INSTALL_DIRS`, set by `kit.mk`
  and `miseEnvironment`), so its `make install` installs only the tools that the main checkout lacks, about 0.7 GB less for
  each worktree; its data dir, state, shims and wrappers stay its own (K387).
- The Python link takes the constraints of its install from the PEP 751 lock (`pylock.toml`) of a workspace that has no
  `uv.lock`, so a project locked that way, as orm is, is linked into the environment that its install made (K401).
- The Unreleased entries of a changelog stay newest first through a rebase: `CHANGELOG.md` merges with the driver
  `kit-changelog` and its Korean twin with `kit-twin`, which put the entries that only the applied commit adds first, in the
  style of the list of main, one entry a line or each a paragraph; `make hooks` replaces the union line (K354-1).
- `make lint-ts` passes on kit main again: four test files read their values through a check or a typed parse in place of
  two non-null assertions and four unsafe assertions from `any` (K409).
- `make owner-validate` passes on kit main again: `config/owner-checks.json` owns the merge driver `twin-merge.mts` through
  `git-hooks.mts`, `clippy.toml` through the real Rust lint test and `scripts/kit/php-library` through the module that
  reads it (K410).
- `make lint-go` lints the Go files behind every build tag that a module names in its `//go:build` lines: it runs
  golangci-lint (`--build-tags`) and deadcode (`-tags`) once more for each such tag, leaving out the tags that the go tool
  sets itself, so a file behind a tag is linted and a helper that only tagged files use is no longer read as unused (K406).
- The package of kit ships `clippy.toml`, which `kit.copies` declares, so kit-sync copies it into a consumer and the test of
  the copies passes on main (K408).
- `make duplication-check` and `make lint-python` pass on kit main again: the symbols and the leaks of the Python
  extractor read the public names of a module through one function, and the extractor is formatted (K407).
- The repository declares its commit identity in `config/commit-identity.json`, which kit-sync copies, and the commit-msg
  check and `commits-check` refuse an author or committer other than it (rule `commit-identity`), naming
  `git config user.name` and `user.email` of the clone as the fix; the rule of an AI identity (K265) stays (K405).
- The commit-msg hook refuses a commit while `HEAD` is `main` and `main` has a commit (rule `commit-on-main`): a row,
  its registration and its close included, is committed on its own branch and reaches `main` only through the fast-forward
  of `make land`; the first commit of a repository, which creates `main`, is the one exception (K404).
- `make land` reads every path inside the temporary folder of the system as one placeholder before it compares the output
  of a gate on the branch and on main, so the jscpd configuration that duplication-check writes into a fresh temporary
  folder on each run is no longer taken for a new finding (K394-2).
- While a Composer project is linked, `make dependency-review UPDATE=1` also updates the tracked `composer.lock`, lock only,
  for each package it updates that is no polyspec package, so the review it records holds in a fresh checkout, whose link
  lock is the tracked lock; the polyspec packages still wait for the check of the release (K392-2).
- `make link-state-check` expands the variables that the Makefiles of the repository assign before it follows the chain
  of `make install`, so a recipe reached through a variable, such as fsm-js-install through `$(PACKAGE_DEPS)`, is no
  longer reported as an install without the link step; a rule of several targets is reached when one of them is (K403).
- `commits-check` takes a range whose refs hold a dot, so `make land` lands the branch of a row id with a dot, such as
  `chore/kitsync-T2.60`; three dots, an empty side and a side that starts or ends with a dot stay refused (K402).
- `kit.mk` and `miseEnvironment` set `MISE_GLOBAL_CONFIG_ROOT` to the checkout: with `MISE_GLOBAL_CONFIG_FILE` set,
  `mise install` records the trust of the root of the global config, the home directory by default, so `make install-tools`
  wrote the home entry again right after K397 removed it (K397-1).
- `make worktree-prune` removes every branch whose own commits (those after the creation point that its reflog records)
  are all in main, with its worktree when that has no uncommitted change, and lists a fresh, unmerged or dirty one with
  its reason; `make link-state-check` fails while a merged branch is left (K381).
- `make land` refuses a gate that fails on the branch only when its output has a line that the same gate run on main does
  not have (the worktree folder read as the main checkout, numbers ignored, repeats counted), and names those lines; a gate
  red on main with no new finding no longer refuses every branch. It never runs `parity-check` or a `test-` target, which
  the Verification of the rows runs (K394-1).
- The link takes a package folder that a path repository of an enclosing Composer project installs as part of that
  project, so it links the polyspec requirements of the folder in the vendor of that project, and names that vendor while
  it is not installed yet (K396).
- The `go.work` that the link writes for a module under a tracked `go.work` of the repository uses every module of that
  workspace besides the module and the providers, so the modules of the repository still import each other while linked
  (K399).
- `make parity-declarations-check UNITS="<id> ..."` reports only the findings that name the units and those of
  `config/parity.json` itself, so a row that fixes the declarations of its units passes while other units still have
  findings; without UNITS it reports every finding (K400).
- The mise state of a checkout trusts only its own `mise.toml`: `trustConfig` and `make install-tools` remove every other
  entry of `var/tools/mise/state/trusted-configs` (a link to the home directory, to another checkout or to a removed
  worktree), and `make link-state-check` names such an entry. A `mise trust` run with `MISE_GLOBAL_CONFIG_FILE` set trusts
  the home directory, which then trusted every `mise.toml` under it (K397).
- While a Composer project is linked, `make dependency-review UPDATE=1` writes each new range into the tracked
  `composer.json` too (`composer require --no-update` with the tracked manifest), as it writes it into
  `composer.link.json`; the tracked lock waits for the check of the release. Red: the range went only into the link
  manifest; green: `node --test --test-name-pattern=K392-1 tests/kit/dependency-review.test.mts` passes (K392-1).
- `make test-php-ext CASES=<pattern>` takes the tests that the filter selects in each PHP library from PHPUnit itself,
  `--list-tests --filter` with the command of the run of that library, so a `#[Test]` method, a data provider and an
  inherited test count; the reading of `function test…` methods of K390 is removed. Red: a library whose only matching
  test was a `#[Test]` method without the prefix was reported as no case selected; green: `node --test
  --test-name-pattern=K390 tests/kit/runtime-targets.test.mts` passes (K390-1).
- `make land BRANCH=<branch>` lands a branch on main: it refuses a branch that is not rebased on main or has no
  worktree, runs in that worktree the static gates of kit-gates that the changed paths select through
  `config/owner-checks.json`, always with docs-check and commits-check (over `main..<branch>`) and never a test,
  refuses with the output of a failing gate, merges `--ff-only`, and removes the clean worktree and the branch; a
  branch that main already contains only has what is left removed. Red: no utility landed a branch through its
  gates; green: `node --test --test-name-pattern=K394 tests/kit/land.test.mts` passes (K394).
- `make link-state-check` asks a recipe that installs from a lock to link right after it only for an ecosystem in
  which the repository declares a polyspec dependency, and not for a recipe that `make install` reaches by a
  prerequisite or a `$(MAKE)` call, since install links last (K360-2); local-links.md states both. Red: the
  `install-packages` recipe of kit, which has nothing to link, failed the check and every kit worktree ended red;
  green: `node --test --test-name-pattern=K349-2 tests/kit/link-state-check.test.mts` passes, and kit passes the
  check (K349-2).
- In a checkout beside the kit checkout `../kit`, `kit-bootstrap.mk` takes `../kit/dist` as `KIT` from the first make on,
  the provider that the link installs, and fails when it is not built; without it, as in CI, `KIT` is the installed
  package. A fresh worktree then reads `kit.mk` before `npm ci`, so a repository step that names a kit target runs,
  and installs with the tools of the kit it develops against. Red: `make install` of a fresh template worktree knew no
  rule for `cargo-downloads-fetch`, and its install-tools wrote no php wrapper; green: `node --test
  --test-name-pattern=K348-1 tests/kit/link.test.mts` passes (K348-1).
- `make install` links after all its prerequisites, the steps of the repository included, whose environments the link
  reads, and `install-kit` only installs; local-links.md states the order. Red: in a fresh orm worktree the link of
  install-kit ran before the Composer vendor and the Python environment existed and stopped make install; green:
  `node --test --test-name-pattern='K360|K205' tests/kit/link.test.mts` passes (K360-2).
- `run-tests` starts the php of a phpunit run with a PHP extension or a library run, the go of a Go run and the python
  of a Python run from the checkout (`var/tools/bin/php`, the shims of mise) and fails with `<path> does not exist;
  run make install` when it is missing, never taking the tool of PATH. Red: the run took the php of PATH, another PHP
  than the pin in a worktree without make install; green: `node --test --test-name-pattern=K393
  tests/kit/run-tests.test.mts` passes (K393).
- `link` writes `composer.link.lock` from the tracked `composer.lock` only when the link lock is missing, and keeps it
  afterwards, so the versions that `make dependency-review UPDATE=1` applied to the link lock survive a relink and the
  partial update changes only the linked packages. Red: a second link copied the tracked lock back over an updated
  link lock; green: `node --test --test-name-pattern=K392 tests/kit/link.test.mts` passes (K392).
- The message of a failed command holds both of its streams, stderr and then stdout, each when it is not empty, so an
  error that a tool writes on stdout after progress on stderr is kept; a command with one stream keeps its message.
  Red: the error of gen_stub.php on stdout was dropped behind the download progress on stderr; green: `node --test
  --test-name-pattern=K352 tests/kit/process.test.mts` passes (K352).
- `make parity-declarations-check` reports, by the new rule R18 duplicate-suite, two directory suites that cite the
  same requirement ids from different case sets, naming both units and the ids, since a feature is one unit that
  every implementation tests. Red: two suites of one feature passed; green: `node --test --test-name-pattern=K350
  tests/kit/parity.test.mts` passes (K350).
- `make item-edit ID= DELIVERABLES=` replaces the Deliverables cell of a row in both languages through the checks of
  item-new, for an item in any state but done. Red: item-edit took no DELIVERABLES; green: `node --test
  --test-name-pattern=K388 tests/kit/plan.test.mts` passes (K388).
- `make commit` and the commit-msg hook refuse a Subject that already holds ` (#<id>)` before the id that make
  commit adds (rule commit-subject-id). Red: the subject `Fix it (#T1) (#T1)` passed; green: `node --test
  --test-name-pattern=K380-1 tests/kit/commits.test.mts` passes (K380-1).
- `make link-state-check` reads an install from a lock that a recipe runs through the make variable of its tool,
  `$(COMPOSER) install`, `$(COMPOSER_BIN) install`, `$(NPM) ci` or `$(UV) sync`, and fails it without the kit link
  step after it. Red: a recipe with `$(COMPOSER) install` and no link step passed; green: `node --test
  --test-name-pattern=K349-1 tests/kit/link-state-check.test.mts` passes (K349-1).
- `make hooks` declares in `.git/info/attributes` the union merge of git for `CHANGELOG.md` and the English checklists
  and the merge driver `kit-twin` for their Korean twins (`make twin-merge`), which writes the union of both sides and
  the revision marker of the English file as the rebase merges it, so a rebase of two branches that add changelog
  lines and checklist rows needs no hand edit or script, and each commit it writes holds current twins; the driver
  works in a rebase, where git names the commit it applies, and fails elsewhere naming the rebase. `make hooks-check`
  fails while the declarations are missing. Red: such a rebase conflicted in both Korean twins; green: `node --test
  --test-name-pattern=K354 tests/kit/git-hooks.test.mts` passes (K354).
- The Claude Code hook reads `pgrep`, `pidof`, `ls`, `test` and `[` as a poll only in the condition or body of a
  `while` or `until` loop, which can wait on a state; a `for` loop over a list ends with its list, so it may run them,
  and a `sleep` stays refused in every loop. Red: the hook refused a `for` loop over two named files with `test -f`
  (a recipe of orm), and docs-check of orm failed on the rows that depend on it; green: `node --test
  --test-name-pattern=K386-1 tests/kit/claude-hook.test.mts` passes (K386-1).
- `make test-php-ext CASES=<pattern>` runs each PHP library where the filter selects a test, read from the `test…`
  methods of its `*Test.php` files as PHPUnit matches `--filter` against `Class::method`, prints `<library>: no case
  selected by CASES` for each other library, and fails when the filter selects no test in any library. Red: a filter
  that named a test of one library failed the other library; green: `node --test --test-name-pattern=K390
  tests/kit/runtime-targets.test.mts` passes (K390).
- kit tracks the commit-msg hook that `make hooks` writes (K380), so its own commits are checked when they are made,
  and `make hooks-check` passes in kit. Red: `make hooks-check` failed in kit, naming `.githooks/commit-msg`; green:
  `make hooks-check` passes (K391).
- `make duplication-check` leaves out the S10 stub of a PHP extension, `packages/php-ext/src/polyspec_*.stub.php`, by
  its path, since S10 makes it declare the library under the same names and signatures; clones inside the library stay
  counted, and docs/operations/tool-inventory.md states the reason. Red: jscpd reported a stub that mirrors a library
  class; green: `node --test --test-name-pattern=K366 tests/kit/duplication-check.test.mts` passes (K366).
- The Claude Code hook of kit refuses a Bash command that waits: a `sleep`, and a `for`, `while` or `until` loop whose
  body sleeps or polls (`pgrep`, `pidof`, `ls`, `test -e`/`-f`/`-d`, `[ -e`), with one message that names the
  alternatives, a foreground command bounded by its own work and timeout or a background run that notifies at its end.
  Red: the hook accepted `sleep 280; echo waited`; green: `node --test --test-name-pattern=K386
  tests/kit/claude-hook.test.mts` passes (K386).
- `make worktree-setup NAME=<name> ID=<id> [TYPE=<type>]` makes the worktree of a row, `../<repository>-<name>-<id>`
  on `<type>/<name>-<id>` from `main`, installs it from its own sources with `make install` (tools, packages and links,
  then the steps of the repository) and checks it with `make link-state-check`; it refuses while the free disk is under
  30 GB, and a second run installs and checks the same worktree again. docs/operations/local-links.md states the
  worktrees and the install order of K360-1. Red: no target made a worktree, which needed hand steps; green: `node
  --test --test-name-pattern=K348 tests/kit/worktree-setup.test.mts` passes (K348).
- `link` takes the packages of the consumer's own repository from the work tree that runs it, a main checkout or a
  worktree, and never from a checkout of the same repository among its arguments, so a worktree links the other
  repositories only, never takes the sources of its main checkout and names no checkout of its own; its own packages
  are reported `own (this repository)`. Red: the own package of a worktree was provided by the main checkout; green:
  `node --test --test-name-pattern=K385 tests/kit/link.test.mts` passes (K385).
- The fix check of `make commit` and check-commits takes a Rust unit test as the test of a fix: a changed `tests.rs`,
  or a changed line inside a `#[cfg(test)]` item or a `#[test]` function of a `.rs` file, read on the side of the
  commit. Red: a fix whose test was `src/tests.rs` was refused as changing no test file; green: `node --test
  --test-name-pattern=K370 tests/kit/commits.test.mts` passes (K370).
- The pre-commit hook of kit and `make commit` refuse a commit after which a Korean twin carries a revision marker
  that is not the sha256 of its English document, read on the staged tree, naming the twin and `make
  documents-stamp`. Red: a staged change of `CHANGELOG.md` without the new marker of its twin committed; green: `node
  --test --test-name-pattern=K382 tests/kit/documents.test.mts` passes (K382).
- `make hooks` writes a commit-msg hook of kit, `.githooks/commit-msg`, which runs the message checks of `make commit`
  (`make commit-msg-hook`, check-commits `--message`) on every commit, so a commit made outside `make commit`, an amend
  with the footer of an AI tool included, is refused when it is made; `make hooks-check` fails when the hook is
  missing or changed. Red: an amend with a `Co-Authored-By` trailer of an AI tool succeeded after `make hooks`; green:
  `node --test --test-name-pattern=K380 tests/kit/git-hooks.test.mts` passes (K380).
- The library run of `make test-php-ext` finds PHPUnit in the vendor directory that Composer gives the library, its
  own or that of the root project that installs it through a path repository and its `vendor-dir`, as `run-tests`
  does for `phpunit --cwd` (K186). Red: a library installed by a root project with `vendor-dir` failed with
  `packages/php/vendor/phpunit/phpunit/phpunit does not exist`; green: `node --test --test-name-pattern=K367
  tests/kit/run-tests.test.mts` passes (K367).
- `make link-state-check` reports a linked vendor whose platform check demands a newer PHP than `.php-version`, not one
  that demands the lower floor of its packages, since Composer demands the highest floor that the packages require
  (80400 for `>=8.4`). Red: a vendor that demanded 80400 with `.php-version` 8.4.1 was a finding; green: `node --test
  --test-name-pattern=K384 tests/kit/link-state-check.test.mts` passes (K384).
- `make dependency-review` never proposes a version older than the locked one: a dependency whose latest release in
  the registry is older than its locked version, such as an unreleased `0.0.11` against `0.0.6`, is not outdated and
  never enters the update plan, linked or not. Red: the review proposed `polyspec/template 0.0.11 < 0.0.6` and planned
  `composer require ...:^0.0.6`; green: `node --test --test-name-pattern=K369 tests/kit/dependency-review.test.mts`
  passes (K369).
- `make link-check` checks against the checkouts beside the repository when `CHECKOUTS` is empty, as `make link`
  does, so it no longer reports every link as NOT linked right after `make link`. Red: its command named no checkout;
  green: `node --test --test-name-pattern=K383 tests/kit/kit-mk.test.mts` passes (K383).
- `make install-packages` only runs `npm ci`, and `make install` links as its own last kit step, `make install-link`,
  after the full `make install-tools`, since the link needs the Go that only the full install-tools installs; the
  messages of the bootstrap name that order. Red: the documented order failed at the link after `npm ci`, and the
  recipes held the link in install-packages; green: `node --test --test-name-pattern='K360|K205'
  tests/kit/link.test.mts` passes (K360-1).
- `make dependency-review` scans a Go module with the `go.work` that the link wrote beside its `go.mod`, so govulncheck
  compiles the linked modules that the code uses, while the version listing stays on the released modules
  (`GOWORK=off`); a failed Go scan is reported with its output and the fix of its cause, not as an outage of the
  advisory database. Red: the scan of a linked module ran without its `go.work`; green: `node --test
  --test-name-pattern=K365 tests/kit/dependency-go.test.mts` passes (K365).
- `make item-new`, `make item-edit` and `make docs-check` refuse a Verification command that holds a pipe outside
  quotes, since a pipeline hides the exit status of its first command; a quoted pattern such as `-run 'A|B'` stays
  allowed. Red: item-edit accepted `go test -run A|B ./...`, which ran as a pipeline; green: `node --test
  --test-name-pattern=K376 tests/kit/plan.test.mts` passes (K376).
- `make link-state-check` fails an install directory of a checkout (`node_modules`, `vendor`, `.venv`, `target`, `var`)
  that is a symbolic link, and a link of a workspace package in `node_modules` that resolves outside the checkout,
  since a worktree that links them to the main checkout runs the sources of the main checkout; a link to a polyspec
  provider stays allowed. Red: a checkout with a linked `node_modules` passed; green: `node --test
  --test-name-pattern=K375 tests/kit/link-state-check.test.mts` passes (K375).
- `make lint-php` runs phpstan with `--memory-limit=-1`, phpstan's value for no limit, since the memory that an
  analysis needs grows with the package and a limit only stops it. Red: phpstan stopped at the 128M of php.ini on
  orm packages/php, and its command had no memory limit; green: `node --test --test-name-pattern=K346
  tests/kit/lint-php.test.mts` passes (K346).
- The isolation test of kit reads the name of another repository only where it names the repository, as a package
  (`polyspec/<name>`, `@polyspec/<name>`, `github.com/polyspec/<name>`) or a path segment (`../<name>/`), so the same
  English word, such as the variable `template` of a link test, is no finding. Red: the test failed on kit main for
  that variable; green: `node --test tests/kit/isolation.test.mts` passes (K361).
- `make test-markers-check` leaves the skip of a fixture of one convention, a file in a folder `fixtures` or
  `testdata` or named `*_fixture_test.go`, `*.fixture.test.*`, `test_*_fixture.py` or `*FixtureTest.php`, since the
  skip of such a fixture is the behaviour that its test checks; a skip anywhere else, and any other marker of a
  fixture, stays a finding. Red: TestFixtureSkip of a `*_fixture_test.go` file was a finding; green: `node --test
  --test-name-pattern=K344 tests/kit/test-markers.test.mts` passes (K344).
- `make install-packages` of a consumer runs the link of the kit checkout beside it (`../kit/dist/link.mjs`), and fails
  before `npm ci` with the fix when that checkout is not built, since the released kit that `npm ci` just installed
  has no `--siblings`; without a sibling kit, as in CI, it runs the link of the installed kit. The K205 test states
  that the recipe links right after the install and never builds, which K349 made true. Red: the recipe ran the link
  of the installed kit beside a kit checkout, and the K205 test failed; green: `node --test
  --test-name-pattern='K360|K205' tests/kit/link.test.mts` passes (K360).
- The plan utilities refuse a checklist that would add a path into a home directory, through the private-path
  function of docs-check, and `make item-edit ID= TASK= TASK_KO=` replaces the Task cells of a row in both languages,
  also of a done row; the rows K358 and K363 are rewritten without the home paths that failed docs-check of kit. Red:
  item-new wrote a path into a home directory into a row and item-edit took no TASK; green: `node --test
  --test-name-pattern=K373 tests/kit/plan.test.mts` passes, and docs-check of kit passes (K373).
- `make item-new`, `make item-edit`, `make item-state` and `make plan-split` write the revision marker of the new
  English text into each Korean twin that they change when the twin was current, and keep a stale twin stale, so
  their output passes docs-check without `make documents-stamp`. Red: after item-new the marker named the text before
  the change; green: `node --test --test-name-pattern=K368 tests/kit/plan.test.mts` passes (K368).
- `make hooks` and `make hooks-check` fail naming `config/generated.json` when the repository lacks it, since the
  pre-commit hook that they install runs the generated-file check on it and would refuse every commit. Red: the check
  passed without the file; green: `node --test --test-name-pattern=K362 tests/kit/git-hooks.test.mts` passes (K362).
- `config/layout.kit.yml` declares `clippy.toml`, which kit-sync writes into every repository, among the root files,
  and a kit test fails when a root file of `kit.copies` is missing from that list. Red: `clippy.toml` was not declared
  and `make layout-check` failed in fsm; green: `node --test --test-name-pattern=K356 tests/kit/kit-sync.test.mts`
  passes (K356).
- kit-check requires `lint-rust` in `CHECK_TARGETS` only for a repository with Rust sources, as it does for the lint
  of the other languages. Red: a repository without a `.rs` file got the finding that `CHECK_TARGETS` runs no
  `lint-rust`; green: `node --test --test-name-pattern=K364 tests/kit/kit-check.test.mts` passes (K364).
- `link --siblings` takes only the main checkouts of polyspec repositories, whose origin is
  `github.com/polyspec/<folder>`, and prints every other folder with a `.git` entry once as skipped with its reason, so a
  stray copy such as `template_2026` no longer provides the packages a second time. Red: the copies `prov_2026` and
  `prov-copy` were taken as checkouts; green: `node --test --test-name-pattern=K363 tests/kit/link.test.mts` passes
  (K363).
- `make item-state`, check-commits and `make bypass-check` read the gates of kit-gates from the make database of the
  Makefile of the repository, which includes the kit.mk of the kit that it uses, and fail naming kit-gates when the
  Makefile declares none; they read `scripts/kit/kit.mk`, which only kit holds, so a consumer had no gate: no Red-Gate
  record was written and a `make -o <gate>` passed bypass-check. Red: in a consumer layout no record was written and a
  planted `make -o lint-go` passed; green: `node --test --test-name-pattern=K357 tests/kit/plan.test.mts
  tests/kit/bypass-check.test.mts` passes 4 of 4, and fsm reads 24 gates (K357-1).
- While a Composer project is linked, a provider that the link lock records as a path dist with the absolute folder of
  its checkout is a linked dependency, compared with the review record and judged by its link (K328), not a path
  package of the repository; only a path dist with a relative url is one. Red: `make dependency-policy-check` failed
  with `packages/fixture-php/<absolute folder>/composer.json is missing`, as in fsm after `make link`; green: `node
  --test --test-name-pattern=K358 tests/kit/dependency-policy.test.mts` passes (K358).
- A fix commit whose defect is a finding of a gate of kit-gates, such as a lint finding, is proved by the red of the
  gate on its parent instead of a test file: `make item-state` runs the gate commands of the Verification of a row as
  it becomes active on a tree that equals HEAD outside `docs/plans` and records their exit statuses in
  `var/plan/<id>.json`, `make commit` writes each failed gate as a `Red-Gate: make <gate> exit <n> at <parent>` line,
  and check-commits accepts the commit when it moves the item to done and the line names a gate of the row and the
  parent. Red: such a commit was refused with commit-fix-test and no red was recorded; green: `node --test
  --test-name-pattern=K357 tests/kit/plan.test.mts` passes 2 of 2 (K357).
- The Claude Code hook, `make item-test` and `make item-state` read a command of `run-tests.mts` as the runner does: its
  arguments after the options also without `--`, and a file from its `--cwd`, so `--cwd packages/php --
  ../../tests/XTest.php` is allowed; item-test and item-state judge a file of a Verification command from the root,
  where they run it. Red: both commands were refused by the hook; green: `node --test --test-name-pattern=K353-2
  tests/kit/claude-hook.test.mts tests/kit/plan.test.mts` passes 2 of 2 (K353-2).
- `make dependency-policy-check` runs with `GOWORK=off` as `make dependency-review` does, so a linked Go checkout no
  longer reports the review record of a lock that no manifest declares (K343).
- The type check of `make lint-ts`, `make commit` and `make item-test` runs the `typecheck` script of the package when
  its `package.json` has one (svelte-check for a package with `.svelte` files), `tsc --noEmit` only otherwise (K355).
- While a Composer project is linked, the dependency review and policy read the locked versions from
  `composer.link.lock`, so the review record is compared with what Composer resolved and the vendor holds, not with
  the tracked lock that cannot relock (K326-1).
- `make install-packages` links the installed packages to the polyspec checkouts beside the repository (`link
  --siblings`), `make link` without `CHECKOUTS` takes those checkouts also in a worktree, and `make link-state-check`
  fails a recipe that installs from a lock without the link step after it and a linked vendor whose platform check
  demands another PHP than `.php-version` (K349).
- `make item-state` checks the transition to done before it runs the verification, so a waiting row is refused with
  the states it can move to, not for its unstaged files (K353-1).
- `make item-edit ID= VERIFICATION=` replaces the Verification cell of a row in both languages through the checks of
  `item-new`, and the type check of `make item-state` and `make item-test` builds the workspace package that tsc
  cannot find (`npm run build`) and compiles again (K353).
- `make lint-rust` also fails P8 hiding: `let_underscore_untyped`, `map_err_ignore`, an explicit `unused_must_use` and `allow_attributes_without_reason`, and the `clippy.toml` that kit copies disallows `Result::ok`, `unwrap_or`, `unwrap_or_default` and `unwrap_or_else` unless an `#[allow]` states the reason. `lint-rust` joins `kit-gates` and the CI of kit, so P8 names it. Red: an untyped `let _` and the disallowed methods passed; green: each fails by its lint, and a variant with a reason passes (`tests/source/lint-rust-real.test.mts`) (K334).
- `make parity-declarations-check` fails an implementation of `config/parity.json` whose roots hold no manifest of its
  ecosystem (`package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`) and one that has the roots of
  another, since an implementation is a source root, never only test globs (K336).
- `make lint-go` also fails P8 hiding: errcheck with `check-blank` and `check-type-assertions` (an error assigned to `_`, an unchecked assertion), nilerr, errorlint, and nolintlint (a `//nolint` needs its linter and a reason). Red: seven planted patterns passed; green: each fails with its linter, and variants that state their need pass (`tests/source/lint-go-real.test.mts`). The symbol extractor `symbols/go/main.go` reports a marshal error (K334).
- `make item-state` marks an item done only after the commands of its Verification cell pass on the tree that the
  commit holds: the files it delivers must be staged or committed, and a failing command refuses the state (K335).
- The dependency policy compares plain Composer releases as versions, so a locked version above the latest release of
  the registry, such as an unreleased `polyspec/template 0.0.11` against 0.0.6, is not outdated (K328-1).
- `make lint-python` also fails P8 hiding: SIM105, a typed `try`-`except`-`pass` and `continue` (S110, S112 with `check-typed-exception`), TRY201, TRY203, TRY400, B012, a blanket `type: ignore` (PGH003) or `noqa` (PGH004), and a `noqa` that suppresses nothing (RUF100). Red: each planted pattern passed the lint; green: each fails with its rule and a variant that states its need passes (`tests/source/lint-python-real.test.mts`) (K334).
- Parity rule R16 reports only a match of the requirement pattern that `docs/spec` defines, over every match of an
  internal test, so `UTF-8` and `SHA-256` name no requirement (K342).
- While a Composer project is linked, `make dependency-review` runs Composer on `composer.link.json` and its lock,
  does not compare a linked package with its registry or update it, and never changes the tracked `composer.json` and
  `composer.lock` (K340).
- The link and parity tests are bounded and cheaper: every case of `tests/kit/link.test.mts` has a 60 s timeout, a
  sandbox repository is a copy of one configured `.git` folder instead of six git processes, and a link workspace
  copies three repositories committed once per process (K301).
- Parity rule R17 (leaked-internal) fails a public signature, parent class or interface that names an internal symbol:
  an `@internal` PHP class, a `_`-private Python name, or a TypeScript type that the entry point does not export (API
  Extractor `ae-forgotten-export`) (K307-1).
- Parity rule R10 counts only phrases that state a number of implementations: a noun that modifies a compound ("one
  language service") and the pair of a comparison ("between the two languages") are no count (K311).
- `make duplication-check` passes the exclude globs of `config/duplication.json` to jscpd in a configuration file, so
  a brace glob such as `{tests,spec}/**` keeps its braces and excludes the files it names (K310).
- `make lint-ts` passes in kit: the JSON of the tests and tools of the link, the divergence check and the PHP library
  autoload is read through a schema or a guard, and the `php` binary of the real-tool tests is declared in
  `config/knip-entries.json` (K333).
- `make lint-ts` runs `tsc --noEmit -p tsconfig.json` in the folder of each `tsconfig.json` that has TypeScript below
  it, and `make commit` and `make item-test` run it for the owning `tsconfig.json` of each changed TypeScript file and
  refuse on a type error, since vitest and node transpile without checking the types (K309).
- `kit link` installs a declared polyspec Python package that the environment lacks, such as after the uv sync of an
  install recipe removed the editables, as the editable install of its provider folder, so a second run ends linked
  like the first (K316-2).
- Parity rule R6 leaves out the test files that an `internal` glob of any implementation selects, as it does bound
  files, so an internal node-run test of a PHP implementation draws no R6 (K332).
- `kit link` runs the partial `composer update` of the linked packages with `--with-dependencies`, so a dependency
  that a linked package now requires at another constraint is resolved while unrelated packages stay at the locked
  release (K331).
- `make dependency-policy-check` fails a root `composer.json` that requires a polyspec package whose own
  `composer.json` declares a repository that the root lacks, naming the package and the repository, since Composer
  reads `repositories` only from the root manifest, and `kit link` writes the repositories of each linked package into
  `composer.link.json` (K330).
- The extension run of `make test-php-ext` loads the PHPUnit files of the library and none of its sources (K329) in S10: `run-tests phpunit --without-library <folder>` starts the PHPUnit script with an autoloader that Composer dumps over the vendor directory of the library, with its dependencies and its autoload-dev and without its own autoload, and a test that includes a source of the library fails the run; `make divergence-check` also reads the sources below the implementation roots that Git ignores, and reports `function_exists` as it reports `extension_loaded`, so the library has no guard against its extension. Red: `node --test tests/source/php-library-real.test.mts` showed the sources of the library loaded with the library autoload; Green: none is loaded, and a required source fails the run.
- A linked package (a path dist of the link lock of a Composer project, a symbolic link of `node_modules`) is not compared with the latest release of the registry, in `make dependency-review` and in `make dependency-policy-check`; a third-party package still is (K328). The local checkout is canonical during development, so the package is judged by its link and the registry comparison belongs to the check of the batch release. Red: `node --test --test-name-pattern=K328 tests/kit/dependency-policy.test.mts` failed with `psr/log: 3.0.2 is older than 99.0.0` for a linked package; Green: it passes, and the third-party package is still reported.
- A repository declares a downloaded tool of its own in `mise.toml` through the http backend (K327): the key `http:<name>`, a table with an exact `version` and an https `url`; `mise.lock` pins its sha256 for every platform and `make toolchain-check` names the platform whose sha256 is missing. A tool of another backend that kit does not check is still refused. Red: `node --test --test-name-pattern=K327 tests/kit/toolchain-mise.test.mts` was refused with `mise.toml tools declares http:pie, which kit does not check`; Green: it passes.
- `make divergence-check` (K315) is a gate of every repository: it fails on a test that branches on the extension, the runtime or the platform, on code of an implementation that reads whether another implementation is present, on `--exclude-group`, on `partial` or `unsupported` in `contracts/features.json`, and on an exception of `config/duplication.json` or of the `tools` and `internal` of `config/parity.json` whose reason begins with no kind that kit defines (`generated:`, `fixture:`, `test:`, `harness:`, `ecosystem:`, `external:`); `make test-markers-check` also reads `testing.Short()`, `pytest.importorskip`, `@requires`, `#[Requires...]` and the skip of a `node:test` context; `make item-state` refuses a bypassed or impossible cause that cites a release, a failure not reproduced, a flake, a transient or unrelated failure or the environment. Findings on 2026-10-21: orm 101 (68 test branches, 18 partial features, 11 exceptions, 4 code branches), template 12, crudui 44, hyper 10, fsm 5, ordered-json 4, ssr 5. Red: there was no check (the case imports `divergenceFindings`); Green: `node --test tests/kit/divergence-check.test.mts` finds each kind.
- A link over a non-editable install of the provider folder or a release wheel becomes the editable install (K316-1): the overrides file of the install holds one `-e <folder>` line for each linked package, since the line `name @ file://<folder>` makes uv take a non-editable requirement that beats the `-e` of the command line and left the package non-editable (checked with the uv of this checkout: `dir_info` is empty with the URL line and `{"editable":true}` with the `-e` line, also for a package that requires another by a release URL); the message for a registry or archive install says so. Red: `node --test --test-name-pattern=K316-1 tests/kit/link.test.mts` found `name @ file://` lines; Green: it finds `-e` lines.
- The path repository of a linked package in `composer.link.json` carries `symlink` and `versions` set to the release that the lock recorded, else to the exact release that the project requires, and comes before the other repositories, so Composer takes the folder for that release and prefers no archive of the same version (K304-2). The link locks of orm, hyper (root and `examples/board`) and crudui hold every linked polyspec package with dist type `path` and a `platform_check.php` of PHP 8.4.1 or 8.4.0 from the folder. Red: a package that the lock did not hold got no `versions`; Green: `node --test --test-name-pattern=K304-2 tests/kit/link.test.mts` passes.
- While a Composer project is linked (its `composer.link.lock` exists), `make dependency-policy-check` judges the platform and `composer validate` of the project on `composer.link.json` and `composer.link.lock`, fails a package of a path repository of the link manifest that the link lock holds from another dist, and leaves the review hash of the tracked lock to the check of the batch release (K326). Red: `node --test --test-name-pattern=K326 tests/kit/dependency-policy.test.mts` failed on the tracked lock resolved for PHP 8.5.0; Green: it passes on the link lock and still fails a link lock of another platform or dist.
- An implementation of `config/parity.json` declares `internal` globs, each with a reason (K313): a test that matches is no parity unit, so R5 asks no binding for it and no binding may name it, and it names no requirement of the spec (R16), so a contract test cannot hide there; a glob that selects no test fails the declaration. The existing `tools` already covers a single-language package that implements no contract, so no `outside` declaration is added. Red: the declaration was refused by the schema and R5 flagged the internal file; Green: `node --test --test-name-pattern=K313 tests/kit/parity.test.mts` passes.
- The standing rulings of the conductor are rules of kit (K314): PRINCIPLES P32 to P35 state the scope (a contract behaviour in every implementation, one neutral rule for a native integration, internal tests that are no parity unit, a rule missing in `docs/spec` written first, no unit dropped, no citation without a test, no rename to escape a check, repeated code restructured, generated output untracked) and the providers (a finding blocked by a release is a link defect), each with its `Enforced by`; `docs/operations/adoption.md` states the procedure of an item boundary and the questions that may be asked. Red: the rulings lived in messages and a scratch file; Green: `node scripts/kit/check-rules.mts` reads each rule with its check.
- `make bypass-check` (K308) is a gate of every repository: it fails on a tracked test, script, Makefile or Git hook that sets the CI identity (`GITHUB_ACTIONS`, `CI`) outside a workflow, names a gate of `kit-gates` in `make -o`, `--old-file` or `--assume-old`, or uses `--no-verify`; the tools and tests of kit itself are left out. Red: there was no check, and a test with `GITHUB_ACTIONS: 'true'` or `make -o toolchain-check` passed every gate (the case imports `bypassFindings`); Green: `node --test tests/kit/bypass-check.test.mts` finds each.
- `make rules-check` expands a make target once for each set of variables it is called with, so every `make ci-targets TARGETS=...` call of the workflows is reached and a rule enforced by a target of a later call is no longer reported as run at no point (K312). Red: `node --test --test-name-pattern=K312 tests/kit/check-rules.test.mts` reported `make second` as unreached; Green: it finds nothing.
- `make test-js` and `make test-ts` name only the `*.test.*` and `*.spec.*` files of a package, the naming of the node and vitest conventions, so a probe or a helper under `tests/` is never run as a test (K325). Red: `node --test --test-name-pattern=K325 tests/kit/runtime-targets.test.mts` listed `tests/probe.mjs` and `tests/helper.mts`; Green: only the test files.
- `make test-python` runs the tests of a package in its environment: the run carries `--venv` with the nearest `.venv` at or above the package folder (K324), so the dependencies of the package import. Red: `node --test --test-name-pattern=K324 tests/kit/runtime-targets.test.mts` expected the `--venv` option and the run had none; Green: it passes.
- The Composer projects that kit writes (`config/php-lint`, `config/phpunit`, the symbol extractor) resolve for PHP 8.4.1, the minor of `.php-version` with the patch 1, in `composer.json` and in the `platform-overrides` of the lock (K322). Red: `node --test tests/kit/php-platform.test.mts` found `8.4` in config/php-lint and in the extractor project; Green: it finds `8.4.1`.
- The suite `CHECK_TARGETS` is read with its `$(VAR)` words expanded by `suiteTargets`, for the gate check of `kit-check` and for the owner check (K321). Red: `node --test --test-name-pattern=K321 tests/kit/kit-check.test.mts` reported `docs-check` missing although `$(MORE)` carried it; Green: it finds nothing.
- `make link-state-check` leaves out the Composer projects that kit writes (the copies of `kit.copies`, `config/php-lint`, `config/phpunit`), so a repository with only those needs no Composer (K320). Red: `node --test --test-name-pattern=K320 tests/kit/link-state-check.test.mts` threw for the missing Composer; Green: it finds nothing.
- `make lint-php` and `make lint-python` pass in a repository without PHP or Python sources: the steps are empty before any tool or configuration is looked up (K319). Red: `node --test tests/kit/lint-php.test.mts tests/kit/lint-python.test.mts` threw for the missing tools in a tree with documents only; Green: both return no step.
- A Composer package counts as linked (K318) only when its folder is a link and `installed.json` records `dist` type `path`; a link over the install of a release archive, which the earlier mechanism left, is installed anew by the partial update, every already linked folder stays in the same update, and `link-state-check` fails a link whose record says another dist type. Red: `tests/source/link-composer-real.test.mts` with an archive install under a hand-made link kept the archive (record dist type `zip`); Green: the record says `path` and the platform check follows the folder.
- A Python link is an editable install of the provider folder (K316): `uv pip install --reinstall-package <name> -e <folder>` with the constraints of the lock and an overrides file that names each linked package by the URL of its folder; no wheel is built or kept under `var/link/wheels`, the state is read from `direct_url.json` (the folder and `dir_info.editable`), and uv checks `Requires-Python` and the requirements at that install. The fingerprint, the prebuilt wheel and the read-only stale paths are removed. Red: the link tests expected `-e <folder>` installs and found wheels built by `uv run`; Green: they pass, and the real uv of this checkout installs a package that requires another linked one by a release URL with `-e` and the override.
- A Composer link is a path repository with `symlink` that Composer itself installs (K304-1): link writes a git-ignored `composer.link.json` (the tracked `composer.json` with a path repository per provider folder in front of its repositories, the locked release as the version) and a copy of the lock, and runs `COMPOSER=composer.link.json composer update` for the linked polyspec packages and the own path packages; the installed folder is a symbolic link and the record, autoload rules and platform check come from the `composer.json` of the folder; `composer.json` and `composer.lock` stay unchanged; `unlink` removes the link files. The hand-made rewrite of `installed.json` of K304 is removed. Red: the link test expected `composer update` with `composer.link.json` and found `dump-autoload`; Green: it passes, and `tests/source/link-composer-real.test.mts` installs a package whose archive requires PHP 99 from its folder under the real Composer.
- `make link-state-check` replaces `link-metadata-check` (K305-1): the link counts as the installed released version, so no version or requirement is compared; while a link exists it fails, naming the package, for an installed 0.0.x polyspec package that is a copy among links, a link that resolves to no package of that name, or a `go.work` `use` folder without a `go.mod`. PRINCIPLES P30 and local-links state the owner rule. Red: `tests/kit/link-state-check.test.mts` imported a module that did not exist and a stale record failed the old gate; Green: it passes.
- The PHP symbol extractor treats a class, function, constant, method or property whose docblock carries `@internal` as no public API (phpstan and psalm semantics), and a class that carries it hides its members (K307). Red: `node --test tests/source/symbols-php-real.test.mts` listed `A\\Hidden`, `A\\Open::secret` and the other internal symbols; Green: it lists only the public ones.
- `parity.mts` runs the extractors and runners with `toolsEnvironment(root)`, so a mise shim finds the mise environment of the checkout instead of failing with "mise.toml not trusted" in a consumer (K306). Red: `node --test --test-name-pattern=K306 tests/kit/parity.test.mts` failed with a python shim that needs `MISE_GLOBAL_CONFIG_FILE`; Green: it passes.
- `make link-metadata-check` (K305) is a gate of every repository: while a link exists it fails, naming the package and the field, when a linked npm package resolves to no package of that name, a Composer record of installed.json differs from the composer.json at its install-path, an editable Python install differs from its pyproject.toml in Version or Requires-Python, or a go.work use folder has no go.mod; a checkout without a link passes. Red: there was no gate, and hyper's stale records passed every gate (the case imports `linkFindings`); Green: `node --test tests/kit/link-check.test.mts` passes, and the gate reports the stale records of `hyper/examples/board`.
- A Composer link takes the `require`, `autoload`, `replace`, `provide`, `conflict` and `version` of the linked source's composer.json into installed.json before `composer dump-autoload`, for a linked package and for a path package of the project, so the platform check and autoload rules follow the source as it is (K304). Red: `node --test --test-name-pattern=K304 tests/kit/link.test.mts` showed the record still requiring the released `php >=8.5`; Green: it records the source's `>=8.4`.
- `make toolchain-check` names the system commands that `make php-ext-arginfo` needs in a repository with `packages/php-ext`: `curl` or `wget`, and `tar`, which the gen_stub.php of the PHP uses to download and unpack its PHP-Parser (K303). A pinned Composer PHP-Parser was not chosen: gen_stub.php names the one release that fits its PHP. Red: toolchain-check was silent when they were missing (the case imports `arginfoToolFindings`, which did not exist); Green: `node --test --test-name-pattern=K303 tests/kit/check-toolchain.test.mts` passes.
- The build copy of `make build-php-ext` and `make php-ext-arginfo` holds only the sources of the extension (stub, C and header files except config.h, config.m4, config.w32, and composer.json beside src/), never a build folder or product, so a stale object or module left in an ignored src/ cannot be built or published (K302). Red: `node --test --test-name-pattern=K302 tests/kit/php-ext.test.mts` reported the extension built although its C did not compile; Green: the build fails and publishes nothing.
- `make rules-check` reads AGENTS.md structurally (K300): each rule of PRINCIPLES.md has an id (P<n>, S<n>), and each rule of AGENTS.md begins with `Own:` or `Refines <id>:` and, when it refines, names an existing path or make target in backticks that PRINCIPLES.md lacks; the 4-word similarity of K279 is removed. kit's AGENTS.md and its twin adopt it. Red: `node --test --test-name-pattern=K300 tests/kit/check-rules.test.mts` showed the short restatement "Build modular components" without a finding; Green: it passes.
- A requirement of the spec is defined by a list item, bulleted (`-`, `*`, `+`) or numbered (`1.`, `1)`), that starts with `**<id>**`, or by a heading (K299); S6 and the schema say a list item. Red: `node --test --test-name-pattern=K299 tests/kit/parity-requirements.test.mts` found no R13 for `1. **AB-4**`; Green: it passes.
- `make test-python` refuses a test directory of a Python package that holds `test_*.py` and no `__init__.py`, naming the file to add, since unittest discovers a directory only as a package and ran no test ("no test ran") otherwise (K298). orm, template, crudui and hyper already make their test directories packages; ordered-json adds the files. Red: `node --test --test-name-pattern=K298 tests/kit/runtime-targets.test.mts` failed on the unchanged runner, which returned the run; Green: it passes.
- S10 holds for a repository with more than one PHP library (K293): one extension implements every library, `packages/php` named `polyspec/<repository>` or `packages/<component>/php` named `polyspec/<repository>-<component>`; `make lint-php-ext` checks those names, `make test-php-ext` compares each registered name with the library that declares it and runs the PHPUnit files of every library, and the parity extension shares the implementations of all libraries. Red: the K293 cases of `tests/kit/php-ext.test.mts`, `runtime-targets.test.mts` and `parity.test.mts` failed (one `packages/php` was assumed); Green: they pass.
- `make plan-split FROM= TO= IDS=` moves the rows of items, with their sub-items and their text unchanged, from the checklist of one plan to that of another and in the Korean twins, makes the target plan when it does not exist, and writes nothing when it refuses (K292). Red: `node --test tests/kit/plan.test.mts` failed because `splitPlan` did not exist; Green: it passes.
- `make lint-php-ext`, `make build-php-ext` and `make php-ext-arginfo` read the files of `packages/php-ext` from the disk as well as the tracked files, so an extension whose `src/` is generated and ignored by Git passes like a tracked one (K297). Red: `node --test --test-name-pattern=K297 tests/kit/php-ext.test.mts` failed with `the stub of the extension is missing`; Green: it passes.
- The documents state the rules that exist (K291): local-links says that nothing is released, tagged or version-bumped in any repository, kit included, until all development is complete, and that a push publishes nothing; the language-parity section of tool-inventory no longer describes profiles, admit lists, exclusions (R8), nativeOnly entries or spec anchors, which S6 removed from the declaration. Red: the text named them; Green: `node scripts/kit/check-documents.mts` passes and the sections follow `parity.schema.json`.
- The dependency arrays of a pyproject include `[build-system] requires`, so `make dependency-review UPDATE=1` pins a build requirement such as setuptools like a project one (K296). Red: `node --test --test-name-pattern=K296 tests/kit/pin-python-dependency.test.mts` failed with no exact pin of setuptools; Green: it passes.
- `make build-php-ext` and `make php-ext-arginfo` work in a copy that keeps `composer.json` beside `src/`, so `config.m4` reads the version of the package from `../composer.json`, the one source of the version (K295) in S10. Red: `node --test tests/kit/php-ext.test.mts` failed because `phpversion()` of the built fixture was empty, not the 1.2.3 of its composer.json; Green: it passes.
- `make php-ext-arginfo` runs ./configure in the copy before it makes the header, since the rule of the header lies in the Makefile that configure writes (K290). Red: `node --test --test-name-pattern=K290 tests/kit/php-ext.test.mts` failed with `make: *** No rule to make target polyspec_demo_arginfo.h`; Green: it passes.
- `make rebuild-check` excludes the vendored copies that the installed kit lists (`node_modules/@polyspec/kit/package.json` kit.copies, as kit-check reads them), not the kit.copies of the consumer's own package.json, which has none (K294). Red: `node --test --test-name-pattern=K294 tests/kit/rebuild-check.test.mts` failed with the copies listed as tool sources; Green: it passes.
- `make dependency-policy-check` requires one PHP platform (K282): every entry of composerPlatforms and every config.platform.php of a Composer manifest names the same PHP, and with a .php-version it is the minor with the patch 1 that PHPUnit 13 needs (8.4.1). Red: `node --test --test-name-pattern=K282 tests/kit/dependency-policy.test.mts` failed on the stashed check (no platform finding); Green: it passes. hyper, fsm, orm and template (8.4.0) now fail the rule.
- A Composer answer that is no version is never recorded as one (K281): `isVersionText` of `version.mts` refuses the "[none matched]" of composer outdated, so dependency-review reports no release for it and dependency-policy-check fails a review record whose latest is not a version. Red: `node --test --test-name-pattern=K281` on dependency-review and dependency-policy tests failed (the sentinel was recorded and accepted); Green: both pass.
- `make rules-check` fails an AGENTS rule that restates a PRINCIPLES rule: more than a quarter of its 4-word sequences lie in one rule of PRINCIPLES.md (K279). The AGENTS rules of seven repositories measured 0.15 or less except the restated ones of kit (0.29, 0.71, 0.82); kit's four copies are removed. Red: `node --test --test-name-pattern=K279 tests/kit/check-rules.test.mts` found no finding for a restated rule; Green: it passes and `node scripts/kit/check-rules.mts` passes in kit.
- `make kit-check` requires that CHECK_TARGETS of a repository reaches every prerequisite of kit-gates, as a word or as the prerequisite of one, with the lint of a language and the PHP extension gates only for a repository that holds code of it (K289). Red: no check read the suite, so a repository without language-check, rebuild-check or duplication-check passed kit-check (the case imports `gateFindings`, which did not exist); Green: `node --test tests/kit/kit-check.test.mts` passes, and kit-check names the missing gates of hyper, fsm, ordered-json and crudui.
- `make duplication-check` skips the tokens of the lines that carry no logic, with jscpd's own `--ignore-pattern` (K287): PHP declare, namespace and use, TypeScript and JavaScript import (single line and block), Go package and import (single and block), Python import and from-import, Rust use (single and braced) and C #include. Docblocks, signatures, the mode and the minimum of tokens are unchanged. Red: `node --test --test-name-pattern=K287 tests/kit/duplication-check.test.mts` failed all 7 cases because two files that share only a header were reported (`1 !== 0`); Green: all 7 pass, and two files that share a 6-line body still fail.
- The typecheck of kit passes (K288): the two assertions of `tests/kit/link.test.mts` pass a string message and `tests/kit/parity-requirements.test.mts` sets `caseFile` only when given. Red: `npx tsc --noEmit -p .` listed TS2769 at link.test.mts(384,125) and (387,134) and TS2375 at parity-requirements.test.mts(65,106); Green: it prints nothing.
- `make rebuild-check` finds the tool sources by the layout of the repository (`scripts/`, `scripts|tools|bin` of packages, generators, benchmarks, examples, fixture generators) and `config/rebuild.json` only classifies them: its `paths` is removed, so a repository cannot narrow what the gate sees (K286). kit's own config gains the classes of `install-php.mts` and of the PHP and Python symbol extractors, which the narrow `paths` had hidden. Red: `node --test tests/kit/rebuild-check.test.mts` failed the case of a tool outside the declared paths (benchmarks/run.js and packages/codec/tools/make.mjs passed); Green: it passes, and `node scripts/kit/rebuild-check.mts` first named five unclassified tools in kit, then passed.
- The tests of a PHP extension are the PHPUnit files of `packages/php` (K285) in S10: `make test-php-ext` runs `packages/php` (and `packages/php-ext` when it holds tests) with the extension loaded, and the parity implementation of the root `packages/php-ext` shares the implementation of the root `packages/php` by the layout, so a repository declares no relative path (`../php/tests`) in `config/parity.json`. Red: `node --test tests/kit/runtime-targets.test.mts` failed with `cwd: 'packages/php-ext'` for a fixture extension without tests, and `node --test --test-name-pattern=K285 tests/kit/parity.test.mts` found R6 for `php-ext`; Green: both pass.
- A Composer project installation of var/tools (PHPUnit, the PHP lint) is kept only while it is current: its composer.lock equals the lock of the project byte for byte and Composer's own `composer check-platform-reqs --lock` passes in it under the wrapped PHP; otherwise `make install-tools` installs it again, so an installation made under PHP 8.5 no longer fails with `Composer dependencies require a PHP version >= 8.5.0` under PHP 8.4. Red: `node scripts/kit/run-tests.mts node -- tests/kit/install-composer-project.test.mts` 0 passed, 3 failed; green: 3 passed (K284).
- `make install-tools` provides the PHP of `.php-version` by discovery: a `php` on PATH of that minor, else `php<minor>` of apt, else the `opt/php@<minor>` keg of Homebrew. It writes exec wrappers for php, php-config and phpize in var/tools/bin before the Composer installs, so every repository runs the pinned PHP whatever PHP the machine puts first on PATH, and it fails with the attempts when none matches. Red: `node scripts/kit/run-tests.mts node -- tests/kit/install-php.test.mts` 0 passed, 9 failed; green: 9 passed (K283).
- link installs each project of the consumer's own environment with `--no-deps` and each linked provider with its dependencies, in two installs: the lock sync of the consumer provides the dependencies of its own projects, so a project whose path dependency is provided another way no longer fails the install (K280).
- A case directory of a directory suite lists the requirements it tests in its `case.json` (`requirements`, read as JSON): R15 counts an id as named when a case.json of the unit's case set lists it, a missing or malformed case.json is a declaration finding, and an id of it that docs/spec does not define is R14; a unit may declare `caseFile` to take only the case directories that hold that file (K277).

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
