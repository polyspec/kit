#!/usr/bin/env node
// Makes the virtual environment of the checkout's Python without a symbolic link (`make python-venv DIR=<directory>`), and
// holds the rule that run-tests --venv checks (venvProblem). `python -m venv --copies` makes lib64 a relative link to lib on
// 64-bit posix systems other than macOS; the rule removes exactly that link, and refuses every other link, every other
// lib64 and every platlibdir other than lib, naming the path and changing nothing.
//
//   node scripts/kit/python-venv.mjs <directory>
//
// The caller names the interpreter that makes the venv and its home, the directory that pyvenv.cfg must name, as absolute paths;
// the command and kit's own targets pass checkoutPython of tool-wrappers.mjs (var/tools/bin/python3 and
// var/tools/python-build/python/bin), and a consumer that takes kit as a library passes its own.
//
// The run is idempotent: an existing directory that already is a venv of the interpreter (run-tests' rule, the same Python
// version, platlibdir lib, no lib64 in sys.path) is accepted unchanged; any other existing directory is an error with its reason
// and is neither removed nor repaired. An absent directory is made with the interpreter (install-tools installs the one of the
// checkout), its link is removed, and the environment is checked: no sys.path entry names lib64, and venvProblem accepts it. A
// failure removes the directory that this run made, so no partial environment is left behind.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { isMain, ROOT } from './paths.mjs';
import { checkoutPython, requireAbsolute, run } from './tool-wrappers.mjs';

const MAKE = (directory) => `make it with make python-venv DIR=${directory}, and install into it with --link-mode copy`;

/** The symbolic links below `directory`, as paths relative to it; a link is not followed. */
function symbolicLinks(directory, relative = '') {
  const found = [];
  for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) found.push(rel);
    else if (entry.isDirectory()) found.push(...symbolicLinks(directory, rel));
  }
  return found;
}

/**
 * Why the virtual environment `venv` may not run the python tests of `root`, or undefined when it may: its pyvenv.cfg names `home`,
 * the absolute bin directory of the interpreter that made it, and it holds no symbolic link.
 */
export function venvProblem(venv, { root, home }) {
  requireAbsolute('the interpreter home', home);
  const config = path.join(venv, 'pyvenv.cfg');
  const relative = path.relative(root, venv);
  const make = MAKE(relative);
  if (!existsSync(config)) return `${relative} is not a virtual environment (no pyvenv.cfg); ${make}`;
  const named = /^home\s*=\s*(.+)$/m.exec(readFileSync(config, 'utf8'))?.[1].trim();
  const resolved = target => (existsSync(target) ? realpathSync(target) : target);
  if (!named || resolved(named) !== resolved(home)) {
    return `${relative} was made from ${named ?? 'no home'}, not from the interpreter home ${path.relative(root, home)}; ${make}`;
  }
  const links = symbolicLinks(venv);
  if (links.length > 0) return `${relative} holds symbolic links (${links.slice(0, 3).join(', ')}${links.length > 3 ? ', …' : ''}); ${make}`;
  return undefined;
}

/**
 * Removes the lib64 link of the virtual environment `directory` after the checks, and changes nothing when one fails. The
 * platlibdir is the sys.platlibdir of the environment's interpreter, which must be lib. A link named lib64 must link to lib;
 * no other link may exist, and lib64 may be absent (macOS).
 */
export function finishVenv(directory, { platlibdir, root = ROOT }) {
  const relative = path.relative(root, directory);
  if (platlibdir !== 'lib') {
    throw new Error(`${relative} has sys.platlibdir ${platlibdir}, not lib; nothing is changed, and the environment is refused`);
  }
  for (const link of symbolicLinks(directory)) {
    if (link === 'lib64') continue;
    throw new Error(`${path.join(relative, link)} is a symbolic link to ${readlinkSync(path.join(directory, link))}; the venv holds no symbolic link other than lib64`);
  }
  const lib64 = path.join(directory, 'lib64');
  const stat = lstatSync(lib64, { throwIfNoEntry: false });
  if (stat === undefined) return;
  if (!stat.isSymbolicLink()) {
    throw new Error(`${path.join(relative, 'lib64')} is ${stat.isDirectory() ? 'a directory' : 'a file'}, not a symbolic link to lib; the venv holds no copy of lib`);
  }
  const target = readlinkSync(lib64);
  if (target !== 'lib') throw new Error(`${path.join(relative, 'lib64')} links to ${target}, not to lib; the venv holds no link to another directory`);
  unlinkSync(lib64);
}

