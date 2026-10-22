#!/usr/bin/env node
// The mutation gate of the dependency policy (T18.10): on a copy of the dependency files of the repository, each
// mutation must make scripts/check-dependency-policy.mts report its finding. It reports every mutation that the check
// accepts and fails when there is one. The check runs only as the command (`make dependency-policy-mutation-check`); importing the
// module runs nothing.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { check } from './check-dependency-policy.mts';
import { POLICY, RECORD, readPolicy } from './dependency-state.mts';
import { writeJson } from './bootstrap/files.mts';
import { readComposerManifest } from './manifests.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { checkedFiles } from './tracked-files.mts';
import { readGoWork } from './toolchain-files.mts';
import { present } from './present.mts';


/** A finding of check-dependency-policy.mts, with the fields that a mutation expects. */
interface Finding {
  rule: string;
  subject?: string;
}

/** A mutation: whether the repository has what it changes, the change of a copy, and the finding that the check must report. */
interface Mutation {
  name: string;
  applies?: (root: string) => boolean;
  apply: (root: string) => void;
  expect: (finding: Finding) => boolean;
}

const COPIED = /(^|\/)(package\.json|package-lock\.json|composer\.json|composer\.lock|pyproject\.toml|pylock(\.[A-Za-z0-9_-]+)?\.toml|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|go\.work|go\.work\.sum)$/;

/**
 * The findings of each go.work of `root` that uses a module whose go.mod Git does not track, such as an ignored clone of a
 * sibling repository: the copy of the gate holds the tracked files only, and no other checkout holds that module (K160).
 */
function untrackedUses(root: string): string[] {
  const files = checkedFiles(root);
  const tracked = new Set(files);
  return files.filter(file => posix.basename(file) === 'go.work').flatMap(file =>
    (readGoWork(root, join(root, file), process.env).Use ?? [])
      .map(use => ({ use: use.DiskPath, mod: posix.join(posix.dirname(file), use.DiskPath, 'go.mod') }))
      .filter(({ mod }) => !tracked.has(mod))
      .map(({ use, mod }) => `${file}: uses ${use}, whose go.mod Git does not track; a committed go.work may only use tracked modules. Fix: commit ${mod} or remove the use from ${file}`));
}

/**
 * A copy of the files that the gate reads: every tracked manifest and lock (npm workspaces and local packages included), each
 * go.work with its go.work.sum, which makes a requirement of another member a package of the repository that needs no go.sum
 * (K153), the policy and the review record.
 */
function copy(directory: string) {
  const files = new Set([POLICY, RECORD, ...checkedFiles(repositoryRoot()).filter(file => COPIED.test(file))]);
  for (const file of files) {
    if (!existsSync(join(repositoryRoot(), file))) continue;
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    cpSync(join(repositoryRoot(), file), join(directory, file));
  }
  // The gate lists the files of a checkout through Git, so each copy is a repository.
  spawnSync('git', ['init', '--quiet'], { cwd: directory });
  // The copy runs with the tools of the checkout it was copied from, as a worktree shares them: its var/tools is a link to that
  // folder (K393-1).
  if (existsSync(join(repositoryRoot(), 'var/tools'))) {
    mkdirSync(join(directory, 'var'), { recursive: true });
    symlinkSync(join(repositoryRoot(), 'var/tools'), join(directory, 'var/tools'));
  }
}


const hasComposer = (root: string) => readPolicy(root).composerPlatforms.length > 0;
// The first Composer manifest of the policy, which applies (hasComposer) holds.
const firstComposerManifest = (root: string) => present(readPolicy(root).composerPlatforms[0], 'composerPlatforms[0]').manifest;

// A mutation applies when the repository has what it changes: `applies` is absent for the ones every repository has.
// K448: the gate judges no version, review or advisory (S4), so no mutation of the review record or the PHP platform is rejected.
const MUTATIONS: Mutation[] = [
  {
    // Composer's content-hash of the lock covers the version of the manifest, so a version bump re-locks the manifest with
    // composer update --lock (K180); composer validate --strict fails the lock that it outdated.
    name: 'a Composer manifest whose version changed without composer update --lock',
    applies: hasComposer,
    apply: (root) => {
      const file = firstComposerManifest(root);
      const manifest = readComposerManifest(root, file);
      manifest.version = (manifest.version ?? '0.0.0').replace(/(\d+)$/, number => String(Number(number) + 1));
      writeJson(join(root, file), manifest);
    },
    expect: finding => finding.rule === 'composerLock' && finding.subject === firstComposerManifest(repositoryRoot()),
  },
];

/** Applies each mutation that the repository root has to a copy of its dependency files; the exit status of the command. */
function run() {
  const untracked = untrackedUses(repositoryRoot());
  if (untracked.length) {
    for (const finding of untracked) console.error(`[dependency-policy] ${finding}`);
    return 1;
  }
  const mutations = MUTATIONS.filter(mutation => !mutation.applies || mutation.applies(repositoryRoot()));
  const accepted: string[] = [];
  for (const mutation of mutations) {
    const directory = mkdtempSync(join(tmpdir(), 'kit-dependency-policy-'));
    try {
      copy(directory);
      mutation.apply(directory);
      if (!check(directory).some(mutation.expect)) accepted.push(mutation.name);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  if (accepted.length) {
    for (const name of accepted) console.error(`[dependency-policy] the check accepted the mutation: ${name}`);
    return 1;
  }
  console.log(`[dependency-policy] ${mutations.length} mutations rejected: ${mutations.map(mutation => mutation.name).join('; ')}`);
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = run();
