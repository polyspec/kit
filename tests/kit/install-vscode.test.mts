// Tests of scripts/kit/install-vscode.mts: the VS Code of an extension's integration test is the minimum of its
// engines.vscode; an install publishes the downloaded copy by a rename, leaves no directory of its download, does nothing
// for a present copy and keeps the copy of a concurrent install; the offline read fails without a complete copy. The
// download of @vscode/test-electron is replaced by a function that writes its layout, so no test reaches the network; the
// tests of the command run @vscode/test-electron against a stub of update.code.visualstudio.com behind a local proxy (K173).
import assert from 'node:assert/strict';
import { ChildProcess, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { Server as NetServer } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { Duplex } from 'node:stream';
import { downloadInProcessOf, installVSCode, installedExecutable, vscodeCopy } from '../../scripts/kit/install-vscode.mts';
import type { Download } from '../../scripts/kit/install-vscode.mts';
import { runCommand as runOwnedCommand } from '../../scripts/kit/run-command.mts';

const ownedResources = new WeakMap<TestContext, (() => Promise<void>)[]>();

async function awaitCleanup(work: Promise<void>[], message: string): Promise<void> {
  const failures: unknown[] = [];
  for (const result of await Promise.allSettled(work)) {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason;
      failures.push(reason);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, message);
}

const directory = (t: TestContext) => {
  const created = mkdtempSync(path.join(tmpdir(), 'kit-install-vscode-'));
  t.after(async () => {
    await awaitCleanup((ownedResources.get(t) ?? []).map(close => close()), `fixture retained because resource cleanup failed: ${created}`);
    rmSync(created, { recursive: true, force: true });
  });
  return created;
};

/** An extension package whose engines.vscode is `range`, and an empty tools directory. */
const setup = (t: TestContext, range = '^1.138.0') => {
  const base = directory(t);
  const extension = path.join(base, 'extension');
  mkdirSync(extension);
  writeFileSync(path.join(extension, 'package.json'), JSON.stringify({ name: 'extension', engines: { vscode: range } }));
  const tools = path.join(base, 'tools');
  mkdirSync(tools);
  return { extension, tools };
};

// A download in the layout of @vscode/test-electron: the copy and, after its last file, is-complete.
const fakeDownload = (calls: string[]): Download => async ({ version, platform, cachePath }) => {
  calls.push(cachePath);
  const copy = path.join(cachePath, `vscode-${platform}-${version}`);
  mkdirSync(copy, { recursive: true });
  writeFileSync(path.join(copy, 'product.json'), '{}');
  writeFileSync(path.join(copy, 'is-complete'), '');
  return copy;
};

test('the copy is the minimum of engines.vscode for the platform, in the layout of @vscode/test-electron', (t) => {
  const { extension, tools } = setup(t);
  assert.deepEqual(vscodeCopy(extension, tools, 'linux-x64'), { version: '1.138.0', platform: 'linux-x64', directory: path.join(tools, 'vscode-linux-x64-1.138.0') });
});

// K1077: the copy is the minimum version of any range that semver reads, not only ^X.Y.Z.
test('K1077: the copy is the minimum of an engines.vscode range of any form', (t) => {
  const ranges: [string, string][] = [['>=1.138.0', '1.138.0'], ['~1.138.2', '1.138.2'], ['1.138.x', '1.138.0'], ['^1.138.0 || ^2.0.0', '1.138.0']];
  for (const [range, version] of ranges) {
    const { extension, tools } = setup(t, range);
    assert.equal(vscodeCopy(extension, tools, 'linux-x64').version, version, range);
  }
});

test('an engines.vscode that is no range fails with the value', (t) => {
  const { extension, tools } = setup(t, 'latest');
  assert.throws(() => vscodeCopy(extension, tools), /package\.json: engines\.vscode is "latest", which is no semver range with a minimum version$/);
});

test('an install publishes the downloaded copy by a rename and a second install downloads nothing', async (t) => {
  const { extension, tools } = setup(t);
  const calls: string[] = [];
  const installed = await installVSCode(extension, tools, fakeDownload(calls));
  assert.equal(installed, vscodeCopy(extension, tools).directory);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], path.join(tools, `.next-${process.pid}`));
  assert.deepEqual(readdirSync(tools), [path.basename(installed)], 'the install left the directory of its download');
  assert.ok(existsSync(path.join(installed, 'product.json')));
  await installVSCode(extension, tools, fakeDownload(calls));
  assert.equal(calls.length, 1, 'an install of a present copy downloaded again');
});