/** The sys values of the interpreter `python`: its version, its platlibdir and its sys.path. */
function interpreterFacts(python, env = process.env) {
  const code = 'import json, platform, sys; print(json.dumps([platform.python_version(), sys.platlibdir, sys.path]))';
  const [version, platlibdir, paths] = JSON.parse(execFileSync(python, ['-c', code], { encoding: 'utf8', env }));
  return { version, platlibdir, paths };
}

/**
 * Why the existing virtual environment `directory` is not a venv of the interpreter `python` as this tool makes it, or undefined:
 * the rule of run-tests (pyvenv.cfg names `home`, no symbolic link), the version of `python`, platlibdir lib and no lib64 in
 * sys.path.
 */
export function existingVenvProblem(directory, { root, python, home, env = process.env }) {
  const relative = path.relative(root, directory);
  const problem = venvProblem(directory, { root, home });
  if (problem) return problem;
  const interpreter = path.join(directory, 'bin/python');
  if (!existsSync(interpreter)) return `${relative} has no bin/python`;
  const venv = interpreterFacts(interpreter, env);
  const maker = interpreterFacts(python, env);
  if (venv.version !== maker.version) return `${relative} runs Python ${venv.version}, the interpreter ${path.relative(root, python)} is ${maker.version}`;
  if (venv.platlibdir !== 'lib') return `${relative} has the platlibdir ${venv.platlibdir}, not lib`;
  const named = venv.paths.filter(entry => entry.includes('lib64'));
  if (named.length > 0) return `${relative} has sys.path entries that name lib64 (${named.join(', ')})`;
  return undefined;
}

/**
 * Makes the virtual environment `directory` with the interpreter `python`, whose home is `home`, or accepts it unchanged when it
 * already is one: the run is idempotent. An existing directory that is not such a venv is an error with its reason; it is neither
 * removed nor repaired. `python` and `home` are absolute paths that the caller names.
 */
export function makeVenv({ root, directory, python, home, env = process.env, print = () => {} }) {
  requireAbsolute('the interpreter', python);
  requireAbsolute('the interpreter home', home);
  const relative = path.relative(root, directory);
  if (!existsSync(python)) {
    throw new Error(`${path.relative(root, python)} is missing; declare pythonBuild in config/toolchain.json and run make install-tools TOOLS=python`);
  }
  if (lstatSync(directory, { throwIfNoEntry: false }) !== undefined) {
    const problem = existingVenvProblem(directory, { root, python, home, env });
    if (problem) throw new Error(`${relative} exists and is not a venv of the interpreter ${path.relative(root, python)}: ${problem}; it is neither removed nor repaired`);
    print(`${relative} unchanged: a venv of the interpreter ${path.relative(root, python)} with no symbolic link`);
    return;
  }
  run(python, ['-m', 'venv', '--copies', '--without-pip', directory], { cwd: root, env }, print);
  try {
    const { platlibdir } = interpreterFacts(path.join(directory, 'bin/python'), env);
    finishVenv(directory, { platlibdir, root });
    const problem = existingVenvProblem(directory, { root, python, home, env });
    if (problem) throw new Error(problem);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  print(`made ${relative} with no symbolic link`);
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 1) throw new Error('Usage: node scripts/kit/python-venv.mjs <directory>');
    const { wrapper, home } = checkoutPython(ROOT);
    makeVenv({ root: ROOT, directory: path.resolve(ROOT, args[0]), python: wrapper, home, print: text => process.stdout.write(`${text}\n`) });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
