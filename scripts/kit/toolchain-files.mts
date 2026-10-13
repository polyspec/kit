// The readers of the manifests whose format an ecosystem tool reads, so that kit parses none of them itself (S1):
//   TOML    tomllib of the Python on PATH (pyproject.toml, rust-toolchain.toml), printed as JSON
// A reader that cannot run or read its file throws an Error that names the file and the cause.
import path from 'node:path';
import { execute } from './process.mts';

// Reads the TOML file of the first argument and prints it as JSON; a date or time prints as its TOML text.
const TOML_TO_JSON = 'import json, sys, tomllib\nwith open(sys.argv[1], "rb") as file: print(json.dumps(tomllib.load(file), default=str))';

/** The TOML file `file` of `root` as tomllib of the Python on the PATH of `env` reads it. */
export function readToml(root: string, file: string, env: NodeJS.ProcessEnv): unknown {
  const result = execute('python3', ['-I', '-c', TOML_TO_JSON, path.join(root, file)], { env });
  if (result.error) throw new Error(`${file}: python3 cannot start to read it with tomllib: ${result.error.message}`);
  if (result.status !== 0) {
    const ended = result.signal ? `ended by signal ${result.signal}` : `exit status ${result.status}`;
    throw new Error(`${file}: tomllib cannot read it: ${result.stderr.trim().split('\n').at(-1)} (${ended})`);
  }
  return JSON.parse(result.stdout);
}
