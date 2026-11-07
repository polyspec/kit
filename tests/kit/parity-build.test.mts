import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { cargoCfgFacts, cargoCfgMatches } from '../../scripts/kit/cargo-cfg.mts';
import { cargoConfigFiles, resolvedCargoRustc, resolvedCargoRunner, cargoRunnerOrigin, cargoRunnerPath, cargoRunner, cargoTripleRunner, cargoTargets, cargoCommandConfig, mergeCargoConfig, readCargoConfig } from '../../scripts/kit/cargo-config.mts';
import { repository, FILES, ENV } from './parity-support.mts';
import { readDeclaration } from '../../scripts/kit/parity-declaration.mts';
import { runBindings } from '../../scripts/kit/parity-ledger.mts';
import path from 'node:path';
import { buildGroups, cargoNativeContexts, queryCargoHost, queryRustCfg, cargoHost, cargoExecutables, compileCargoGroup, compileGoGroup, runCargoGroup, executeGoBinding, runGoGroup, goExecCommand, selectCargoExecutable, type BuildRequest } from '../../scripts/kit/parity-build.mts';
import { captureExecutable, capturedExecutableFor, readExecutable, runCargoExecutable, runGoExecutable, selectedGoArguments } from '../../scripts/kit/parity-executable.mts';

test('compiled Go execution preserves a reporter process start failure without reporting cases (K1025)', async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-go-start-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lines: string[] = [];
  const result = await runGoExecutable(path.join(root, 'missing-go'), '/copied/binary',
    { executable: 'test-binary', cwd: root, env: {}, args: ['-test.v=test2json'] },
    ['-run', '^Suite$'], 10000, line => lines.push(line));
  assert.ok(result.error);
  assert.match(result.error.message, /ENOENT/);
  assert.equal(result.status, null);
  assert.equal(result.stdout, '');
  assert.deepEqual(lines, []);
});

test('a copied Go executable runs through test2json with native context and no build command (K1025)', async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-go-execute-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tool = path.join(root, 'go');
  const log = path.join(root, 'call.json');
  writeFileSync(tool, `#!${process.execPath}\nconst fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),value:process.env.NATIVE_VALUE})); console.log(JSON.stringify({Action:'pass',Test:'Suite/case'})); process.exitCode=3;\n`, { mode: 0o755 });
  const invocation = { executable: 'test-binary' as const, cwd: root, env: { NATIVE_VALUE: 'kept' }, args: ['-test.v=test2json', '-test.timeout=0'] };
  const lines: string[] = [];
  const result = await runGoExecutable(tool, '/copied/test-binary', invocation, ['-count=1', '-run', '^Suite$'], 10000, line => lines.push(line));
  assert.equal(result.status, 3);
  assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), {args:['tool','test2json','-t','/copied/test-binary','-test.v=test2json','-test.timeout=0','-test.count=1','-test.run=^Suite$'],cwd:root,value:'kept'});
  assert.match(result.stdout, /Suite\/case/);
  assert.deepEqual(lines, [result.stdout.trim()]);
});

test('Go binary selection replaces captured filters without changing native flags or the capture (K1025)', () => {
  const invocation = { executable: 'test-binary' as const, cwd: '/package', env: {},
    args: ['-test.v=test2json', '-test.timeout=0', '-test.run', 'old', '-test.count=3', '-custom=value'] };
  const before = structuredClone(invocation);
  assert.deepEqual(selectedGoArguments(invocation, ['-count=1', '-run', '^Suite/case$']),
    ['-test.v=test2json', '-test.timeout=0', '-custom=value', '-test.count=1', '-test.run=^Suite/case$']);
  assert.deepEqual(invocation, before);
  assert.throws(() => selectedGoArguments(invocation, ['-run']), /no value/);
  assert.throws(() => selectedGoArguments(invocation, ['-tags=other']), /unsupported/);
});

test('the native exec adapter copies the binary and preserves native arguments, directory and environment (K1025)', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-parity-executable-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const records = path.join(root, 'records');
  mkdirSync(records);
  const executable = path.join(root, 'package.test');
  const ran = path.join(root, 'ran');
  writeFileSync(executable, `#!/bin/sh\ntouch '${ran}'\n`, { mode: 0o755 });
  const args = ['-test.v=test2json', '-test.timeout=0', '-test.run=^Suite/case with spaces$'];
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/kit/parity-executable.mts', import.meta.url)), records, executable, ...args],
    { cwd: root, env: { PRIVATE_VALUE: 'fixture-private', GOROOT: '/fixture/go' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(!existsSync(ran), 'capture must not execute any test');
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-private/);
  const id = result.stdout.trim().replace(/^KIT_PARITY_EXECUTABLE /, '');
  const record = readExecutable(records, id);
  assert.equal(record.source, path.resolve(executable));
  assert.deepEqual(record.args, args);
  assert.equal(record.cwd, realpathSync(root));
  assert.equal(record.env.PRIVATE_VALUE, 'fixture-private');
  assert.equal(record.env.GOROOT, '/fixture/go');
  assert.equal(readFileSync(path.join(records, id, record.executable), 'utf8'), readFileSync(executable, 'utf8'));
  if (process.platform !== 'win32') {
    assert.equal(statSync(path.join(records, id, record.executable)).mode & 0o777, 0o755);
    assert.equal(statSync(path.join(records, id, 'invocation.json')).mode & 0o777, 0o600);
  }
});

test('captured binaries cannot collide, escape the run directory or survive a failed copy (K1025)', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-parity-executable-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'package.test');
  const records = path.join(root, 'records');
  mkdirSync(records);
  writeFileSync(executable, 'first');
  const first = captureExecutable(records, executable, [], { env: {} });
  assert.equal(capturedExecutableFor(records, executable).executable, path.join(records, first, 'test-binary'));
  assert.throws(() => capturedExecutableFor(records, path.join(root, 'other.test')), /0 captured invocations/);
  writeFileSync(executable, 'second');
  const second = captureExecutable(records, executable, [], { env: {} });
  assert.throws(() => capturedExecutableFor(records, executable), /2 captured invocations/);
  assert.notEqual(first, second);
  assert.equal(readFileSync(path.join(records, first, 'test-binary'), 'utf8'), 'first');
  assert.equal(readFileSync(path.join(records, second, 'test-binary'), 'utf8'), 'second');
  assert.throws(() => readExecutable(records, '../package.test'), /invalid parity executable id/);
  assert.throws(() => captureExecutable(records, path.join(root, 'missing'), []), /ENOENT/);
  assert.deepEqual(readdirSync(records).sort(), [first, second].sort());
  writeFileSync(path.join(records, first, 'invocation.json'), JSON.stringify({ executable: '../package.test', cwd: root, args: [], env: {} }));
  assert.throws(() => readExecutable(records, first), /test-binary|constant/);
});

const request = (id: string, target: string[], overrides: Partial<BuildRequest> = {}): BuildRequest => ({
  id, runner: 'cargo', command: '/tools/cargo', cwd: '/checkout',
  options: ['test', '--manifest-path', 'client/Cargo.toml', '--locked'],
  env: { PATH: '/tools', CARGO_TARGET_DIR: '/checkout/target' }, target, ...overrides,
});

