<!-- doc-id: standards-enforcement -->
# Standards enforcement plan

[한국어](standards-enforcement.ko.md)

## Status and scope

The owner approved the plan on 2026-10-13. Work has not started.

Revision 2 rewrote the plan after two adversarial verifications, one of the facts and one of the design. Each ran in a
scratch directory and changed no repository. The corrections they forced are listed in "Corrections from verification".

The plan covers the polyspec repositories crudui, fsm, hyper, kit, ordered-json, orm, template, template-benchmark and ssr.
template_2026 is out of scope.

Facts below are measured at each repository's HEAD on 2026-10-13. Counts give their population.

## Context

orm-php built its own class loading where PSR-4 was enough:
- `packages/orm-php/src` keeps 26 extra classes in 11 of its files. The count is both "declarations after the first in a
  file" and "declarations whose name differs from the file". `Planner.php` alone holds 8.
- `composer.json:22-29` maps `src/` both as `psr-4` and as `classmap`.
- `tests/autoload.php:7-44` keeps a map of 26 entries.
- 14 files make 15 `spl_autoload_register` calls.

The review found three causes.

1. **Standards live only in documents, and no tool enforces them.**
   - Nothing checks PSR rules, forbidden APIs, folder structure, test placement or versions.
   - kit's parity checker (`scripts/kit/parity.mjs`) is wired only in fsm (`fsm/Makefile:16`).
   - orm declares `config/parity.json` but does not run it.
   - ordered-json and template vendor the checker without wiring it.
   - The same ideas were rebuilt per repository:
     - orm and template: `contracts/features.json`
     - template: `tests/runner/parity.mjs`
     - ordered-json: `implementations.json` and `package-tests.json`
     - crudui: evidence files
     - ssr: `features.json`
2. **Our own rules produced rebuilds.**
   - kit's rule "a tool imports only Node built-ins" (`kit/AGENTS.md:17`) produced its own implementations of a JSON
     Schema validator, a TOML reader, a PEP 508 requirement parser, version comparison and a commit linter. `pylock.mjs`
     names that rule as its reason.
   - The no-symlink rule keeps hyper and template off npm workspaces. Their `.npmrc` sets `bin-links=false`, which needs
     the workaround `hyper/scripts/tsc.mjs` and makes `npx tsc` fail.
   - The rule "do not rebuild what an outside tool does" is missing from orm's, template's and ssr's AGENTS.md.
3. **Implementations and tests differ in depth between languages.** Today only a reader with grep sees it, not a tool.

The plan therefore works in this order:
1. Set the standards.
2. Make each one a tool. Use the ecosystem's standard tool where one exists. Where a kit tool remains, a written rebuild
   record must show that no ecosystem tool does the job.
3. Run the tools on HEAD and record the red result.
4. Implement until green.

A standard is never lowered to pass. A wrong standard is reported and corrected.

## Corrections from verification

Revision 1 was wrong in these places:

| Topic | Revision 1 said | Correct |
|---|---|---|
| `spl_autoload_register` count | 16 calls | 15 calls in 14 files |
| `.npmrc` | blocks npm workspaces; crudui has it | `install-links` has no effect on workspaces; only hyper and template set the keys |
| `config/phpunit` | unused | used by `tests/source/parity-real.test.mjs` |
| template lint stack | eslint 8 with TS 5 | eslint 10 with TypeScript 6 |
| template-ts tests | lack load-failure | load-failure exists; object-calls and compiler-interface are covered elsewhere (see §2) |
| validator-python | no unit tests | 5 test files; `hiddenPaths` is untested |
| Unicode generators | 3 | 7 |
| `--strict-psr` | proves one class per file | exits 0 and silently drops the extra classes; only phpcs `MultipleClasses` catches them |
| hyper Python JSON | rebuilt | its spec requires byte equality with PHP `json_encode`, and ordered-json fails 14 of 34 encode cases. It is justified |
| ordered-json PHP `files` | a PSR-4 bypass | `files` is Composer's standard way to load namespaced functions and constants; only the classes move |
| rustdoc JSON | a stable extractor | needs `-Z unstable-options` on stable 1.98 and 1.99 |
| `path.matchesGlob` | a drop-in for `glob.mjs` | it does not match dot-paths, so `**` would silently drop `.github/…` |
| npm `semver` | replaces `version.mjs` | `version.mjs` compares npm, Go, PyPI, Composer and crates versions, and `semver` does not parse PEP 440 or Go pseudo-versions |
| API Extractor `ae-undocumented` | works | fires only with `apiReport.enabled`; `ae-forgotten-export` needs `addToApiReportFile: false` |
| generator-svelte TS 6 | one devDependency in a workspace | npm hoists `ts-api-utils` and `eslint-plugin-svelte` to TS 7 and eslint crashes |
| kit npm dependencies | possible inside byte copies | a copied file would resolve its dependencies from each consumer, so kit must first become a package |
| removing `--test-force-exit` | gives red | a leaked handle then hangs a file instead of failing it |
| exclusions | allowed with a reason | kit parity R8 already fails on every exclusion; permanent differences use `profiles` / `nativeOnly` |
| standard IDs R1–R8 | used | they collide with parity rule IDs, so the standards are now S1–S9 |

