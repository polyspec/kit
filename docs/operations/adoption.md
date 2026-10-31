<!-- doc-id: adoption -->
# Working in a repository that adopts kit

[한국어](adoption.ko.md)

This is the procedure of an agent or a person who works in a repository that takes kit, with the rules it rests on in
[PRINCIPLES.md](../../PRINCIPLES.md). It states no rule of its own: each step names the rule and the tool that holds it.

## At every item boundary

1. `make kit-sync` copies the files of the installed kit (P30: the installed kit of a development checkout is a link to the local
   kit, so a landing of kit reaches the repository this way, with no relay).
2. Each provider that the repository consumes through links is built by its own targets ([local-links.md](local-links.md)); link
   builds nothing (K856).
3. `make install-tools` installs the tools of `mise.toml`.
4. Every gate of `kit-gates` runs. A gate that fails is the next item of the plan of the repository, with its own red and green.

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
   (cd "${RUNNER_TEMP:?RUNNER_TEMP is not set}" && npm_config_cache="$root/var/bootstrap/npm-cache" npm exec --yes --package="npm@$version" -- npm --prefix "$root" ci --ignore-scripts --allow-remote=root)
   ```
5. A checkout without `node_modules` has no kit to include. A worktree is made by `make worktree-setup NAME=<name> ID=<id>`, which
   runs the npm ci above, then `make install` and `make link-check` in it (K858). It refuses, before it creates the worktree or its branch and before it runs npm or make, a
   `package.json` that declares no devEngines npm (K938-1). A plain clone runs the same npm ci from outside the checkout first.

The sequence of a first adoption (K938-1):

- `package.json` and `mise.toml` (steps 1 and 2), then the npm ci of step 4 with `--prefix`.
- `make install-tools TOOLS=npm`: the first run stops after mise is installed; mise.lock does not pin node and npm:npm yet, so
  the bootstrap names `make toolchain-lock`. This is expected and needs no fix.
- `make toolchain-lock` writes `mise.lock` and the sidecar. It needs `var/tools/bin/mise` of the bootstrap and the kit
  inside `node_modules`, since its recipes run through the include of kit.
- `make install-tools TOOLS=npm` installs the node and npm:npm that the lock pins.
- `make install` installs the rest.

Then commit `package.json`, `mise.toml`, `mise.lock`, `.mise/locks/npm-npm/<version>/` and the workflow lines in one change.

## Never

No polling loop, no deferral, no run of a full suite, no push, tag or release, and no tool but the utilities of kit for plans,
items and commits (P18, P24 to P28, P31).
