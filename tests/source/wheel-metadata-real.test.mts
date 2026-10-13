// The metadata of a wheel, read by the real pip of this checkout (var/tools/mise/shims/python3) without installing it: pip names the
// .dist-info of the distribution itself, so a wheel that vendors another distribution, with its own .dist-info/METADATA
// inside the package, gives the name, version and Requires-Dist of the wheel only. Nothing reaches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { wheelMetadata } from '../../scripts/kit/release-wheel.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PYTHON = path.join(ROOT, 'var/tools/mise/shims/python3');

// A wheel of pkg 1.0 that requires idna and vendors dep 2.0 with its own dist-info under pkg/_vendor.
const WRITE_WHEEL = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as wheel:
    wheel.writestr('pkg/__init__.py', '')
    wheel.writestr('pkg/_vendor/dep-2.0.dist-info/METADATA', 'Metadata-Version: 2.1\\nName: dep\\nVersion: 2.0\\nRequires-Dist: other==9\\n')
    wheel.writestr('pkg-1.0.dist-info/METADATA', 'Metadata-Version: 2.1\\nName: pkg\\nVersion: 1.0\\nRequires-Dist: idna==3.20\\n')
    wheel.writestr('pkg-1.0.dist-info/WHEEL', 'Wheel-Version: 1.0\\nGenerator: kit-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
    wheel.writestr('pkg-1.0.dist-info/RECORD', '')
`;

test('the metadata of a wheel that vendors a distribution is the metadata of the wheel only', (t) => {
  assert.ok(existsSync(PYTHON), 'var/tools/mise/shims/python3 is installed by make install-tools');
  const folder = mkdtempSync(path.join(tmpdir(), 'kit-wheel-metadata-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const wheel = path.join(folder, 'pkg-1.0-py3-none-any.whl');
  const written = spawnSync(PYTHON, ['-c', WRITE_WHEEL, wheel], { encoding: 'utf8' });
  assert.equal(written.status, 0, written.stderr);
  assert.deepEqual(wheelMetadata(ROOT, wheel, process.env), { name: 'pkg', version: '1.0', requiresDist: ['idna==3.20'] });
});