test('an install keeps the complete copy that a concurrent install published first', async (t) => {
  const { extension, tools } = setup(t);
  const { directory: copy } = vscodeCopy(extension, tools);
  const first: Download = async (options) => {
    // The concurrent install publishes its copy while this one downloads.
    mkdirSync(copy);
    writeFileSync(path.join(copy, 'first'), '');
    writeFileSync(path.join(copy, 'is-complete'), '');
    return fakeDownload([])(options);
  };
  await installVSCode(extension, tools, first);
  assert.ok(existsSync(path.join(copy, 'first')), 'the install replaced the copy of the concurrent install');
  assert.deepEqual(readdirSync(tools), [path.basename(copy)]);
});

test('an incomplete download publishes nothing and names its directory, and the offline read then fails', async (t) => {
  const { extension, tools } = setup(t);
  const incomplete: Download = async ({ version, platform, cachePath }) => {
    const copy = path.join(cachePath, `vscode-${platform}-${version}`);
    mkdirSync(copy, { recursive: true });
    return copy;
  };
  await assert.rejects(installVSCode(extension, tools, incomplete), /left no complete copy in .*\.next-\d+\/vscode-/);
  assert.deepEqual(readdirSync(tools), []);
  assert.throws(() => installedExecutable(extension, tools), /^Error: VS Code 1\.138\.0 is not installed in .*; run make install-vscode$/);
  // K1257: the fix names the install target of the consumer, whose Makefile may give it another name.
  assert.throws(() => installedExecutable(extension, tools, 'make app-install-vscode'), /^Error: VS Code 1\.138\.0 is not installed in .*; run make app-install-vscode$/);
});

test('the offline read of an installed copy returns its executable', async (t) => {
  const { extension, tools } = setup(t);
  const installed = await installVSCode(extension, tools, fakeDownload([]));
  assert.ok(installedExecutable(extension, tools).startsWith(installed), 'the executable is not inside the installed copy');
});

// K1285: a failed download states its cause. The download process of each test is a file of the test that runs the real
// downloadProcess with a download that rejects, or that sends its own messages, so the install reads them through its channel.
const OPTIONS = { version: '1.138.0', platform: 'linux-x64', cachePath: 'unused' };

/** The error of a download in a process that runs the module `source`. */
const failureOf = async (t: TestContext, source: string): Promise<string> => {
  const file = path.join(directory(t), 'download-process.mjs');
  writeFileSync(file, source);
  try {
    await downloadInProcessOf(file)(OPTIONS);
  } catch (error) {
    assert.ok(error instanceof Error, 'the install rejects with an Error');
    return error.message;
  }
  return assert.fail('the download of a failing process succeeded');
};

/** The module of a download process whose download names the step `resolvingCDNLocation` and then rejects with the expression `rejection`. */
const rejecting = (rejection: string): string => `
  import { downloadProcess } from ${JSON.stringify(pathToFileURL(path.resolve('scripts/kit/install-vscode.mts')).href)};
  await downloadProcess(${JSON.stringify(OPTIONS)}, async (_options, step) => { step('resolvingCDNLocation'); throw ${rejection}; });
`;

test('K1285: a rejection with a message keeps its message', async (t) => {
  assert.equal(await failureOf(t, rejecting(`new Error('getaddrinfo ENOTFOUND update.code.visualstudio.com')`)), 'getaddrinfo ENOTFOUND update.code.visualstudio.com');
});

