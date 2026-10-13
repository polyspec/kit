// The install of a tool from the release archive of its platform (uv, alint, golangci-lint, Go): the archive of the declared release for the
// target of this platform is downloaded, refused unless its sha256 is the digest that config/toolchain.json declares for the
// platform, unpacked as it is into a directory beside the target and renamed into place (install-tool.mts), and the wrapper
// of var/tools/bin is written. An installed release is kept.
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileDigest } from './bootstrap/digest.mts';
import { installOnce } from './bootstrap/install-tool.mts';
import { bootstrapEnvironment, run, toolsPath, writeWrapper } from './bootstrap/tool-wrappers.mts';

/** What an archive install of a tool needs: the release and its digests, the archive of each target and the wrappers. */
export type ArchiveTool = {
  /** The name of the tool: the folder under var/tools and the label of the messages. */
  tool: 'uv' | 'alint' | 'golangci-lint' | 'go';
  /** Where the digests are declared, as the messages name it, such as `config/toolchain.json uv`. */
  source: string;
  root: string;
  declared: { version: string; sha256: Readonly<Record<string, unknown>> };
  /** The platform key (process.platform-process.arch). */
  platform: string;
  /** The target of the archive of each platform key that the declaration may name. */
  targets: Readonly<Record<string, string>>;
  /** The name of the archive of the target, without .tar.gz. */
  archive: (target: string) => string;
  /** The download URL of the archive of the target. */
  url: (target: string) => string;
  /** The release that the tool unpacked into `directory` reports, or undefined when none is there. */
  release: (directory: string, target: string) => string | undefined;
  /** The text of each wrapper of var/tools/bin, by its name, for the tool installed into `directory`. */
  wrappers: (directory: string, target: string) => Record<string, string>;
  print: (text: string) => void;
};

/** Installs the declared release of `tool` from its archive and writes its wrappers; returns `{ installed, release }`. */
export function installArchive({ tool, source, root, declared, platform, targets, archive, url, release, wrappers, print }: ArchiveTool) {
  const target = targets[platform];
  if (!target) throw new Error(`no ${tool} archive is verified for ${platform}; the verified platforms are ${Object.keys(targets).join(', ')}`);
  const sha256 = declared.sha256[platform];
  if (!sha256) throw new Error(`${source} declares no sha256 for ${platform}; declare the digest of ${archive(target)}.tar.gz of the ${tool} release ${declared.version}`);
  const location = url(target);
  const prefix = toolsPath(root, tool);
  const result = installOnce({
    root, label: tool, prefix, recorded: declared.version, installedRelease: (directory: string) => release(directory, target), print,
    install: (next: string) => {
      const file = path.join(next, `${archive(target)}.tar.gz`);
      const environment = bootstrapEnvironment(root);
      run('curl', ['--fail', '--silent', '--show-error', '--location', '--output', file, location], { cwd: root, env: environment }, print);
      const actual = fileDigest(file);
      if (actual !== sha256) {
        rmSync(file, { force: true });
        throw new Error(`${location} has the sha256 ${actual}; ${source} declares ${sha256} for ${platform}`);
      }
      run('tar', ['-xzf', file, '-C', next], { cwd: root, env: environment }, print);
      rmSync(file, { force: true });
    },
  });
  for (const [name, text] of Object.entries(wrappers(prefix, target))) writeWrapper(root, name, text, print);
  return result;
}
