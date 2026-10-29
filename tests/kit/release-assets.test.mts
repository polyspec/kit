// Tests of the release archives of other repositories (scripts/kit/release-assets.mts, config/release-assets.json): the
// version is declared once in its entry, an archive whose destination holds its sha256 is kept, a download with another
// sha256 is refused and writes nothing, a zip with `unpack` is extracted once per archive, and a destination outside the
// ignored var/ is refused. The network is a stub of fetch that answers from a map; the zip is made by the zip of the machine.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { sha256 } from '../../scripts/kit/bootstrap/digest.mts';
import { fetchedAsset, fetchReleaseAssets, main, releaseAssets, UNPACKED_MARK } from '../../scripts/kit/release-assets.mts';
import { KIT_MAKE, tool } from './kit-tools.mts';
import { tree } from './tree.mts';
import { known } from './known.mts';

const URL_PATTERN = 'https://github.com/polyspec/codec/releases/download/v{version}/polyspec-codec-php-{version}.zip';
const URL = 'https://github.com/polyspec/codec/releases/download/v0.0.14/polyspec-codec-php-0.0.14.zip';

/** A zip that holds src/a.php, made with the zip of the machine. */
function zipBytes(t: TestContext): Buffer {
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-release-assets-zip-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(path.join(folder, 'a.php'), '<?php\n');
  const made = spawnSync('zip', ['-q', '-X', 'archive.zip', 'a.php'], { cwd: folder, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return readFileSync(path.join(folder, 'archive.zip'));
}

/** A repository that ignores var/ and declares `assets` in config/release-assets.json. */
function repository(t: TestContext, assets: unknown[]): string {
  return tree(t, { '.gitignore': 'var/\n', 'config/release-assets.json': JSON.stringify({ schema: 1, assets }) });
}

/** A fetch that answers each URL of `bodies` with its bytes and every other URL with 404, and records the URLs it was asked. */
function stubFetch(bodies: Record<string, Buffer>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const body = bodies[url];
    return body ? new Response(new Uint8Array(body)) : new Response('missing', { status: 404 });
  };
  return { fetch, asked };
}

const entry = (bytes: Buffer, fields: Record<string, unknown> = {}) => ({ name: 'codec-php', version: '0.0.14', url: URL_PATTERN, sha256: sha256(bytes), directory: 'var/composer-artifacts', ...fields });

test('fetch downloads an archive into its directory under the file name of its URL, and keeps it once it holds the sha256', async (t) => {
  const bytes = zipBytes(t);
  const root = repository(t, [entry(bytes)]);
  const { fetch, asked } = stubFetch({ [URL]: bytes });
  assert.deepEqual(await fetchReleaseAssets({ root, fetch }), ['codec-php']);
  assert.deepEqual(readFileSync(path.join(root, 'var/composer-artifacts/polyspec-codec-php-0.0.14.zip')), bytes);
  assert.deepEqual(readdirSync(path.join(root, 'var/composer-artifacts')), ['polyspec-codec-php-0.0.14.zip'], 'no file of the download is left beside it');
  const printed: string[] = [];
  assert.deepEqual(await fetchReleaseAssets({ root, fetch, print: text => printed.push(text) }), []);
  assert.deepEqual(asked, [URL], 'an archive that holds its sha256 is not downloaded again');
  assert.deepEqual(printed, [`var/composer-artifacts/polyspec-codec-php-0.0.14.zip holds codec-php 0.0.14 (sha256 ${sha256(bytes)})`]);
  assert.equal(fetchedAsset(root, 'codec-php'), path.join(root, 'var/composer-artifacts/polyspec-codec-php-0.0.14.zip'));
});

test('a download with another sha256 is refused and writes nothing; a changed file is downloaded again', async (t) => {
  const bytes = zipBytes(t);
  const root = repository(t, [entry(bytes)]);
  const { fetch } = stubFetch({ [URL]: Buffer.from('tampered') });
  await assert.rejects(fetchReleaseAssets({ root, fetch }), new RegExp(`${URL.replaceAll('.', '\\.')} has the sha256 ${sha256('tampered')}, expected ${sha256(bytes)} of codec-php in config/release-assets\\.json; nothing was written`));
  assert.equal(existsSync(path.join(root, 'var/composer-artifacts')), false);
  assert.throws(() => fetchedAsset(root, 'codec-php'), /does not hold the archive codec-php 0\.0\.14 .*; run make release-assets-fetch/);
  const good = stubFetch({ [URL]: bytes });
  await fetchReleaseAssets({ root, fetch: good.fetch });
  writeFileSync(path.join(root, 'var/composer-artifacts/polyspec-codec-php-0.0.14.zip'), 'changed');
  assert.deepEqual(await fetchReleaseAssets({ root, fetch: good.fetch }), ['codec-php']);
  await assert.rejects(fetchReleaseAssets({ root: repository(t, [entry(bytes, { version: '9.9.9' })]), fetch: good.fetch }), /the download of .*v9\.9\.9\/polyspec-codec-php-9\.9\.9\.zip failed with HTTP 404/);
});

test('a zip with unpack is extracted into its directory with the sha256 of the archive, and only again when the archive changes', async (t) => {
  const bytes = zipBytes(t);
  const root = repository(t, [entry(bytes, { unpack: 'var/products/codec' })]);
  const { fetch } = stubFetch({ [URL]: bytes });
  await fetchReleaseAssets({ root, fetch });
  assert.equal(readFileSync(path.join(root, 'var/products/codec/a.php'), 'utf8'), '<?php\n');
  assert.equal(readFileSync(path.join(root, 'var/products/codec', UNPACKED_MARK), 'utf8'), `${sha256(bytes)}\n`);
  writeFileSync(path.join(root, 'var/products/codec/a.php'), 'kept');
  const printed: string[] = [];
  await fetchReleaseAssets({ root, fetch, print: text => printed.push(text) });
  assert.equal(readFileSync(path.join(root, 'var/products/codec/a.php'), 'utf8'), 'kept', 'an extraction of the same archive is kept');
  assert.match(printed.join('\n'), new RegExp(`codec-php 0\\.0\\.14 in var/products/codec: ${sha256(bytes)} is installed`));
  writeFileSync(path.join(root, 'var/products/codec', UNPACKED_MARK), 'other\n');
  await fetchReleaseAssets({ root, fetch });
  assert.equal(readFileSync(path.join(root, 'var/products/codec/a.php'), 'utf8'), '<?php\n', 'an extraction of another archive is replaced');
  assert.deepEqual(readdirSync(path.join(root, 'var/products')), ['codec'], 'no temporary directory is left beside it');
});

test('the configuration refuses a destination outside var/ or not ignored, a repeated name, an unknown placeholder and a bad sha256', (t) => {
  const bytes = zipBytes(t);
  const refused: [unknown[], RegExp][] = [
    [[entry(bytes, { directory: 'artifacts' })], /\/assets\/0\/directory must match pattern/],
    [[entry(bytes, { directory: 'var/../artifacts' })], /\/assets\/0\/directory must match pattern/],
    [[entry(bytes, { unpack: '/tmp/codec' })], /\/assets\/0\/unpack must match pattern/],
    [[entry(bytes, { sha256: 'ABC' })], /\/assets\/0\/sha256 must match pattern/],
    [[entry(bytes, { url: 'http://example.com/a.zip' })], /\/assets\/0\/url must match pattern/],
    [[entry(bytes), entry(bytes)], /the name codec-php is declared twice\n.*the destination var\/composer-artifacts\/polyspec-codec-php-0\.0\.14\.zip is the destination of another entry/],
    [[entry(bytes, { url: 'https://example.com/v{tag}/a.zip' })], /the url https:\/\/example\.com\/v\{tag\}\/a\.zip holds a placeholder other than \{version\}/],
  ];
  for (const [assets, finding] of refused) assert.throws(() => releaseAssets(repository(t, assets)), finding, JSON.stringify(assets));
  const unignored = tree(t, { '.gitignore': 'var/tools/\n', 'config/release-assets.json': JSON.stringify({ schema: 1, assets: [entry(bytes)] }) });
  assert.throws(() => releaseAssets(unignored), /codec-php: var\/composer-artifacts is not ignored by Git/);
});

// K780-1: in a worktree each release archive directory is a link to that of the main checkout (K780), and Git names no path beyond a
// symbolic link; a declared folder is ignored when it or one of its ancestors is, so version and the other commands run there.
test('version runs in a worktree whose release archive directory is a link (K780-1)', async (t) => {
  const bytes = zipBytes(t);
  const checkout = tree(t, {});
  mkdirSync(path.join(checkout, 'var/products/ext'), { recursive: true });
  const root = repository(t, [entry(bytes, { name: 'ext', directory: 'var/products', unpack: 'var/products/ext' }), entry(bytes, { name: 'php', directory: 'var/products/php' })]);
  mkdirSync(path.join(root, 'var'));
  symlinkSync(path.join(checkout, 'var/products'), path.join(root, 'var/products'), 'dir');
  const printed: string[] = [];
  const errors: string[] = [];
  assert.equal(await main(['version', 'php'], { root, print: (text: string) => printed.push(text), error: (text: string) => errors.push(text) }), 0, errors.join('\n'));
  assert.deepEqual(printed, ['0.0.14']);
  const unignored = tree(t, { '.gitignore': 'var/tools/\n', 'config/release-assets.json': JSON.stringify({ schema: 1, assets: [entry(bytes, { directory: 'var/products' })] }) });
  mkdirSync(path.join(unignored, 'var'));
  symlinkSync(path.join(checkout, 'var/products'), path.join(unignored, 'var/products'), 'dir');
  assert.throws(() => releaseAssets(unignored), /codec-php: var\/products is not ignored by Git/);
});

test('version prints the version that the entry declares once, and the command line refuses other arguments', async (t) => {
  const bytes = zipBytes(t);
  const root = repository(t, [entry(bytes)]);
  const printed: string[] = [];
  const errors: string[] = [];
  const out = { root, print: (text: string) => printed.push(text), error: (text: string) => errors.push(text) };
  assert.equal(await main(['version', 'codec-php'], out), 0);
  assert.deepEqual(printed, ['0.0.14']);
  assert.equal(await main(['version', 'codec-js'], out), 1);
  assert.match(known(errors.at(-1), 'errors.at(-1)'), /declares no entry codec-js; it declares \[codec-php\]/);
  for (const argv of [[], ['version'], ['fetch', 'codec-php'], ['unpack']]) assert.equal(await main(argv, out), 2, argv.join(' '));
});

// The recipe of the main checkout: KIT_WORKTREE= keeps a run of the test in a worktree from the refusal of K780.
test('make release-assets-fetch runs the fetch online', () => {
  const dry = spawnSync('make', ['-n', '--no-print-directory', ...KIT_MAKE, 'release-assets-fetch', 'ONLINE=online-wrapper', 'KIT_WORKTREE='], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout.trim(), `online-wrapper ${process.execPath} ${tool(import.meta.resolve('../../scripts/kit/release-assets.mts'))} fetch`);
});
