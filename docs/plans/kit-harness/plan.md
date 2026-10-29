<!-- doc-id: plan-kit-harness -->
# Kit as common rules and a harness

[한국어](plan.ko.md)

## Goal
- Kit is a harness, not a shackle. It injects the rules common to every repo. Each repo states and keeps its own rules.
- A harness is required, or repos diverge. Kit does not hold every rule, or kit would change with every repo change.
- Each repo holds a self-complete document. That is why PRINCIPLES is copied into each repo.
- A restriction that enforces a rule is a harness. Needless interference is a shackle, and so is doing a package manager's job.
- Kit is not a package manager.
- At release the package manager installs the stated version. Development is the same, except that the stated version is assumed installed and its install folder is symlinked to the development folder (2026-10-30).
- A symlinked development folder is never damaged.

## Criterion
- **A common rule, injected by kit:** the same rule for every repo. A conditional rule counts too ("a repo with PHP uses PSR-4", "a repo with several implementations keeps parity"), because every repo that meets the condition must keep it identically. The condition names a runtime or a repo shape that several repos share, not one repo's domain. Moving it into each repo would copy it and let it diverge. It lives in `PRINCIPLES.md`, kit copies it into each repo, and kit provides its check and runs it in every repo through `kit-gates`.
- **A repo's own rule:** a rule about that repo's domain. It lives in that repo's `AGENTS.md` as an `Own:` rule (`scripts/kit/check-rules.mts:139,141`). The repo implements its target and lists it in its `CHECK_TARGETS` and CI. Kit never changes for it. `make rules-check` proves that CI or a hook reaches the target.
- **A harness piece:** kit code that makes the two layers work. It must be named by a written rule.
- **A shackle:** kit code that no rule needs, or that does a package manager's job. It is deleted.

## Facts (table.md has the evidence)
- Every PRINCIPLES rule (P1–P38, S1–S11) is a common rule under the criterion, either unconditional or conditional (table.md, Table 2). So no rule moves out of PRINCIPLES.
- The two layers and their wiring already exist:
  - `kit-gates` (`scripts/kit/kit.mk:203`) is the explicit list of common checks.
  - Its CI partitions (`kit.mk:209-216`, `workflows/gates.yml`) run it in every repo.
  - `land.mts:123-125`, `bypass-check.mts:47` and `tests/kit/gates-workflow.test.mts:42` read that list, and it holds only kit targets.
  - Repo rules live in each `AGENTS.md`, with 9 to 62 `Enforced by` lines per repo.
- Injection is unenforced. `PRINCIPLES.md:6-7` and `AGENTS.md:35-37` say a changed copy fails, but `kit-check.mts:4-5` (K799) does not compare copies. kit-sync rewrites the copies from the installed package idempotently (`kit-sync.mts:2-9`).
- Kit does package-manager work in these places:
  - **worktree-setup.** `worktree-setup.mts:36-160` runs npm, Composer and uv installs itself. `worktree-setup.mts:258-265` then builds with kit's `link rebuild` instead of the repo's make, so a repo's generation prerequisites are skipped (`fsm/Makefile:462-468`, as reported by the fsm session).
  - **The worktree refusals.** `kit-bootstrap.mk:46-48` and `kit.mk:100-102` refuse `make install` in a worktree.
  - **link.** `link.mts:137,362` applies a Go 0.0.x pin rule, and `link.mts:246-253` (K401-1) reads the uv lock to pick releases to reinstall.
  - **link-state-check.** `link-state-check.mts:149-170` judges which locks record links or paths. Under the owner's model, a dev link is a symlink over the install folder, and it leaves the lock unchanged. This was measured for composer and uv. So there is nothing for this check to judge.
  - **toolchain-check.** It judges four things (`check-toolchain.mts:148-151,204-206`):
    - that tools are present and start, which is mise's install result
    - `.npmrc` keys
    - the K192 uv sidecar, which is kit's own `AGENTS.md:73-79` rule
    - the php-parser pin (`arginfoToolFindings`)
  - **install-php-arginfo.** `install-php-arginfo.mts:40-47` matches the arginfo output and compares the php-parser pin.
  - **kit-check.** `kit-check.mts:46-57` requires `.php-version` (K193). No PRINCIPLES rule names this.
  - **lint-go.** `lint-go.mts:5-6` bans go.mod `replace` and `toolchain`.
  - **cargo-downloads-check.** `check-cargo-downloads.mts:1-8` judges crate presence. ordered-json uses it.
