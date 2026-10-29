<!-- doc-id: table-kit-harness -->
# kit fact table, 2026-10-30

Scope: `kit/` at its current main tree, read only. No code changed, no make run. Paths are relative to the polyspec workspace folder that holds kit and the consumer repos.
Consumers: T=template, H=hyper, OJ=ordered-json, O=orm, S=ssr, C=crudui, F=fsm, FM=flowmark. Consumer lists are the full CHECK_TARGETS word lists, including `+=` lines (orm `+=` at Makefile:3077, 3079; hyper `+=` at Makefile:325).
"Kit target" means a target defined in `kit/Makefile` or `kit/scripts/kit/kit.mk` or `kit/scripts/kit/kit-bootstrap.mk`. Names that no kit file defines are repo-local and left out (see Notable).
Column (a) PRINCIPLES = rule IDs whose "Enforced by" line names the target (`kit/PRINCIPLES.md:N` = that line). AGENTS = `kit/AGENTS.md` rule start line, with the lines that name the target in parentheses.

## Table 1. Kit gate targets

### 1a. Kit-gates prerequisites (`kit/scripts/kit/kit.mk:203`, 22 targets)

| target | (a) PRINCIPLES | (a) AGENTS | (b) what the check judges | (c) judges versions, pins, lock contents or package installation state? | consumers' CHECK_TARGETS |
|---|---|---|---|---|---|
| kit-check | none | rule :34 (L35, L37); rule :45 (L59); rule :80 (L85); rule :130 (L131) | config/*.json against kit schemas (`kit-check.mts:102`); `.php-version` must exist when a Composer package or `php` in toolchain needs PHP (`kit-check.mts:85-86`); recipes that start tools by bare name or run test runners unsafely (`kit-check.mts:19`, `:149`); scripts/kit files that kit.copies does not declare (`kit-check.mts:130`). Copy contents are not compared (`kit-check.mts:5-6`) | T H OJ O S C F FM |
| toolchain-check | S4 (`:198`) | rule :69 (L73, L79); rule :80 (L89, L92, L93) | each declared tool's version command runs from the checkout's shim; absent or unstartable tool, or unparsable output, is a finding with its fix (`check-toolchain.mts:148-151`) | yes: tool installation state (`check-toolchain.mts:150-151`). Version output is parsed (`:58`, `:64`) but "never compared" (`:148`, `:203`). Also judges the uv lock sidecar tracked by Git (`check-toolchain.mts` header `:9-12`) | T H OJ O S C F FM |
| layout-check | S5 (`:206`), S7 (`:218`), S9 (`:225`) | none | runs `alint check --config config/layout.yml` on the checkout (`kit.mk:121-122`); the target description also names Git-ignore (K372) and no-tracked-generated (K426) (`kit.mk:120`), which the recipe does not run itself | no: recipe runs alint only (`kit.mk:121-122`); judgement lives in the config | T H OJ O S C F FM |
| docs-check | P1 (`:15`), P24 (`:121`), P25 (`:126`), P26 (`:129`) | rule :21 (L24) | `check-documents.mts`: anchors, fences, relative links, private home paths, `{{` outside code, checklist validity and kit item IDs (`check-documents.mts:1-14`); also runs DOCS_CHECKS (`kit.mk:289-290`) | no (anchors, links, checklists; no package or version data) | T H OJ O S C F FM |
| rules-check | P3 (`:22`) | none | every rule of PRINCIPLES and AGENTS has an Enforced-by check that CI, a Git hook or the Claude hook reaches (`check-rules.mts:1-12`) | no | T H OJ O S C F FM |
| owner-validate | none | none | `config/owner-checks.json` owns every tracked path, each named target exists and does not run the full suite (`owner-check.mts:1-20`, `kit.mk:332-333`) | no | T H OJ O S C F FM |
| rebuild-check | P14 (`:66`), P34 (`:162`), S1 (`:186`), S8 (`:221`) | rule :40 (L44) | each tool source is classed ecosystem / replaced / record / policy in `config/rebuild.json` (`rebuild-check.mts:1-14`) | no | T H OJ O S C F FM |
| language-check | P11 (`:55`) | none | Hangul in comments, identifiers, error/log messages, test names of code (`language-check.mts:1-6`) | no | T H OJ O S C F FM |
| test-markers-check | P6 (`:35`), P32 (`:156`) | none | skip/only markers in tests: `test.skip`, `it.only`, `t.Skip`, `unittest.skip`, `#[ignore]` (`test-markers.mts:1-6`) | no | T H OJ O S C F FM |
| duplication-check | P15 (`:68`), P34 (`:162`) | rule :60 (L61, L62) | jscpd: 6+ duplicated lines outside `config/duplication.json` folders (`duplication-check.mts:1-5`) | no | T H OJ O S C F FM |
| parity-declarations-check | P32 (`:156`), P33 (`:159`), S3 (`:196`), S6 (`:215`), S7 (`:218`) | rule :94 (L95, L97) | `config/parity.json` declarations, without any binding or extractor run (`parity.mts:9-11`, `kit.mk:549-550`) | no | T H OJ O S C F FM |
| parity-check | P32 (`:156`), S6 (`:215`) | rule :94 (L95) | every parity binding and every rule (`parity.mts:9-14`, `kit.mk:516-517`) | yes: runs symbol extractors that read the installed Python distribution RECORD (`parity-symbols.mts:4`, `:75`); TS runner needs installed vitest (`parity-runners.mts:270`); PHP runner needs installed phpunit (`parity-runners.mts:305`) | H OJ O S C F FM (not T) |
| bypass-check | P31 (`:150`) | none | tests/scripts/Makefiles that set CI identity, `make -o` a kit-gates target, or `--no-verify` (`bypass-check.mts:1-10`) | no | T H OJ O S C F FM |
| suppression-check | P8 (`:41`) | none | lint suppressions without a reason in each tool's form (`suppression-check.mts:1-12`) | no | T H OJ O S C F FM |
| divergence-check | P32 (`:156`) | none | implementation branches on runtime/platform, narrowed runs, partial features, reasonless exceptions (`divergence-check.mts:1-12`) | no. PHP_VERSION and process.versions appear as branch triggers, not version pins (`divergence-check.mts:34`) | T H OJ O S C F FM |
| lint-ts | P8 (`:41`), P13 (`:64`) | none (rule :25 names it in text, L29) | oxlint type-aware, knip, API Extractor on the checkout (`lint-ts.mts:1-12`) | yes: installation state. Needs package-lock.json and the installed kit package (`lint-ts.mts:130`, `:151`, `:156`). Lock contents not compared | T H OJ O S C F FM |
| lint-php | P8 (`:41`), S2 (`:190`) | none | phpcs PSR-12, PHPStan S2 rules, autoload file contents (`lint-php.mts:1-18`) | yes: installation state. Fails when the php-parser autoloader is missing (`lint-php.mts:44-47`); PHPStan needs each package's Composer autoloader (`lint-php.mts` header `:9-14`) | T H OJ O C F FM (not S) |
| lint-python | P8 (`:41`), P13 (`:64`) | none | `ruff check` and `ruff format --check` on root; vulture per package (`lint-python.mts:1-14`) | yes: tool installation state. Throws without ruff and vulture installed from mise.toml (`lint-python.mts:25`) | T H OJ O C F (not S, FM) |
| lint-go | P8 (`:41`), P13 (`:64`) | none | golangci-lint with kit config, per build tag, and deadcode (`lint-go.mts:1-12`) | yes, go.mod content: kit config forbids `replace` and `toolchain` lines (`lint-go.mts:5`). No lock check | T OJ O C F FM (not H, S) |
| lint-rust | P8 (`:41`) | none | `cargo clippy --workspace --all-targets --locked -D warnings` per workspace (`lint-rust.mts:2`, `:47`) | no: passes cargo's own --locked flag; kit reads no lock | T OJ O S C F (not H, FM) |
| lint-php-ext | S10 (`:241`) | none | names, the one stub, and the stub hash of the arginfo header (`php-extension.mts:115-119`) | no. The stub hash is a sha1 of content (`php-extension.mts:46`); no version or lock judged | T OJ O C F (not H, S, FM) |
| test-php-ext | S10 (`:241`) | none | Reflection comparison of the built extension with the PHP library, then PHPUnit with the extension loaded (`php-extension.mts:10-13`, `kit.mk:177-178`) | no. Requires the built extension first (`kit.mk:177`) | T OJ O C F (not H, S, FM) |

### 1b. Kit targets in consumer CHECK_TARGETS that kit-gates does not run (13 targets)

| target | (a) PRINCIPLES | (a) AGENTS | (b) what the check judges | (c) judges versions, pins, lock contents or package installation state? | consumers' CHECK_TARGETS |
|---|---|---|---|---|---|
| cargo-downloads-check | none | none | runs `cargo fetch --locked --offline` for each Cargo.lock; fails when crates are missing from CARGO_HOME (`check-cargo-downloads.mts:1-8`, `:27-28`; `kit.mk:84-85`) | yes: lock contents (`--locked`) and package installation state (crates in the registry) | OJ |
| hooks-check | none (P34 names `.githooks/pre-commit` at `:162`, not the target) | none | core.hooksPath is `.githooks`; hooks of `config/checklist.json` are installed, executable and unchanged (`git-hooks.mts:1-12`; `kit.mk:143-144`) | no for packages. It checks Git hook files, not packages | T H OJ S F |
| link-check | none | none | lists installed package folders that a provider gives and that are copies or link elsewhere; a Go require pinned not 0.0.x is reported (`link.mts:362`; `kit.mk:436-437`) | yes: installation state (folder is a link); version judged for Go requires only (`link.mts:137`, `:362`); reads the uv lock's locked releases (`link.mts:246-253`) | C |
| link-state-check | none in Enforced-by. Named in prose only: P30 (`:147`), S11 (`:245`) | none | installed polyspec folders are links, not copies; a tracked lock does not record a provided package as path or link (`link-state-check.mts:154-169`); workspace/go.work state | yes: lock contents (`link-state-check.mts:154-169`) and installation state (`link-state-check.mts:1-14`). Header `:4` says no version is compared; header `:6-7` says npm/Composer pinned 0.0.x is judged, but the file has no 0.0.x test | T H OJ O S C F FM |
| parity-api-check | none | none | public symbol extractors and static parity rules, no native bindings (`parity.mts:13`; `kit.mk:541-542`) | yes: runs symbol extractors, the Python one reads installed RECORD (`parity-symbols.mts:4`, `:75`) | T |
| release-coverage | none | none | every package file of the checkout is classified in `config/release.json` (`release.mts:629-650`; `kit.mk:400-401`) | no | OJ O |
| test-go | none | none | unit tests of each Go package via `go test -run` with the name filter (`runtime-targets.mts:109`) | no. A missing tool fails through the run itself | T OJ FM |
| test-infrastructure | none | none | every tracked root Node infrastructure test, by platform (`runtime-targets.mts:180-185`, `:307`; `kit.mk:190-191`) | no | FM |
| test-js | none | none | unit tests of JS packages via node --test or vitest (`runtime-targets.mts:107`) | no | OJ |
| test-php | none | none | unit tests of PHP packages via phpunit (`runtime-targets.mts:113`) | no | T OJ |
| test-python | none | none | unit tests of Python packages via unittest; each test folder must be a package (`runtime-targets.mts:66-77`) | no | T OJ |
| test-rust | none | none | unit tests of Rust packages via cargo test (`runtime-targets.mts:111`) | no | T OJ |
| test-ts | none | none | unit tests of TS packages via node --test or vitest (`runtime-targets.mts:107`) | no | T |

### 1c. Generated parity binding targets (`kit/scripts/kit/kit.mk:533`, `:539-547`; names from `parity.mts --make-targets`)

| target | (a) PRINCIPLES | (a) AGENTS | (b) what the check judges | (c) judges versions, pins, lock contents or package installation state? | consumers' CHECK_TARGETS |
|---|---|---|---|---|---|
| parity-bindings-go-check | none | none | native binding run for the Go implementation (`parity.mts:14`) | not checked: no install-state finding found in the Go runner by grep | T |
| parity-bindings-php-check | none | none | native binding run for the PHP implementation (`parity.mts:14`) | yes: installation state, phpunit must exist (`parity-runners.mts:305`) | T |
| parity-bindings-php-ext-check | none | none | native binding run for the PHP extension implementation (`parity.mts:14`) | yes if it runs PHPUnit as the PHP binding does (`parity-runners.mts:305`); not separately verified | T |
| parity-bindings-python-check | none | none | native binding run for the Python implementation (`parity.mts:14`) | not checked: no install-state finding found in the Python runner by grep | T |
| parity-bindings-rust-check | none | none | native binding run for the Rust implementation (`parity.mts:14`) | not checked: no install-state finding found in the Rust runner by grep | T |
| parity-bindings-ts-check | none | none | native binding run for the TS implementation (`parity.mts:14`) | yes: installation state, vitest must exist (`parity-runners.mts:270`) | T |

Table 1 notes:
- `typecheck` is listed in T, H and OJ CHECK_TARGETS but is not a kit.mk target. Its only definition is `kit/Makefile:132` (kit's own repo). It is repo-local in consumers and is left out.
- Consumer-listed names defined nowhere in kit (repo-local): e.g. `link-metadata-check`, `verify-all`, `release-config-check`, `pie-check`, `evidence-check` (OJ `Makefile:109-128`), `docs-static-check`, `virtiofs-check` (H `Makefile:323`), and all `*-helper-check`, `feature-*`, `dbspec-*` names in O.

## Table 2. PRINCIPLES.md rules

Applicability is taken from the rule text. "Every repo" means the rule carries no runtime, feature or repo-type qualifier.

| rule | gist | Enforced by (`kit/PRINCIPLES.md`) | applies to |
|---|---|---|---|
| P1 | Responsibility for code, tests, docs, AGENTS, memory | `make docs-check` (:15) | every repo |
| P2 | Rules followed because right; oddities reported | none (:19) | every repo |
| P3 | Rules first; behaviour without a rule is a defect | `make rules-check` (:22) | every repo |
| P4 | Settled rulings written into spec | none (:25) | every repo |
| P5 | Wrong change judged by harm and correctness | none; commit-msg hook noted (:29) | every repo |
| P6 | Standard never lowered to pass | `make test-markers-check` (:35) | every repo |
| P7 | No tricks | `.claude/settings.json` (:38) | every repo |
| P8 | Errors never hidden; no silent fallback | `make lint-ts`, `lint-python`, `lint-go`, `lint-php`, `lint-rust`, `suppression-check` (:41) | every repo |
| P9 | Correct first; fast only when correct | none (:43) | every repo |
| P10 | Work reaches main via own worktree and `make land` | none (:52) | every repo |
| P11 | English code, identifiers, logs, messages, test names, commits; bilingual docs | `make language-check` for code (:55) | every repo |
| P12 | No backward compatibility before a release says so | none (:61) | every repo |
| P13 | Simplest implementation; no speculative abstraction | `make lint-ts`, `lint-python`, `lint-go` (:64) | every repo |
| P14 | Outside ecosystem tools used, never redeveloped | `make rebuild-check` (:66) | every repo |
| P15 | Components modular, concerns separated | `make duplication-check` (:68) | every repo |
| P16 | Long-term architecture; no stopgap | none (:71) | every repo |
| P17 | Idempotent apply; event-published changes; declarative paths; multi-platform | `.claude/settings.json` (:74) | every repo |
| P18 | No polling loops | `.claude/settings.json` (:78) | every repo |
| P19 | Defect starts as a failing test; stale text via `text-absent` | `.githooks/commit-msg` (Red line) (:86) | every repo |
| P20 | Items completed by own unit tests; full suite only by the conductor | `.claude/settings.json` (:90) | every repo |
| P21 | Hard judgements verified adversarially | none (:95) | every repo |
| P22 | Agent handoffs carry full context; Haiku 5.5 subagents | none (:102) | every repo that hands work to agents |
| P23 | Questions asked only when needed | none (:109) | every repo |
| P24 | Plan folder with plan.md and checklist.md | `make docs-check` (:121) | every repo that keeps plans (repo-level, not runtime) |
| P25 | Item states and allowed transitions | `make docs-check` (:126) | every repo with checklists |
| P26 | Open items name their own unit-test commands; no suite | `make docs-check`, `.claude/settings.json` (:129) | every repo with checklists |
| P27 | One item per commit | none; commit-msg hook is a guided rule (:132) | every repo |
| P28 | Commit message format; no AI footer; human author | `.githooks/commit-msg` for footer and identity (:137) | every repo |
| P29 | Fixed make target names per task and runtime | none; names are the repo's own (K810) (:141) | repos with packages of runtimes (text: "for each runtime of packages/") |
| P30 | 0.0.x: applications connect provider sources through native links; no disguised versions | none; `make link-state-check` named in text (:147) | applications consuming polyspec providers during 0.0.x development |
| P31 | No gate bypassed (CI identity, `make -o`, `--no-verify`) | `make bypass-check` (:150) | every repo |
| P32 | Shared contract behaviour in every implementation; scope rules | `make parity-declarations-check`, `parity-check`, `divergence-check`, `test-markers-check` (:156) | repos with several implementations of one contract (AGENTS.md:94-95 names config/parity.json) |
| P33 | Rules the work needs are written in docs/spec first | `make parity-declarations-check` (:159) | repos with docs/spec requirements |
| P34 | Repeated code restructured; generated output not tracked | `make duplication-check`, `make rebuild-check`, `.githooks/pre-commit` (:162) | every repo |
| P35 | Local source development does not wait for provider release | none (:166) | repos consuming provider packages |
| P36 | Found defect registered and worked now | none (:168) | every repo |
| P37 | Result reported only after its check ran | none (:171) | every repo |
| P38 | main written directly by one actor per checkout; branches reach main via `make land` | none (:174) | every repo |
| S1 | No rebuilds of ecosystem tools; rebuild records | `make rebuild-check` (:186) | every repo |
| S2 | PHP: one class per file, PSR-4, no classmap, PHPUnit | `make lint-php` (:190) | PHP repos only (text is PHP-specific) |
| S3 | Tests only on the standard runner; installed packages, no own harness | `make parity-declarations-check` (:196) | every repo with tests (runner list is fixed by kit) |
| S4 | Versions: kit enforces no version or pin | `make toolchain-check` (:198) | every repo |
| S5 | Same root folders in every monorepo | `make layout-check` (:206) | every monorepo |
| S6 | Language parity: same units and vectors in every implementation | `make parity-declarations-check`, `make parity-check` (:215) | repos with several implementations |
| S7 | Test placement: basic-feature tests live with the owning package | `make layout-check`, `make parity-declarations-check` (:218) | every repo with packages or tests |
| S8 | Every exception, profile and rebuild record carries its reason | `make rebuild-check` (:221) | every repo with exceptions |
| S9 | Cross-language orchestration and kit written in TypeScript, checked by tsc | `make layout-check` (:225) | repos with cross-language orchestration or checks (kit included) |
| S10 | PHP extension implements every PHP library of the repo, same names and signatures | `make lint-php-ext`, `make test-php-ext` (:241) | repos with a PHP library and packages/php-ext |
| S11 | Local links in development; no package-manager link step | none; `make link-state-check` named in text (:245) | repos in development that link polyspec packages |

## Notable

1. Version or pin judgements in kit, by evidence: `toolchain-check` parses versions but does not compare them (`check-toolchain.mts:148`, `:203`). `lint-go` forbids `replace` and `toolchain` lines in go.mod (`lint-go.mts:5`). `link` applies the 0.0.x pin rule to Go requires only (`link.mts:137`, `:362`). `kit-check` requires `.php-version` to exist (`kit-check.mts:85-86`).
2. Lock-content judgements in kit: `cargo-downloads-check` uses `--locked` (`lint-rust.mts:2`, `:47`; `check-cargo-downloads.mts:1-8`). `link-state-check` judges lock entries that record links or paths (`link-state-check.mts:154-169`). `link` reads the uv lock (`link.mts:246-253`).
3. `link-state-check` header conflicts with its code. Header `:4` says no version is compared. Header `:6-7` says npm and Composer 0.0.x pins are judged, but the file holds no 0.0.x test, so the npm/Composer pin claim is not in the code.
4. `layout-check` description (`kit.mk:120`) names Git-ignore (K372) and no-tracked-generated (K426) checks. The recipe runs only `alint check --config config/layout.yml` (`kit.mk:121-122`).
5. `kit-check` header says copy-matching is npm's and kit-sync's business, not a check (`kit-check.mts:5-6`). `kit-check` checks only for stray files in scripts/kit that kit.copies does not declare (`kit-check.mts:130`); it does not compare copy contents.
6. Targets with no PRINCIPLES Enforced-by naming them (none): kit-check, owner-validate, release-coverage, link-check, link-state-check (prose only), hooks-check, cargo-downloads-check, parity-api-check, all test-* and parity-bindings-*. PRINCIPLES Enforced-by lines also name non-kit items (`.claude/settings.json`, `.githooks/commit-msg`, `.githooks/pre-commit`).
7. Repo-scoped PRINCIPLES rules by text: S2 (PHP), S10 (php-ext), S6 and P32 (several implementations), S11 and P30 and P35 (0.0.x development and provider consumers), S5 (monorepo), S9 (cross-language orchestration).
8. Kit-gates prerequisites missing from one or more consumers: `parity-check` is absent from T. `lint-python` is absent from S and FM. `lint-go` is absent from H and S. `lint-rust` is absent from H and FM. `lint-php` is absent from S. `lint-php-ext` and `test-php-ext` are absent from H, S and FM.
9. Kit-only targets run by consumers and not by kit-gates (Table 1b): cargo-downloads-check, hooks-check, link-check, link-state-check, parity-api-check, release-coverage, test-go, test-infrastructure, test-js, test-php, test-python, test-rust, test-ts. Plus the six generated parity-bindings-*-check (T only).