## 0. Standards

`PRINCIPLES.md` (repository root, with `PRINCIPLES.ko.md`) holds the standards in its "Repository standards" section. kit vendors it to every repository, as agreed with the kit maintainer session.
Each repository's AGENTS.md and AGENTS.ko.md refer to it and do not copy it.

| ID | Standard | Enforcing tool (red test) |
|---|---|---|
| S1 | **No rebuilds.** Follow each ecosystem's rules and do not rebuild what an outside tool or library does. Our own rules, such as no symbolic links, govern only what we create. They never block an outside tool's behavior, including the links npm creates for workspaces and bins. Our own implementation is allowed only with a rebuild record (`docs/rebuild/<tool>.md`): the requirement, the ecosystem tools searched, and why none fits. | The lint and forbidden-API checks below; a check that every kit tool and every repository tool that parses an outside format has a rebuild record |
| S2 | **PHP.** One class per file. PSR-4 for the package and `autoload-dev` for tests. No `classmap`. `files` only for namespaced functions and constants. No `spl_autoload_register` and no runtime `ClassLoader` registration. Generated code follows PSR-1 and PSR-4. Tests use PHPUnit. | phpcs PSR-12 (`PSR1.Classes.ClassDeclaration.MultipleClasses`, `PSR1.Files.SideEffects`); a composer.json policy schema checked with ajv (no `autoload.classmap`, `autoload-dev` required); phpstan with `spaze/phpstan-disallowed-calls` (also catches `spl_autoload_register` called through a string variable, and `ClassLoader::addPsr4`); phpcs over a committed sample of generator output; `composer dump-autoload --strict-psr` for single-class files whose name is wrong |
| S3 | **Test runners.** Tests run only through the ecosystem's standard runner: `node --test`, vitest, PHPUnit, `go test`, `cargo test` / nextest, or unittest. No PASS/FAIL protocol of our own, no `check()` helpers, no chains of files run one by one. Tests run against installed packages: no `PYTHONPATH`, no `sys.path` changes, no path that leaves the repository. | kit fixes the test-file convention per runner (`*.test.{ts,mjs}`, `*Test.php`, `*_test.go`, `tests/` and `#[test]`, `test_*.py`). A repository declaration may add files but never narrow the set. Any file under a test root that imports a test API must belong to a binding. parity R3 and R5; ruff TID251 `sys.path` with every nested `[tool.ruff]` required to `extend` the root; the parity schema and the layout tool reject `PYTHONPATH` and repository-leaving paths in `env`, Makefiles and configs |
| S4 | **Versions.** A version is chosen only after every locked dependency is shown to work with it. Use the latest LTS where the ecosystem has one (Node, Symfony). Otherwise use the latest stable release that the dependencies support. A newer non-LTS release close to the LTS is allowed. The declared floor equals the pinned toolchain at the pin's precision. Every repository uses the same pins. An exception is declared with its scope, reason and retry condition. No silent fallback to a source build. | kit ships the pins as data. A repository declares only the tools it uses and its exceptions. `check-toolchain` compares every manifest floor with the pins, including a new TypeScript key. uv `no-build`, npm `engine-strict`, Composer `config.platform.php`. CI runs the whole suite on the pins. |
| S5 | **Folders.** One folder structure for every monorepo (below). | The layout tool (§1.4) |
| S6 | **Language parity.** Every implementation in a repository tests the same feature units, vectors and API at the same level. A permanent difference is a parity `profile` or `nativeOnly` entry. Its reason must cite a spec anchor (`contracts/…#id` or `docs/spec/…#id`) that the tool resolves. An `exclusion` is temporary debt that fails until removed (kit parity R8). | kit parity, extended (§1.3) |
| S7 | **Test placement.** A test of a basic feature lives in the package and repository that own the feature. A consumer keeps only tests from the consumer's point of view. | parity R6 and the layout tool, inside one repository. A test that reads another repository's vectors or fixtures is caught by the path rule of S3. A consumer test that repeats an owner's assertions in other words cannot be detected by a tool, so it is found by review and recorded |
| S8 | **Reasons.** Reporting oddities is the second bullet of PRINCIPLES "Responsibility" and is not restated. S8 adds that every exception, profile and rebuild record carries its reason, in the place where it is declared (K117). | No tool can enforce the reporting itself. The plan says so. The tool side is that every exception, profile and rebuild record needs its reason |
| S9 | **One infrastructure language.** Cross-language orchestration and checks, kit included, are written in TypeScript. Node 26 runs repository-local `.ts` directly (type stripping); `tsc` 7 checks it with `noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions` and `verbatimModuleSyntax`. The kit package is published as `tsc` 7 output (JS and `.d.ts`), because Node does not strip types inside `node_modules`. | The layout tool fails on a non-TS script on an infrastructure path. Declared carve-outs: (a) a harness that drives one language's implementation is a test of that language and lives in the owning package; (b) a language-specific static check is a plugin of that ecosystem's analyzer (golangci-lint, PHPStan); (c) a symbol extractor runs that ecosystem's tool and emits JSON |

