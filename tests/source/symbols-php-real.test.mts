// The PHP symbol extractor on real PHP sources (K307): a symbol whose docblock carries @internal, as phpstan and psalm read it, is
// no public API. The extractor runs on the php-parser of var/tools/symbols-php, which `make install-tools` installs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { tree } from '../kit/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUTOLOAD = path.join(ROOT, 'var/tools/symbols-php/vendor/autoload.php');

/** The public symbol ids that the extractor gives for the PHP files `files`. */
function symbolsOf(t: Parameters<typeof tree>[0], files: Record<string, string>): string[] {
  if (!existsSync(AUTOLOAD)) assert.fail(`${path.relative(ROOT, AUTOLOAD)} does not exist; run make install-tools`);
  const root = tree(t, files);
  const run = spawnSync('php', [path.join(ROOT, 'scripts/kit/symbols/php/extract.php'), AUTOLOAD, root], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout) as string[];
}

test('a class, method, constant, property and function whose docblock carries @internal is no public symbol (K307)', (t) => {
  const source = `<?php
namespace A;

/** The open class. */
class Open
{
    public const X = 1;
    /** @internal */
    public const HIDDEN = 2;
    public int $shown = 0;
    /**
     * Not for use outside the package.
     *
     * @internal
     */
    public int $hidden = 0;
    public function run(): void {}
    /** @internal used by the package only */
    public function secret(): void {}
}

/** @internal */
final class Hidden
{
    public function method(): void {}
}

function shown(): void {}
/** @internal */
function hidden(): void {}
`;
  assert.deepEqual(symbolsOf(t, { 'src/A.php': source }), ['A\\Open', 'A\\Open::$shown', 'A\\Open::X', 'A\\Open::run', 'A\\shown']);
});

test('the word internal outside an @internal tag does not hide a symbol (K307)', (t) => {
  const source = '<?php\nnamespace A;\n\n/** Internal use is described here; the tag is {@internal} only at a line start. */\nclass Open\n{\n    /** An @internalised name. */\n    public function run(): void {}\n}\n';
  assert.deepEqual(symbolsOf(t, { 'src/A.php': source }), ['A\\Open', 'A\\Open::run']);
});
