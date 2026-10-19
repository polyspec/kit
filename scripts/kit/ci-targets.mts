#!/usr/bin/env node
// Runs make targets past failures and writes their report (`make ci-targets TARGETS="..."`):
//
//   node scripts/kit/ci-targets.mts <report directory> <target>...
//   node scripts/kit/ci-targets.mts --summary <report directory>
//
// The run is a suite and runs only in CI (ci-only.mts). Each target runs as `make -k <target>` to its end, also after an earlier target failed, with its output printed and written
// to <report directory>/targets/<target>.log; record.json and summary.md name each target with its result and, for a failed
// target, its first failure lines (scripts/kit/target-report.mts). No target has a time limit. The run holds the lock
// <report directory>.lock (holder-lock.mts), so two runs never write one report. The command ends with status 1 when a target failed or the
// report could not be written, and with status 2 for a usage error.
//
// `--summary` writes summary.md again from record.json, also when the run recorded nothing or did not record its end, and
// appends it to the job summary of GitHub Actions (GITHUB_STEP_SUMMARY). It names each setup step that did not succeed from
// CI_STEPS, the JSON of `toJSON(steps)`. A CI job runs it under `if: always()`, so the report of a job whose runner stopped is
// still written and uploaded.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { acquireHolderLock } from './holder-lock.mts';
import { now } from './time.mts';
import { toolchainVersions } from './check-toolchain.mts';
import { capLog, failureLines, logPath, render, reportWriter, runLogged, startReport, TARGET_NAME, targetPassed, treeId, warningLines } from './target-report.mts';
import type { RunRecord, UnreadRecord } from './target-report.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { jsonText } from './bootstrap/files.mts';
import { ConfigError, parseJson, readJsonFile } from './schema-validate.mts';
import { errorCode } from './process.mts';
import { present } from './present.mts';
import { ciRefusal } from './ci-only.mts';

const USAGE = 'usage: node scripts/kit/ci-targets.mts <report directory> <target>...  |  --summary <report directory>';
// The toolchains whose releases the record of a run names.
const REPORTED_TOOLS = ['node', 'npm', 'go', 'rust', 'php', 'composer'];

/**
 * Runs `targets` with `make -k` and writes the report to `directory`. `output(text, stream)` receives the output of the
 * targets and `print` the lines of the runner. Returns the exit status: 0 when every target passed and every report write
 * succeeded, 1 otherwise.
 */
export async function ciTargets({ root, directory, targets, env = process.env, make = 'make', environment, print = line => console.log(line), output = (text, stream) => process[stream].write(text) }: {
  root: string; directory: string; targets: string[]; env?: NodeJS.ProcessEnv; make?: string; environment?: Record<string, string>;
  print?: (line: string) => void; output?: (text: string, stream: 'stdout' | 'stderr') => void;
}) {
  const refused = ciRefusal('make ci-targets', env);
  if (refused) {
    print(`[ci-targets] refuse: ${refused}`);
    return 1;
  }
  const report = path.resolve(root, directory);
  const held = acquireHolderLock(`${report}.lock`, { checkout: root, command: `ci-targets ${targets.join(' ')}` });
  try {
    startReport(report);
    const writer = reportWriter(print);
    const record: RunRecord = {
      title: `make ci-targets ${targets.join(' ')}`,
      tree: treeId(root),
      environment: { ...(environment ?? toolchainVersions(REPORTED_TOOLS, { root })), ...(env.ImageOS ? { runner: `${env.ImageOS} ${env.ImageVersion ?? ''}`.trim() } : {}) },
      result: 'incomplete',
      started: now(),
      ended: null,
      targets: targets.map(name => ({ name, status: 'pending', log: `targets/${name}.log` })),
    };
    const save = () => {
      record.reportErrors = [...writer.errors];
      writer.write(path.join(report, 'record.json'), jsonText(record));
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
      const passed = targetPassed(target.name, exit);
      Object.assign(target, { status: passed ? 'passed' : 'failed', ended: now(), elapsedMs: Date.now() - begin });
      if (!passed) target.failures = failureLines(lines, exit);
      const warnings = warningLines(lines);
      if (warnings.length) target.warnings = warnings;
      try { capLog(log); } catch (error) {
        if (!(error instanceof Error)) throw error;
        writer.errors.push(`report write failed: ${log}: ${errorCode(error) ?? error.message}`);
      }
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
    held.release();
  }
}

/** Writes summary.md of the report in `directory` from its record; returns 0, or 1 when a write failed. */
export function ciSummary({ root, directory, env = process.env, print = line => console.log(line) }: { root: string; directory: string; env?: NodeJS.ProcessEnv; print?: (line: string) => void }) {
  const report = path.resolve(root, directory);
  const file = path.join(report, 'record.json');
  let record: RunRecord | UnreadRecord | null = null;
  if (existsSync(file)) {
    try {
      record = readJsonFile<RunRecord>(file, 'run-record.schema.json');
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      record = { error: `${path.relative(root, file)}: ${error.message}` };
    }
  }
  let steps: Record<string, { outcome?: string }> = {};
  let unreadSteps = false;
  if (env.CI_STEPS) {
    // The summary is still written without the steps, and the run fails.
    try {
      steps = parseJson<Record<string, { outcome?: string }>>(env.CI_STEPS, 'ci-steps.schema.json', 'CI_STEPS');
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      unreadSteps = true;
      print(`[ci-targets] ${error.message}`);
    }
  }
  const text = render({ title: record?.title ?? 'make ci-targets', record, steps });
  const writer = reportWriter(print);
  writer.write(path.join(report, 'summary.md'), text);
  if (env.GITHUB_STEP_SUMMARY) writer.append(env.GITHUB_STEP_SUMMARY, text);
  print(text.trimEnd());
  return writer.errors.length === 0 && !unreadSteps ? 0 : 1;
}

if (isMain(import.meta.url)) {
  const root = repositoryRoot();
  const [first, ...rest] = process.argv.slice(2);
  try {
    if (first === '--summary' && rest.length === 1) {
      // The condition holds exactly one argument after --summary.
      process.exitCode = ciSummary({ root, directory: present(rest[0], 'rest[0]') });
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
    if (!(error instanceof Error)) throw error;
    const usage = 'usage' in error && error.usage === true;
    console.error(`[ci-targets] ${usage ? `${error.message}; ${USAGE}` : error.message}`);
    process.exitCode = usage ? 2 : 1;
  }
}
