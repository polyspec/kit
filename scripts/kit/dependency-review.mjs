#!/usr/bin/env node
// The dependency review (T18.10): `make dependency-review`, a developer command that is not part of `make check` or
// of the gating CI jobs; the scheduled workflow .github/workflows/dependency-review.yml runs it every day. It asks the
// registries for the latest stable release of every registry dependency (scripts/dependency-state.mjs defines them)
// and for the advisories of every lock, and reports each newer stable release without an exception, each stale
// exception and each advisory with its fix, one line each; it fails when there is one.
//
//   node scripts/dependency-review.mjs [--root <checkout>] [--record] [--update]
//
// --record writes what it reviewed to config/dependency-review.json: the date, the sha256 and the advisories of every
// lock, and the locked and latest stable version of every registry dependency. The gate
// scripts/check-dependency-policy.mjs compares the checkout with that record without a network.
// --update first raises every newer dependency without an exception to its latest stable release, keeping the range
// operator of its manifest, and updates the packages with an advisory; then it reviews and records again.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY, RECORD, dependencyKey, digest, highestStable, isPrerelease, older, readJson, readState } from './dependency-state.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const UPDATE = 'make dependency-review UPDATE=1';
// npm audit reports these severities; the configured severity is moderate. Composer audit reports every advisory.
const NPM_SEVERITIES = new Set(['moderate', 'high', 'critical']);

function query(command, args, cwd, statuses = [0]) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || !statuses.includes(result.status)) {
    return { error: `${command} ${args.join(' ')} ended with ${result.error?.message ?? `exit status ${result.status}`}: ${`${result.stderr}`.trim().split('\n').slice(-3).join(' ')}` };
  }
  try {
    return { value: result.stdout.trim() ? JSON.parse(result.stdout) : {} };
  } catch (error) {
    return { error: `${command} ${args.join(' ')} printed no JSON: ${error.message}` };
  }
}

/** The latest stable release of every registry dependency: key -> { latest } or { error }. */
function latestReleases(root, state) {
  const latest = new Map();
  const composer = new Map();
  for (const dependency of state.dependencies) {
    const key = dependencyKey(dependency);
    if (dependency.ecosystem === 'npm') {
      const answer = query('npm', ['view', dependency.package, 'dist-tags', 'versions', '--json'], root);
      if (answer.error) {
        latest.set(key, { error: answer.error });
        continue;
      }
      // npm 12 prints the fields of `npm view` with several fields as an array of one object.
      const view = Array.isArray(answer.value) ? answer.value[0] ?? {} : answer.value;
      const tag = view['dist-tags']?.latest;
      const stable = tag && !isPrerelease(tag) ? tag : highestStable(view.versions ?? []);
      latest.set(key, stable ? { latest: stable } : { error: `npm view ${dependency.package} reported no stable release` });
      continue;
    }
    if (dependency.ecosystem === 'pypi') {
      const answer = query('curl', ['-fsSL', `https://pypi.org/pypi/${dependency.package}/json`], root);
      if (answer.error) {
        latest.set(key, { error: answer.error });
        continue;
      }
      const stable = highestStableRelease(answer.value.releases ?? {});
      latest.set(key, stable ? { latest: stable } : { error: `PyPI reported no stable release of ${dependency.package}` });
      continue;
    }
    const directory = dirname(dependency.manifest);
    if (!composer.has(directory)) composer.set(directory, query('composer', ['outdated', '--direct', '--locked', '--all', '--format=json', '--no-interaction'], join(root, directory)));
    const answer = composer.get(directory);
    if (answer.error) {
      latest.set(key, { error: answer.error });
      continue;
    }
    const entry = (answer.value.locked ?? []).find(item => item.name === dependency.package);
    latest.set(key, entry?.latest ? { latest: entry.latest } : { error: `composer outdated in ${directory} reported no release of ${dependency.package}` });
  }
  return latest;
}