test('K1285: an Error without a message is sent with its name, its code, its cause and its stack', async (t) => {
  const message = await failureOf(t, rejecting(`Object.assign(new Error('', { cause: new Error('socket hang up') }), { code: 'ECONNRESET' })`));
  assert.match(message, /^Error without a message\ncode: ECONNRESET\ncause: socket hang up\nstack: Error\n\s+at /);
});

test('K1285: an AggregateError without a message is sent with its errors', async (t) => {
  const message = await failureOf(t, rejecting(`Object.assign(new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:443'), new Error('connect ECONNREFUSED ::1:443')], ''), { code: 'ECONNREFUSED' })`));
  assert.match(message, /^AggregateError without a message\ncode: ECONNREFUSED\nerrors: connect ECONNREFUSED 127\.0\.0\.1:443; connect ECONNREFUSED ::1:443\nstack: AggregateError\n\s+at /);
});

test('K1285: a rejection that is no Error is sent with its value', async (t) => {
  assert.equal(await failureOf(t, rejecting('undefined')), 'a rejection with the value undefined, which is no Error');
  assert.equal(await failureOf(t, rejecting(`''`)), `a rejection with the value '', which is no Error`);
  assert.equal(await failureOf(t, rejecting(`{ status: 503 }`)), 'a rejection with the value { status: 503 }, which is no Error');
});

test('K1285: a failure that arrives without a text names the version, the platform and the step that was running', async (t) => {
  assert.equal(await failureOf(t, `process.send({ step: 'fetchingVersion' }); process.send({ error: '' });`),
    'the download of VS Code 1.138.0 for linux-x64 failed without a message during the step fetchingVersion');
  assert.equal(await failureOf(t, `process.send({ error: null });`),
    'the download of VS Code 1.138.0 for linux-x64 failed without a message during the step start; its process sent the error null');
});

test('K1285: a download process that ends before its result names the step that was running', async (t) => {
  assert.equal(await failureOf(t, `process.send({ step: 'downloading' }, () => process.exit(3));`),
    'the download process of VS Code 1.138.0 ended with 3 during the step downloading, before its result');
});

// The command against a stub of update.code.visualstudio.com (K173). @vscode/test-electron pipes a .tar.gz download into a
// `tar -xzf -` child and never ends that child when the response fails, so the child kept the process alive after a
// retry succeeded. The stub serves the TLS of the host with a certificate of the test (NODE_EXTRA_CA_CERTS) behind an
// HTTP proxy (npm_config_https_proxy, which @vscode/test-electron reads), and aborts the archive response of the
// attempts that `aborted` names after half of its body.
const HOST = 'update.code.visualstudio.com';
const VERSION = '1.138.0';

/** A certificate of HOST and its key, made by openssl into `dir`. */
const certificate = (dir: string) => {
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return { key, cert };
};

