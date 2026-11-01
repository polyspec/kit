// Tests of kit-check.mts: the configuration is read against the schemas of kit, and the names of the targets, the suite, the
// tracked links and the other files of a repository are its own (K810).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { bootstrapCopyFindings, check, ciNameFinding, gateNames, linkStepFindings, pipelineFindings } from '../../scripts/kit/kit-check.mts';
import { initRepository } from './sandbox-repository.mts';
import { tree } from './tree.mts';

test('kit-check reads the configuration only: a tracked link, a target of its own name and an old config pass (K810)', (t) => {
  const root = tree(t, {
    'Makefile': 'test-unit:\n\t@true\nCHECK_TARGETS := test-unit\n',
    'config/commits.json': '{}\n',
    'packages/go/go.mod': 'module x\n',
    'a.txt': 'a\n',
  });
  symlinkSync('a.txt', path.join(root, 'link.txt'));
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: root }).status, 0);
  assert.deepEqual(check(root), []);
});

test('kit-check fails on a configuration that breaks its schema', (t) => {
  const root = tree(t, { 'Makefile': 'all:\n\t@true\n', 'config/checklist.json': '{ "schema": 1 }\n' });
  assert.ok(check(root).some(line => line.includes('config/checklist.json')), 'the finding names the file');
});

// K987: release.yml waits for the CI workflow by its name, so kit-check requires the ci.yml of the repository to carry that name.
test('kit-check requires the ci.yml of a repository to be named as the CI workflow that release.yml waits for (K987)', (t) => {
  const release = 'on:\n  workflow_run:\n    workflows: [ci]\n    types: [completed]\n';
  assert.equal(ciNameFinding(tree(t, { '.github/workflows/release.yml': release, '.github/workflows/ci.yml': 'name: ci\non:\n  push:\n' })), null);
  assert.match(ciNameFinding(tree(t, { '.github/workflows/release.yml': release, '.github/workflows/ci.yml': 'name: CI\non:\n  push:\n' })) ?? '', /ci\.yml is named CI, but \.github\/workflows\/release\.yml waits for the CI workflow ci/);
  assert.match(ciNameFinding(tree(t, { '.github/workflows/release.yml': release })) ?? '', /ci\.yml is missing/);
  assert.equal(ciNameFinding(tree(t)), null, 'a repository without the release workflow releases nothing');
});

// K992: the bootstrap of a CI job is the action that kit-sync vendors; a workflow of the repository with its own copy of the
// bootstrap is named by file and line, and the copies of kit are left to the copy check.
test('kit-check names each workflow line of a repository that copies the bootstrap of kit, and leaves the copies of kit alone (K992)', (t) => {
  const copy = 'jobs:\n  check:\n    steps:\n      - run: |\n          root="$PWD"\n          (cd "$RUNNER_TEMP" && npm exec --yes --package="npm@$version" -- npm --prefix "$root" ci --ignore-scripts --allow-remote=root)\n';
  // The form of an earlier kit, the npm of packageManager without --prefix, is a copy too.
  const earlier = 'jobs:\n  check:\n    steps:\n      - run: npm exec --yes --package="$(node -p \'require("./package.json").packageManager\')" -- npm ci --ignore-scripts --allow-remote=root\n';
  const root = tree(t, { '.github/workflows/ci.yml': copy, '.github/workflows/pages.yaml': copy, '.github/workflows/old.yml': earlier, '.github/workflows/ci-pipeline.yml': copy, '.github/workflows/clean.yml': 'jobs:\n  check:\n    steps:\n      - uses: ./.github/actions/kit-bootstrap\n      - run: npm ci --prefix tools\n' });
  const findings = bootstrapCopyFindings(root, new Set(['.github/workflows/ci-pipeline.yml']));
  assert.deepEqual(findings.map(finding => finding.split(' ')[0]), ['.github/workflows/ci.yml:6', '.github/workflows/old.yml:4', '.github/workflows/pages.yaml:6']);
  assert.match(findings[0] ?? '', /carries a copy of the bootstrap of kit; run the vendored action with `uses: \.\/\.github\/actions\/kit-bootstrap` after the checkout of the job instead \(K992, K996\)/);
  assert.deepEqual(bootstrapCopyFindings(tree(t), new Set()), [], 'a repository without workflows has no finding');
});