test('compatible targets share one build while all binding identities remain (K1025)', () => {
  const requests = [request('first', ['--test', 'one']), request('second', ['--test', 'two']), request('third', ['--test', 'one'])];
  const before = structuredClone(requests);
  const groups = buildGroups(requests);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.targets, [['--test', 'one'], ['--test', 'two']]);
  assert.deepEqual(groups[0]?.requests.map(entry => entry.id), ['first', 'second', 'third']);
  assert.deepEqual(requests, before, 'planning leaves runner declarations unchanged');
});

test('different toolchains, checkouts, flags and environments never share a build (K1025)', () => {
  const base = request('base', ['--test', 'one']);
  const changes: Partial<BuildRequest>[] = [
    { command: '/other/cargo' }, { cwd: '/other-checkout' },
    { options: [...base.options, '--features', 'faults'] },
    { options: [...base.options, '--release'] },
    { env: { ...base.env, CARGO_TARGET_DIR: '/checkout/other-target' } },
    { env: { ...base.env, RUSTFLAGS: '-C opt-level=1' } },
    { runner: 'go', command: '/tools/go', options: ['test', '-tags', 'faults'], target: ['./client'] },
  ];
  assert.equal(buildGroups([base, ...changes.map((change, index) => request(`other-${index}`, ['--test', 'two'], change))]).length, changes.length + 1);
});

test('environment key order does not produce redundant builds (K1025)', () => {
  const first = request('first', ['--test', 'one'], { env: { A: 'a', B: 'b' } });
  const second = request('second', ['--test', 'two'], { env: { B: 'b', A: 'a' } });
  assert.equal(buildGroups([first, second]).length, 1);
});

test('Go packages share compatible flags and keep distinct build-tag groups (K1025)', () => {
  const go = { runner: 'go' as const, command: '/tools/go', options: ['test', '-tags', 'contract'] };
  const groups = buildGroups([
    request('one', ['./one'], go), request('two', ['./two'], go),
    request('other-tags', ['./one'], { ...go, options: ['test', '-tags', 'faults'] }),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]?.targets, [['./one'], ['./two']]);
});

test('Go exec arguments preserve spaces and quotes without shell expansion (K1025)', () => {
  assert.equal(goExecCommand(['/node path/node', '/plain/adapter', '/run with space']), '"/node path/node" /plain/adapter "/run with space"');
  assert.equal(goExecCommand(['a"b']), "'a\"b'");
  assert.equal(goExecCommand(["a'b"]), '"a\'b"');
  assert.throws(() => goExecCommand(['a\'"b']), /both quote characters/);
});

test('a Go package that disappears is a binding error, not an abort of the build report (K1025)', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-go-missing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const group = buildGroups([request('missing', ['./missing'], { runner: 'go', command: process.execPath, cwd: root,
    env: {}, options: ['-e', 'process.exitCode=1', '--', 'test'] })])[0];
  assert.ok(group);
  const built = await compileGoGroup(group, root, () => {});
  assert.equal(built.result.status, 1);
  assert.equal(built.executables.size, 0);
  assert.match(built.errors.get('missing') ?? '', /cannot resolve Go test package/);
});

test('a Go group builds once, distinguishes equal package basenames and retains completed builds after failure (K1025)', async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-go-group-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const targets = ['./left/same', './right/same'] as const;
  for (const target of targets) {
    mkdirSync(path.join(root, target), { recursive: true });
    writeFileSync(path.join(root, target, 'same.test'), target, { mode: 0o755 });
  }
  for (const partial of [false, true]) {
    const directory = path.join(root, partial ? 'partial' : 'complete');
    mkdirSync(directory);
    const log = path.join(root, `${partial}.jsonl`);
    const script = `
      import {appendFileSync} from 'node:fs';
      import {captureExecutable} from ${JSON.stringify(new URL('../../scripts/kit/parity-executable.mts', import.meta.url).href)};
      appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(1))+'\\n');
      for (const target of ${JSON.stringify(partial ? targets.slice(0, 1) : targets)}) {
        const cwd = ${JSON.stringify(root)} + '/' + target;
        captureExecutable(${JSON.stringify(directory)}, cwd+'/same.test', ['-test.v=test2json', '-test.short=true'],
          {cwd: (await import('node:fs')).realpathSync(cwd), env: {...process.env, GOROOT: '/native/go'}});
      }
      process.exitCode = ${partial ? 1 : 0};
    `;
    const stub = path.join(root, `${partial}-go.mjs`);
    writeFileSync(stub, script);
    const base = { runner: 'go' as const, command: process.execPath, cwd: root, env: { SAMPLE: 'kept' }, options: [stub, 'test'] };
    const group = buildGroups([request('left', [targets[0]], base), request('right', [targets[1]], base), request('again', [targets[0]], base)])[0];
    assert.ok(group);
    const built = await compileGoGroup(group, directory, () => {});
    assert.equal(built.result.status, partial ? 1 : 0, built.result.stdout + built.result.stderr);
    assert.equal(built.errors.size, partial ? 1 : 0);
    assert.equal(built.executables.get('again'), built.executables.get('left'));
    const left = built.executables.get('left');
    assert.ok(left);
    assert.equal(readFileSync(left, 'utf8'), targets[0]);
    assert.deepEqual(built.invocations.get('left')?.args, ['-test.v=test2json', '-test.short=true']);
    assert.equal(built.invocations.get('left')?.env.SAMPLE, 'kept');
    assert.equal(built.invocations.get('left')?.env.GOROOT, '/native/go');
    if (partial) assert.match(built.errors.get('right') ?? '', /captured 0 executables/);
    else {
      const right = built.executables.get('right');
      assert.ok(right);
      assert.equal(readFileSync(right, 'utf8'), targets[1]);
    }
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].slice(-2), targets);
    assert.ok(calls[0].includes('-exec'));
    assert.ok(calls[0].includes('-count=1'));
    await assert.rejects(compileGoGroup(group, directory, () => {}), /not empty/);
  }
});

const artifact = (overrides: Record<string, unknown> = {}) => ({
  reason: 'compiler-artifact', manifest_path: '/checkout/client/Cargo.toml',
  target: { name: 'one', kind: ['test'], src_path: '/checkout/client/tests/one.rs' },
  profile: { test: true }, executable: '/checkout/target/debug/deps/one-actual-hash', fresh: false,
  ...overrides,
});
const jsonLines = (...values: unknown[]) => values.map(value => JSON.stringify(value)).join('\n');

test('Cargo executable selection uses compiler paths and keeps custom harnesses (K1025)', () => {
  const output = `native build progress\n${jsonLines(
    artifact({ executable: null }),
    artifact({ manifest_path: '/checkout/dependency/Cargo.toml', executable: '/checkout/target/dependency' }),
    artifact({ profile: { test: false }, fresh: true }),
    { reason: 'build-finished', success: true },
  )}`;
  const artifacts = cargoExecutables(output);
  assert.equal(selectCargoExecutable(artifacts, '/checkout/client/Cargo.toml', ['--test', 'one']), '/checkout/target/debug/deps/one-actual-hash');
  assert.throws(() => selectCargoExecutable(artifacts, '/checkout/client/Cargo.toml', ['--test', 'missing']), /no executable/);
});

