// A consumer includes its installed kit and runs the native npm hook bin in linked-source and packed installs, without ../kit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { setup, teardown } from '../../scripts/kit/test-hooks.mts';
import { linkFolders } from '../../scripts/kit/link-folders.mts';
import { toolsPath } from '../../scripts/kit/bootstrap/tool-wrappers.mts';
import { copyTracked, commitSandbox, kitConsumer, packedKit, NPM } from './checkout.mts';
import { readFixture } from '../kit/json-fixture.mts';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('installed kit bootstrap and hook bin (K671-1)', () => {
  let directory: string;
  const observations: { kind: string; bootstrap: string; target: string; settings: string; allowed: number | null; refused: number | null; refusal: string }[] = [];
  const run = (command: string, args: string[], cwd: string) => {
    process.stdout.write(`[installed-hook] ${path.basename(cwd)}: ${command} ${args.join(' ')}: started\n`);
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true' } });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    process.stdout.write(`[installed-hook] ${path.basename(cwd)}: finished\n`);
    return result.stdout.trim();
  };
  setup('installing native linked-source and packed kit consumers without sibling checkouts', () => {
    directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-installed-hook-')));
    const source = path.join(directory, 'provider');
    mkdirSync(source);
    copyTracked(ROOT, source);
    run(NPM, ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], source);
    commitSandbox(source);
    const artifacts = path.join(directory, 'artifacts');
    mkdirSync(artifacts);
    const packed = packedKit(run(NPM, ['pack', '--json', '--foreground-scripts=false', '--pack-destination', artifacts], source));
    const archives = readdirSync(artifacts).filter(file => file.endsWith('.tgz'));
    assert.equal(archives.length, 1);
    const archive = path.join(artifacts, archives[0] ?? '');
    for (const kind of ['source', 'packed']) {
      const consumer = path.join(directory, `${kind}-consumer`);
      mkdirSync(consumer);
      writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: `${kind}-consumer`, private: true }));
      const { manifest, lock } = kitConsumer(packed);
      writeFileSync(path.join(consumer, 'package.json'), JSON.stringify(manifest));
      writeFileSync(path.join(consumer, 'package-lock.json'), JSON.stringify(lock));
      // Seed the existing exact registry graph, then let npm read the archive and generate its bin metadata itself.
      run(NPM, ['install', '--offline', '--allow-remote=root', '--ignore-scripts', '--no-audit', '--no-fund', archive], consumer);
      // The source consumer installs the release, then its kit folder becomes one plain link to the checkout (K761); the bin link of the
      // install reads through it.
      if (kind === 'source') linkFolders([{ ecosystem: 'npm', name: '@polyspec/kit', folder: path.join(consumer, 'node_modules/@polyspec/kit'), target: source }]);
      assert.equal(existsSync(path.join(path.dirname(consumer), 'kit')), false);
      mkdirSync(path.join(consumer, '.claude'));
      copyFileSync(path.join(consumer, 'node_modules/@polyspec/kit/claude/settings.json'), path.join(consumer, '.claude/settings.json'));
      // The fixture copies the declared Node wrapper; npm alone creates the package and command links.
      mkdirSync(path.join(consumer, 'var/tools/bin'), { recursive: true });
      copyFileSync(toolsPath(ROOT, 'bin', 'node'), path.join(consumer, 'var/tools/bin/node'));
      chmodSync(path.join(consumer, 'var/tools/bin/node'), 0o755);
      writeFileSync(path.join(consumer, 'Makefile'), 'include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk\nshow:\n\t@printf "%s|%s\\n" "$(KIT)" "$(KIT_EXT)"\n');
      const settings = readFileSync(path.join(consumer, '.claude/settings.json'), 'utf8');
      const hooks = readFixture<{ hooks: { PreToolUse: { hooks: { command: string }[] }[] } }>(consumer, '.claude/settings.json');
      const command = hooks.hooks.PreToolUse[0]?.hooks[0]?.command;
      assert.ok(command);
      const invoke = (text: string) => spawnSync('sh', ['-c', command], {
        cwd: consumer, env: { ...process.env, CLAUDE_PROJECT_DIR: consumer }, encoding: 'utf8',
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: text } }),
      });
      const allowed = invoke('printf ok');
      const refused = invoke('make check');
      observations.push({ kind, settings, bootstrap: run('make', ['--no-print-directory', 'show'], consumer),
        target: realpathSync(path.join(consumer, 'node_modules/.bin/polyspec-kit-hook')), allowed: allowed.status, refused: refused.status, refusal: refused.stderr });
    }
  });
  teardown('the installed-hook consumer fixtures', () => { if (directory) rmSync(directory, { recursive: true, force: true }); });
  test('source and packed consumers include the installed package and enforce the same native npm hook command', () => {
    assert.equal(observations.length, 2);
    for (const result of observations) {
      assert.equal(result.allowed, 0, result.kind);
      assert.equal(result.refused, 2, result.refusal);
      assert.match(result.refusal, /refuse:/);
      assert.match(result.settings, /node_modules\/\.bin\/polyspec-kit-hook/);
      assert.doesNotMatch(result.settings, /scripts\/kit\/claude-hook|dist\/claude-hook|\.\.\/kit/);
      assert.equal(result.bootstrap, result.kind === 'source'
        ? 'node_modules/@polyspec/kit/scripts/kit|mts' : 'node_modules/@polyspec/kit/dist|mjs');
      // The bin link is the one of the installed release; in the source consumer it reads the checkout through the folder link (K761).
      assert.ok(result.target.endsWith('/dist/claude-hook.mjs'), result.target);
      if (result.kind === 'source') assert.ok(result.target.startsWith(path.join(directory, 'provider')), result.target);
    }
    assert.equal(observations[0]?.settings, observations[1]?.settings);
  });
});
