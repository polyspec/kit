// K1250: every job of a CI workflow of kit runs one recipe. A job has exactly one run step, `make ci-<job>` with make variables
// only, a matrix value as `NAME=${{ matrix.key }}`, and the job that judges the other jobs may pass `'${{ toJSON(needs) }}'`; every
// other step is a `uses:` step, and only those carry an `if:`. So the order, the conditions and the values of a job live in its
// recipe, and a local run of the job is the same make call. The workflows are every workflow of kit and every example workflow
// that kit ships.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { makeDatabase } from '../../scripts/kit/owner-check.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The CI workflows of kit, each with the job that judges the results of the others. */
const WORKFLOWS = [
  { file: '.github/workflows/ci.yml', judge: 'kit' },
  { file: '.github/workflows/release.yml', judge: '' },
  { file: 'workflows/ci-pipeline.yml', judge: 'required' },
  { file: 'workflows/release.yml', judge: '' },
] as const;
const STEP_KEYS_OF_RUN = new Set(['run', 'name', 'id', 'shell']);
const WORD = /^[A-Za-z0-9_.\/-]+$/;

type Step = Record<string, unknown>;

/** The argument of a run line is a make variable whose value is a plain word, a matrix value or, for the judge, the needs. */
function argumentFinding(argument: string, judge: boolean): string | null {
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(argument);
  if (!match) return `${argument} is no make variable NAME=value`;
  const value = match[2] ?? '';
  if (/^\$\{\{ matrix\.[A-Za-z0-9_-]+ \}\}$/.test(value)) return null;
  if (judge && value === "'${{ toJSON(needs) }}'") return null;
  if (!value.includes('${{') && WORD.test(value)) return null;
  return `${argument} passes a value that is neither a plain word nor a matrix value${judge ? ' nor the needs' : ''}`;
}

/** The findings of the rule for the jobs of `workflow`, whose judging job is `judge`. */
export function jobFindings(workflow: unknown, judge: string): string[] {
  const findings: string[] = [];
  const jobs = (workflow as { jobs?: Record<string, { steps?: Step[] }> }).jobs ?? {};
  for (const [id, job] of Object.entries(jobs)) {
    const steps = job.steps ?? [];
    const runs = steps.filter(step => 'run' in step);
    if (runs.length !== 1) findings.push(`${id}: ${runs.length} run steps; a job has exactly one, make ci-${id}`);
    for (const step of steps) {
      if ('run' in step) {
        const extra = Object.keys(step).filter(key => !STEP_KEYS_OF_RUN.has(key));
        if (extra.length) findings.push(`${id}: the run step has ${extra.join(', ')}; a run step carries no condition, environment or folder of its own`);
        const words = String(step.run).trim().split(/ (?=[A-Z][A-Z0-9_]*=)/);
        if (words[0] !== `make ci-${id}`) findings.push(`${id}: the run step runs ${JSON.stringify(step.run)}, not make ci-${id}`);
        for (const argument of words.slice(1)) {
          const finding = argumentFinding(argument, id === judge);
          if (finding) findings.push(`${id}: ${finding}`);
        }
      } else if (!('uses' in step)) findings.push(`${id}: a step is neither a run step nor a uses step`);
    }
  }
  return findings;
}

test('K1250: every job of the workflows of kit runs one make ci-<job> step, and every other step is a uses step', () => {
  const make = makeDatabase(ROOT);
  for (const { file, judge } of WORKFLOWS) {
    const workflow = parse(readFileSync(path.join(ROOT, file), 'utf8')) as { jobs: Record<string, unknown> };
    assert.ok(Object.keys(workflow.jobs).length > 0, `${file} declares jobs`);
    assert.deepEqual(jobFindings(workflow, judge), [], file);
    for (const id of Object.keys(workflow.jobs)) assert.ok(make.targets.has(`ci-${id}`), `${file}: the Makefile of kit defines ci-${id}`);
  }
});

test('K1250: the rule reports a second run step, an expression, a condition on a run step and a run of another target', () => {
  const workflow = parse([
    'jobs:',
    '  tests:',
    '    steps:',
    '      - uses: actions/checkout@v0',
    '      - run: make install-tools TOOLS="${{ join(matrix.tools, \' \') }}"',
    '      - if: ${{ !cancelled() }}',
    '        run: make ci-tests SHARD=${{ matrix.shard }} TARGETS=${{ needs.plan.outputs.targets }}',
    '  judge:',
    '    steps:',
    "      - run: make ci-judge RESULTS='${{ toJSON(needs) }}'",
    '  other:',
    '    steps:',
    "      - run: make ci-other RESULTS='${{ toJSON(needs) }}'",
    '      - name: no action',
    '',
  ].join('\n'));
  assert.deepEqual(jobFindings(workflow, 'judge'), [
    'tests: 2 run steps; a job has exactly one, make ci-tests',
    'tests: the run step runs "make install-tools TOOLS=\\"${{ join(matrix.tools, \' \') }}\\"", not make ci-tests',
    'tests: TOOLS="${{ join(matrix.tools, \' \') }}" passes a value that is neither a plain word nor a matrix value',
    'tests: the run step has if; a run step carries no condition, environment or folder of its own',
    'tests: TARGETS=${{ needs.plan.outputs.targets }} passes a value that is neither a plain word nor a matrix value',
    "other: RESULTS='${{ toJSON(needs) }}' passes a value that is neither a plain word nor a matrix value",
    'other: a step is neither a run step nor a uses step',
  ]);
});
