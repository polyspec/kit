#!/usr/bin/env node
// The mutation gate of the dependency policy (T18.10): on a copy of the dependency files of the repository, each
// mutation must make scripts/check-dependency-policy.mjs report its finding. It reports every mutation that the check
// accepts and fails when there is one.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './check-dependency-policy.mjs';
import { POLICY, RECORD, readJson } from './dependency-state.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** A copy of the manifests, locks, local package manifests, Python manifests, policy and review record of the repository. */
function copy(directory) {
  const policy = readJson(ROOT, POLICY);
  const files = ['package.json', 'package-lock.json', POLICY, RECORD];
  for (const spec of Object.values(readJson(ROOT, 'package.json').dependencies ?? {})) if (spec.startsWith('file:')) files.push(`${spec.slice(5)}/package.json`);
  for (const { manifest } of policy.composerPlatforms) files.push(manifest, join(dirname(manifest), 'composer.lock'));
  for (const manifest of policy.pythonManifests ?? []) files.push(manifest);
  for (const file of files) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    cpSync(join(ROOT, file), join(directory, file));
  }
}

const editJson = (root, file, edit) => {
  const data = JSON.parse(readFileSync(join(root, file), 'utf8'));
  edit(data);
  writeFileSync(join(root, file), `${JSON.stringify(data, null, 2)}\n`);
};

// The lock of the first Composer platform of the policy: the file that the lock mutation changes.
const lockOfFirstPlatform = root => join(dirname(readJson(root, POLICY).composerPlatforms[0].manifest), 'composer.lock');

const MUTATIONS = [
  {
    name: 'an outdated dependency without an exception',
    apply: root => editJson(root, RECORD, (record) => { record.dependencies.find(item => item.package === 'eslint').latest = '9.1.0'; }),
    expect: finding => finding.rule === 'latest' && finding.subject === 'package.json eslint',
  },
  {
    name: 'a Composer platform other than the declared minimum PHP',
    apply: root => editJson(root, POLICY, (policy) => { policy.composerPlatforms[0].php = '8.1.0'; }),
    expect: finding => finding.rule === 'platform',
  },
  {
    name: 'a lock changed without a review',
    apply: root => appendFileSync(join(root, lockOfFirstPlatform(root)), '\n'),
    expect: finding => finding.rule === 'record' && finding.subject === lockOfFirstPlatform(ROOT),
  },
  {
    name: 'a lock with an advisory at its review',
    apply: root => editJson(root, RECORD, (record) => { record.locks[0].advisories = [{ package: 'example', version: '1.0.0', id: 'GHSA-0000-0000-0000', severity: 'high', title: 'mutation' }]; }),
    expect: finding => finding.rule === 'advisory',
  },
];

const accepted = [];
for (const mutation of MUTATIONS) {
  const directory = mkdtempSync(join(tmpdir(), 'template-dependency-policy-'));
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
  process.exit(1);
}
console.log(`[dependency-policy] ${MUTATIONS.length} mutations rejected: ${MUTATIONS.map(mutation => mutation.name).join('; ')}`);
