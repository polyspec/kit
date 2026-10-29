#!/usr/bin/env node
// Proves a released tag from outside the repository, online. The release workflow (workflows/release.yml) runs it on the draft
// after make release-publish, in the same job; a failed proof fails that run and the release stays a draft. A developer may
// run it for any released tag.
//
//   node scripts/kit/release-proof.mts TAG
//
// For a tag vX.Y.Z it proves, one line `✔ <what>` for each step, and stops at the first step that fails:
//   1. The GitHub Release of TAG, a draft included, lists exactly the archives that config/release.json declares for the version.
//   2. The release assets, downloaded into a temporary directory, are checked and install together: each wheel's file has the
//      sha256 that the release lists. Then they install in clean npm, Composer and Python projects (release-consumer.mts
//      installConsumers, with the committed manifests and locks of the checkout; uv installs each wheel lock and verifies its
//      hashes) and the smoke command of each package passes. Run it in a checkout of the tag, whose consumer projects name the
//      archives of the version.
//   3. Each manifest with the mode `git-tag` installs from the tag: a Rust crate as a git dependency of a temporary crate, and
//      the declared smoke command runs in that crate. A Python package is a `wheel` package: its wheel is an archive of step 2.
//   4. Each Go module has its tag on the remote (`git ls-remote`) and `go list -m <module>@<tag>` resolves it with
//      GOFLAGS=-mod=mod and GOPROXY=direct.
// A tag `<Go module directory>/vX.Y.Z` releases that module alone: the release holds no archive and only step 4 runs for it.
// Every command of a step comes from config/release.json: `consumers` (smoke commands of the archives) and `proof.gitTag`.
//   TAG is `latest` for the newest root release tag reachable from HEAD.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { assetNames, context, latestTag, parseTag, recordedRelease, stepFailure, type CommandOptions } from './release.mts';
import { downloadAsset, type GitHubRelease } from './github-release.mts';
import { run, Stop } from './process.mts';
import { installConsumers, type ReleaseContext } from './release-consumer.mts';
import { toolCommand } from './mise-tools.mts';
import { fileDigest } from './bootstrap/digest.mts';
import { wheelName } from './release-wheel.mts';

type Step = (text: string) => void;

/** Step 1: the names of the assets of the GitHub Release (a draft included) equal the archives of the tag. */
function proveAssets(ctx: ReleaseContext, tag: string, version: string, directory: string | null, step: Step) {
  const expected = [...(directory === null ? assetNames(ctx.config, version) : [])].sort();
  // The draft of this repository is read by the id that publish recorded: the list shows a new draft only after a while.
  const release = recordedRelease(ctx, tag);
  const actual = release.assets.map(({ name }) => name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = expected.filter(name => !actual.includes(name));
    const extra = actual.filter(name => !expected.includes(name));
    throw new Stop(`the release ${tag} lists [${actual.join(', ')}], expected [${expected.join(', ')}]${missing.length ? `; missing [${missing.join(', ')}]` : ''}${extra.length ? `; unexpected [${extra.join(', ')}]` : ''}`);
  }
  step(`the ${release.draft ? 'draft' : 'public'} release ${tag} lists ${expected.length ? `exactly its ${expected.length} archives` : 'no archive'}`);
  return release;
}

/** Step 2, the wheels of the release, each downloaded file checked before it is installed: its sha256 is the one that the release lists. */
function proveWheels(ctx: ReleaseContext, tag: string, version: string, assets: string, release: GitHubRelease, step: Step) {
  const { config } = ctx;
  for (const { name } of config.packages.filter(item => item.kind === 'wheel')) {
    const file = wheelName(name, version);
    const listed = release.assets.find(item => item.name === file);
    const digest = listed?.digest?.replace(/^sha256:/, '') ?? null;
    const actual = fileDigest(path.join(assets, file));
    if (actual !== digest) throw new Stop(`the release ${tag} lists ${file} with the sha256 ${digest ?? 'none'}, the downloaded file has ${actual}`);
    step(`${file}: the sha256 of the downloaded file is the one the release lists`);
  }
}

/** Step 2: download the assets of the release into `folder/assets`, check the wheels and install the assets in clean consumer projects. */
function proveInstall(ctx: ReleaseContext, tag: string, version: string, folder: string, release: GitHubRelease, step: Step) {
  const assets = path.join(folder, 'assets');
  mkdirSync(assets, { recursive: true });
  for (const { id, name } of release.assets) downloadAsset({ cwd: ctx.root, env: ctx.env }, ctx.config.repositoryUrl, id, path.join(assets, name));
  step(`downloaded [${readdirSync(assets).sort().join(', ')}] from the release ${tag}`);
  proveWheels(ctx, tag, version, assets, release, step);
  const count = installConsumers(ctx, version, assets, text => step(text));
  step(`installed and checked ${count} packages from the release assets`);
}

