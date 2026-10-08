#!/usr/bin/env node
// Runs make targets past failures and writes their report (`make ci-targets TARGETS="..."`):
//
//   node scripts/kit/ci-targets.mjs <report directory> <target>...
//   node scripts/kit/ci-targets.mjs --summary <report directory>
//
// Each target runs as `make -k <target>` to its end, also after an earlier target failed, with its output printed and written
// to <report directory>/targets/<target>.log; record.json and summary.md name each target with its result and, for a failed
// target, its first failure lines (scripts/kit/target-report.mjs). No target has a time limit. The run holds the lock
// <report directory>.lock, so two runs never write one report. The command ends with status 1 when a target failed or the
// report could not be written, and with status 2 for a usage error.
//
// `--summary` writes summary.md again from record.json, also when the run recorded nothing or did not record its end, and
// appends it to the job summary of GitHub Actions (GITHUB_STEP_SUMMARY). It names each setup step that did not succeed from
// CI_STEPS, the JSON of `toJSON(steps)`. A CI job runs it under `if: always()`, so the report of a job whose runner stopped is
// still written and uploaded.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capLog, failureLines, git, logPath, render, reportWriter, runLogged, startReport, toolchainVersions, warningLines } from './target-report.mjs';

const TARGET_NAME = /^[A-Za-z0-9_.-]+$/;
const USAGE = 'usage: node scripts/kit/ci-targets.mjs <report directory> <target>...  |  --summary <report directory>';
const now = () => new Date().toISOString();

/** Holds the lock file `file` (the pid of the holder) until the returned function is called; throws while another run holds it. */
export function acquire(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  for (;;) {
    try {
      writeFileSync(file, `${process.pid}\n`, { flag: 'wx' });
      return () => rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = Number.parseInt(readFileSync(file, 'utf8'), 10);
      let alive = Number.isInteger(holder);
      if (alive) {
        try { process.kill(holder, 0); } catch (killed) { alive = killed.code === 'EPERM'; }
      }
      if (alive) throw new Error(`the report is in use: ${file} is held by the process ${holder}; wait for that run to end`);
      // The holder ended without releasing the lock, so the lock is stale.
      rmSync(file, { force: true });
    }
  }
}

/**
 * Runs `targets` with `make -k` and writes the report to `directory`. `output(text, stream)` receives the output of the
 * targets and `print` the lines of the runner. Returns the exit status: 0 when every target passed and every report write
 * succeeded, 1 otherwise.
 */
export async function ciTargets({ root, directory, targets, env = process.env, make = 'make', environment, print = line => console.log(line), output = (text, stream) => process[stream].write(text) }) {
  const report = path.resolve(root, directory);
  const release = acquire(`${report}.lock`);
  try {
    startReport(report);
    const writer = reportWriter(print);
    const record = {
      title: `make ci-targets ${targets.join(' ')}`,
      tree: git(root, 'rev-parse', 'HEAD^{tree}'),
      environment: { ...(environment ?? toolchainVersions(root)), ...(env.ImageOS ? { runner: `${env.ImageOS} ${env.ImageVersion ?? ''}`.trim() } : {}) },
      result: 'incomplete',
      started: now(),
      ended: null,
      targets: targets.map(name => ({ name, status: 'pending', log: `targets/${name}.log` })),
    };
    const save = () => {
      record.reportErrors = [...writer.errors];
      writer.write(path.join(report, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
    };
    save();
    print(`[ci-targets] ${targets.length} targets on tree ${record.tree}; report ${path.relative(root, report) || '.'}`);
    for (const [index, target] of record.targets.entries()) {
      Object.assign(target, { status: 'running', started: now() });
      save();
      print(`[ci-targets] start ${target.name} (${index + 1}/${targets.length})`);
      const begin = Date.now();
      const log = logPath(report, target.name);
      const { lines, exit } = await runLogged({ root, target: target.name, log, writer, output, make, env });
      const passed = exit === `make ${target.name} exited with status 0`;
      Object.assign(target, { status: passed ? 'passed' : 'failed', ended: now(), elapsedMs: Date.now() - begin });
      if (!passed) target.failures = failureLines(lines, exit);
      const warnings = warningLines(lines);
      if (warnings.length) target.warnings = warnings;
      try { capLog(log); } catch (error) { writer.errors.push(`report write failed: ${log}: ${error.code ?? error.message}`); }
      save();
      print(`[ci-targets] ${target.name} ${target.status} in ${((Date.now() - begin) / 1000).toFixed(1)} s`);
    }
    const failed = record.targets.filter(target => target.status === 'failed');
    record.result = failed.length ? 'failed' : 'passed';
    record.ended = now();
    save();
    // The summary is written after the record, and the record once more after it, so that a failed write of the summary is recorded.
    const text = render({ title: record.title, record });
    writer.write(path.join(report, 'summary.md'), text);
    if (env.GITHUB_STEP_SUMMARY) writer.append(env.GITHUB_STEP_SUMMARY, text);
    save();
    print(text.trimEnd());
    if (writer.errors.length) print(`[ci-targets] ${writer.errors.length} report writes failed:\n${writer.errors.join('\n')}`);
    print(`[ci-targets] ${targets.length - failed.length} of ${targets.length} targets passed${failed.length ? `; failed: ${failed.map(target => target.name).join(', ')}` : ''}`);
    return failed.length === 0 && writer.errors.length === 0 ? 0 : 1;
  } finally {
    release();
  }
}

/** Writes summary.md of the report in `directory` from its record; returns 0, or 1 when a write failed. */
export function ciSummary({ root, directory, env = process.env, print = line => console.log(line) }) {
  const report = path.resolve(root, directory);
  const file = path.join(report, 'record.json');
  let record = null;
  if (existsSync(file)) {
    try { record = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { record = { error: `${path.relative(root, file)}: ${error.message}` }; }
  }
  let steps = {};
  if (env.CI_STEPS) {
    try { steps = JSON.parse(env.CI_STEPS); } catch (error) { print(`[ci-targets] CI_STEPS is not JSON: ${error.message}`); }
  }
  const text = render({ title: record?.title ?? 'make ci-targets', record, steps });
  const writer = reportWriter(print);
  writer.write(path.join(report, 'summary.md'), text);
  if (env.GITHUB_STEP_SUMMARY) writer.append(env.GITHUB_STEP_SUMMARY, text);
  print(text.trimEnd());
  return writer.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const [first, ...rest] = process.argv.slice(2);
  try {
    if (first === '--summary' && rest.length === 1) {
      process.exitCode = ciSummary({ root, directory: rest[0] });
    } else if (first && first !== '--summary' && rest.length > 0) {
      const bad = rest.find(name => !TARGET_NAME.test(name));
      if (bad !== undefined) throw Object.assign(new Error(`the target name ${JSON.stringify(bad)} is not a make target name [A-Za-z0-9_.-]+`), { usage: true });
      const repeated = rest.find((name, at) => rest.indexOf(name) !== at);
      if (repeated !== undefined) throw Object.assign(new Error(`the target ${repeated} is listed twice; its log would be overwritten`), { usage: true });
      process.exitCode = await ciTargets({ root, directory: first, targets: rest });
    } else {
      console.error(USAGE);
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`[ci-targets] ${error.usage ? `${error.message}; ${USAGE}` : error.message}`);
    process.exitCode = error.usage ? 2 : 1;
  }
}