test('Cargo rejects malformed artifact data and ambiguous executable identities (K1025)', () => {
  assert.throws(() => cargoExecutables(jsonLines(artifact({ executable: 123 }))), /executable/);
  assert.throws(() => cargoExecutables('{broken JSON'), /JSON/);
  assert.throws(() => selectCargoExecutable(cargoExecutables(jsonLines(artifact(), artifact({ executable: '/checkout/target/other' }))), '/checkout/client/Cargo.toml', ['--test', 'one']), /more than one executable/);
  assert.equal(cargoExecutables(jsonLines(artifact(), artifact())).length, 1, 'repeated identical events name the same artifact');
});

test('Cargo library tests do not select an ordinary library artifact (K1025)', () => {
  const library = { name: 'client', kind: ['lib'], src_path: '/checkout/client/src/lib.rs' };
  const artifacts = cargoExecutables(jsonLines(artifact({ target: library, profile: { test: false } }), artifact({ target: library, executable: '/checkout/target/lib-test' })));
  assert.equal(selectCargoExecutable(artifacts, '/checkout/client/Cargo.toml', ['--lib']), '/checkout/target/lib-test');
});

test('a compatible Cargo group builds once and maps each binding to its own executable (K1025)', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'kit-parity-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = path.join(root, 'calls.jsonl');
  const messages = [artifact(), artifact({ target: { name: 'two', kind: ['test'], src_path: '/checkout/client/tests/two.rs' }, executable: '/checkout/target/two' })];
  const script = `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(1))+'\\n'); process.stdout.write(${JSON.stringify(jsonLines(...messages))});`;
  const base = { command: process.execPath, cwd: root, env: {}, options: ['-e', script, '--', 'test', '--manifest-path', '/checkout/client/Cargo.toml'] };
  const group = buildGroups([request('one', ['--test', 'one'], base), request('two', ['--test', 'two'], base), request('again', ['--test', 'one'], base)])[0];
  assert.ok(group);
  const built = await compileCargoGroup(group, () => {});
  assert.equal(built.result.status, 0);
  assert.equal(built.errors.size, 0);
  assert.deepEqual([...built.executables], [['one', '/checkout/target/debug/deps/one-actual-hash'], ['two', '/checkout/target/two'], ['again', '/checkout/target/debug/deps/one-actual-hash']]);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(-7), ['--test', 'one', '--test', 'two', '--no-run', '--keep-going', '--message-format=json-render-diagnostics']);
});

test('Cargo build failures preserve independently completed targets and name missing artifacts (K1025)', async () => {
  for (const exit of [0, 1]) {
    const base = {
      command: process.execPath, cwd: process.cwd(), env: {},
      options: ['-e', `process.stdout.write(${JSON.stringify(jsonLines(artifact()))}); process.exit(${exit});`, '--', 'test', '--manifest-path', '/checkout/client/Cargo.toml'],
    };
    const group = buildGroups([request('missing', ['--test', 'missing'], base), request('finished', ['--test', 'one'], base)])[0];
    assert.ok(group);
    const built = await compileCargoGroup(group, () => {});
    assert.equal(built.result.status, exit);
    assert.deepEqual([...built.executables], [['finished', '/checkout/target/debug/deps/one-actual-hash']]);
    assert.match(built.errors.get('missing') ?? '', /no executable/);
  }
});


test('bindings reuse one recorded executable while preserving separate selections and failures (K1025)', async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-go-reuse-')));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  const tool = path.join(root, 'go');
  const log = path.join(root, 'runs.jsonl');
  writeFileSync(tool, `#!${process.execPath}\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n'); process.exitCode=args.some(arg=>arg.includes('Failure'))?1:0;\n`, {mode:0o755});
  const group = buildGroups([request('first', ['./pkg'], {runner:'go',command:tool})])[0];
  assert.ok(group);
  const invocation = {executable:'test-binary' as const,cwd:root,args:['-test.v=test2json'],env:{}};
  const result = {status:0,signal:null,stdout:'',stderr:'',elapsedMs:1};
  const built = {result,executables:new Map([['first','/copied/binary'],['second','/copied/binary']]),
    invocations:new Map([['first',invocation],['second',invocation]]),errors:new Map([['missing','compiler failed']])};
  assert.equal((await executeGoBinding(group,built,'first',['-run','^Failure$'],10000,()=>{})).status,1);
  assert.equal((await executeGoBinding(group,built,'second',['-run','^Success$'],10000,()=>{})).status,0);
  await assert.rejects(executeGoBinding(group,built,'missing',[],10000,()=>{}),/compiler failed/);
  const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(args=>args.slice(0,4)),[['tool','test2json','-t','/copied/binary'],['tool','test2json','-t','/copied/binary']]);
  assert.deepEqual(calls.map(args=>args.at(-1)),['-test.run=^Failure$','-test.run=^Success$']);
});


test('a grouped Go run preserves build start errors and removes owned artifacts (K1025)', async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'kit-go-owned-')));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const group = buildGroups([request('one',['./pkg'],{runner:'go',command:path.join(root,'missing-go'),cwd:root})])[0];
  assert.ok(group);
  await assert.rejects(runGoGroup(group,new Map(),root,10000,()=>{}),/no selection/);
  assert.deepEqual(readdirSync(root),[]);
  const result = await runGoGroup(group,new Map([['one',['-run','^Suite$']]]),root,10000,()=>{});
  assert.ok(result.build.error);
  assert.equal(result.runs.size,0);
  assert.match(result.errors.get('one')??'',/ENOENT/);
  assert.deepEqual(readdirSync(root),[]);
});


test('a grouped Go lifecycle builds once, continues after a failed binding and cleans its binaries (K1025)', async t => {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-go-lifecycle-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const parent=path.join(root,'artifacts'), pkg=path.join(root,'pkg');
  mkdirSync(parent); mkdirSync(pkg);
  writeFileSync(path.join(pkg,'native.test'),'compiled fixture',{mode:0o755});
  const tool=path.join(root,'go'), log=path.join(root,'calls.jsonl');
  const capture=new URL('../../scripts/kit/parity-executable.mts',import.meta.url).href;
  writeFileSync(tool,`#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args[0]==='test') {
  const exec=args[args.indexOf('-exec')+1];
  const directory=exec.split(' ').at(-1);
  import(${JSON.stringify(capture)}).then(({captureExecutable})=>captureExecutable(directory,${JSON.stringify(path.join(pkg,'native.test'))},['-test.v=test2json'],{cwd:${JSON.stringify(pkg)},env:{}}));
} else {
  console.log(JSON.stringify({Action:args.some(a=>a.includes('Failure'))?'fail':'pass',Test:'Suite/case'}));
  process.exitCode=args.some(a=>a.includes('Failure'))?1:0;
}
`,{mode:0o755});
  const base={runner:'go' as const,command:tool,cwd:root,env:{},options:['test']};
  const group=buildGroups([request('one',['./pkg'],base),request('two',['./pkg'],base)])[0];
  assert.ok(group);
  const progress: string[]=[];
  const result=await runGoGroup(group,new Map([['one',['-run','^Failure$']],['two',['-run','^Success$']]]),parent,10000,line=>progress.push(line));
  assert.equal(progress.filter(line=>/^Go group build: exit 0, [0-9.]+ ms, 1 packages$/.test(line)).length,1);
  assert.ok(progress.some(line=>/^Go binding one execution: exit 1, [0-9.]+ ms$/.test(line)));
  assert.ok(progress.some(line=>/^Go binding two execution: exit 0, [0-9.]+ ms$/.test(line)));
  assert.equal(result.build.status,0,result.build.stderr);
  assert.equal(result.errors.size,0);
  assert.equal(result.runs.get('one')?.status,1);
  assert.equal(result.runs.get('two')?.status,0);
  const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(calls.map(args=>args[0]),['test','tool','tool']);
  assert.equal(calls[1][3],calls[2][3]);
  assert.deepEqual(readdirSync(parent),[]);
  writeFileSync(log,'');
  const invalid=await runGoGroup(group,new Map([['one',['-unsupported']],['two',['-run','^Success$']]]),parent,10000,()=>{});
  assert.match(invalid.errors.get('one')??'',/unsupported Go binding selection/);
  assert.equal(invalid.runs.has('one'),false);
  assert.equal(invalid.runs.get('two')?.status,0);
  assert.deepEqual(readdirSync(parent),[]);

});


