import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ciJob, planJob } from '../../scripts/kit/ci-job.mts';

// K1227: the run of one CI job runs the run steps of the job and of its local composite actions in their order.
function fixture(workflow: string, action?: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kit-ci-job-'));
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  writeFileSync(path.join(root, '.github/workflows/ci.yml'), workflow);
  if (action !== undefined) {
    mkdirSync(path.join(root, '.github/actions/bootstrap'), { recursive: true });
    writeFileSync(path.join(root, '.github/actions/bootstrap/action.yml'), action);
  }
  return root;
}

const ACTION = `runs:
  using: composite
  steps:
    - uses: actions/setup-node@v6
      with: { node-version-file: mise.toml }
    - run: printf 'bootstrap ' >> order.log
      shell: bash
    - run: printf "packages:$KIND " >> order.log
      shell: bash
      env: { KIND: npm }
`;

const WORKFLOW = `env: { TOP: top }
jobs:
  bindings:
    runs-on: ubuntu-26.04-arm
    env: { JOB: job }
    steps:
      - uses: actions/checkout@v6
      - uses: ./.github/actions/bootstrap
      - name: tools
        run: printf "tools:$TOP:$JOB " >> order.log
      - name: temp
        run: test -d "$RUNNER_TEMP" && printf "$RUNNER_TEMP" > temp.txt
      - name: report
        if: \${{ !cancelled() }}
        run: printf 'report' >> order.log
  other:
    uses: ./.github/workflows/assets.yml
`;

test('K1227: the run steps of the job and of its composite action run in order, external actions are named', async () => {
  const root = fixture(WORKFLOW, ACTION);
  try {
    const lines: string[] = [];
    const status = await ciJob({ root, workflow: '.github/workflows/ci.yml', job: 'bindings', print: line => lines.push(line) });
    assert.equal(status, 0, lines.join('\n'));
    assert.equal(readFileSync(path.join(root, 'order.log'), 'utf8'), 'bootstrap packages:npm tools:top:job report');
    assert.ok(lines.some(line => line.includes('not run on this machine') && line.includes('actions/checkout@v6')), lines.join('\n'));
    assert.ok(lines.some(line => line.includes('actions/setup-node@v6') && line.includes('node-version-file')), lines.join('\n'));
    assert.ok(lines.at(-1)?.includes('5 steps passed'), lines.join('\n'));
    const temp = readFileSync(path.join(root, 'temp.txt'), 'utf8');
    assert.throws(() => readFileSync(temp), /ENOENT|EISDIR/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K1227: the run stops at the first failing step and names it', async () => {
  const root = fixture(`jobs:
  j:
    steps:
      - name: first
        run: exit 3
      - name: second
        run: touch second
`);
  try {
    const lines: string[] = [];
    const status = await ciJob({ root, workflow: '.github/workflows/ci.yml', job: 'j', print: line => lines.push(line) });
    assert.equal(status, 1);
    assert.ok(lines.some(line => line.includes('failed') && line.includes('(first)') && line.includes('status 3')), lines.join('\n'));
    assert.throws(() => readFileSync(path.join(root, 'second')), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K1227: a reusable workflow, an expression, an unknown condition and a missing job are refused by name', () => {
  const root = fixture(WORKFLOW, ACTION);
  try {
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'other'), /calls the reusable workflow/);
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'none'), /has no job none; its jobs are bindings, other/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const [step, cause] of [
    ['run: echo ${{ github.sha }}', /run holds a \$\{\{ \}\} expression/],
    ['if: github.ref == \'refs/heads/main\'\n        run: true', /is not always\(\), success\(\) or !cancelled\(\)/],
    ['run: true\n        env: { A: "${{ secrets.X }}" }', /env A holds the expression/],
  ] as const) {
    const other = fixture(`jobs:\n  j:\n    steps:\n      - ${step}\n`);
    try {
      assert.throws(() => planJob(other, '.github/workflows/ci.yml', 'j'), cause);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }
});
