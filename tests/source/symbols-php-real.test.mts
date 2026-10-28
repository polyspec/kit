// The PHP symbol extractor on real PHP sources (K307): a symbol whose docblock carries @internal, as phpstan and psalm read it, is
// no public API. The extractor runs on the php-parser of scripts/kit/symbols/php/vendor, which `make kit-install-symbols-php` installs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installedBinary } from './real-tools.mts';
import { tree } from '../kit/tree.mts';
import { parseJson } from '../../scripts/kit/schema-validate.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUTOLOAD = path.join(ROOT, 'scripts/kit/symbols/php/vendor/autoload.php');

/** The public symbol ids that the extractor gives for the PHP files `files`. */
function symbolsOf(t: Parameters<typeof tree>[0], files: Record<string, string>, extra: string[] = []): string[] {
  if (!existsSync(AUTOLOAD)) assert.fail(`${path.relative(ROOT, AUTOLOAD)} does not exist; run make kit-install-symbols-php`);
  const root = tree(t, files);
  const run = spawnSync(installedBinary('php'), [path.join(ROOT, 'scripts/kit/symbols/php/extract.php'), AUTOLOAD, root, ...extra], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return parseJson<string[]>(run.stdout, 'symbol-ids.schema.json', 'extract.php');
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

test('an internal trait contributes its public methods to its public consumer (K717)', (t) => {
  const source = `<?php
namespace A;

/** @internal */
class Hidden {}

final class Collection
{
    use ArrayRows, OtherRows {
        ArrayRows::shared insteadof OtherRows;
        ArrayRows::toArray as private;
        ArrayRows::privateHelper as public exposedHelper;
        OtherRows::visible as renamedVisible;
    }
}

/** @internal */
trait ArrayRows
{
    use NestedRows;
    public function toArray(): array { return []; }
    public function shared(): Hidden { return new Hidden(); }
    private function privateHelper(): void {}
    /** @internal */
    public function internalHelper(): void {}
}

/** @internal */
trait NestedRows
{
    use NestedSource { nested as private nestedSecret; }
}

/** @internal */
trait NestedSource
{
    public function nested(): void {}
}

/** @internal */
trait OtherRows
{
    public function shared(): void {}
    public function visible(): void {}
}
`;
  assert.deepEqual(symbolsOf(t, { 'src/Rows.php': source }), [
    'A\\Collection',
    'A\\Collection::exposedHelper',
    'A\\Collection::nested',
    'A\\Collection::renamedVisible',
    'A\\Collection::shared',
    'A\\Collection::visible',
  ]);
  assert.deepEqual(symbolsOf(t, { 'src/Rows.php': source }, ['--leaks']), [
    'A\\Collection::shared names the internal A\\Hidden',
  ]);
});

// K307-1: an @internal symbol is hidden from the API, so a public signature, parent or interface that names it leaks it.
test('a public signature, parent or interface that names an @internal class is a leak, and a public name is not (K307-1)', (t) => {
  const source = `<?php
namespace A;

/** @internal */
class Hidden {}
/** @internal */
interface HiddenContract {}
class Open {}

class Child extends Hidden implements HiddenContract
{
    public ?Hidden $field = null;
    public function __construct(public Hidden $promoted) {}
    public function take(int|Hidden $value, Open $open): ?Hidden { return null; }
    private function own(Hidden $value): void {}
    /** @internal */
    public function secret(Hidden $value): void {}
}

function build(Hidden&Open $both): Open { return new Open(); }
function fine(Open $open): Open { return $open; }
`;
  assert.deepEqual(symbolsOf(t, { 'src/A.php': source }, ['--leaks']), [
    'A\\Child names the internal A\\Hidden',
    'A\\Child names the internal A\\HiddenContract',
    'A\\Child::$field names the internal A\\Hidden',
    'A\\Child::$promoted names the internal A\\Hidden',
    'A\\Child::__construct names the internal A\\Hidden',
    'A\\Child::take names the internal A\\Hidden',
    'A\\build names the internal A\\Hidden',
  ]);
  assert.deepEqual(symbolsOf(t, { 'src/A.php': '<?php\nnamespace A;\n\nclass Open {}\nfunction fine(Open $open): Open { return $open; }\n' }, ['--leaks']), []);
});