test('malformed Go captures become errors for every affected binding (K1025)', async t => {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-go-malformed-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const captures=path.join(root,'captures'); mkdirSync(captures);
  const script=path.join(root,'go.mjs');
  writeFileSync(script,`import fs from 'node:fs'; const dir=${JSON.stringify(captures)}+'/binary-broken'; fs.mkdirSync(dir); fs.writeFileSync(dir+'/invocation.json','{broken');`);
  const base={runner:'go' as const,command:process.execPath,cwd:root,env:{},options:[script,'test']};
  const group=buildGroups([request('one',['./pkg'],base),request('two',['./other'],base)])[0];
  assert.ok(group);
  const built=await compileGoGroup(group,captures,()=>{});
  assert.equal(built.result.status,0);
  assert.equal(built.executables.size,0);
  assert.equal(built.invocations.size,0);
  assert.deepEqual([...built.errors.keys()],['one','two']);
  assert.match(built.errors.get('one')??'',/JSON/);
});


test('the parity ledger batches native Go suites and retains every declared case (K1025)', async t => {
  const root=repository(t,{edit:config=>{const go=config.implementations.find(i=>i.name==='go'); assert.ok(go);go.command='./go-driver';return config;}});
  const log=path.join(root,'calls.jsonl');
  const mode=path.join(root,'mode');
  writeFileSync(mode,'pass');
  const capture=new URL('../../scripts/kit/parity-executable.mts',import.meta.url).href;
  writeFileSync(path.join(root,'go/native.test'),'fixture',{mode:0o755});
  writeFileSync(path.join(root,'go-driver'),`#!${process.execPath}
const fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
if(args[0]==='test') { const directory=args[args.indexOf('-exec')+1].split(' ').at(-1); import(${JSON.stringify(capture)}).then(({captureExecutable})=>captureExecutable(directory,${JSON.stringify(path.join(root,'go/native.test'))},['-test.v=test2json'],{cwd:fs.realpathSync(${JSON.stringify(path.join(root,'go'))}),env:{}})); }
else { const run=args.find(a=>a.startsWith('-test.run='))||''; const codec=run.includes('TestCodec'); const symbol=codec?'TestCodec':'TestWidth'; const mode=fs.readFileSync(${JSON.stringify(mode)},'utf8'); for(const id of codec?['empty','ascii']:['narrow','wide']) { if(codec&&mode==='omit'&&id==='ascii') continue; console.log(JSON.stringify({Action:codec&&mode==='fail'?'fail':'pass',Test:symbol+'/'+id,Elapsed:0})); } if(codec&&mode==='fail') process.exitCode=1; }
`,{mode:0o755});
  const files=new Set([...Object.keys(FILES),'config/parity.json','go-driver','go/native.test']);
  const declaration=readDeclaration(root,files);
  assert.ok(declaration.model,JSON.stringify(declaration.errors));
  const result=await runBindings(declaration.model,root,{files,env:ENV,say:()=>{},units:new Set(['codec','width']),implementations:new Set(['go'])});
  assert.deepEqual(result.findings,[]);
  assert.equal(result.ledger.cases.length,4);
  for (const run of result.ledger.runs) {
    assert.equal(run.command,path.join(root,'go-driver'));
    assert.deepEqual(run.args.slice(0,3),['tool','test2json','-t']);
    assert.equal(run.cwd,realpathSync(path.join(root,'go')));
  }
  const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(calls.map(args=>args[0]),['test','tool','tool']);
  for (const outcome of ['omit','fail']) {
    writeFileSync(mode,outcome);
    const failed=await runBindings(declaration.model,root,{files,env:ENV,say:()=>{},units:new Set(['codec','width']),implementations:new Set(['go'])});
    assert.equal(failed.findings.length,1);
    assert.equal(failed.findings[0]?.unit,'codec');
    assert.match(failed.findings[0]?.message??'',outcome==='omit'?/not executed: ascii/:/failed: empty, ascii/);
    assert.equal(failed.ledger.cases.filter(entry=>entry.unit==='width'&&entry.outcome==='pass').length,2);
  }
  writeFileSync(mode,'pass');
  writeFileSync(log,'');
  declaration.model.config.units.push({id:'codec-feature',kind:'feature',requirements:['CX-1'],bindings:[{implementation:'go',test:'go/codec_test.go',id:'TestCodec/empty'}]});
  const go=declaration.model.implementations.get('go');
  assert.ok(go);
  declaration.model.unitImplementations.set('codec-feature',[go]);
  const mixed=await runBindings(declaration.model,root,{files,env:ENV,say:()=>{},units:new Set(['codec','width','codec-feature']),implementations:new Set(['go'])});
  assert.deepEqual(mixed.findings,[]);
  assert.ok(mixed.ledger.cases.some(entry=>entry.unit==='codec-feature'&&entry.case==='TestCodec/empty'&&entry.outcome==='pass'));
  const mixedCalls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(mixedCalls.map(args=>args[0]),['test','tool','tool','tool']);
});


test('Rust executable replay retains Cargo environment, native options and failure status (K1025)', async t => {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-cargo-replay-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const binary=path.join(root,'rust-test'), log=path.join(root,'run.json');
  writeFileSync(binary,`#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),manifest:process.env.CARGO_MANIFEST_DIR,libs:process.env.LD_LIBRARY_PATH,config:process.env.FROM_CARGO_CONFIG})); console.log('test recipe::case ... FAILED'); process.exitCode=101;
`,{mode:0o755});
  const invocation={executable:'test-binary' as const,cwd:root,args:['--nocapture'],env:{CARGO_MANIFEST_DIR:root,LD_LIBRARY_PATH:'/native/build:/native/deps',FROM_CARGO_CONFIG:'retained'}};
  const result=await runCargoExecutable(binary,invocation,['--test-threads=1','recipe::case','--exact'],10000,()=>{});
  assert.equal(result.status,101);
  assert.match(result.stdout,/recipe::case.*FAILED/);
  const expected={args:['--nocapture','--test-threads=1','recipe::case','--exact'],cwd:root,manifest:root,libs:'/native/build:/native/deps',config:'retained'};
  assert.deepEqual(JSON.parse(readFileSync(log,'utf8')),expected);
  assert.deepEqual(result.execution,{command:binary,args:expected.args,cwd:root});
});

