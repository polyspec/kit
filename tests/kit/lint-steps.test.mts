// K1050: the lint utilities run each tool with the configuration of the repository, which the tool finds by its own rules
// (ruff.toml, phpcs.xml.dist, phpstan.dist.neon, .golangci.yml, clippy.toml and the [lints] of Cargo.toml, .oxlintrc.json,
// knip.json); none names a file of the kit package or a rule of its own on the command line or in the environment.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const LINTS = ['lint-go', 'lint-php', 'lint-python', 'lint-rust', 'lint-ts'];
const FORCED = [/P8_LINTS/, /\bkitFile\(/, /\bkitPackageRoot\(/, /CLIPPY_CONF_DIR/, /--deny-warnings/, /'-D', 'warnings'/, /--extend-exclude/, /--min-confidence/, /knip-entries/, /--type-aware/, /'catch-check'/];

test('the lint utilities pass no configuration or rule of kit to the tools they run (K1050)', () => {
  const found = LINTS.flatMap(name => {
    const source = readFileSync(new URL(`../../scripts/kit/${name}.mts`, import.meta.url), 'utf8');
    return FORCED.filter(pattern => pattern.test(source)).map(pattern => `${name}: ${pattern.source}`);
  });
  assert.deepEqual(found, []);
});
