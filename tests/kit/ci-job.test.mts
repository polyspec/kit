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
    assert.deepEqual(planJob(root, '.github/workflows/ci.yml', 'bindings').combinations, [{}]);
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'none'), /has no job none; its jobs are bindings, other/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const [step, cause] of [
    ['run: echo ${{ github.sha }}', /run: echo \$\{\{ github\.sha \}\} reads github\.sha, a value of a run of GitHub/],
    ['if: github.ref == \'refs/heads/main\'\n        run: true', /if: github\.ref == 'refs\/heads\/main' reads github\.ref/],
    ['run: true\n        env: { A: "${{ secrets.X }}" }', /env A: \$\{\{ secrets\.X \}\} reads secrets\.X, a secret of the repository/],
  ] as const) {
    const other = fixture(`jobs:\n  j:\n    steps:\n      - ${step}\n`);
    try {
      assert.throws(() => planJob(other, '.github/workflows/ci.yml', 'j'), cause);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  }
});

const MATRIX = `jobs:
  check:
    strategy:
      matrix:
        include:
          - { name: ts, targets: "a b" }
          - { name: rust, targets: c }
    steps:
      - run: printf "\${{ matrix.name }}:\${{ matrix.targets }};" >> order.log
      - run: test "\${{ runner.temp }}" = "$RUNNER_TEMP" && test -d "\${{ runner.temp }}"
        working-directory: .
  axes:
    strategy:
      matrix: { os: [x, y], php: ['8.4', '8.5'] }
    steps:
      - run: printf "\${{ matrix.os }}-\${{ matrix.php }};" >> axes.log
  mixed:
    strategy:
      matrix: { os: [x], include: [{ os: x, extra: 1 }] }
    steps:
      - run: true
`;