test('Rust replay uses the declared target runner and retains its arguments (K1025)', async t => {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-cargo-runner-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const runner=path.join(root,'runner');
  writeFileSync(runner,`#!${process.execPath}
console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),value:process.env.NATIVE_ENV})); process.exitCode=7;
`,{mode:0o755});
  const result=await runCargoExecutable('/native/binary',{executable:'test-binary',cwd:root,args:['--nocapture'],env:{NATIVE_ENV:'retained'}},
    ['suite::case','--exact'],10000,()=>{},[runner,'--configured-option']);
  assert.equal(result.status,7);
  assert.deepEqual(JSON.parse(result.stdout),{args:['--configured-option','/native/binary','--nocapture','suite::case','--exact'],cwd:root,value:'retained'});
  assert.equal(result.execution.command,runner);
});

test('Cargo capture delegates environment setup to its native runner invocation (K1025)', async t => {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-cargo-capture-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const directory=path.join(root,'captures'); mkdirSync(directory);
  const log=path.join(root,'args.json');
  const script=path.join(root,'cargo.mjs');
  writeFileSync(script,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));`);
  const group=buildGroups([request('one',['--test','one'],{command:process.execPath,cwd:root,env:{},options:[script,'test','--manifest-path','client/Cargo.toml']})])[0];
  assert.ok(group);
  const result=await compileCargoGroup(group,()=>{},{directory,triple:'aarch64-unknown-linux-gnu'});
  assert.equal(result.result.status,0);
  const args=JSON.parse(readFileSync(log,'utf8')) as string[];
  assert.ok(!args.includes('--no-run'));
  const config=args[args.indexOf('--config')+1];
  assert.ok(config);
  assert.ok(config.startsWith('target."aarch64-unknown-linux-gnu".runner='));
  assert.deepEqual(JSON.parse(config.slice(config.indexOf('=')+1)),[process.execPath,fileURLToPath(new URL('../../scripts/kit/parity-executable.mts',import.meta.url)),directory]);
  assert.match(result.errors.get('one')??'',/no executable/);
  await assert.rejects(compileCargoGroup(group,()=>{},{directory,triple:''}),/target triple/);
});


test('Cargo grouped execution preserves start failures and cleans its artifact directory (K1025)', async t => {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-cargo-owned-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const group=buildGroups([request('one',['--test','one'],{command:path.join(root,'missing-cargo'),cwd:root})])[0];
  assert.ok(group);
  const result=await runCargoGroup(group,new Map([['one',['--exact','case']]]),root,{triple:'aarch64-unknown-linux-gnu',runner:[]},10000,()=>{});
  assert.ok(result.build.error);
  assert.equal(result.runs.size,0);
  assert.match(result.errors.get('one')??'',/ENOENT/);
  assert.deepEqual(readdirSync(root),[]);
});

test('Cargo grouped lifecycle reuses one capture, continues after test failure and cleans artifacts (K1025)', async t => {
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-cargo-lifecycle-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const parent=path.join(root,'captures'), crate=path.join(root,'client');
  mkdirSync(parent);mkdirSync(crate);
  const binary=path.join(root,'native-test'), log=path.join(root,'calls.jsonl');
  writeFileSync(binary,`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'run',args,env:process.env.FROM_CARGO_CONFIG,cwd:process.cwd()})+'\\n');console.log('test suite::case ... '+(args.includes('fail')?'FAILED':'ok'));process.exitCode=args.includes('fail')?101:0;
`,{mode:0o755});
  const script=path.join(root,'cargo.mjs');
  const message=artifact({manifest_path:path.join(crate,'Cargo.toml'),executable:binary});
  const helper=new URL('../../scripts/kit/parity-executable.mts',import.meta.url).href;
  writeFileSync(script,`import fs from 'node:fs';import {captureExecutable} from ${JSON.stringify(helper)};