### S5: folder structure

**Root folders**

| Folder | Holds |
|---|---|
| `packages/` | the packages |
| `contracts/` | shared spec data: vectors, fixtures, JSON schemas, machine definitions |
| `docs/` | documentation |
| `scripts/` | TypeScript infrastructure |
| `tests/` | cross-language runners and tool tests only |
| `examples/` | examples |
| `benchmarks/` | benchmarks |
| `config/` | configuration |

Existing roots move like this:
- `schema/`, `conformance/`, `fixtures/` and `machines/` → `contracts/`
- `bench/` → `benchmarks/`
- `tools/` → `scripts/`, or `packages/` when it is a package
- orm's root Go module (`engine/`, `generator/`, `cmd/`, `internal/`) → `packages/go/`
- ssr's `verification/` → `packages/verification/`
- template-benchmark, which is not a monorepo of packages: `adapters/` → `packages/`, and it adopts kit and S1–S9

Every repository's map is written in its `config/layout.json` before the tool is turned on, so the red has a defined green.

**Package folders**
- The runtime ports of the main spec live in `packages/<runtime>/`, where the runtime is go, php, php-ext, python, rust,
  ts or js.
- Another component lives in `packages/<component>/`.
- A component with ports lives in `packages/<component>/<runtime>/`.
- Folder names carry no repository prefix. Published names do.

### S4: usability findings

All locked dependencies at HEAD, 2026-10-13.