/** The highest release of a PyPI project that has files and no pre-release or development marker; releases: version -> files. */
export function highestStableRelease(releases) {
  const stable = Object.keys(releases).filter(version => /^\d+(\.\d+)*$/.test(version) && releases[version].length > 0);
  stable.sort((a, b) => {
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  return stable.at(-1) ?? null;
}

/** The advisories of every lock: lock -> { advisories } or { error }. */
function advisories(root, state) {
  const result = new Map();
  const npmVersions = state.npmLock.packages ?? {};
  const npm = query('npm', ['audit', '--json', '--package-lock-only'], root, [0, 1]);
  if (npm.error) result.set(state.locks[0], { error: npm.error });
  else {
    const list = [];
    for (const [name, vulnerability] of Object.entries(npm.value.vulnerabilities ?? {})) {
      for (const via of vulnerability.via ?? []) {
        if (typeof via !== 'object' || !NPM_SEVERITIES.has(via.severity)) continue;
        list.push({ package: name, version: npmVersions[`node_modules/${name}`]?.version ?? vulnerability.range, id: String(via.source ?? via.url), severity: via.severity, title: via.title, url: via.url });
      }
    }
    result.set(state.locks[0], { advisories: list });
  }
  for (const lock of state.locks.slice(1)) {
    const directory = dirname(lock);
    const lockData = readJson(root, lock);
    const versions = new Map([...(lockData.packages ?? []), ...(lockData['packages-dev'] ?? [])].map(item => [item.name, item.version]));
    // composer audit sets bit 1 for an advisory and bit 2 for an abandoned package.
    const answer = query('composer', ['audit', '--locked', '--format=json', '--no-interaction'], join(root, directory), [0, 1, 2, 3]);
    if (answer.error) {
      result.set(lock, { error: answer.error });
      continue;
    }
    const list = [];
    for (const [name, entries] of Object.entries(answer.value.advisories ?? {})) {
      for (const advisory of entries) list.push({ package: name, version: versions.get(name), id: String(advisory.advisoryId), severity: advisory.severity ?? 'unknown', title: advisory.title, url: advisory.link });
    }
    for (const [name, replacement] of Object.entries(answer.value.abandoned ?? {})) {
      list.push({ package: name, version: versions.get(name), id: 'abandoned', severity: 'abandoned', title: replacement ? `abandoned, replaced by ${replacement}` : 'abandoned without a replacement' });
    }
    result.set(lock, { advisories: list });
  }
  return result;
}

/** The review of the checkout at `root`: the findings, the newer dependencies, the advisories and the record. */
export function review(root) {
  const policy = readJson(root, POLICY);
  const exceptions = new Map(policy.exceptions.map(exception => [dependencyKey(exception), exception]));
  const state = readState(root, policy);
  const latest = latestReleases(root, state);
  const audits = advisories(root, state);
  const lines = [];
  const notes = [];
  const newer = [];
  const found = [];
  for (const dependency of state.dependencies) {
    const key = dependencyKey(dependency);
    const subject = `${dependency.manifest} ${dependency.package}`;
    const answer = latest.get(key);
    if (answer.error) {
      lines.push(`${subject}: the registry query failed: ${answer.error}. Fix: run ${UPDATE} again when the registry answers`);
      continue;
    }
    const outdated = older(dependency.version, answer.latest);
    if (outdated && exceptions.has(key)) notes.push(`${subject} ${dependency.version} < ${answer.latest}: kept by the exception of ${POLICY}: ${exceptions.get(key).reason}`);
    else if (outdated) {
      newer.push({ ...dependency, latest: answer.latest });
      lines.push(`${subject} ${dependency.version} < ${answer.latest}: a newer stable release exists. Fix: ${UPDATE}`);
    } else if (exceptions.has(key)) lines.push(`${subject} ${dependency.version}: the exception of ${POLICY} is stale, ${answer.latest} is the latest stable release. Fix: remove the exception from ${POLICY}`);
  }
  for (const lock of state.locks) {
    const answer = audits.get(lock);
    if (answer.error) {
      lines.push(`${lock}: the advisory query failed: ${answer.error}. Fix: run ${UPDATE} again when the advisory database answers`);
      continue;
    }
    for (const advisory of answer.advisories) {
      found.push({ lock, ...advisory });
      lines.push(`${lock} ${advisory.package} ${advisory.version}: advisory ${advisory.id} (${advisory.severity}) ${advisory.title}${advisory.url ? ` ${advisory.url}` : ''}. Fix: ${UPDATE}`);
    }
  }
  const record = {
    schema: 1,
    comment: 'Written by make dependency-review RECORD=1 (scripts/dependency-review.mjs) from the registries; make dependency-policy-check compares the checkout with it without a network.',
    reviewed: new Date().toISOString(),
    locks: state.locks.map(lock => ({ lock, sha256: digest(root, lock), advisories: (audits.get(lock).advisories ?? []).map(({ package: name, version, id, severity, title, url }) => ({ package: name, version, id, severity, title, ...(url ? { url } : {}) })) })),
    dependencies: state.dependencies.map(dependency => ({ ecosystem: dependency.ecosystem, manifest: dependency.manifest, package: dependency.package, version: dependency.version, latest: latest.get(dependencyKey(dependency)).latest ?? null })),
  };
  const complete = state.locks.every(lock => !audits.get(lock).error) && [...latest.values()].every(answer => !answer.error);
  return { lines, notes, newer, advisories: found, record, complete };
}

/** The range operator of a manifest constraint: `^`, `~` or none for an exact version. */
const operator = spec => (/^[\^~]/.test(spec) ? spec[0] : '');

/** The commands that raise the newer dependencies and update the packages with an advisory, in order. */
export function updatePlan({ newer, advisories: found }) {
  const plan = [];
  for (const dependency of newer) {
    const version = String(dependency.latest).replace(/^v/, '');
    const range = operator(dependency.spec);
    if (dependency.ecosystem === 'npm') {
      const save = dependency.kind === 'devDependencies' ? ['--save-dev'] : ['--save'];
      plan.push({ command: 'npm', args: ['install', ...save, ...(range ? [] : ['--save-exact']), `${dependency.package}@${range}${version}`], cwd: '.' });
    } else if (dependency.ecosystem === 'pypi') {
      plan.push({ command: 'node', args: ['scripts/pin-python-dependency.mjs', dependency.manifest, dependency.package, version], cwd: '.' });
    } else {
      plan.push({ command: 'composer', args: ['require', ...(dependency.kind === 'require-dev' ? ['--dev'] : []), '--update-with-dependencies', '--no-interaction', `${dependency.package}:${range}${version}`], cwd: dirname(dependency.manifest) });
    }
  }
  if (found.some(advisory => advisory.lock === 'package-lock.json')) plan.push({ command: 'npm', args: ['audit', 'fix'], cwd: '.' });
  const composerLocks = new Map();
  for (const advisory of found.filter(item => item.lock !== 'package-lock.json')) {
    const directory = dirname(advisory.lock);
    if (!composerLocks.has(directory)) composerLocks.set(directory, new Set());
    composerLocks.get(directory).add(advisory.package);
  }
  for (const [directory, packages] of composerLocks) plan.push({ command: 'composer', args: ['update', '--with-dependencies', '--no-interaction', ...packages], cwd: directory });
  return plan;
}

function print(result) {
  for (const note of result.notes) console.log(`[dependency-review] ${note}`);
  for (const line of result.lines) console.log(`[dependency-review] ${line}.`);
  console.log(result.lines.length
    ? `[dependency-review] ${result.lines.length} finding${result.lines.length === 1 ? '' : 's'}`
    : '[dependency-review] no newer stable release without an exception and no advisory');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = ROOT;
  let record = false;
  let update = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--root' && args[index + 1]) root = resolve(args[++index]);
    else if (args[index] === '--record') record = true;
    else if (args[index] === '--update') update = true;
    else {
      console.error('Usage: node scripts/dependency-review.mjs [--root <checkout>] [--record] [--update]');
      process.exit(2);
    }
  }
  let result = review(root);
  if (update) {
    print(result);
    const plan = updatePlan(result);
    let failed = 0;
    for (const step of plan) {
      console.log(`[dependency-review] run ${step.command} ${step.args.join(' ')} in ${step.cwd}`);
      const run = spawnSync(step.command, step.args, { cwd: join(root, step.cwd), stdio: 'inherit' });
      if (run.error || run.status !== 0) {
        failed += 1;
        console.log(`[dependency-review] ${step.command} ${step.args.join(' ')} in ${step.cwd} ended with ${run.error?.message ?? `exit status ${run.status}`}`);
      }
    }
    console.log(`[dependency-review] ${plan.length - failed} of ${plan.length} update commands passed; reviewing again`);
    result = review(root);
  }
  print(result);
  if (record || update) {
    if (!result.complete) {
      console.log(`[dependency-review] ${RECORD} is unchanged: a registry or advisory query failed`);
      process.exit(1);
    }
    writeFileSync(join(root, RECORD), `${JSON.stringify(result.record, null, 2)}\n`);
    console.log(`[dependency-review] wrote ${RECORD}: ${result.record.dependencies.length} registry dependencies and ${result.record.locks.length} locks reviewed at ${result.record.reviewed}`);
  }
  process.exitCode = result.lines.length ? 1 : 0;
}