const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'build',args})+'\\n');
const config=args[args.indexOf('--config')+1];const runner=JSON.parse(config.slice(config.indexOf('=')+1));
captureExecutable(runner.at(-1),${JSON.stringify(binary)},[],{cwd:${JSON.stringify(crate)},env:{FROM_CARGO_CONFIG:'native'}});
console.log(${JSON.stringify(JSON.stringify(message))});`);
  const base={command:process.execPath,cwd:root,env:{},options:[script,'test','--manifest-path','client/Cargo.toml']};
  const group=buildGroups([request('first',['--test','one'],base),request('second',['--test','one'],base)])[0];
  assert.ok(group);
  const result=await runCargoGroup(group,new Map([['first',['fail']],['second',['pass']]]),parent,{triple:'aarch64-unknown-linux-gnu',runner:[]},10000,()=>{});
  assert.equal(result.build.status,0,result.build.stderr);
  assert.equal(result.errors.size,0);
  assert.equal(result.runs.get('first')?.status,101);
  assert.equal(result.runs.get('second')?.status,0);
  const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(calls.map(call=>call.kind),['build','run','run']);
  assert.deepEqual(calls.slice(1).map(call=>[call.env,call.cwd]),[['native',crate],['native',crate]]);
  assert.equal(result.runs.get('first')?.execution.command,result.runs.get('second')?.execution.command);
  assert.deepEqual(readdirSync(parent),[]);
});


test('Cargo host identity comes from native verbose version and rejects incomplete output (K1025)',()=>{
  assert.equal(cargoHost('cargo 1.99.0\nrelease: 1.99.0\nhost: aarch64-unknown-linux-gnu\n'),'aarch64-unknown-linux-gnu');
  assert.equal(cargoHost('host: x86_64-apple-darwin\r\n'),'x86_64-apple-darwin');
  assert.throws(()=>cargoHost('cargo 1.99.0\n'),/did not report one host/);
  assert.throws(()=>cargoHost('host: first\nhost: second\n'),/did not report one host/);
});


test('Cargo configuration discovery preserves ancestor and home priorities with legacy filenames (K1025)',()=>{
  const root=path.resolve('fixture-cargo-root'),cwd=path.join(root,'workspace','member'),home=path.join(root,'home');
  const local=path.join(cwd,'.cargo','config.toml'),parent=path.join(root,'workspace','.cargo','config'),shadow=parent+'.toml',user=path.join(home,'.cargo','config.toml');
  const existing=new Set([local,parent,shadow,user]);
  const env={HOME:home,USERPROFILE:home};
  assert.deepEqual(cargoConfigFiles(cwd,env,file=>existing.has(file)),[local,parent,user]);
  assert.deepEqual(cargoConfigFiles(cwd,{...env,CARGO_HOME:path.join(root,'workspace','.cargo')},file=>existing.has(file)),[local,parent]);
  const relative=path.join(cwd,'custom-home','config.toml');existing.add(relative);
  assert.deepEqual(cargoConfigFiles(cwd,{...env,CARGO_HOME:'custom-home'},file=>existing.has(file)),[local,parent,relative]);
});


test('Cargo tables merge by priority, append arrays, preserve inputs and reject conflicting types (K1025)',()=>{
  const low={build:{target:'low',rustflags:['low']},env:{LOW:'yes'}};
  const high={build:{target:'high',rustflags:['high']},env:{HIGH:'yes'}};
  const before=JSON.stringify([low,high]);
  assert.deepEqual(mergeCargoConfig(low,high),{build:{target:'high',rustflags:['low','high']},env:{LOW:'yes',HIGH:'yes'}});
  assert.equal(JSON.stringify([low,high]),before);
  assert.throws(()=>mergeCargoConfig({build:{target:'one'}},{build:{target:['two']}}),/build.target.*conflicting/);
  const files:Record<string,string>={local:'[build]\ntarget="local"\nrustflags=["local"]',home:'[build]\ntarget="home"\nrustflags=["home"]'};
  assert.deepEqual(readCargoConfig(['local','home'],file=>files[file]??''),{build:{target:'local',rustflags:['home','local']}});
});


test('Cargo command configuration respects repeated overrides, files and the test argument separator (K1025)',()=>{
  const cwd=path.resolve('cargo-command-fixture');
  const file=path.join(cwd,'extra.toml');
  const reads:string[]=[];
  const config=cargoCommandConfig(['test','--config','extra.toml','--config=build.target="last"','--config','build.rustflags=["last"]','--','--config','build.target="ignored"'],cwd,name=>{reads.push(name);return '[build]\ntarget="file"\nrustflags=["file"]';});
  assert.deepEqual(reads,[file]);
  assert.deepEqual(config,{build:{target:'last',rustflags:['file','last']}});
  assert.throws(()=>cargoCommandConfig(['test','--config'],cwd),/has no value/);
  assert.throws(()=>cargoCommandConfig(['--config='],cwd),/has no value/);
  assert.throws(()=>cargoCommandConfig(['--config','build.target=broken'],cwd),/--config line/);
});


test('Cargo target selection preserves CLI, environment, file and host precedence (K1025)',()=>{
  const config={build:{target:['file-one','file-two']}};
  assert.deepEqual(cargoTargets([],{}, {},'native-host'),['native-host']);
  assert.deepEqual(cargoTargets([],config,{},'native-host'),['file-one','file-two']);
  assert.deepEqual(cargoTargets([],config,{CARGO_BUILD_TARGET:'environment'},'native-host'),['environment']);
  assert.deepEqual(cargoTargets(['--target','one','--target=two','--','--target','ignored'],config,{CARGO_BUILD_TARGET:'environment'},'native-host'),['one','two']);
  assert.deepEqual(cargoTargets([],{build:{target:'host-tuple'}},{},'native-host'),['native-host']);
  assert.throws(()=>cargoTargets(['--target'],config,{},'native-host'),/has no value/);
  assert.throws(()=>cargoTargets([],{build:{target:3}},{},'native-host'),/must name targets/);
});


test('Cargo exact runner preserves array arguments and respects environment precedence (K1025)',()=>{
  const config={target:{'native-target':{runner:['runner with spaces','--flag']},custom:{runner:'custom-runner --arg'}}};
  assert.deepEqual(cargoTripleRunner(config,{},'native-target'),['runner with spaces','--flag']);
  assert.deepEqual(cargoTripleRunner(config,{CARGO_TARGET_NATIVE_TARGET_RUNNER:'environment --option'},'native-target'),['environment','--option']);
  assert.deepEqual(cargoTripleRunner(config,{},'some/path/custom.json'),['custom-runner','--arg']);
  assert.equal(cargoTripleRunner(config,{},'other'),undefined);
  assert.throws(()=>cargoTripleRunner(config,{CARGO_TARGET_NATIVE_TARGET_RUNNER:''},'native-target'),/must name a runner/);
  assert.throws(()=>cargoTripleRunner({target:{bad:{runner:3}}},{},'bad'),/must name a runner/);
});


test('Cargo cfg matching evaluates nested predicates and rejects invalid conditions (K1025)',()=>{
  const facts=new Set(['unix','target_os="linux"','target_arch="aarch64"']);
  assert.equal(cargoCfgMatches('cfg(all(unix, target_os = "linux", not(target_arch="x86_64"),))',facts),true);
  assert.equal(cargoCfgMatches('cfg(any(windows,target_os="macos"))',facts),false);
  assert.equal(cargoCfgMatches('cfg(all())',facts),true);
  assert.equal(cargoCfgMatches('cfg(any())',facts),false);
  for(const condition of ['cfg(not(unix,windows))','cfg(unknown(unix))','cfg(unix) trailing','cfg(all(unix windows))'])
    assert.throws(()=>cargoCfgMatches(condition,facts),/invalid Cargo cfg condition/);
});


test('Cargo runner selection prefers exact targets and rejects ambiguous cfg matches (K1025)',()=>{
  const facts=new Set(['unix','target_os="linux"']);
  const config={target:{'cfg(unix)':{runner:['unix-runner','--arg']},'cfg(windows)':{runner:'windows-runner'}}};
  assert.deepEqual(cargoRunner(config,{},'native',facts),['unix-runner','--arg']);
  assert.deepEqual(cargoRunner(config,{},'native',new Set()),[]);
  const ambiguous={target:{...config.target,'cfg(target_os="linux")':{runner:'linux-runner'}}};
  assert.throws(()=>cargoRunner(ambiguous,{},'native',facts),/multiple Cargo cfg runners/);
  assert.deepEqual(cargoRunner({target:{...ambiguous.target,native:{runner:'exact'}}},{},'native',facts),['exact']);
  assert.deepEqual(cargoRunner(ambiguous,{CARGO_TARGET_NATIVE_RUNNER:'environment'},'native',facts),['environment']);
});


test('Cargo runner paths use the defining file origin while bare programs remain on PATH (K1025)',()=>{
  const cwd=path.resolve('cargo-invocation'),file=path.join(cwd,'project','.cargo','config.toml');
  const words=['./tools/runner','--file','relative/input'];
  assert.deepEqual(cargoRunnerPath(words,{cwd,file}),[path.join(cwd,'project','tools','runner'),'--file','relative/input']);
  assert.deepEqual(cargoRunnerPath(words,{cwd}),[path.join(cwd,'tools','runner'),'--file','relative/input']);
  assert.deepEqual(cargoRunnerPath(['runner','arg with space'],{cwd,file}),['runner','arg with space']);
  assert.deepEqual(words,['./tools/runner','--file','relative/input']);
  assert.throws(()=>cargoRunnerPath([],{cwd}),/has no program/);
});


test('Cargo includes merge in order, keep own precedence and reject cycles or malformed optional files (K1025)',()=>{
  const root=path.resolve('cargo-includes'),main=path.join(root,'config.toml');
  const files:Record<string,string>={};
  files[main]='include=["first.toml", "second.toml", {path="absent.toml",optional=true}]\n[build]\ntarget="own"';
  files[path.join(root,'first.toml')]='[build]\ntarget="first"\nrustflags=["first"]';
  files[path.join(root,'second.toml')]='[build]\ntarget="second"\nrustflags=["second"]';
  const read=(file:string)=>{const text=files[path.resolve(file)];if(text===undefined) throw Object.assign(new Error('missing fixture'),{code:'ENOENT'});return text;};
  assert.deepEqual(readCargoConfig([main],read),{build:{target:'own',rustflags:['first','second']}});
  files[path.join(root,'absent.toml')]='invalid = [';
  assert.throws(()=>readCargoConfig([main],read),/absent.toml line/);
  files[path.join(root,'absent.toml')]='include=["config.toml"]';
  assert.throws(()=>readCargoConfig([main],read),/include cycle/);
});


test('Cargo runner arrays replace lower runners and retain the higher configuration origin (K1025)',()=>{
  const root=path.resolve('cargo-origins'),low=path.join(root,'home','config.toml'),high=path.join(root,'project','.cargo','config.toml');
  const files:Record<string,string>={};
  files[low]='[target.native]\nrunner=["./low-runner"]';
  files[high]='[target.native]\nrunner=["./high-runner","--extra"]';
  const merged=readCargoConfig([high,low],file=>files[file]??'');
  assert.equal(cargoRunnerOrigin(merged,'native'),high);
  assert.deepEqual(cargoTripleRunner(merged,{},'native'),['./high-runner','--extra']);
  files[low]='[target.native]\nrunner="./low"';
  files[high]='[target.native]\nrunner="./high"';
  const scalar=readCargoConfig([high,low],file=>files[file]??'');
  assert.equal(cargoRunnerOrigin(scalar,'native'),high);
  const cli=cargoCommandConfig(['--config','target.native.runner="./cli"'],root);
  assert.equal(cargoRunnerOrigin(mergeCargoConfig(scalar,cli),'native'),undefined);
});


test('resolved Cargo runners combine file origins, environment and command precedence (K1025)',()=>{
  const cwd=path.resolve('cargo-runner-selection'),file=path.join(cwd,'project','.cargo','config.toml');
  const config=readCargoConfig([file],()=> '[target.native]\nrunner="./tools/file --file"');
  const facts=new Set(['unix']);
  assert.deepEqual(resolvedCargoRunner(config,{}, {},'native',facts,cwd),[path.join(cwd,'project','tools','file'),'--file']);
  const env={CARGO_TARGET_NATIVE_RUNNER:'./tools/env --env'};
  assert.deepEqual(resolvedCargoRunner(config,{},env,'native',facts,cwd),[path.join(cwd,'tools','env'),'--env']);
  const command=cargoCommandConfig(['--config','target.native.runner="./tools/cli --cli"'],cwd);
  assert.deepEqual(resolvedCargoRunner(config,command,env,'native',facts,cwd),[path.join(cwd,'tools','cli'),'--cli']);
  const conditional=readCargoConfig([file],()=> "[target.'cfg(unix)']\nrunner=\"./tools/conditional\"");
  assert.deepEqual(resolvedCargoRunner(conditional,{}, {},'native',facts,cwd),[path.join(cwd,'project','tools','conditional')]);
});


test('native Rust cfg reports preserve target facts and reject empty or malformed reports (K1025)',()=>{
  assert.deepEqual([...cargoCfgFacts('unix\ntarget_os = "linux"\ntarget_arch="aarch64"\n')],['unix','target_os="linux"','target_arch="aarch64"']);
  assert.throws(()=>cargoCfgFacts(''),/no target cfg facts/);
  assert.throws(()=>cargoCfgFacts('target_os=linux'),/invalid rustc cfg output/);
});


test('Rust cfg queries invoke only compiler introspection and preserve process failures (K1025)',async t=>{
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-rust-cfg-query-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const compiler=path.join(root,'rustc'),log=path.join(root,'args.json');
  writeFileSync(compiler,`#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));process.stdout.write(process.env.CFG_OUTPUT||'');process.stderr.write(process.env.CFG_ERROR||'');process.exitCode=Number(process.env.CFG_EXIT||0);
