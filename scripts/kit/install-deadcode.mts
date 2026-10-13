// Installs the deadcode of the golang.org/x/tools release that `deadcode` of config/toolchain.json records into
// var/tools/deadcode, with the wrapper deadcode in var/tools/bin. deadcode reports the functions of a Go module that neither a
// main package nor a test reaches (`make lint-go`). The release is built with `go install` into a temporary directory beside
// the target and renamed, and an installed recorded release is kept. deadcode prints no version, so the release of an
// installation is the version of golang.org/x/tools that `go version -m` reads from the binary. Nothing is installed into the
// machine.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { installOnce } from './bootstrap/install-tool.mts';
import { quote, run, toolsPath, wrapperText, writeWrapper } from './bootstrap/tool-wrappers.mts';

const commandIn = (prefix: string): string => path.join(prefix, 'bin', 'deadcode');

/** The golang.org/x/tools release of the deadcode binary in `prefix`, which `go version -m` reads, or undefined when none is installed. */
function releaseIn(prefix: string): string | undefined {
  if (!existsSync(commandIn(prefix))) return undefined;
  return /^\s*mod\s+golang\.org\/x\/tools\s+v(\d+\.\d+\.\d+)\s/m.exec(execFileSync('go', ['version', '-m', commandIn(prefix)], { encoding: 'utf8' }))?.[1];
}

/** Installs deadcode of golang.org/x/tools `recorded` into var/tools/deadcode of `root` and writes the wrapper. */
export function installDeadcode({ root, recorded, print = () => {} }: { root: string; recorded: string; print?: (text: string) => void }) {
  const prefix = toolsPath(root, 'deadcode');
  const result = installOnce({
    root, label: 'deadcode', prefix, recorded, installedRelease: releaseIn, print,
    install: (next: string) => {
      run('go', ['install', `golang.org/x/tools/cmd/deadcode@v${recorded}`], { cwd: root, env: { ...process.env, GOBIN: path.join(next, 'bin'), GOFLAGS: '-modcacherw' } }, print);
    },
  });
  writeWrapper(root, 'deadcode', wrapperText(`deadcode of golang.org/x/tools ${recorded} of this checkout`, `exec ${quote(commandIn(prefix))} "$@"`), print);
  return result;
}
