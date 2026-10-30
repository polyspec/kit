// Installs PHP's gen_stub.php with the exact PHP-Parser release it names into var/tools/php-arginfo. Builds and checks use this
// staged copy offline, so gen_stub never downloads into the PHP installation or the build tree.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replaceInstall } from './bootstrap/install-tool.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { toolCommand } from './mise-tools.mts';
import { execute } from './process.mts';

// One locked Composer project per PHP-Parser release that a gen_stub.php of PHP names: php-arginfo/<release> (K637).
const PROJECTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'php-arginfo');

const PREFIX = 'php-arginfo';
const parserVersion = (source: string): string => {
  const match = /\$version\s*=\s*"(\d+\.\d+\.\d+)"/.exec(source);
  if (!match?.[1]) throw new Error('the installed gen_stub.php does not declare its PHP-Parser release');
  return match[1];
};

/**
 * The generator of `root` for an offline build: the gen_stub.php of the PHP as it is, copied beside the PHP-Parser that
 * make kit-install-php-arginfo staged, where gen_stub.php finds it; kit compares no staged generator (K861).
 */
export function installedGenStub(root: string): { file: string; parser: string } {
  const generator = genStub(root);
  const folder = toolsPath(root, PREFIX);
  const directory = path.join(folder, `PHP-Parser-${generator.parser}`, 'lib/PhpParser');
  if (!existsSync(directory)) throw new Error(`${path.relative(root, directory)} is missing; run make kit-install-php-arginfo, which installs the PHP-Parser that the gen_stub.php of the php of PATH names`);
  // A rename over the staged copy: the generator of a PHP may be read-only, and a build beside this one reads a whole file.
  const file = path.join(folder, 'gen_stub.php');
  const next = `${file}.next-${process.pid}`;
  writeFileSync(next, generator.source);
  renameSync(next, file);
  return { file, parser: generator.parser };
}

/** The installed gen_stub.php for `root`, with the PHP-Parser version it requires. */
export function genStub(root: string): { file: string; source: string; parser: string } {
  const phpConfig = toolCommand(root, 'php-config');
  const result = execute(phpConfig, ['--prefix'], { cwd: root });
  if (result.error || result.status !== 0) throw new Error(`${phpConfig} --prefix failed; install the PHP development files of the php of PATH`);
  const prefix = result.stdout.trim();
  const prefixFile = path.join(prefix, 'lib/php/build/gen_stub.php');
  const candidates = [prefixFile];
  if (!existsSync(prefixFile)) {
    const extensions = execute(phpConfig, ['--extension-dir'], { cwd: root });
    if (extensions.error || extensions.status !== 0 || !extensions.stdout.trim()) {
      throw new Error(`${phpConfig} --extension-dir failed; install the PHP development files of the php of PATH`);
    }
    candidates.push(path.join(extensions.stdout.trim(), 'build/gen_stub.php'));
  }
  const file = candidates.find(candidate => existsSync(candidate));
  if (file === undefined) throw new Error(`${candidates.join(', ')} are missing; install the PHP development files of the php of PATH`);
  const source = readFileSync(file, 'utf8');
  return { file, source, parser: parserVersion(source) };
}

/** Installs gen_stub.php and its exact parser under var/tools/php-arginfo atomically, with the locked composer install on each run (K861). */
export function installPhpArginfo({ root = repositoryRoot(), print = () => {} }: { root?: string; print?: (text: string) => void } = {}): void {
  const generator = genStub(root);
  const project = path.join(PROJECTS, generator.parser);
  const prefix = toolsPath(root, PREFIX);
  replaceInstall(prefix, (next) => {
    for (const file of ['composer.json', 'composer.lock']) {
      try {
        copyFileSync(path.join(project, file), path.join(next, file));
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error(`kit holds no locked Composer project for PHP-Parser ${generator.parser}, which the gen_stub.php of the php of PATH names; add scripts/kit/php-arginfo/${generator.parser} to kit with its composer.json and composer.lock`, { cause: error });
        throw error;
      }
    }
    const composer = composerCommand(root, 'PHP arginfo generation');
    run(composer, ['install', '--no-interaction', '--no-progress', '--no-scripts', '--no-plugins', '--prefer-dist'], { cwd: next, env: composerEnvironment(root) }, print);
    const parserSource = path.join(next, 'vendor/nikic/php-parser/lib/PhpParser');
    const stagedParser = path.join(next, `PHP-Parser-${generator.parser}`, 'lib/PhpParser');
    mkdirSync(path.dirname(stagedParser), { recursive: true });
    cpSync(parserSource, stagedParser, { recursive: true });
    copyFileSync(generator.file, path.join(next, 'gen_stub.php'));
    rmSync(path.join(next, 'vendor'), { recursive: true, force: true });
  });
  print(`PHP arginfo generator: installed PHP-Parser ${generator.parser} in ${path.relative(root, prefix)}`);
}

if (isMain(import.meta.url)) {
  try { installPhpArginfo({ print: text => console.log(`[install-php-arginfo] ${text}`) }); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[install-php-arginfo] ${error.message}`);
    process.exitCode = 1;
  }
}