// K996: a copy whose npm ci runs through a target of the repository (make bootstrap of hyper) is named by its npm install, the
// step that only the bootstrap runs; the name of that step and a comment that quotes it are no copy.
test('kit-check names a bootstrap copy that runs npm ci through make bootstrap (K996)', (t) => {
  const hyper = 'jobs:\n  check:\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n      - name: make bootstrap\n        run: make bootstrap\n      - name: make install-tools TOOLS=npm\n        run: make install-tools TOOLS=npm\n      - name: make install-packages\n        run: make install-packages\n      - run: |\n          # make install-tools TOOLS=npm\n          make install-tools TOOLS=npm\n';
  assert.deepEqual(bootstrapCopyFindings(tree(t, { '.github/workflows/ci.yml': hyper }), new Set()).map(finding => finding.split(' ')[0]), ['.github/workflows/ci.yml:9', '.github/workflows/ci.yml:14']);
});

// K998: the self-diagnosis judges the rules that held no check. S12: the ci.yml of a consumer calls ci-pipeline.yml as its job kit,
// its other jobs follow with needs: kit, and no workflow of the repository names a gate of kit-gates again, checks out another
// repository or a path, or clones one. S11: no Makefile or workflow runs a link step of a package manager.
test('kit-check names a ci.yml that does not follow the pipeline of kit, a gate run again, a path checkout and a clone (K998, S12)', (t) => {
  const checkout = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
  const ci = [
    'name: ci', 'jobs:', '  kit:', '    uses: ./.github/workflows/ci-pipeline.yml',
    '  check:', '    runs-on: ubuntu-24.04', '    defaults:', '      run:', '        working-directory: app', '    steps:',
    `      - uses: ${checkout}`, '        with:', '          path: app',
    '      - run: make docs-check', '      - run: make ci-targets TARGETS="own-check lint-ts"',
    '  scripts:', '    needs: [kit]', '    steps:', `      - uses: ${checkout}`,
    `      - uses: ${checkout}`, '        with:', '          repository: acme/provider',
    '      - run: |', '          # git clone is named in a comment only', '          git clone https://github.com/acme/provider ../provider',
    '      - run: make own-check',
    '# a comment at the margin between jobs',
    '  "quoted":', '    needs: "kit"', '    steps:',
    '      - name: Check out the provider', `        uses: ${checkout}`, '        with:', '          path: provider',
    '      - name: make lint-ts is a name, not a command', '        run: make -C sub --no-print-directory lint-ts',
    "      - run: make ci-targets TARGETS='docs-check'",
    '      - run: |', "          cat > notes.txt <<'EOF'", '          make lint-ts', '          EOF',
    '      - uses: actions/upload-artifact@v4', '        with:', '          path: var/report',
    '  block:', '    needs:', '      - other', "      - 'kit'", '    steps:', '      - run: make own-check',
    '  late:', '    steps:', '      - run: make own-check', '',
  ].join('\n');
  const pages = `jobs:\n  build:\n    steps:\n      - uses: ${checkout}\n      - run: make docs-build\n`;
  const root = tree(t, {
    '.github/workflows/ci.yml': ci, '.github/workflows/pages.yml': pages, '.github/workflows/ci-pipeline.yml': 'jobs:\n  shared:\n    steps:\n      - run: make docs-check\n',
    'config/ci.json': '{"schema":1,"runtimes":[],"setup":{"shared":["lint-ts"],"parity":[],"runtimes":{"go":[],"php":[],"php-ext":[],"python":[],"rust":[],"ts":[]}}}\n',
  });
  const findings = pipelineFindings(root, new Set(['.github/workflows/ci-pipeline.yml']), new Set(['docs-check', 'lint-ts']));
  assert.deepEqual(findings.map(finding => finding.replace(/ (?:is|names|checks|clones|does) .*$/, '')), [
    '.github/workflows/ci.yml: job check',
    '.github/workflows/ci.yml: job late',
    '.github/workflows/ci.yml:13',
    '.github/workflows/ci.yml:14',
    '.github/workflows/ci.yml:15',
    '.github/workflows/ci.yml:22',
    '.github/workflows/ci.yml:25',
    '.github/workflows/ci.yml:34',
    '.github/workflows/ci.yml:36',
    '.github/workflows/ci.yml:37',
    'config/ci.json',
  ]);
  assert.match(findings[0] ?? '', /job check does not follow the job kit with needs: kit \(S12\)/);
  assert.match(findings[2] ?? '', /checks out to a path/);
  assert.match(findings[3] ?? '', /names the gate docs-check of kit-gates again/);
  assert.match(findings[4] ?? '', /names the gate lint-ts of kit-gates again/);
  assert.match(findings[5] ?? '', /checks out another repository/);
  assert.match(findings[6] ?? '', /clones a repository/);
  assert.match(findings[7] ?? '', /checks out to a path/, 'a step whose name comes before its uses is a checkout too');
  assert.match(findings[8] ?? '', /names the gate lint-ts/, 'the options of make and their arguments are no targets');
  assert.match(findings[9] ?? '', /names the gate docs-check/, 'a TARGETS in single quotes');
  assert.match(findings[10] ?? '', /config\/ci\.json names the gate lint-ts of kit-gates again, which the job kit runs once \(S12\)/);
  const missing = tree(t, { '.github/workflows/ci.yml': 'name: ci\njobs:\n  check:\n    steps:\n      - run: make own-check\n' });
  assert.match(pipelineFindings(missing, new Set(), new Set()).join('\n'), /ci\.yml has no job kit that calls \.\/\.github\/workflows\/ci-pipeline\.yml \(S12\)/);
  assert.deepEqual(pipelineFindings(tree(t), new Set(), new Set()), [], 'a repository without workflows has no CI to judge');
  const targets = new Map([['kit-gates', { prerequisites: ['kit-gates-static', 'lint-ts'] }], ['kit-gates-static', { prerequisites: ['docs-check'] }],
    ['kit-gates-runtime-ts', { prerequisites: [] }], ['own-check', { prerequisites: [] }]]);
  assert.deepEqual([...gateNames(targets)].sort(), ['kit-gates', 'kit-gates-runtime-ts', 'kit-gates-static', 'lint-ts'], 'an aggregate of the gates is a gate too');
  assert.deepEqual([...gateNames(new Map([['own-check', { prerequisites: [] }]]))], [], 'a Makefile without kit-gates has no gate');
});

test('kit-check names a Makefile or workflow line that runs a link step of a package manager, and not a comment (K998, S11)', (t) => {
  const root = tree(t, {
    'Makefile': 'link-js:\n\tcd packages/js && npm link\n\t# npm link is named in a comment only\npy:\n\tuv pip install -e packages/python\n\tpip install --editable .\n\tpip install -r requirements.txt\n',
    'make/local.mk': 'dev:\n\t@npm link @acme/provider\n',
    '.github/workflows/ci.yml': 'jobs:\n  kit:\n    uses: ./.github/workflows/ci-pipeline.yml\n  check:\n    needs: kit\n    steps:\n      - run: npm link ../provider/packages/js\n',
  });
  initRepository(root);
  spawnSync('git', ['-C', root, 'add', '-A'], { encoding: 'utf8' });
  assert.deepEqual(linkStepFindings(root, new Set()).map(finding => finding.split(' ')[0]), ['.github/workflows/ci.yml:7', 'Makefile:2', 'Makefile:5', 'Makefile:6', 'make/local.mk:2']);
  assert.match(linkStepFindings(root, new Set())[0] ?? '', /runs a link step of a package manager; link a provider checkout with \.links and make link \(S11\)/);
});
