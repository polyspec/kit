<!-- doc-id: adoption -->
# Working in a repository that adopts kit

[한국어](adoption.ko.md)

This is the procedure of an agent or a person who works in a repository that takes kit, with the rules it rests on in
[PRINCIPLES.md](../../PRINCIPLES.md). It states no rule of its own: each step names the rule and the tool that holds it.

## At every item boundary

1. Each provider that the repository consumes through links is built by its own targets ([local-links.md](local-links.md)); link
   builds nothing (K856).
2. `make install-tools` installs the tools of `mise.toml`.
3. Every gate of `kit-gates` runs. A gate that fails is the next item of the plan of the repository, with its own red and green.
4. Before each push, `make kit-gates-static` is the self-diagnosis of the repository: it runs every shared gate past a failure,
   so one run names each gate that fails, and ends with `[kit-gates-static] every shared gate passed`. The tests run in CI.

## Scope

- A contract behaviour exists in every implementation (S6, S10) and is implemented with its tests (P32).
- A language- or runtime-native integration is written once as a neutral rule in `docs/spec`; each implementation binds its
  native form (P32).
- A test of the internals of one implementation is a plain package test that no parity unit names and that cites no
  requirement; a symbol that is public by accident becomes non-public (P32).
- A rule the work needs and `docs/spec` lacks is written there first. A unit is never dropped, a requirement is never cited
  without a test, and nothing is renamed to escape a check (P33).
- Repeated code is restructured, a tool source is classified and generated output is untracked except a tracked generated source that a consumer installs as the tagged tree itself, declared in config/generated.json (P34).

## Providers

A repository consumes the others only through links (P30). A finding that looks blocked by a release is a defect of the link
tooling: it is reported as a kit defect with its file and line (P35), and only the re-resolution of a committed lock waits for
the decision to release. No tag, version bump or release workflow run happens before the development of every repository is
complete ([local-links.md](local-links.md)).

## Questions

A question goes to the conductor only for a defect of kit, with its file and line, or for two rules that contradict each other
(P23). A rule that is missing is made in kit first.

## Recipes (K1054)

kit includes no recipe into a repository, and the package ships no make file. A repository writes the targets it runs in its own
Makefile, with the variables, settings and environment of its own case. [docs/examples/bootstrap.mk](../examples/bootstrap.mk)
shows one way: a copy of it beside a copy of the targets of kit's `scripts/kit/kit.mk` that the repository wants runs the tools of
the installed package from its dist.

## Adopting the npm of mise.toml (K938)

A repository takes its npm from `mise.toml`, locked in `mise.lock`, and declares the same version in `package.json`. It holds no
`packageManager` field. Each step names the tool that checks it.

1. `package.json`: replace `packageManager` with `"devEngines": {"packageManager": {"name": "npm", "version": "12.2.0", "onFail": "error"}}`.
   npm enforces the version itself.
2. `mise.toml`: declare `node` and `"npm:npm" = "12.2.0"` under `[tools]`.
3. `make toolchain-lock` (online) writes `mise.lock` with the digests of `npm:npm` and its sidecar `.mise/locks/npm-npm/<version>/`
   (`aube-lock.yaml` and `package.json`), which `mise.lock` names. Commit all of these; `mise install --locked` fails without the
   sidecar (K192). Never edit them by hand.
4. Workflows: each line that reads `packageManager` reads `devEngines.packageManager.version` instead. The npm of `npm exec`
   runs outside the checkout, since the npm of the machine refuses to run in a folder whose devEngines names another version
   (EBADDEVENGINES), so the step runs the same block as the bootstrap step of `workflows/release.yml`:

   ```sh
   root="$PWD"
   version="$(node -p 'require("./package.json").devEngines.packageManager.version')"
   (cd "${RUNNER_TEMP:?RUNNER_TEMP is not set}" && npm_config_cache="$root/var/bootstrap/npm-cache" npm exec --yes --package="npm@$version" -- npm --prefix "$root" ci --ignore-scripts)
   ```

   npm reads the repository's own `.npmrc` for this npm ci. A repository that pins kit or another package by a release URL writes
   `allow-remote=root` (or `all`) there, as [docs/examples/native-settings](../examples/native-settings.md) shows; kit sets none (K1045).
5. A checkout without `node_modules` has no kit whose tools its recipes run. A worktree is made by `make worktree-setup NAME=<name> ID=<id>`, which
   runs the npm ci above, then `make install` and `make link-check` in it (K858). It refuses, before it creates the worktree or its branch and before it runs npm or make, a
   `package.json` that declares no devEngines npm (K938-1). A plain clone runs the same npm ci from outside the checkout first.

The sequence of a first adoption (K938-1):

- `package.json` and `mise.toml` (steps 1 and 2), then the npm ci of step 4 with `--prefix`.
- `make install-tools TOOLS=npm`: the first run stops after mise is installed; mise.lock does not pin node and npm:npm yet, so
  the bootstrap names `make toolchain-lock`. This is expected and needs no fix.
- `make toolchain-lock` writes `mise.lock` and the sidecar. It needs `var/tools/bin/mise` of the bootstrap and the kit
  inside `node_modules`, whose tools the recipes of the repository run.
- `make install-tools TOOLS=npm` installs the node and npm:npm that the lock pins.
- `make install` installs the rest.

Then commit `package.json`, `mise.toml`, `mise.lock`, `.mise/locks/npm-npm/<version>/` and the workflow lines in one change.

## Shared files (K1052)

kit writes no file of a repository. The workflows, the bootstrap action, the layout rules and the
principles are examples of the package, listed in [docs/examples/shared-files](../examples/shared-files.md); a repository copies
the ones it wants and commits each copy as its own file. A repository that held copies of kit-sync keeps them as its files; it
removes `kit-sync` and `kit-inject-check` from its own recipes and workflows.

rules-check reads a copied pipeline as one of the repository's workflows, by the make commands of its steps (K1057). A check
that the example pipeline runs only through an expression, such as a target of config/ci.json or a runtime of a computed
matrix, is reached when a step names it, when its matrix lists the value, or when the `Enforced by` line names a target that a
step runs.

## Hooks and checks of a commit (K1053)

kit writes no Git hook and no Claude Code setting, and no utility of kit refuses a commit, a command or the place of a run. A
repository that wants a check at commit writes its own hook under `.githooks`, lists it in `config/checklist.json` `hooks`, and
runs `make hooks`; [docs/examples/git-hooks](../examples/git-hooks.md) shows hooks that run the checks of kit. A repository whose
checkout holds the `.githooks/pre-commit` and `.githooks/commit-msg` of an earlier kit removes them or lists them as its own.

## Never

No polling loop, no deferral, no run of a full suite, no push, tag or release, and no tool but the utilities of kit for plans,
items and commits (P18, P24 to P28, P31).