`,{mode:0o755});
  const facts=await queryRustCfg(compiler,'native-target',root,{CFG_OUTPUT:'unix\ntarget_os="linux"\n'});
  assert.ok(facts.has('target_os="linux"'));
  assert.deepEqual(JSON.parse(readFileSync(log,'utf8')),['--print=cfg','--target','native-target']);
  const group=buildGroups([request('one',['--test','one'],{command:compiler,cwd:root,env:{CFG_OUTPUT:'cargo fixture\nhost: native-host\n'}})])[0];
  assert.ok(group);
  assert.equal(await queryCargoHost(group),'native-host');
  assert.deepEqual(JSON.parse(readFileSync(log,'utf8')),['-vV']);

  await assert.rejects(queryRustCfg(compiler,'native-target',root,{CFG_EXIT:'1',CFG_ERROR:'fixture compiler failure'}),/fixture compiler failure/);
  await assert.rejects(queryRustCfg(path.join(root,'missing'),'native-target',root,{}),/ENOENT/);
  await assert.rejects(queryRustCfg(compiler,'native-target',root,{}),/no target cfg facts/);
});


test('Cargo compiler resolution retains configuration origins and explicit overrides (K1025)',()=>{
  const cwd=path.resolve('cargo-compiler'),file=path.join(cwd,'project','.cargo','config.toml');
  const config=readCargoConfig([file],()=> '[build]\nrustc="./tool/rustc"');
  assert.equal(resolvedCargoRustc(config,{}, {},cwd),path.join(cwd,'project','tool','rustc'));
  assert.equal(resolvedCargoRustc(config,{}, {CARGO_BUILD_RUSTC:'./env/rustc'},cwd),path.join(cwd,'env','rustc'));
  const command=cargoCommandConfig(['--config','build.rustc="./cli/rustc"'],cwd);
  assert.equal(resolvedCargoRustc(config,command,{CARGO_BUILD_RUSTC:'other'},cwd),path.join(cwd,'cli','rustc'));
  assert.equal(resolvedCargoRustc(config,command,{RUSTC:'./special/rustc'},cwd),path.join(cwd,'special','rustc'));
  assert.equal(resolvedCargoRustc({}, {},{},cwd),'rustc');
  assert.throws(()=>resolvedCargoRustc({}, {},{RUSTC:''},cwd),/must name a compiler/);
});


test('Cargo native contexts combine tool host, target configuration and existing runners (K1025)',async t=>{
  const root=realpathSync(mkdtempSync(path.join(tmpdir(),'kit-cargo-context-')));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const cargo=path.join(root,'cargo'),log=path.join(root,'queries.jsonl');
  writeFileSync(cargo,`#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');console.log('host: native-host');
`,{mode:0o755});
  const group=buildGroups([request('one',['--test','one'],{command:cargo,cwd:root,env:{},options:['test']})])[0];
  assert.ok(group);
  assert.deepEqual(await cargoNativeContexts(group,{},{}),[{triple:'native-host',runner:[]}]);
  const configured={build:{target:['target-one','target-two']},target:{'target-one':{runner:'one --flag'},'target-two':{runner:['two','--other']}}};
  assert.deepEqual(await cargoNativeContexts(group,configured,{}),[{triple:'target-one',runner:['one','--flag'],runnerType:'string'},{triple:'target-two',runner:['two','--other']}]);
  assert.deepEqual(readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line)),[['-vV'],['-vV']]);
});

test('Rust ledger shares a captured executable between suite and exact feature bindings (K1025)',async t=>{
  const root=repository(t,{edit:config=>{const rust=config.implementations.find(i=>i.name==='rust');assert.ok(rust);rust.command='./cargo-driver';return config;}});
  const binary=path.join(root,'native-rust'),log=path.join(root,'rust-calls.jsonl'),manifest=path.join(root,'rust','Cargo.toml');
  writeFileSync(binary,`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'run',args,manifest:process.env.CARGO_MANIFEST_DIR})+'\\n');const names=args.includes('--exact')?['empty']:['empty','ascii'];console.log('running '+names.length+' tests');for(const name of names)console.log('test vectors::'+name+' ... ok');console.log('test result: ok. '+names.length+' passed; 0 failed; 0 ignored; 0 measured; 0 filtered out');