test('K1227: a matrix job runs each combination of include or of the axes, or those that --matrix selects', async () => {
  const root = fixture(MATRIX);
  try {
    const lines: string[] = [];
    assert.equal(await ciJob({ root, workflow: '.github/workflows/ci.yml', job: 'check', print: line => lines.push(line) }), 0, lines.join('\n'));
    assert.equal(readFileSync(path.join(root, 'order.log'), 'utf8'), 'ts:a b;rust:c;');
    assert.ok(lines.at(-1)?.includes('2 runs, 4 steps passed'), lines.join('\n'));
    assert.equal(await ciJob({ root, workflow: '.github/workflows/ci.yml', job: 'check', select: { name: 'rust' }, print: () => {} }), 0);
    assert.equal(readFileSync(path.join(root, 'order.log'), 'utf8'), 'ts:a b;rust:c;rust:c;');
    assert.equal(await ciJob({ root, workflow: '.github/workflows/ci.yml', job: 'axes', print: () => {} }), 0);
    assert.equal(readFileSync(path.join(root, 'axes.log'), 'utf8'), 'x-8.4;x-8.5;y-8.4;y-8.5;');
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'check', { name: 'go' }), /no combination of its matrix has \{"name":"go"\}; its combinations are/);
    assert.deepEqual(planJob(root, '.github/workflows/ci.yml', 'mixed').combinations, [{ os: 'x', extra: 1 }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const CONDITIONS = `jobs:
  shards:
    strategy:
      matrix: { shard: [1, 2, 3], runner: [linux, windows] }
    steps:
      - if: \${{ contains(fromJSON('[1,3]'), matrix.shard) && matrix.runner != 'windows' }}
        run: printf "\${{ matrix.shard }}-\${{ matrix.runner }};" >> picked.log
      - if: \${{ matrix.shard == 2 && matrix.runner == 'linux' && runner.os != 'Plan9' }}
        run: printf "\${{ matrix.shard }}-\${{ matrix.runner }};" >> picked.log
`;

test('K1227: a condition of matrix values and literals is decided as CI decides it', async () => {
  const root = fixture(CONDITIONS);
  try {
    const lines: string[] = [];
    assert.equal(await ciJob({ root, workflow: '.github/workflows/ci.yml', job: 'shards', print: line => lines.push(line) }), 0, lines.join('\n'));
    assert.equal(readFileSync(path.join(root, 'picked.log'), 'utf8'), '1-linux;2-linux;3-linux;');
    assert.ok(lines.some(line => line.includes('skipped:') && line.includes('if: ')), lines.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// K1228: the run evaluates the expressions of GitHub Actions, follows the status of its steps and runs a job after the job
// whose outputs it reads.
async function run(root: string, job: string, select: Record<string, string> = {}): Promise<{ status: number; lines: string[] }> {
  const lines: string[] = [];
  const status = await ciJob({ root, workflow: '.github/workflows/ci.yml', job, select, print: line => lines.push(line) });
  return { status, lines };
}

function read(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

const FILES = `jobs:
  files:
    env: { LEVEL: job }
    steps:
      - id: plan
        run: |
          echo 'common_tools=["php","composer"]' >> "$GITHUB_OUTPUT"
          echo 'empty=[]' >> "$GITHUB_OUTPUT"
          printf 'notes<<EOF\\nfirst line\\nsecond=line\\nEOF\\n' >> "$GITHUB_OUTPUT"
          echo 'LEVEL=from-env-file' >> "$GITHUB_ENV"
          echo "$PWD/first" >> "$GITHUB_PATH"
          echo "$PWD/bin" >> "$GITHUB_PATH"
          echo '### summary line' >> "$GITHUB_STEP_SUMMARY"
      - if: \${{ contains(steps.plan.outputs.common_tools, 'php') }}
        run: echo 'php planned' >> files.log
      - if: \${{ steps.plan.outputs.empty != '[]' }}
        run: echo 'never' >> files.log
      - name: install
        run: echo make install-tools TOOLS="\${{ join(fromJSON(steps.plan.outputs.common_tools), ' ') }}" >> files.log
      - run: |
          echo "\${{ steps.plan.outputs.notes }}" >> files.log
          echo "$LEVEL \${{ env.LEVEL }} \${{ steps.plan.outcome }}/\${{ steps.plan.conclusion }}" >> files.log
          echo "\${PATH%%:*}" | sed "s|^$PWD/||" >> files.log
        env: { STEP: step }
`;

test('K1228: GITHUB_OUTPUT, GITHUB_ENV, GITHUB_PATH and GITHUB_STEP_SUMMARY reach the later steps as in CI', async () => {
  const root = fixture(FILES);
  try {
    const { status, lines } = await run(root, 'files');
    assert.equal(status, 0, lines.join('\n'));
    assert.equal(read(root, 'files.log'), 'php planned\nmake install-tools TOOLS=php composer\nfirst line\nsecond=line\nfrom-env-file from-env-file success/success\nbin\n');
    assert.ok(lines.some(line => line.includes('skipped:') && line.includes("steps.plan.outputs.empty != '[]'")), lines.join('\n'));
    assert.ok(lines.some(line => line.includes('summary of') && line.includes('### summary line')), lines.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const STATUS = `jobs:
  status:
    steps:
      - id: context_prepare
        run: echo prepared >> status.log
      - id: tolerated
        continue-on-error: true
        run: exit 4
      - run: echo "after tolerated \${{ steps.tolerated.outcome }}/\${{ steps.tolerated.conclusion }}" >> status.log
      - id: gate
        run: exit 5
      - run: echo never >> status.log
      - if: \${{ failure() }}
        run: echo "failure \${{ steps.gate.outcome }}" >> status.log
      - if: \${{ always() && steps.context_prepare.outcome != 'skipped' }}
        run: echo cleanup >> status.log
      - if: \${{ !cancelled() }}
        run: echo report >> status.log
      - if: \${{ success() }}
        run: echo never >> status.log
`;

test('K1228: after a failing step the run skips the plain steps, runs those of failure(), always() and !cancelled(), and ends with 1', async () => {
  const root = fixture(STATUS);
  try {
    const { status, lines } = await run(root, 'status');
    assert.equal(status, 1, lines.join('\n'));
    assert.equal(read(root, 'status.log'), 'prepared\nafter tolerated failure/success\nfailure failure\ncleanup\nreport\n');
    assert.ok(lines.some(line => line.includes('continued:') && line.includes('continue-on-error')), lines.join('\n'));
    assert.ok(lines.some(line => line.includes('failed:') && line.includes('status 5')), lines.join('\n'));
    assert.ok(lines.at(-1)?.includes('failure'), lines.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const COMPOSITE = `inputs:
  tools: { description: tools, default: none }
  level: { description: level, default: '\${{ runner.os }}' }
outputs:
  joined: { value: '\${{ steps.join.outputs.joined }}' }
runs:
  using: composite
  steps:
    - id: join
      shell: bash
      run: echo "joined=\${{ inputs.tools }}-\${{ inputs.level }}" >> "$GITHUB_OUTPUT"
    - shell: bash
      run: test -f "\${{ github.action_path }}/action.yml" && echo "path $CALLER" >> composite.log
    - shell: bash
      run: exit 6
    - if: \${{ failure() }}
      shell: bash
      run: echo inner-failure >> composite.log
`;

const CALLER = `jobs:
  caller:
    steps:
      - id: boot
        uses: ./.github/actions/bootstrap
        continue-on-error: true
        env: { CALLER: caller-env }
        with: { tools: "\${{ format('{0}+{1}', 'php', 'go') }}" }
      - run: echo "\${{ steps.boot.outputs.joined }} \${{ steps.boot.outcome }} \${{ steps.boot.conclusion }}" >> composite.log
`;

test('K1228: a composite action takes its inputs over their defaults, gives its outputs and keeps its own status', async () => {
  const root = fixture(CALLER, COMPOSITE);
  try {
    const { status, lines } = await run(root, 'caller');
    assert.equal(status, 0, lines.join('\n'));
    const os = process.platform === 'darwin' ? 'macOS' : process.platform === 'linux' ? 'Linux' : 'Windows';
    assert.equal(read(root, 'composite.log'), `path caller-env\ninner-failure\nphp+go-${os} failure success\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const MATRIX_RULES = `jobs:
  fruit:
    strategy:
      matrix:
        fruit: [apple, pear]
        animal: [cat, dog]
        include:
          - color: green
          - color: pink
            animal: cat
          - fruit: apple
            shape: circle
          - fruit: banana
          - fruit: banana
            animal: cat
    steps:
      - run: true
  excluded:
    strategy:
      matrix:
        os: [linux, mac]
        node: [24, 26]
        exclude:
          - { os: mac, node: 24 }
        include:
          - { os: mac, node: 24, extra: back }
    steps:
      - run: true
`;

test('K1228: include and exclude follow the rules of GitHub', () => {
  const root = fixture(MATRIX_RULES);
  try {
    assert.deepEqual(planJob(root, '.github/workflows/ci.yml', 'fruit').combinations, [
      { fruit: 'apple', animal: 'cat', color: 'pink', shape: 'circle' },
      { fruit: 'apple', animal: 'dog', color: 'green', shape: 'circle' },
      { fruit: 'pear', animal: 'cat', color: 'pink' },
      { fruit: 'pear', animal: 'dog', color: 'green' },
      { fruit: 'banana' },
      { fruit: 'banana', animal: 'cat' },
    ]);
    assert.deepEqual(planJob(root, '.github/workflows/ci.yml', 'excluded').combinations, [
      { os: 'linux', node: 24 }, { os: 'linux', node: 26 }, { os: 'mac', node: 26 }, { os: 'mac', node: 24, extra: 'back' },
    ]);
    assert.deepEqual(planJob(root, '.github/workflows/ci.yml', 'excluded', { node: '26' }).combinations, [{ os: 'linux', node: 26 }, { os: 'mac', node: 26 }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const NEEDS = `jobs:
  shared:
    outputs:
      runtimes: \${{ steps.plan.outputs.runtimes }}
      has_runtimes: \${{ steps.plan.outputs.has_runtimes }}
    steps:
      - id: plan
        run: |
          echo shared >> needs.log
          echo 'runtimes=[{"runtime":"go","installTools":["go"]},{"runtime":"ts","installTools":[]}]' >> "$GITHUB_OUTPUT"
          echo 'has_runtimes=true' >> "$GITHUB_OUTPUT"
  runtime:
    needs: shared
    if: \${{ needs.shared.outputs.has_runtimes == 'true' }}
    strategy:
      fail-fast: false
      matrix:
        runtime: [go, ts]
        include: \${{ fromJSON(needs.shared.outputs.runtimes) }}
    runs-on: \${{ needs.shared.outputs.runner }}
    steps:
      - if: \${{ join(matrix.installTools, ' ') != '' }}
        run: echo "tools \${{ join(matrix.installTools, ' ') }}" >> needs.log
      - run: echo "gate \${{ matrix.runtime }}" >> needs.log
  skipped:
    needs: shared
    if: needs.shared.outputs.has_runtimes != 'true'
    steps:
      - run: echo never >> needs.log
  verify:
    needs: shared
    runs-on: \${{ needs.shared.outputs.runner }}
    steps:
      - run: echo verify >> needs.log
  required:
    if: \${{ always() }}
    needs: [shared, runtime]
    env:
      SHARED_RESULT: \${{ needs.shared.result }}
    steps:
      - run: echo "$SHARED_RESULT"
  summary:
    needs: [shared]
    steps:
      - env: { RESULTS: "\${{ toJSON(needs) }}" }
        run: echo "$RESULTS"
  matrixed:
    strategy:
      matrix: { n: [1, 2] }
    outputs: { n: "\${{ matrix.n }}" }
    steps:
      - run: true
  reader:
    needs: matrixed
    steps:
      - run: echo "\${{ needs.matrixed.outputs.n }}"
`;

test('K1228: a job that reads the outputs of a needed job runs after it, as in CI, and a job that judges other jobs is refused', async () => {
  const root = fixture(NEEDS);
  try {
    const plan = planJob(root, '.github/workflows/ci.yml', 'runtime');
    assert.deepEqual(plan.needs.map(needed => needed.job), ['shared']);
    assert.equal(plan.combinations, undefined);
    const { status, lines } = await run(root, 'runtime');
    assert.equal(status, 0, lines.join('\n'));
    assert.equal(read(root, 'needs.log'), 'shared\ntools go\ngate go\ngate ts\n');
    assert.ok(lines.at(-1)?.includes('2 runs'), lines.join('\n'));
    const ts = await run(root, 'runtime', { runtime: 'ts' });
    assert.equal(ts.status, 0, ts.lines.join('\n'));
    assert.equal(read(root, 'needs.log'), 'shared\ntools go\ngate go\ngate ts\nshared\ngate ts\n');
    const skipped = await run(root, 'skipped');
    assert.equal(skipped.status, 0, skipped.lines.join('\n'));
    assert.ok(skipped.lines.some(line => line.includes('skipped:') && line.includes('job skipped')), skipped.lines.join('\n'));
    assert.deepEqual(planJob(root, '.github/workflows/ci.yml', 'verify').needs, []);
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'required'), /reads needs\.shared\.result, the outcome of other jobs of the CI run/);
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'summary'), /reads needs, the outcome of other jobs of the CI run/);
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'reader'), /reads the outputs of job matrixed, which has a matrix/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const FAIL_FAST = `jobs:
  fast:
    strategy:
      matrix: { n: [1, 2, 3] }
    steps:
      - run: echo "\${{ matrix.n }}" >> fast.log && test "\${{ matrix.n }}" != 2
  slow:
    strategy:
      fail-fast: false
      matrix: { n: [1, 2, 3] }
    steps:
      - run: echo "\${{ matrix.n }}" >> slow.log && test "\${{ matrix.n }}" != 2
`;

test('K1228: fail-fast cancels the combinations after a failed one, and fail-fast false runs them', async () => {
  const root = fixture(FAIL_FAST);
  try {
    const fast = await run(root, 'fast');
    assert.equal(fast.status, 1);
    assert.equal(read(root, 'fast.log'), '1\n2\n');
    assert.ok(fast.lines.some(line => line.includes('cancelled by fail-fast') && line.includes('"n":3')), fast.lines.join('\n'));
    const slow = await run(root, 'slow');
    assert.equal(slow.status, 1);
    assert.equal(read(root, 'slow.log'), '1\n2\n3\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const SHELLS = `defaults:
  run: { working-directory: sub }
jobs:
  shells:
    strategy:
      matrix:
        include:
          - { runner: windows-2025 }
          - { runner: macos-15 }
    defaults:
      run: { shell: sh }
    steps:
      - run: echo "$0" | grep -q '\\.sh$' && echo "sh $(basename "$PWD")" >> ../shells.log
      - shell: bash
        run: set -o | grep -q 'pipefail.*on' && echo bash >> ../shells.log
      - if: matrix.runner == 'windows-2025'
        shell: pwsh
        run: Write-Output never
  pwsh:
    steps:
      - shell: pwsh
        run: Write-Output never
`;

test('K1228: defaults.run gives the shell and the folder, and a pwsh step that runs is refused on a machine other than Windows', async () => {
  if (process.platform === 'win32') return;
  const root = fixture(SHELLS);
  mkdirSync(path.join(root, 'sub'));
  try {
    const { status, lines } = await run(root, 'shells', { runner: 'macos-15' });
    assert.equal(status, 0, lines.join('\n'));
    assert.equal(read(root, 'shells.log'), 'sh sub\nbash\n');
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'shells'), /step 3: shell pwsh is not a shell that the local run gives/);
    assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'pwsh'), /shell pwsh is not a shell that the local run gives/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K1228: what the run does not have is refused by name', () => {
  for (const [job, cause] of [
    ['steps:\n      - id: php\n        uses: shivammathur/setup-php@v2\n      - run: echo ${{ steps.php.outputs.php-version }}', /reads steps\.php\.outputs\.php-version, the step php of the external action shivammathur\/setup-php@v2/],
    ['steps:\n      - run: echo ${{ vars.NAME }}', /reads vars\.NAME, a variable of the repository/],
    ['steps:\n      - run: echo ${{ runner.name }}', /reads runner\.name, a value of a GitHub runner/],
    ['steps:\n      - run: echo ${{ strategy.job-index }}', /reads strategy\.job-index, the strategy context/],
    ['steps:\n      - run: echo ${{ inputs.x }}', /reads inputs\.x, the inputs of a workflow call/],
    ['steps:\n      - run: echo ${{ hashFiles(\'x\') }}', /Unrecognized function: 'hashFiles'/],
    ['container: node:26\n    steps:\n      - run: true', /has container/],
    ['services: { db: { image: x } }\n    steps:\n      - run: true', /has services/],
    ['needs: other\n    steps:\n      - run: true', /./],
  ] as const) {
    const root = fixture(`jobs:\n  other:\n    steps:\n      - run: true\n  j:\n    ${job}\n`);
    try {
      if (job.startsWith('needs')) assert.deepEqual(planJob(root, '.github/workflows/ci.yml', 'j').needs, []);
      else assert.throws(() => planJob(root, '.github/workflows/ci.yml', 'j'), cause);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('K1228: a missing matrix value is null and writes an empty text, as in CI', async () => {
  const root = fixture('jobs:\n  j:\n    steps:\n      - run: printf "[${{ matrix.missing }}]" > missing.log\n');
  try {
    const { status, lines } = await run(root, 'j');
    assert.equal(status, 0, lines.join('\n'));
    assert.equal(read(root, 'missing.log'), '[]');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