- `catch-check` is live (`lint-ts.mts:181`, `lint-rust.mts:37-47`). `check-editor-boundaries` is live too, but only template uses it: template's `editor-boundary-check` runs it (`template/Makefile:514-515`), and `orm/docs/spec/editor-stack.md` mentions it.
- `lint-rust --locked` passes cargo's own flag. Cargo judges, kit does not, so this is not package-manager work.
- `release-run.mts:46,54-56` checks the release tool's arguments (version format, SHA, run id). That is input validation, not interference.
- `worktree-setup` creates or reuses a worktree (`kit.mk:440`, `worktree-setup.mts:5`).

## Decision
Kit is not a package manager. Kit does none of the following:
- installs, updates, removes, pins or resolves packages;
- compares versions, pins or lock contents;
- checks installed files against a package;
- refuses, replaces or wraps a package-manager install, except where the owner's rule requires it: a symlinked development folder is never damaged;
- builds in place of the repo's own make.

Kit may call a package manager or tool as a thin recipe (`mise install --locked`, `mise lock`, rustup, `cargo fetch`, and the guarded `make uv-install`) and pass its own flags (cargo `--locked`). In that case the tool judges and kit reads no result. One model, in the owner's words: development symlinks the install folder to the dev folder and downloads nothing; release lets the package manager fetch the stated version itself. Kit downloads no package.

1. **Keep, as the common harness.**
   - PRINCIPLES and its copy
   - `kit-gates` as an explicit list, and the CI partitions
   - the gates.yml and release.yml copies
   - `rules-check`, `catch-check` and `owner-validate`
   - kit-sync
   - `link` (link, check) and `install-link`
   - `link-check`, which judges folder identity only, after the deletions in item 6: it checks whether each install folder is a symlink to the dev folder as the link declaration says (item 8). P30 and S11 change their Enforced by to `make link-check`, and their bodies (`PRINCIPLES.md:147`, `:245`, with the Korean twin) name `link-check` in the same row. It reads no file content and no version. `link-state-check` is merged into it and deleted, because its remaining folder checks overlap.
   - `worktree-link-state`, which calls `link-check` instead of `link-state-check` (`kit.mk:444`, `worktree-setup.mts:258`)
   - the format validation of the `release-run` arguments
   - `lint-rust --locked`. table.md's lint-rust row (c) is corrected to read "passes cargo's flag; kit reads no lock".
   - `bootstrap/tool-wrappers.mts`

   The coordinator earlier ruled to delete the partitions and the gates.yml copy (class F). That ruling is reversed: without them, every repo rebuilds its own CI harness, and the repos diverge.
2. **Never damage a symlinked dev folder.** This is a common rule, in the owner's words, and a new PRINCIPLES rule states it.
   - Its harness is the K539 guard. Measured: uv uninstall, remove and `sync --no-install-package` delete through the link. npm ci replaces the link but leaves the dev folder intact. composer install keeps the link. So only uv calls are guarded.
   - `unlink` is reduced to `releaseLinks` (`link.mts:232-234`). It only removes links. It is not made a prerequisite of `install`: on a fresh checkout node does not exist yet (`kit.mk:55-61`), and `uv-install.mts:41` already releases links before every uv write.
   - Repo recipes call uv through `make uv-install`, the guarded entry point (`uv-install.mts:41`). Today SYNC allows only `--no-install-project` and `--all-groups` (`uv-install.mts:10,78-79`), and it splits SYNC on whitespace and tests each token (`:76-78`), so the value of `--group test` or `--project packages/python` is refused. `--locked` is already passed internally. The row parses SYNC as flag/value pairs and adds the flags consumers use: `--no-editable`, `--group <name>`, `--all-packages`, `--project <dir>`, `--quiet`. `kit.mk:466` help follows.
   - Red tests: `make uv-install` with the exact SYNC strings of crudui `Makefile:173`, orm `Makefile:751` and hyper `Makefile:116`, run after `install-link`, leaves the dev folder byte-identical. A check fails when a repo recipe contains a raw `uv sync`.
   - The rule's Enforced by names `tests/kit/uv-install.test.mts` and `tests/source/uv-link-real.test.mts`.