/** A .tar.gz in the layout of a VS Code archive: one top directory, which the install strips. */
const archive = (dir: string): Buffer => {
  const source = path.join(dir, 'archive');
  mkdirSync(path.join(source, 'VSCode'), { recursive: true });
  writeFileSync(path.join(source, 'VSCode', 'product.json'), '{}');
  const file = path.join(dir, 'vscode.tar.gz');
  const made = spawnSync('tar', ['-czf', file, '-C', source, 'VSCode'], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return readFileSync(file);
};

/** Starts the stub and its proxy; returns the URL of the proxy, the certificate and the count of archive requests. */
const stubUpdateService = async (t: TestContext, dir: string, aborted: (attempt: number) => boolean, holdFirst = false) => {
  const { key, cert } = certificate(dir);
  const body = archive(dir);
  const served = { archives: 0 };
  const stages: string[] = [];
  const requested = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const connections = new Map<Duplex, Promise<void>>();
  const service = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `https://${HOST}`);
    if (url.pathname === '/api/releases/stable') {
      response.end(JSON.stringify([VERSION]));
    } else if (url.pathname.startsWith(`/${VERSION}/`)) {
      response.writeHead(302, { location: `https://${HOST}/archive/vscode.tar.gz` }).end();
    } else if (url.pathname === '/archive/vscode.tar.gz') {
      served.archives += 1;
      const attempt = served.archives;
      stages.push(`archive:${attempt}:requested`);
      const respond = () => {
        response.writeHead(200, { 'content-length': body.length, 'content-disposition': 'attachment; filename=vscode.tar.gz' });
        if (aborted(attempt)) response.write(body.subarray(0, body.length >> 1), () => {
          stages.push(`archive:${attempt}:aborted`);
          response.socket?.destroy();
        });
        else response.end(body, () => { stages.push(`archive:${attempt}:delivered`); });
      };
      if (holdFirst && attempt === 1) {
        requested.resolve();
        void released.promise.then(respond);
      } else respond();
    } else {
      response.writeHead(404).end();
    }
  });
  const proxy = createHttpServer();
  proxy.on('connect', (_request: IncomingMessage, socket, head: Buffer) => {
    connections.set(socket, new Promise(resolve => socket.once('close', () => { connections.delete(socket); resolve(); })));
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) socket.unshift(head);
    service.emit('connection', socket);
  });
  const closeServer = (server: typeof proxy | typeof service) => new Promise<void>((resolve, reject) => {
    server.close(error => {
      // Setup can fail before listen; an already-closed owned server also has no listener left to stop.
      if (error && !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) reject(error);
      else resolve();
    });
  });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    const socketCloses = [...connections.values()];
    for (const socket of connections.keys()) socket.destroy();
    proxy.closeAllConnections();
    await awaitCleanup([closeServer(proxy), closeServer(service), ...socketCloses], `local proxy cleanup failed: ${dir}`);
  })();
  const resources = ownedResources.get(t) ?? [];
  resources.push(close);
  ownedResources.set(t, resources);
  try {
    // Both listeners and every upgraded connection are owned before either asynchronous listen can fail.
    service.listen(0, '127.0.0.1');
    await once(service, 'listening');
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `local proxy setup and cleanup failed: ${dir}`, { cause: cleanupError });
    }
    throw error;
  }
  const address = proxy.address();
  assert.ok(address !== null && typeof address === 'object', 'the proxy listens on no port');
  return { proxy: `http://127.0.0.1:${address.port}`, cert, served, stages, requested: requested.promise, release: () => released.resolve(), close };
};

/** Observe the production command's actual downloader settlement and close without replacing its download. */
function observeInstaller(extension: string): string {
  const file = path.join(extension, 'observe-installer.mjs');
  writeFileSync(file, `
    import { syncBuiltinESMExports } from 'node:module';
    const cp = process.getBuiltinModule('node:child_process');
    const originalFork = cp.fork;
    cp.fork = (...args) => {
      const child = originalFork(...args);
      child.on('message', message => {
        if (message && (typeof message.executable === 'string' || typeof message.error === 'string'))
          process.stdout.write('[installer-observation] settled\\n');
      });
      child.once('close', () => process.stdout.write('[installer-observation] helper-closed\\n'));
      return child;
    };
    syncBuiltinESMExports();
  `);
  return file;
}

/** Runs the real command to owned close; native retry and cleanup behavior decides its result. */
const runCommand = async (extension: string, tools: string, proxy: string, cert: string) => {
  const result = await runOwnedCommand({
    command: process.execPath,
    args: ['--import', observeInstaller(extension), path.resolve('scripts/kit/install-vscode.mts'), extension, tools],
    env: { ...process.env, npm_config_https_proxy: proxy, npm_config_proxy: '', NODE_EXTRA_CA_CERTS: cert },
    stdout: 'pipe', stderr: 'pipe',
  });
  const output = result.stdout + result.stderr;
  assert.equal(result.error, undefined, output);
  assert.equal(result.signal, null, output);
  assert.equal(result.stopped, undefined, output);
  return { code: result.status, output };
};