| Item | Evidence | Decision |
|---|---|---|
| Rust | 23 Cargo.lock, 2,203 registry entries, 674 unique versions. The highest declared MSRV is 1.96 (oxc 0.151.0). 204 versions declare none. 1.99.0 released 2026-10-01. Our code uses neither `no_mangle_generic_items` (a hard error in 1.99) nor the legacy integer modules. A build proves the rest. | **1.99.0**, edition 2024 |
| Python | PyYAML 6.0.3, the latest, has no cp315, abi3 or none-any wheel. `uv sync --python 3.15` with no-build fails on PyYAML. 3.14 passes. cryptography, psycopg-binary and cffi ship cp315 wheels. | **3.14**. Move to 3.15 when PyYAML ships a cp315 wheel; uv no-build decides it |
| PHP | All 22 composer.lock admit 8.5.10. `php -l` is clean on the 587 tracked PHP files. | **8.5** |
| PHPUnit | 13 needs PHP `>=8.4.1`. 13.4.2 is the latest. | **^13.4** |
| Node | 26 becomes LTS on 2026-10-28. 26.11.1 released 2026-10-07. The engines of all 24 package-locks admit it. No node-gyp, nan or node-addon-api. | **26.11.1** |
| TypeScript | See "TypeScript 7". | **7.0.2**, except the declared Svelte exception |
| Go | Repository directives span 1.21–1.27.1. The dependencies' `go.mod` (proxy.golang.org, 51 module versions) need at most 1.27. go1.27.2 is current. | **1.27.2** |

What a build must still prove, red then green:
- Rust 1.99's new lints under `-D warnings`.
- Our PHP extensions on 8.5.
- playwright and puppeteer on Node 26.

### TypeScript 7

TypeScript 7.0.2 exports only `.`, `./package.json` and `./unstable/*`. Microsoft expects 7.1 "to ship with a new (and
different) API". Three groups use the TypeScript 6 API.

**1. Our code (6 places).** It is replaced.

| Place | Use | Replacement |
|---|---|---|
| orm-npm `src/generate/scan.ts` | syntax; `typescript ^6` sits in the runtime `dependencies` of a published library | oxc-parser |
| orm-npm `tests/models-scan.mjs` | `createSourceFile` | oxc-parser |
| template `scripts/check-compiler-interface.mjs` | syntax | oxc-parser |
| template `tools/showcase/compile-generated.mjs` | `transpileModule` | esbuild |
| crudui `tests/build/public-packages.test.mjs` | `createProgram` diagnostics | `tsc --noEmit` 7 over a consumer fixture |
| crudui `scripts/check-contract-manifest.mjs` | symbols and resolution | API Extractor's API model |

**2. Lint.** eslint with typescript-eslint becomes oxlint 1.87 with oxlint-tsgolint 7.0.2004.
- typescript-eslint's parser admits `typescript <6.1`, including its canary. Support is planned in #10940, which is open
  and accepting PRs, but it has not shipped.
- oxlint core is stable, and tsgolint is marked stable. Its README gives the coverage as both "59/61" and "60 of the 62".
- crudui and template use only the non-type-aware `recommended` sets.
- oxlint's JS plugins are alpha, so they are not used.
- oxlint does not lint `.svelte` templates, so `.svelte` lint stays in the Svelte exception.
- When typescript-eslint ships TypeScript 7 support, the choice is reviewed against S1.

**3. Outside tools without TypeScript 7 support (crudui).**
- **svelte-check 4.7.6.** Peer `^5 || ^6`. In sveltejs/language-tools #3063 (open), a member says both versions are
  needed even in `--tsgo` mode.
- **@sveltejs/package 3.0.0.** Peer `^6`, in both latest and next.
- **typedoc 0.28.20.** Peer up to 6.0.x. It is replaced by API Extractor 7.59.4 with API Documenter. API Extractor bundles
  TypeScript 5.9.3 and reads the `.d.ts` that TypeScript 7 emits; a scratch reproduction confirmed both.
  - The docs gate needs `apiReport.enabled` and `addToApiReportFile: false`, because `ae-undocumented` fires only through
    the API report. Without them the gate stays green.
  - Red fixtures prove the gate: an undocumented export fails, and a forgotten export fails.
  - All 7 crudui packages are run through it. Only a sample package has been run so far.
- svelte-check and @sveltejs/package are Svelte's standard tools and stay.
- **Exception.** `packages/generator-svelte` uses TypeScript 6.
  - It becomes a separate npm project with its own `package.json` and lock, outside the workspaces. In a workspace, npm
    hoists `ts-api-utils` and `eslint-plugin-svelte` to TypeScript 7, and eslint crashes (reproduced).
  - The exception is declared in the toolchain data with scope, reason and retry condition. The retry condition is: the
    Svelte tools admit TypeScript 7.
  - A red/green fixture proves the isolation.