3. **Injection.**
   - `make kit-inject-check` runs `make kit-sync`. It then fails if `git status --porcelain --untracked-files=all` on the copy paths prints anything. Red: on the current tree no `kit-inject-check` exists, so a hand-edited copy in a fixture consumer goes undetected; the new target must fail on it. Green: it fails the target, and the same tree passes after `make kit-sync`.
   - It joins consumers' gates only. A `$(if …)` guard in `kit.mk` skips kit's own checkout, because kit-sync refuses it (`kit-check.mts:122-124`).
   - It runs `make kit-sync`, which writes the copies (PRINCIPLES, gates.yml, release.yml) of the installed kit package under `node_modules`, and then fails on whatever git reports for the copy paths. It reads no version and no lock. It is the harness of the injection rule.
   - A new PRINCIPLES rule item, with its Korean twin, says: "common rules are injected identically; Enforced by: `make kit-inject-check`". `PRINCIPLES.md:6-7` is preamble and cannot carry the line. `AGENTS.md:35-37` is retargeted to the new target.
4. **Idempotency (P17).** Running `make install` twice on one tree must change no file. `bootstrap/verify-idempotent.mts` compares mtime and inode (`:12-22`), so a relink always reports a change. The proof is a test under `tests/kit`, not kit code: it runs `make install` twice on a fixture and compares the contents of `var/tools` and the install folders. Red: a fixture where the second install rewrites a file in `var/tools` fails the test on the current tree. Green: the fix makes the test pass. Locks are left out, because their content is the package manager's. P17's Enforced by names the test.
5. **Name each harness piece in a rule.**
   - Every kept piece is named in a rule. Red: a kept piece named by no rule fails a new assertion in `gates-workflow.test.mts` that lists each kept piece by name, not only the `kit-gates` prerequisites of Order step 3. Green: it passes with each piece named. `owner-validate`, `install-link`, `catch-check` (under P8), the release-run argument check, `bootstrap/tool-wrappers.mts`, `worktree-link-state` and `uv-install` each get a kit AGENTS rule or an Enforced-by entry. The `gates-workflow.test.mts` assertion lands in the same row as the owner-validate rule.
   - The `.php-version` requirement stays under `AGENTS.md:93` (K283). install-php reads that file as the declared PHP.
   - S4 is reworded: "kit compares and pins no version or lock; format validation of arguments is allowed". Its enforcement is `Enforced by: none`, with the reason.