/** The smoke command of a git-tag manifest, run in `cwd`. */
const smoke = (command: string[], cwd: string, env: NodeJS.ProcessEnv) => {
  const program = command[0];
  if (program === undefined) throw new Error('config/release.json: a smoke command of proof.gitTag is empty');
  return run(program, command.slice(1), { cwd, env });
};

/** Step 3: install each git-tag manifest (a Rust crate) from the tag as a git dependency of a temporary crate. */
function proveGitTag(ctx: ReleaseContext, tag: string, folder: string, step: Step) {
  const { config } = ctx;
  const files = Object.entries(config.manifests).filter(([, mode]) => mode === 'git-tag').map(([file]) => file).sort();
  for (const file of files) {
    const entry = config.proof?.gitTag?.[file];
    if (!entry) throw new Stop(`config/release.json proof.gitTag lacks ${file}, which manifests releases by "git-tag"`);
    const work = path.join(folder, `git-tag-${files.indexOf(file)}`);
    const crate = path.join(work, 'crate');
    mkdirSync(path.join(crate, 'src'), { recursive: true });
    writeFileSync(path.join(crate, 'Cargo.toml'), `[package]\nname = "release-proof"\nversion = "0.0.0"\nedition = "2021"\npublish = false\n\n[dependencies]\n${entry.name} = { git = "${config.repositoryUrl}", tag = "${tag}" }\n`);
    writeFileSync(path.join(crate, 'src/main.rs'), 'fn main() {}\n');
    smoke(entry.smoke, crate, { ...ctx.env, CARGO_TARGET_DIR: path.join(work, 'target') });
    step(`${file}: cargo resolved ${entry.name} from ${tag} and ${entry.smoke.join(' ')} passed`);
  }
}

/** Step 4: the tag of each Go module is on the remote and the Go tool resolves the module at it. */
function proveGoModules(ctx: ReleaseContext, tag: string, version: string, directory: string | null, folder: string, step: Step) {
  const { config } = ctx;
  const modules = Object.entries(config.goModules).filter(([module]) => directory === null || module === directory).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const env = { ...ctx.env, GIT_TERMINAL_PROMPT: '0' };
  for (const [module, modulePath] of modules) {
    const goTag = module === '.' ? `v${version}` : `${module}/v${version}`;
    const remote = run('git', ['ls-remote', '--tags', config.repositoryUrl, `refs/tags/${goTag}`], { cwd: folder, env });
    if (!remote.split('\n').some(line => line.endsWith(`\trefs/tags/${goTag}`))) throw new Stop(`the tag ${goTag} of the Go module ${modulePath} is not on ${config.repositoryUrl}, git ls-remote lists [${remote.trim()}]`);
    // go is the tool of the checkout, never the one on PATH (K393-1).
    const listed = run(toolCommand(ctx.root, 'go'), ['list', '-m',`${modulePath}@v${version}`], { cwd: folder, env: { ...env, GOFLAGS: '-mod=mod', GOPROXY: 'direct', GOPATH: path.join(folder, 'gopath') } }).trim();
    if (listed !== `${modulePath} v${version}`) throw new Stop(`go list -m ${modulePath}@v${version} printed "${listed}", expected "${modulePath} v${version}"`);
    step(`the Go module ${modulePath} resolves at ${goTag}`);
  }
}

/** Runs the proof of the tag; `step(text)` reports each completed step. */
export function prove(ctx: ReleaseContext, tag: string, step: Step) {
  const [directory, version] = parseTag(ctx.config, tag);
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-proof-'));
  try {
    const release = proveAssets(ctx, tag, version, directory, step);
    if (directory === null) {
      proveInstall(ctx, tag, version, folder, release, step);
      proveGitTag(ctx, tag, folder, step);
    } else {
      step(`${tag} is a Go module tag: the release holds no archive and no git-tag manifest`);
    }
    proveGoModules(ctx, tag, version, directory, folder, step);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const USAGE = 'usage: node scripts/kit/release-proof.mts TAG';

/** Runs the command line; the exit status. */
export function main(argv: string[], { root = repositoryRoot(), env = process.env, print = console.log, error = console.error }: CommandOptions = {}) {
  const [latest, ...rest] = argv;
  let tag = latest;
  if (!tag || rest.length) {
    error(USAGE);
    return 2;
  }
  try {
    if (tag === 'latest') tag = latestTag(context(root, { env }));
    prove(context(root, { env }), tag, text => print(`✔ ${text}`));
  } catch (failure) {
    error(`[release-proof] ${tag} failed: ${stepFailure(failure)}`);
    return 1;
  }
  print(`✔ ${tag} is proven from outside the repository`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
