#!/usr/bin/env node
// The mutation gate of the dependency policy (T18.10): on a copy of the dependency files of the repository, each
// mutation must make scripts/check-dependency-policy.mts report its finding. It reports every mutation that the check
// accepts and fails when there is one. The check runs only as the command (`make dependency-policy-mutation-check`); importing the
// module runs nothing.
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { check } from './check-dependency-policy.mts';
import { POLICY, RECORD, readPolicy } from './dependency-state.mts';
import { readJson, writeJson } from './bootstrap/files.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { checkedFiles } from './tracked-files.mts';


/** The fields of config/dependency-review.json that the mutations change. */
interface ReviewRecordJson {
  dependencies: { manifest: string; package: string; version: string; latest: string | null }[];
  locks: { lock: string; advisories: unknown[] }[];
}

/** The field of config/dependency-policy.json that a mutation changes. */
interface PolicyJson {
  composerPlatforms?: { php: string }[];
}

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
}

const editJson = <T,>(root: string, file: string, edit: (data: T) => void) => {
  const data = readJson(root, file) as T;
  edit(data);
  writeJson(join(root, file), data);
};

const reviewRecord = (root: string) => readJson(root, RECORD) as ReviewRecordJson;
// The first registry dependency of the review record, whatever its ecosystem: the one that the outdated mutation changes.
const firstDependency = (root: string) => {
  const [first] = reviewRecord(root).dependencies;
  if (!first) throw new Error(`${RECORD} records no dependency`);
  return first;
};
const firstLock = (root: string) => {
  const [first] = reviewRecord(root).locks;
  if (!first) throw new Error(`${RECORD} records no lock`);
  return first.lock;
};
const hasComposer = (root: string) => readPolicy(root).composerPlatforms.length > 0;

// A mutation applies when the repository has what it changes: `applies` is absent for the ones every repository has.
const MUTATIONS: Mutation[] = [
  {
    name: 'an outdated dependency without an exception',
    applies: root => reviewRecord(root).dependencies.length > 0,
    apply: root => editJson(root, RECORD, (record: ReviewRecordJson) => {
      // applies holds a record with a dependency.
      const item = record.dependencies[0]!;
      // The record names a release newer than the locked one: the last number of the locked version, plus one.
      item.latest = item.version.replace(/(\d+)$/, number => String(Number(number) + 1));
    }),
    expect: finding => finding.rule === 'latest' && finding.subject === `${firstDependency(repositoryRoot()).manifest} ${firstDependency(repositoryRoot()).package}`,
  },
  {
    name: 'a Composer platform other than the declared minimum PHP',
    applies: hasComposer,
    // applies holds a policy with a Composer platform.
    apply: root => editJson(root, POLICY, (policy: PolicyJson) => { policy.composerPlatforms![0]!.php = '8.1.0'; }),
    expect: finding => finding.rule === 'platform',
  },
  {
    name: 'a lock changed without a review',
    apply: root => appendFileSync(join(root, firstLock(root)), '\n'),
    expect: finding => finding.rule === 'record' && finding.subject === firstLock(repositoryRoot()),
  },
  {
    name: 'a lock with an advisory at its review',
    // The record of every repository holds a lock, as firstLock reads it.
    apply: root => editJson(root, RECORD, (record: ReviewRecordJson) => { record.locks[0]!.advisories = [{ package: 'example', version: '1.0.0', id: 'GHSA-0000-0000-0000', severity: 'high', title: 'mutation' }]; }),
    expect: finding => finding.rule === 'advisory',
  },
];

/** Applies each mutation that the repository root has to a copy of its dependency files; the exit status of the command. */
function run() {
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
