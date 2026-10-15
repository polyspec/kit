// Tests of scripts/kit/install-vscode.mts: the VS Code of an extension's integration test is the minimum of its
// engines.vscode; an install publishes the downloaded copy by a rename, leaves no directory of its download, does nothing
// for a present copy and keeps the copy of a concurrent install; the offline read fails without a complete copy. The
// download of @vscode/test-electron is replaced by a function that writes its layout, so no test reaches the network; the
// tests of the command run @vscode/test-electron against a stub of update.code.visualstudio.com behind a local proxy (K173).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { installVSCode, installedExecutable, vscodeCopy } from '../../scripts/kit/install-vscode.mts';
import type { Download } from '../../scripts/kit/install-vscode.mts';

const directory = (t: TestContext) => {
  const created = mkdtempSync(path.join(tmpdir(), 'kit-install-vscode-'));
  t.after(() => rmSync(created, { recursive: true, force: true }));
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

test('an engines.vscode that is not ^X.Y.Z fails with the value and the rule', (t) => {
  const { extension, tools } = setup(t, '>=1.138.0');
  assert.throws(() => vscodeCopy(extension, tools), /package\.json: engines\.vscode is ">=1\.138\.0"; the install reads the minimum of a range \^X\.Y\.Z$/);
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
});

test('the offline read of an installed copy returns its executable', async (t) => {
  const { extension, tools } = setup(t);
  const installed = await installVSCode(extension, tools, fakeDownload([]));
  assert.ok(installedExecutable(extension, tools).startsWith(installed), 'the executable is not inside the installed copy');
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
const stubUpdateService = async (t: TestContext, dir: string, aborted: (attempt: number) => boolean) => {
  const { key, cert } = certificate(dir);
  const body = archive(dir);
  const served = { archives: 0 };
  const service = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', `https://${HOST}`);
    if (url.pathname === '/api/releases/stable') {
      response.end(JSON.stringify([VERSION]));
    } else if (url.pathname.startsWith(`/${VERSION}/`)) {
      response.writeHead(302, { location: `https://${HOST}/archive/vscode.tar.gz` }).end();
    } else if (url.pathname === '/archive/vscode.tar.gz') {
      served.archives += 1;
      response.writeHead(200, { 'content-length': body.length, 'content-disposition': 'attachment; filename=vscode.tar.gz' });
      if (aborted(served.archives)) response.write(body.subarray(0, body.length >> 1), () => response.socket?.destroy());
      else response.end(body);
    } else {
      response.writeHead(404).end();
    }
  });
  const proxy = createHttpServer();
  proxy.on('connect', (_request: IncomingMessage, socket, head: Buffer) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) socket.unshift(head);
    service.emit('connection', socket);
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  t.after(() => {
    proxy.closeAllConnections();
    proxy.close();
    service.close();
  });
  const address = proxy.address();
  assert.ok(address !== null && typeof address === 'object', 'the proxy listens on no port');
  return { proxy: `http://127.0.0.1:${address.port}`, cert, served };
};

/** Runs the command against the stub; fails when it has not exited after `seconds`. */
const runCommand = async (extension: string, tools: string, proxy: string, cert: string, seconds = 20) => {
  const child = spawn(process.execPath, [path.resolve('scripts/kit/install-vscode.mts'), extension, tools], {
    env: { ...process.env, npm_config_https_proxy: proxy, npm_config_proxy: '', NODE_EXTRA_CA_CERTS: cert },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const timer = setTimeout(() => child.kill('SIGKILL'), seconds * 1000);
  const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  assert.notEqual(signal, 'SIGKILL', `the install did not exit within ${seconds}s:\n${output}`);
  return { code, output };
};

/** The processes of the machine whose command line names `dir`, such as a tar that extracts into it. */
const processesIn = (dir: string): string[] =>
  spawnSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8' }).stdout.split('\n').filter((line) => line.includes(dir));

test('the command exits with the copy when a download attempt is aborted and a retry succeeds, and leaves no process', async (t) => {
  const { extension, tools } = setup(t);
  const { proxy, cert, served } = await stubUpdateService(t, directory(t), (attempt) => attempt === 1);
  const { code, output } = await runCommand(extension, tools, proxy, cert);
  assert.equal(code, 0, output);
  assert.equal(served.archives, 2);
  const { directory: copy } = vscodeCopy(extension, tools);
  assert.ok(existsSync(path.join(copy, 'product.json')), output);
  assert.deepEqual(readdirSync(tools), [path.basename(copy)]);
  assert.deepEqual(processesIn(tools), []);
});

test('the command fails with the error when every download attempt is aborted, and leaves no process', async (t) => {
  const { extension, tools } = setup(t);
  const { proxy, cert } = await stubUpdateService(t, directory(t), () => true);
  const { code, output } = await runCommand(extension, tools, proxy, cert);
  assert.notEqual(code, 0, output);
  assert.match(output, /Failed to download and unzip VS Code 1\.138\.0/);
  assert.deepEqual(readdirSync(tools), []);
  assert.deepEqual(processesIn(tools), []);
});