/** The processes of the machine whose command line names `dir`, such as a tar that extracts into it. */
const processesIn = (dir: string): string[] =>
  spawnSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(dir));

test('K1232: an injected clock cannot replace retry settlement and owned close', async (t) => {
  const { extension, tools } = setup(t);
  const service = await stubUpdateService(t, directory(t), (attempt) => attempt === 1, true);
  const forcedOwners: number[] = [];
  t.mock.method(ChildProcess.prototype, 'kill', function (this: ChildProcess): boolean {
    // Record an owner-termination request without delivering it: the Red must not orphan the real downloader.
    if (this.pid !== undefined) forcedOwners.push(this.pid);
    return true;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = runCommand(extension, tools, service.proxy, service.cert);
  try {
    await Promise.race([service.requested, result.then(({ code, output }) => assert.fail(`installer ended before requesting its archive (${code}):\n${output}`))]);
    t.mock.timers.tick(86_400_000);
    t.mock.timers.reset();
    service.release();
    const { code, output } = await result;
    assert.equal(code, 0, output);
    assert.deepEqual(forcedOwners, [], 'advancing the injected clock must not kill the installer owner');
    assert.deepEqual(service.stages, ['archive:1:requested', 'archive:1:aborted', 'archive:2:requested', 'archive:2:delivered']);
    assert.equal(service.served.archives, 2);
    assert.match(output, /\[installer-observation\] settled[\s\S]*\[installer-observation\] helper-closed/);
    const { directory: copy } = vscodeCopy(extension, tools);
    assert.ok(existsSync(path.join(copy, 'product.json')), output);
    assert.deepEqual(readdirSync(tools), [path.basename(copy)]);
    assert.deepEqual(processesIn(tools), []);
  } finally {
    t.mock.timers.reset();
    service.release();
    await Promise.allSettled([result]);
    await service.close();
  }
});

test('K1232: exhausted archive retries preserve their error and owned close', async (t) => {
  const { extension, tools } = setup(t);
  const service = await stubUpdateService(t, directory(t), () => true);
  try {
    const { code, output } = await runCommand(extension, tools, service.proxy, service.cert);
    assert.notEqual(code, 0, output);
    assert.match(output, /Failed to download and unzip VS Code 1\.138\.0/);
    assert.match(output, /\[installer-observation\] settled[\s\S]*\[installer-observation\] helper-closed/);
    assert.ok(service.stages.filter(stage => stage.endsWith(':aborted')).length > 1, 'each retry reaches the local archive service');
    assert.deepEqual(readdirSync(tools), []);
    assert.deepEqual(processesIn(tools), []);
  } finally { await service.close(); }
});

test('K1232: a partial proxy setup failure closes the already-started service', async t => {
  const listeners: NetServer[] = [];
  const originalListen: unknown = Reflect.get(NetServer.prototype, 'listen');
  assert.ok(typeof originalListen === 'function');
  const failure = new Error('injected proxy listen failure');
  t.mock.method(NetServer.prototype, 'listen', function (this: NetServer, ...args: unknown[]): NetServer {
    listeners.push(this);
    if (listeners.length !== 2) {
      Reflect.apply(originalListen, this, args);
      return this;
    }
    queueMicrotask(() => this.emit('error', failure));
    return this;
  });
  try {
    await assert.rejects(stubUpdateService(t, directory(t), () => false), error => error === failure);
    assert.equal(listeners.length, 2);
    assert.ok(listeners.every(server => !server.listening), 'setup must close the service before rejecting');
  } finally {
    // The Red also owns the listener that the old setup failed to close.
    await Promise.all(listeners.filter(server => server.listening).map(server => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    })));
  }
});