`,{mode:0o755});
  const capture=new URL('../../scripts/kit/parity-executable.mts',import.meta.url).href;
  const message=artifact({manifest_path:manifest,target:{name:'codec',kind:['test'],src_path:path.join(root,'rust/tests/codec.rs')},profile:{test:false},executable:binary});
  writeFileSync(path.join(root,'cargo-driver'),`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);if(args[0]==='-vV'){console.log('host: fixture-native');}else{
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({kind:'build',args})+'\\n');const config=args[args.indexOf('--config')+1];const runner=JSON.parse(config.slice(config.indexOf('=')+1));import(${JSON.stringify(capture)}).then(({captureExecutable})=>{captureExecutable(runner.at(-1),${JSON.stringify(binary)},[],{cwd:${JSON.stringify(path.join(root,'rust'))},env:{CARGO_MANIFEST_DIR:${JSON.stringify(path.join(root,'rust'))}}});console.log(${JSON.stringify(JSON.stringify(message))});process.exitCode=Number(process.env.KIT_BUILD_STATUS??0);});}
`,{mode:0o755});
  const files=new Set([...Object.keys(FILES),'config/parity.json','cargo-driver','native-rust']);
  const declaration=readDeclaration(root,files);assert.ok(declaration.model);
  declaration.model.config.units.push({id:'rust-feature',kind:'feature',requirements:['CX-1'],bindings:[{implementation:'rust',test:'rust/tests/codec.rs',id:'vectors::empty'}]});
  const rust=declaration.model.implementations.get('rust');assert.ok(rust);declaration.model.unitImplementations.set('rust-feature',[rust]);
  const result=await runBindings(declaration.model,root,{files,env:{...ENV,HOME:root,CARGO_HOME:path.join(root,'cargo-home')},say:()=>{},units:new Set(['codec','rust-feature']),implementations:new Set(['rust'])});
  assert.deepEqual(result.findings,[]);
  assert.deepEqual(result.ledger.cases.map(entry=>[entry.unit,entry.case,entry.outcome]),[['codec','empty','pass'],['codec','ascii','pass'],['rust-feature','vectors::empty','pass']]);
  const calls=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(calls.map(call=>call.kind),['build','run','run']);
  assert.ok(calls.slice(1).every(call=>call.manifest===path.join(root,'rust')));
  const compilerFailed = await runBindings(declaration.model, root, {
    files, env: {...ENV, HOME: root, CARGO_HOME: path.join(root,'cargo-home'), KIT_BUILD_STATUS: '1'},
    say: () => {}, units: new Set(['codec','rust-feature']), implementations: new Set(['rust']),
  });
  assert.equal(compilerFailed.findings.length, 2, 'a compiler failure after emitting every artifact remains a failure');
  assert.ok(compilerFailed.findings.every(entry => /build of the tests exited with 1/.test(entry.message)));
  assert.equal(compilerFailed.ledger.cases.length, 3, 'independently completed cases still provide their execution evidence');
  assert.ok(compilerFailed.ledger.cases.every(entry => entry.outcome === 'pass'));
});

test('Rust ledger verifies every configured target without mixing their case reports (K1025)', async t => {
  for (const failedTarget of [undefined, 'target-one', 'target-two']) await t.test(failedTarget ?? 'all targets pass', async t => {
    const root = repository(t, { files: {
      'rust/tests/codec.rs': 'PASS vectors::empty\nPASS vectors::ascii\n' + (failedTarget ? `FAIL_ON_TARGET ${failedTarget} vectors::empty\n` : ''),
    }, edit: config => {
      const rust = config.implementations.find(entry => entry.name === 'rust');
      assert.ok(rust);
      rust.args = ['--target', 'target-one', '--target=target-two'];
      config.units.push({ id: 'rust-feature', kind: 'feature', requirements: ['CX-1'], bindings: [
        { implementation: 'rust', test: 'rust/tests/codec.rs', id: 'vectors::empty' },
      ] });
      return config;
    } });
    const files = new Set([...Object.keys(FILES), 'config/parity.json']);
    const declaration = readDeclaration(root, files);
    assert.ok(declaration.model);
    const result = await runBindings(declaration.model, root, {
      files, env: { ...ENV, HOME: root, CARGO_HOME: path.join(root, 'cargo-home') },
      say: () => {}, units: new Set(['codec', 'rust-feature']), implementations: new Set(['rust']),
    });
    assert.equal(result.ledger.runs.length, 4, 'suite and exact feature run independently on both targets');
    assert.deepEqual(result.ledger.runs.map(entry => entry.target), ['target-one', 'target-two', 'target-one', 'target-two']);
    assert.deepEqual(result.ledger.cases.map(entry => [entry.target, entry.case, entry.outcome]), [
      ['target-one', 'empty', failedTarget === 'target-one' ? 'fail' : 'pass'], ['target-one', 'ascii', 'pass'],
      ['target-two', 'empty', failedTarget === 'target-two' ? 'fail' : 'pass'], ['target-two', 'ascii', 'pass'],
      ['target-one', 'vectors::empty', failedTarget === 'target-one' ? 'fail' : 'pass'],
      ['target-two', 'vectors::empty', failedTarget === 'target-two' ? 'fail' : 'pass'],
    ]);
    if (failedTarget) {
      assert.equal(result.findings.length, 2);
      assert.ok(result.findings.every(entry => entry.message.startsWith(`target ${failedTarget}: `)));
    } else assert.deepEqual(result.findings, []);
  });
});

test('Cargo string runner capture preserves its configuration type and quotes owned paths (K1025)', async t => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "kit cargo ' runner-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'captures');
  mkdirSync(directory);
  const log = path.join(root, 'call.json');
  const driver = path.join(root, 'cargo.mjs');
  writeFileSync(driver, `import fs from 'node:fs'; import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2); fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args,path:process.env.PATH}));
const value=args[args.indexOf('--config')+1]; const runner=JSON.parse(value.slice(value.indexOf('=')+1));
if(typeof runner!=='string')throw new Error('native Cargo refuses merging an array over a string runner');
const result=spawnSync(runner,[process.execPath,'--version'],{env:process.env,encoding:'utf8'});
if(result.error)throw result.error;process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exitCode=result.status;
`);
  const group = buildGroups([request('one', ['--test', 'one'], {
    command: process.execPath, cwd: root, env: { PATH: process.env.PATH },
    options: [driver, 'test', '--manifest-path', 'client/Cargo.toml'],
  })])[0];
  assert.ok(group);
  const result = await compileCargoGroup(group, () => {}, { directory, triple: 'native', runnerType: 'string' });
  assert.equal(result.result.status, 0, result.result.stderr);
  const captures = readdirSync(directory).filter(name => name.startsWith('binary-'));
  assert.equal(captures.length, 1);
  assert.ok(captures[0]);
  const invocation = readExecutable(directory, captures[0]);
  assert.equal(invocation.source, process.execPath);
  assert.deepEqual(invocation.args, ['--version']);
});