Everything else uses TypeScript 7.0.2.

### Defect: `--test-force-exit` drops tests

kit `scripts/kit/run-tests.mjs:104` passes `--test-force-exit` to `node --test`. Every vendored copy has it (crudui :75,
fsm :103, hyper and template :92).

On Node 26.8.1, take a file that registers `first`, then waits at top level, then registers a failing `late`:
- Run plainly, it reports `tests 2, fail 1` and exits 1.
- With the flag, it reports `tests 1, pass 1` and exits 0.

So the flag hides unclosed handles by forcing an exit, and it drops tests. Two patches were then added for the side
effect: the `test-load-check.mjs` preload and crudui's rule `no-await-after-test-registration`.

Removing only the flag is not enough. A leaked `setInterval` then keeps a file running past 15 s, a hang instead of a red
result.

The fix, in order:
1. Add red tests:
   - a test registered after a top-level await must run;
   - a file that has not exited after its last test fails by a per-file exit deadline, and the message names its open
     handles (`process.getActiveResourcesInfo()`). run-tests already has such a deadline for go, cargo, phpunit and python.
2. Remove the flag.
3. Fix each leak the deadline exposes, in its test. The kit maintainer noted a one-time failure of
   `tests/kit/dependency-cargo.test.mjs` with no known cause; it may be such a leak.
4. Check whether `test-load-check.mjs`'s blocking stdout is still needed without forced exit. Then delete it,
   `scripts/lint/node-test-rules.mjs` and their tests.

## 1. Tools and their order

Order is set by dependencies. kit's tools change only through the kit maintainer session ("new"), after its principles
document lands.

1. **kit becomes a TypeScript package (S9).**
   - The sources move to `.ts`.
   - `tsc` 7 builds the JS and `.d.ts`.
   - The package has a `bin` and pins its own dependencies in its lock.
   - Each repository consumes it as one devDependency, the release-asset tarball pinned with its integrity, the way
     polyspec packages are consumed today.
   - fsm, ssr and template-benchmark get a root `package.json` for it.
   - This replaces byte-copy vendoring of tools. `kit-sync` keeps only files that must sit in the repository:
     `release.yml`, `PRINCIPLES.md` and the lint configuration files.
   - Publishing to the npm registry is an outside action and needs the owner's confirmation first.
2. **kit replaces its rebuilds.** Each change starts with a red kit test. Each kit tool without an ecosystem equivalent gets
   its rebuild record. The `.npmrc` keys are removed in the same release that changes the code depending on them
   (`run-tests.mjs` "npm writes no bin links" and `dependency-state.mjs` "install-links copies").

   | Today | Replacement |
   |---|---|
   | `schema-validate.mjs` | ajv |
   | `glob.mjs` | picomatch with `dot: true`; the red test covers `.github/…` and `docs/.vitepress/…` |
   | `pylock.mjs`, the pyproject regex in `dependency-state.mjs` | smol-toml |
   | the PEP 508 parser in `python-lock.mjs` | an npm PEP 508 parser if one passes the red tests, otherwise a rebuild record |
   | `version.mjs` | per-ecosystem comparators (npm `semver`, `@renovatebot/pep440` for PyPI); the rest gets a rebuild record |
   | `check-commits.mjs` | commitlint with a rule for the `(#id)` suffix |
   | `test-output.mjs` text parsing | JUnit / JSON reporters (node junit, PHPUnit `--log-junit`, nextest JUnit, `go test -json`) |
   | `install-*.mjs` and toolchain pins | rebuild record weighed against mise with `mise.lock`, which mise still marks experimental |
   | `changelog.mjs`, `git-hooks.mjs`, `duplication.test.mjs` | rebuild records weighed against git-cliff / release-please, lefthook and jscpd |
   | `run-tests.mjs --test-force-exit` | removed, as in "Defect" above |