6. **Delete the shackles.** Each item is its own row. Each row names its red test (the deleted behaviour, shown present) and its green (the row's test, with the item removed, passing).
   - **Version, pin and lock judging.** This is in progress as kit rows, on the owner's direct ruling:
     - toolchain-pins and toolchain-exceptions
     - toolchain-lock becomes native mise calls in the make recipe, with no script, and kit reads no result. The calls, their order, the PATH, uv's Python and the platforms are settled by kit row K836 from its measured red cases (uv resolving with its own Python or the machine uv).
     - toolchain-mise's lock, pin, exact-release and K192 sidecar checks
     - toolchain-lint's lock form
     - install-php-arginfo's pin compare and output match (`:40-47`)
     - link-state-check's lock judgement (`:149-170`)
     - toolchain-mise's refusal of mise.toml keys kit does not know (`toolchain-mise.mts:100`); mise judges its own config. The `MISE_TOOLS` table stays, because it is the tool list of install-tools, install-symbols, recipe-tools, toolchain-lock and ci-setup
     - the Rust channel format check (`toolchain-files.mts:85`); rustup judges the channel

     The Rust channel is read as a plain declared value from rust-toolchain.toml. `declaredRust` returns the raw string with no format check (`toolchain-files.mts:85` deleted). `check-toolchain.mts:23` is removed with toolchain-check. `install-tools.mts:31` passes the raw string to rustup, and `ci-setup.mts:15` emits it as the CI value (`ci-setup.mts:94`) with no format check. Red: `channel = "nightly"` fails in kit today. Green: it reaches rustup without a kit error.
   - **`toolchain-check` as a whole.** It checks that tools run from the checkout, which is an installed-state check. A missing tool fails the repo's make anyway. The bare-name rule is already kit-check's (`kit-check.mts:1-8`).
     - Its tool list is `MISE_TOOLS` in `toolchain-mise.mts` already; no row moves it.
     - Kit's own CI, gates, tests and rules drop it in the same row. This covers S4, kit AGENTS.md:73-79 and :89-93 (each gets a new Enforced by, or `none` with its reason, as check-rules.mts:271-274 requires), `config/owner-checks.json:45`, and kit CI's `install-tools TOOLS=…` calls (`ci.yml:177-200,241-262`), which move to explicit thin targets.
     - The `.npmrc` key check (`npmrcFindings`) goes with it, and `docs/operations/tool-inventory.md:148` is rewritten in the same row.
     - The coordinator kept it in round 4 and deletes it now. The round-4 reason was the breakage, and the kept tool list (`MISE_TOOLS`) and the consumer step remove that breakage.
   - **Python public symbols read from the installed distribution.** This is the RECORD read at `parity-symbols.mts:4,75-80`. It is replaced by a read of the source package.
   - **link's own package-manager work.**
     - the Go pin rule (`link.mts:137,362`)
     - the reinstall in `unlink`: `:533`, `:542`, `:561`, `:569`, and `pylockReleases` (`:246-253`)
     - `cargo update --offline` (`:663`)
     - `link rebuild`
   - **worktree-setup's installs and builds.**
     - `prepareWorktreeNpm`, `prepareWorktreeComposer`, `prepareWorktreePython` and `prepareWorktreeGo` (`:36-229`)
     - its `link rebuild` step (`:258-265`)

     worktree-setup still creates the worktree under the naming rule (`PRINCIPLES.md:45`) and runs `make install` there. It links no release assets (K865 deletes `linkReleaseAssets`).
   - **The worktree `make install` refusals** (`kit-bootstrap.mk:46-48`, `kit.mk:99-102`).
     - `KIT_TOOLS` becomes the checkout's own `$(CURDIR)/var/tools` (`kit.mk:19`). Today it is main's. A worktree's `make install` is online and installs its own tools, per the owner's ruling, and the `kit.mk:440` help follows.
     - The K519 comments and `docs/operations/local-links.md:64` follow.
     - Red test: main's `var/tools` and locks are unchanged after a worktree's `make install`.
   - **Kit's own install wrappers.**
     - `npm-install`, with its unused `ADD` (K485): no consumer passes it.
     - `composer-install` and `cargo-fetch`
     - their `.mts` scripts and tests

     Today `ci-setup.mts` emits `composer-install` (`:214`) and `uv-install` (`:219`). It then emits `make deps-<runtime>` (`deps-php`, `deps-python`, `deps-node`, `deps-rust`, `deps-go`), and each repo defines those targets in its own Makefile as thin package-manager calls. So each partition job installs only its own tools (`kit.mk:207-208`). The rest of ci-setup (410 lines) gets its own row, judged item by item against the criterion.
   - **install-tools' own installs** (`install-tools.mts:90-110`). Composer, Rust, symbol and arginfo installs move behind the repo's `make install` prerequisites, as thin calls. `mise install --locked` stays.
   - **`install-php`'s discovery across PATH, apt and Homebrew.** It requires `php` of the declared minor on PATH and fails otherwise. The wrappers stay.
   - **`bootstrap/install-mise.mts`.** It becomes mise's official installer, unless a red case shows the official installer cannot do the job.
   - **The check mode of `cargo-downloads-check`**, which checks crate presence. `cargo-downloads-fetch` (`check-cargo-downloads.mts:5-8,16`, `kit.mk:82-86`) stays as a thin `cargo fetch`, because kit CI uses it (`ci.yml:45,203,268`).
   - **Kit's own downloading of packages:** `release-assets-fetch`, `var/products`, the Composer `artifact` repositories it fills, and worktree-setup's `linkReleaseAssets` (K622/K780, `kit.mk:411-414`). Development symlinks. For a release, Composer fetches from a `composer`-type repository: each release publishes a `packages.json` asset, generated from the package's own composer.json plus the zip URL and sha1, and the consumer's composer.json points at `https://github.com/polyspec/<repo>/releases/download/<tag>/packages.json`. Composer uses a URL whose path contains `.json` verbatim (Composer 2.10.3, `getPackagesJsonUrl`). Composer reads the package metadata itself, so the consumer restates only the tag in that URL, not the metadata (a `package` repository restates it; see `hyper/tests/scripts/template-pins.test.mts:82-84`). hyper ships only the `composer`-type repository, and only after template publishes `packages.json`; no interim `package` repository is released.
   - **Hyper's own build of the template PHP extension** (`hyper/scripts/build-template-ext.mts`: phpize, configure, make, stamp). It redevelops what PIE does (P14). PIE installs it from the Composer source above (`template/packages/php-ext/composer.json` is already `type: php-ext`), as ordered-json already does (`ordered-json/Makefile:92-93`). In development the extension source is linked through the link declaration. Whether PIE builds from a local folder is verified first; if it cannot, development links the source folder.
   - **The go.mod `replace`/`toolchain` ban** (`lint-go.mts:5-6`).
   - **`check-editor-boundaries`.** It is template's own rule, so it moves to template: template's row moves the script and its test into template and points `editor-boundary-check` at it. Kit then deletes its copy, `config/rebuild.json:65`, `tests/kit/editor-boundaries.test.mts` and `docs/operations/tool-inventory.md:1518`, and orm's `docs/spec/editor-stack.md` reference follows.
7. **Concurrent item IDs.** `make item-new` (`plan.mts:146-170`) refuses an ID that main or the worktree already holds. Red: two worktrees pick the same ID and the second `make item-new` succeeds. Green: the second call fails and a fresh ID succeeds. It reads main's checklist the way `check-commits.mts:71` does. A simultaneous race is still caught by docs-check at land.
8. **One link declaration (the owner's proposal).** Copying, linking or installing per case keeps producing defects like template's. One git-ignored setting, checked idempotently, replaces them.
   - Each checkout has one git-ignored file. It is plain text, one provider checkout path per line. A relative path is resolved against the root of the checkout that declares it. This file is the only declaration of development links.
   - It replaces sibling auto-discovery, so it does not become a second declaration beside it. A development folder is not assumed to sit beside the consumer.
     - Auto-discovery (`siblingCheckouts`, `link-providers.mts:145`; `install-link` runs `link --siblings`, `kit-bootstrap.mk:38-40`) guesses dev folders from the disk layout. It takes the parent folder as the workspace, matches folder names against `github.com/polyspec/<name>`, and adds a special case for `forks/`.
     - The guess is already broken. limepie is not a sibling of polyspec, so it passes `POLYSPEC=<path>` instead, which is a second mechanism. Worktrees sit beside the main checkouts and are filtered out only by the naming rule.
     - Auto-discovery, the `forks/` special case and limepie's `POLYSPEC=` variable are all deleted in favour of the file. The file lists provider paths explicitly.
     - Every current user of discovery moves to the file, each in a row:
       - `link.mts cargo --siblings` (`link.mts:899-900`): orm `Makefile:205,2022,2894,2907`, ssr `Makefile:113`;
       - hyper's hard-coded `CHECKOUTS=… ../template ../forks/…` (`hyper/Makefile:127-128`) and its positional checkout to `npm-install` (`:183`);
       - `composer-install.mts:49`, which falls back to `siblingCheckouts` (deleted with `composer-install`);
       - the K440 workspace Claude hook, written only under `--siblings` (`link.mts:874`). `make link` writes it whenever the file exists, and a kit AGENTS rule names it;
       - the tests that assert `--siblings`: `template/tests/scripts/toolchain-files.test.mts:298`, `crudui/tests/build/ci-local.test.mts:785`;
       - limepie's Makefiles that pass `POLYSPEC=`, in limepie's own adoption row.
     - With no file, nothing is linked: that is release state.
   - Kit derives the install folders from the manifests, as `link-providers.mts` does today.
   - `make link` applies the file idempotently. `make link-check` compares only the file and the state:
     - each declared folder is a symlink to its provider;
     - no undeclared link exists;
     - with no file, no install folder is a link.
   - A worktree reads main's file at `$(KIT_MAIN_CHECKOUT)/<file>` (`kit.mk:18`), read-only. It does not copy or write it.
   - Package managers are untouched: kit only lays links over the installs and checks them. The rule at `AGENTS.md:47` (native npm links, Composer path repositories, uv editable installations) is rewritten in the same row to name the declaration file, and `docs/operations/local-links.md` follows. This is not the rejected marker design, which skipped installs.
   - Red tests:
     - `make link` creates exactly the declared links, and a second run changes nothing (compared by readlink and inode);
     - an undeclared link fails;
     - a declared copy fails;
     - with no file, any link fails;
     - a worktree reads main's file.
9. **A repo's CI does not re-run the shared gates (owner order: minimize CI time by parallel design).** A new PRINCIPLES rule, with its Korean twin, is enforced by a kit target that reads the `kit-gates` prerequisites (`kit.mk:203`). Red: on the current tree no target checks this, so a fixture workflow other than `gates.yml` naming a `kit-gates` prerequisite, and a `ci-targets` input naming one, go unchecked; the new target must fail on both. Green: both fail the target, and each consumer passes after its adoption row removes its duplicates. It fails when any workflow other than `gates.yml`, or any file that `ci-targets` or `ci-setup` reads (for example `template/config/ci.json`), names one of them. Kit's own `ci.yml` is exempt: kit has no gates.yml copy, and its `ci.yml` is where the partitions run (`ci.yml:53,61,95,108,112,139`). The duplication exists today:
    - orm `ci.yml:213-226`, with `Makefile:257,268`
    - hyper `ci.yml:40,71`
    - ordered-json `ci.yml:75,136`
    - crudui `ci.yml:69,122,128`
    - template `ci.yml:63`

    Each consumer removes its duplicates in its adoption row. fsm `ci.yml:76` runs the full `make check`. That is its own suite, judged in its row.
10. **Fix stale text.** Each comment or description of a deleted target is removed in that target's row: `kit.mk:92-93` and `kit.mk:113` with toolchain-check, `kit.mk:475` with the unlink description. Red: `text-absent` (P19) finds the old sentence. Green: it finds none.

## Order
1. Agree on this plan through the adversarial audit. Record each owner ruling in this file with its date.
2. Register the rows in this plan's checklist, one per item group in Decision 2–10. Each row runs its own test red→green. Rename the worktree and branch to carry the first row's ID (`PRINCIPLES.md:45`). The version, pin and lock rows the kit session already started are referenced, not duplicated.
3. Add a new assertion in `gates-workflow.test.mts`: every `kit-gates` prerequisite is named by a PRINCIPLES rule or a kit `AGENTS.md` rule, and the union of the partitions still equals `kit-gates`.
4. **Consumers, before adopting 0.0.74.** Each repo, in its own adoption row:
   - removes every reference to a deleted target, including build and test prerequisites and AGENTS Enforced-by lines:
     - `toolchain-check`, in all eight repos
     - `cargo-downloads-check`, in template, orm, crudui and ordered-json
     - `cargo-fetch`, in ssr `Makefile:112,141`
     - `link-state-check`, in every consumer's CHECK_TARGETS (table.md, Table 1b), ordered-json `Makefile:38` and crudui `Makefile:552`; `link-check` replaces it
     - `composer-install`, in hyper `Makefile:127-128`; `npm-install`, in hyper `Makefile:183`
     - `release-assets-fetch`, in hyper `Makefile:100` and crudui `Makefile:197`
   - defines its `deps-<runtime>` targets for ci-setup;
   - writes its link declaration file, and drops `--siblings`, `CHECKOUTS=` and `POLYSPEC=` (limepie included);
   - hyper removes its `config/release-assets.json` entries and `build-template-ext.mts` once PIE and the Composer repository replace them;
   - routes raw `uv sync` recipes through `make uv-install`: crudui `Makefile:173`, orm `Makefile:751` and hyper `Makefile:116`.
5. Release 0.0.74, then each repo adopts it with kit-sync. The only real ordering is ordered-json before orm and crudui, and template before hyper; the rest are independent. crudui moves up from kit 0.0.63.

## Exit condition
- Every `kit-gates` prerequisite is named by a written rule, as `gates-workflow.test.mts` proves.
- No kit code installs, updates, pins or resolves packages, or compares versions, pins or lock contents, or builds in place of the repo's make. Package-manager calls are thin recipes only: `mise install --locked`, `mise lock`, `cargo fetch`, rustup, and the guarded `uv-install`, which keeps the dev-folder rule.
- Running `make install` twice changes no file in `var/tools` or the install folders, as the P17 test proves.
- `make link-check` passes with the declaration file, and with no file in release state.
- No consumer workflow or CI config names a `kit-gates` prerequisite.
- A repo-style `uv sync` after `install-link` leaves the dev folder byte-identical.
- A changed or added kit copy in a repo fails `make kit-inject-check`.
- After a worktree's `make install`, main's tools and locks are unchanged.
- Every consumer has adopted 0.0.74, and `make rules-check` passes in each.
