// Installs PHP's gen_stub.php with the exact PHP-Parser release it names into var/tools/php-arginfo. Builds and checks use this
// staged copy offline, so gen_stub never downloads into the PHP installation or the build tree.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installOnce } from './bootstrap/install-tool.mts';
import { run, toolsPath } from './bootstrap/tool-wrappers.mts';
import { composerCommand, composerEnvironment } from './install-composer-project.mts';
import { isMain, repositoryRoot } from './paths.mts';
import { toolCommand } from './mise-tools.mts';
import { execute } from './process.mts';

const PROJECT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'php-arginfo');
const PREFIX = 'php-arginfo';
const parserVersion = (source: string): string => {
  const match = /\$version\s*=\s*"(\d+\.\d+\.\d+)"/.exec(source);
  if (!match?.[1]) throw new Error('the installed gen_stub.php does not declare its PHP-Parser release');
  return match[1];
};

/** The staged generator of `root`, ready for offline use; reports the install remedy without attempting a download. */
export function installedGenStub(root: string): { file: string; parser: string } {
  const folder = toolsPath(root, PREFIX);
  const file = path.join(folder, 'gen_stub.php');
  if (!existsSync(file)) throw new Error(`${path.relative(root, file)} is missing; run make install-tools, which installs the pinned PHP arginfo generator and parser`);
  const installedSource = readFileSync(file, 'utf8');
  const parser = parserVersion(installedSource);
  const current = genStub(root);
  if (installedSource !== current.source) throw new Error(`${path.relative(root, file)} is stale for the installed PHP; run make install-tools`);
  const project = path.join(path.dirname(fileURLToPath(import.meta.url)), 'php-arginfo');
  const lock = JSON.parse(readFileSync(path.join(project, 'composer.lock'), 'utf8')) as { packages?: { name?: string; version?: string }[] };
  const pinned = lock.packages?.find(item => item.name === 'nikic/php-parser')?.version?.replace(/^v/, '');
  if (pinned !== parser) throw new Error(`${project}/composer.lock pins nikic/php-parser ${pinned ?? 'none'}, but gen_stub.php requires ${parser}; update the pinned arginfo parser`);
  const directory = path.join(folder, `PHP-Parser-${parser}`, 'lib/PhpParser');
  if (!existsSync(directory)) throw new Error(`${path.relative(root, directory)} is missing; run make install-tools, which installs the pinned PHP arginfo generator and parser`);
  return { file, parser };
}

/** The installed gen_stub.php for `root`, with the PHP-Parser version it requires. */
export function genStub(root: string): { file: string; source: string; parser: string } {
  const phpConfig = toolCommand(root, 'php-config');
  const result = execute(phpConfig, ['--prefix'], { cwd: root });
  if (result.error || result.status !== 0) throw new Error(`${phpConfig} --prefix failed; install the PHP development files of .php-version and run make install-tools`);
  const prefix = result.stdout.trim();
  const file = path.join(prefix, 'lib/php/build/gen_stub.php');
  if (!existsSync(file)) throw new Error(`${file} is missing; install the PHP development files of .php-version and run make install-tools`);
  const source = readFileSync(file, 'utf8');
  return { file, source, parser: parserVersion(source) };
}

/** The identity of the staged generator, tied to the PHP generator and its locked parser package. */
function release(source: string, lock: Buffer): string {
  return createHash('sha256').update(source).update(lock).digest('hex');
}

/** Installs gen_stub.php and its exact parser under var/tools/php-arginfo atomically. */
export function installPhpArginfo({ root = repositoryRoot(), print = () => {} }: { root?: string; print?: (text: string) => void } = {}): void {
  const generator = genStub(root);
  const project = PROJECT;
  const lock = readFileSync(path.join(project, 'composer.lock'));
  const packageLock = JSON.parse(lock.toString()) as { packages?: { name?: string; version?: string }[] };
  const parser = packageLock.packages?.find(item => item.name === 'nikic/php-parser')?.version?.replace(/^v/, '');
  if (parser !== generator.parser) {
    throw new Error(`${project}/composer.lock pins nikic/php-parser ${parser ?? 'none'}, but ${generator.file} requires ${generator.parser}; update the pinned arginfo parser and run make install-tools`);
  }
  const recorded = release(generator.source, lock);
  const prefix = toolsPath(root, PREFIX);
  installOnce({
    root, label: 'PHP arginfo generator', prefix, recorded, print,
    installedRelease(directory: string) {
      if (!existsSync(path.join(directory, 'gen_stub.php')) || !existsSync(path.join(directory, `PHP-Parser-${generator.parser}`, 'lib/PhpParser/ParserFactory.php'))) return undefined;
      try { return readFileSync(path.join(directory, 'RELEASE'), 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    install(next: string) {
      for (const file of ['composer.json', 'composer.lock']) copyFileSync(path.join(project, file), path.join(next, file));
      const composer = composerCommand(root, 'PHP arginfo generation');
      run(composer, ['install', '--no-interaction', '--no-progress', '--no-scripts', '--no-plugins', '--prefer-dist'], { cwd: next, env: composerEnvironment(root) }, print);
      const parserSource = path.join(next, 'vendor/nikic/php-parser/lib/PhpParser');
      if (!existsSync(parserSource)) throw new Error(`${parserSource} is missing after the locked Composer install`);
      const stagedParser = path.join(next, `PHP-Parser-${generator.parser}`, 'lib/PhpParser');
      mkdirSync(path.dirname(stagedParser), { recursive: true });
      cpSync(parserSource, stagedParser, { recursive: true });
      copyFileSync(generator.file, path.join(next, 'gen_stub.php'));
      rmSync(path.join(next, 'vendor'), { recursive: true, force: true });
      writeFileSync(path.join(next, 'RELEASE'), recorded);
    },
  });
}

if (isMain(import.meta.url)) {
  try { installPhpArginfo({ print: text => console.log(`[install-php-arginfo] ${text}`) }); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`[install-php-arginfo] ${error.message}`);
    process.exitCode = 1;
  }
}