3. **parity is extended.**
   - **Feature units.** Each feature requires one test case per implementation, named by the native runner's test id.
     It is matched against the ids the runner reported as passed.
   - **Fixed test-file conventions.** As in S3.
   - **Symbol snapshots.** Each implementation emits its public API with its ecosystem's tool:

     | Language | Tool |
     |---|---|
     | Go | `go/packages` |
     | TS | API Extractor API model |
     | PHP | `nikic/php-parser` |
     | Python | `ast` |
     | Rust | `rustdoc --output-format json`, which needs nightly (rust-lang/rust#76578 open) |

     This turns on parity R1 and R11.
   - **Rust extraction exception.** Rust symbol extraction uses a pinned nightly. It is declared as a scoped exception with
     its reason and the retry condition "rustdoc JSON is stable". It is the only nightly use.
   - **Spec anchors.** The reasons of profiles and `nativeOnly` entries must resolve to spec anchors (S6).
   - **Registries absorbed.** The rebuilt registries are deleted as each repository adopts parity:
     - ordered-json `implementations.json` and `package-tests.json`
     - orm `scripts/features/*`
     - template `contracts/features.json` checks and `tests/runner/parity.mjs`
     - crudui evidence
     - ssr `features.json`
4. **Layout tool (S5, S7).**
   - fsm's `check-layout.mjs` is not portable: it requires the `fsm-<kind>` prefix, reads `contracts/layout.json` and
     checks only `packages/`.
   - First a rebuild record weighs alint, which covers existence, allowlist and per-package structure. It is young (0.x).
     ls-lint checks names only. Repolinter's state is unverified.
   - If alint covers S5, kit configures alint. Otherwise kit writes the layout tool in TypeScript.
   - Either way, the tool covers:
     - the root allowlist;
     - the package tree;
     - go.mod module path = repository path + folder;
     - no `PYTHONPATH` or repository-leaving path;
     - no non-TS infrastructure script outside the S9 carve-outs.
   - Feature ownership stays in parity.
5. **Lint configuration.** kit distributes it, and each run passes the root config explicitly (for example
   `ruff check --config`).

   | Language | Configuration |
   |---|---|
   | PHP | phpcs PSR-12 + phpstan disallowed-calls + composer.json policy schema |
   | Rust | `[workspace.lints]` with `unsafe_code = "deny"`, scoped allows only at the FFI sites (orm `tx.rs`, case-clock, ssr v8); clippy `-D warnings` |
   | Go | golangci-lint with govet, forbidigo and gomoddirectives (forbids `replace`); `deadcode` |
   | Python | ruff with TID251 `sys.path`; vulture for dead code |
   | TS | oxlint + oxlint-tsgolint; knip for dead code and unused exports |
   | All | `.editorconfig` |

6. **Toolchain check (S4).**
   - It compares floors with the pins at the pin's precision:
     - Node `engines >=26.11.1`
     - Composer `php >=8.5`
     - `requires-python >=3.14`
     - go.mod `go 1.27.2` with `toolchain go1.27.2`
     - `rust-version 1.99.0`
     - the TypeScript pin
   - It reads the declared exceptions.
   - It rejects `.npmrc` keys that block npm's links.
7. **Self-proof of each tool.** Every tool has a violating fixture that must turn it red. The fixtures include the false
   greens found in verification:
   - an extra class with `--strict-psr`;
   - `importlib.import_module("sys").path`;
   - a nested `[tool.ruff]`;
   - `transmute_copy`;
   - an undocumented export without `apiReport`.
8. **One kit release, one sync.** Steps 1–7 ship as one kit release. Every repository then moves to it once:
   - crudui from 0.0.8, hyper from 0.0.17, template from 0.0.21, fsm from 0.0.26, ordered-json from 0.0.28 and orm from
     0.0.30;
   - ssr and template-benchmark adopt kit for the first time.

   Each move is assigned in §4.

## 2. Red reproduction

Folder targets are fixed first, so `config/parity.json` and `config/layout.json` are written once for the final paths.

Right after a repository adopts the release, `make check` runs and its failures are recorded, not fixed. The table predicts
them:
- "tool" means a predicted failure that the named tool must report. If it does not appear, the tool is wrong and is fixed.
- "review" means a finding no tool can detect. It is recorded as found by review.

| Repository | Predicted failure | Tool |
|---|---|---|
| orm | 26 extra classes in 11 files; `classmap` | phpcs; policy schema |
| orm | 15 `spl_autoload_register` calls | phpstan |
| orm | `bootstrap.php` side effects | phpcs on the generator sample |
| orm | 35 `*_test.php` (and helpers) outside PHPUnit; 9 in orm-php-extension; 16 in root `tests/` | S3 conventions |
| orm | orm-npm: 66 test files, 1 on node:test, chained by `typescript:test` and `sqlite-test.sh` | S3 conventions |
| orm | orm-rust: 6 `[[bin]]` test programs (51 files use `#[test]`) | S3 conventions |
| orm | one `transmute` (`planner.rs:1000`) | `unsafe_code` |
| orm | Python marked "planned" in all 18 features; events and DSN vectors not run; `codec_vector.py` and `dbspec_{cases,plans,ddl}.py` never run | parity |
| orm | python and php-extension missing in 11 suite units | parity |
| orm | npm `performance_gate` | parity |
| orm | root Go module | layout |
| orm | `PYTHONPATH=../ordered-json/…` in `config/parity.json` | layout / parity schema |
| ordered-json | 4 classes in `OrderedJson.php` (the functions and `MAX_DEPTH` keep `files`); no `license` | phpcs; `composer validate` |
| ordered-json | JS `check()` runner | S3 |
| ordered-json | strict duplicate keys missing in Go and php-ext | parity |
| ordered-json | Python `sys.path.insert` (3 of the 61 test files under `packages/` across repositories) | ruff |
| ordered-json | Python infrastructure scripts | layout (S9) |
| template | `AstPreparedExecution` in `AstProgram.php` | phpcs |
| template | Python's own JSON parser (`json_parse.py`; Go wraps `encoding/json`) | review; the conformance vectors decide whether ordered-json can replace it |
| template | object-calls tests only in php and python, while `docs/spec/runtime.md:189` covers TS, Go and Rust | parity |
| template | template-compiler has no tests of its own; browser test at the root | layout |
| template | `scripts/test-progress/node-reporter.mjs` and `vitest-reporter.mjs` unreferenced | knip |
| template | a nested `[tool.ruff]` in template-python | ruff config check |
| template | 6 `sys.path.insert` test files | ruff |
| crudui | `Polyspec\Crudui\` mapped by two packages | policy schema |
| crudui | `scripts/php-package-autoload.php` | phpstan |
| crudui | php-ext built with `cc`, no `config.m4` or PIE manifest | layout (required files) |
| crudui | generator-go `replace` and `validator-go v0.0.1` | gomoddirectives |
| crudui | `hiddenPaths` untested in Python and absent in Go, PHP, Rust and php-ext | parity |
| crudui | generator-python (4 test files) and generator-rust (1) against Go (15) and PHP (11) | parity |
| crudui | 7 Unicode generators | review → one generator with per-language backends |
| crudui | 4 CSS tests at the root | layout |
| crudui | stale `tests/ordered-json/check.py` | knip / layout (no binding) |
| crudui | 7 `sys.path.insert` test files | ruff |
| hyper | URL decoding and multipart parsing (JSON stays: spec) | review; the vectors decide replacement with `urllib.parse` / `email.parser` |
| hyper | `.npmrc`, `scripts/tsc.mjs` | toolchain check |
| hyper | hyper-build tests at the root | layout |
| hyper | server-node router test repeats hyper-client's | review |
| hyper | untracked `packages/hyper-php` leftover | reported to the owner (untracked, so no tool sees it) |
| hyper | server-node does not run `reads.json` | parity |
| hyper | Composer `^8.2` | toolchain check |
| fsm | concurrency tests only in npm. Retry tests exist only in rust, and the spec (`docs/spec/fsm.md:187`, S-31) places retry in Rust; parity decides whether the others need it | parity |
| fsm | fsm-go module path | layout |
| fsm | `polyspec_fsm` namespace | review |
| fsm | orm 0.0.7 pinned in an inline Composer `package` repository | toolchain / dependency policy |
| fsm | `PYTHONPATH` in `config/parity.json` | parity schema |
| ssr | adapter asymmetry (vue and svelte no invalid-input test; react and vanilla no empty-SSR hydration) | parity |
| ssr | `crates/` | layout |
| ssr | no kit | adoption |
| all | floors and pins differ | toolchain check |
| all | Rust crates outside a workspace; no `[workspace.lints]` | layout / lint |
| all | the rebuild rule missing in orm, template and ssr AGENTS.md | replaced by the vendored `PRINCIPLES.md` |

## 3. Green

- Each repository registers its red list in `docs/plans/execution-checklist.md` and turns it green one item per commit.
  Commits use `type(scope): Subject (#id)` with the true reason. An unrelated change gets its own commit.
- No compatibility layer, fallback or alias is kept. Old paths are removed.
- **orm PHP.**
  - Split the classes. Remove `classmap` and `tests/autoload.php`.
  - `src/Generator.php` writes PSR-4 class files and a separate function/registration file, as fsm's `backends/php.mjs`
    does.
  - Tests generate their models into a fixed, git-ignored directory under `tests/` that `autoload-dev` maps, then run
    `composer dump-autoload`. There is no runtime `ClassLoader` registration.
  - PHP tests move to PHPUnit.
- **Rust.** `unsafe_code = "deny"`. The `planner.rs` lifetime is threaded through `Scope<'a>`.
- **Replacing a hand parser.** It happens only where the owning spec's vectors stay green. hyper's JSON encoder stays,
  with its rebuild record pointing at `conformance/json.json`.
- **Parity.** Missing features and tests are implemented in their owning packages. Green parity is the judge.
- **Test moves.** Misplaced tests move to their owners. Duplicate consumer tests are deleted.
- **Versions.** As in the S4 table, with the test changes PHPUnit 13 needs.

## 4. Order of repositories and coordination

- **Folder moves go in dependency order, owners first.**
  1. ordered-json (`packages/go`, tags `packages/go/vX`, `goModules` in `config/release.json`).
  2. orm, after T128 lands. Its root Go module moves to `packages/go`; orm-gen's path changes while T128 rewrites the CLIs.
  3. fsm, template, hyper and crudui, which then update their dependencies.

  No consumer moves twice.
- **kit and orm main** belong to the "new" session.
  - kit: §1 starts after its principles document.
  - orm: T128-2a ("new") moves every orm-gen CLI to its ecosystem's argument parser (PHP `getopt`). My orm work follows
    T128-2a.
  - The new `packages/orm-dbspec-*` packages are created under S5 as `packages/dbspec/*`.
- **"unify-path-access-boundary"** moves hyper's dependency versions (S-285). It is told before hyper or template changes.
- **limepie** pins git `subdirectory` sources at old tags (`limepie/hyper/python/pyproject.toml:33-38`).
  - Old tags keep resolving.
  - kit's release rule says Python packages are not released as git tags, so limepie moves to the release wheel assets.
  - "python-server-uv-finish" is told.
- **crudui, fsm, ordered-json, ssr and template-benchmark** have no work in progress. Their kit moves (§1.8) are mine,
  announced before each starts.
- **Outside actions** need the owner's confirmation right before they happen: publishing to a registry, pushing tags.

## 5. Verification

- **Red record.** Each tool's fixture turns it red. After adoption, the §2 failures appear. Both go into the checklist.
- **Green.**
  - `make check` passes in every repository: lint, parity, layout, toolchain and all tests.
  - CI gives the same result on the pins.
- **Per-language checks.**

  | Target | Check |
  |---|---|
  | PHP | phpcs PSR-12 clean; phpstan clean; policy schema; `composer validate --strict`; PHPUnit |
  | Rust | `cargo clippy --workspace -- -D warnings` on 1.99 with `unsafe_code` |
  | Python | `uv sync` with no-build on 3.14; no `PYTHONPATH` |
  | TS | `tsc` 7 `--noEmit`; oxlint; API Extractor gate with `apiReport` |
  | Node | playwright on 26 |
  | Go | golangci-lint; `go get <module>@<tag>` in a clean GOPATH |
  | crudui php-ext | phpize and PIE install |
  | generator-svelte | its own lock; TS 6 isolation fixture |

- A failure is fixed at its cause. No standard is lowered. A wrong standard is reported and corrected.
