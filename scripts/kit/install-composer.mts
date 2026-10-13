// Installs the composer.phar that config/toolchain.json composer declares with a sha256 into var/tools/composer, with the
// wrapper composer in var/tools/bin. The download is refused unless its SHA-256 is the declared one. An installed
// composer.phar with that digest is kept. A Composer declared without a digest is verified by check-toolchain, not installed.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { installOnce } from './bootstrap/install-tool.mts';
import { bootstrapEnvironment, quote, run, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';
import { fileDigest } from './bootstrap/digest.mts';

/** Installs the declared Composer `{ version, sha256 }` into var/tools/composer of `root` and writes the wrapper. */
export function installComposer({ root, declared, print = () => {} }: { root: string; declared: { version: string; sha256: string }; print?: (text: string) => void }) {
  const prefix = toolsPath(root, 'composer');
  const result = installOnce({
    root, label: 'Composer', prefix, recorded: declared.sha256, print,
    installedRelease: (directory: string) => (existsSync(path.join(directory, 'composer.phar')) ? fileDigest(path.join(directory, 'composer.phar')) : undefined),
    install: (next: string) => {
      const file = path.join(next, 'composer.phar');
      const url = `https://getcomposer.org/download/${declared.version}/composer.phar`;
      run('curl', ['--fail', '--silent', '--show-error', '--location', '--output', file, url], { cwd: root, env: bootstrapEnvironment(root) }, print);
      const actual = fileDigest(file);
      if (actual !== declared.sha256) {
        rmSync(file, { force: true });
        throw new Error(`${url} has the sha256 ${actual}; config/toolchain.json composer declares ${declared.sha256}`);
      }
    },
  });
  writeWrapper(root, 'composer', wrapperText(`Composer ${declared.version} of this checkout`, `exec php ${quote(path.join(prefix, 'composer.phar'))} "$@"`), print);
  return result;
}
