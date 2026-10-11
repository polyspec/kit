// Installs the uv release that config/toolchain.json uv declares into the virtual environment var/tools/uv, with the wrapper
// uv in var/tools/bin. uv is the wheel of this platform, downloaded by installBackend with the sha256 of each declared wheel, and
// installed by pip with --no-deps into a virtual environment of var/tools/bin/python3, the pinned Python that install-python.mjs
// installs (the same path as ruff: a standalone binary would need a zip reader that kit does not have, and the Python of the
// pinned toolchain is already a requirement of uv's users). The environment holds copies of the interpreter, not links. The
// wrapper sets every directory that uv writes to under var/tools (the cache, the Python installs), reads no uv.toml of the
// home (UV_NO_CONFIG) and never downloads an interpreter (UV_PYTHON_DOWNLOADS=never); pip's cache is var/tools/pip-cache for
// the install. An installed release is kept. The uv of the machine is never used.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { installOnce } from './install-tool.mjs';
import { installBackend } from './release-backend.mjs';
import { bootstrapEnvironment, printedRelease, quote, run, toolsPath, wrapperText, writeWrapper } from './tool-wrappers.mjs';

// The text of the wrapper uv: the state of uv under var/tools, then the installed binary.
function uvWrapper(root, prefix, version) {
  const lines = [
    `UV_CACHE_DIR=${quote(toolsPath(root, 'uv-cache'))}`,
    `UV_PYTHON_INSTALL_DIR=${quote(toolsPath(root, 'uv-python'))}`,
    'UV_NO_CONFIG=1',
    'UV_PYTHON_DOWNLOADS=never',
    'export UV_CACHE_DIR UV_PYTHON_INSTALL_DIR UV_NO_CONFIG UV_PYTHON_DOWNLOADS',
    `exec ${quote(path.join(prefix, 'bin/uv'))} "$@"`,
  ];
  return wrapperText(`uv ${version} of this checkout`, lines.join('\n'));
}

/** Installs the declared uv `{ version, sha256, source }` into var/tools/uv of `root` and writes the wrapper var/tools/bin/uv. */
export function installUv({ root, declared, print = () => {} }) {
  const python = toolsPath(root, 'bin', 'python3');
  if (!existsSync(python)) throw new Error(`uv needs ${path.relative(root, python)}, the Python that config/toolchain.json pythonBuild declares; declare pythonBuild and run make install-tools TOOLS=python`);
  const prefix = toolsPath(root, 'uv');
  const env = bootstrapEnvironment(root, { PIP_CACHE_DIR: toolsPath(root, 'pip-cache') });
  const result = installOnce({
    root, label: 'uv', prefix, recorded: declared.version, installedRelease: prefix => printedRelease(path.join(prefix, 'bin/uv'), 'uv'), print,
    install: (next) => {
      const { file } = installBackend({ root, env, requirement: `uv==${declared.version}`, digests: Object.values(declared.sha256), source: declared.source, print });
      run(python, ['-m', 'venv', '--copies', next], { cwd: root, env }, print);
      run(path.join(next, 'bin/python'), ['-m', 'pip', 'install', '--quiet', '--no-index', '--no-deps', '--no-cache-dir', file], { cwd: root, env }, print);
    },
  });
  writeWrapper(root, 'uv', uvWrapper(root, prefix, declared.version), print);
  return result;
}
