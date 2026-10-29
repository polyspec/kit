// Stubs of the Python tools of the wheel tests. `uv build --wheel ... --out-dir DIR SRC` writes the wheel of SRC into DIR, with
// the Requires-Dist lines that the JSON file STUB_WHEEL_REQUIRES_FILE holds (an array for every wheel, or an object from each
// distribution name to its lines). `-m pip install --dry-run --report - WHEEL` prints the metadata of the wheel as the report of
// pip. Each uv and pip call is appended as a JSON line to STUB_PYTHON_LOG when that variable is set, with the requirements file
// of a `-r` argument read at call time. No test reaches an index.
// The Requires-Dist lines of STUB_WHEEL_REQUIRES_FILE: an array for every wheel, or an object from each distribution name to its lines.
export type WheelRequires = string[] | Record<string, string[]>;

// The functions of the uv and pip stubs, as source text for a stub script that has fs, path and execFileSync in scope.
const PIP_FUNCTIONS = `
function buildWheel(output, source) {
  const text = fs.readFileSync(path.join(source, 'pyproject.toml'), 'utf8');
  const name = /^name = "(.*)"$/m.exec(text)[1];
  const version = /^version = "(.*)"$/m.exec(text)[1];
  // The file holds the Requires-Dist lines of every wheel, or an object from each distribution name to its lines.
  const given = process.env.STUB_WHEEL_REQUIRES_FILE && fs.existsSync(process.env.STUB_WHEEL_REQUIRES_FILE) ? JSON.parse(fs.readFileSync(process.env.STUB_WHEEL_REQUIRES_FILE, 'utf8')) : [];
  const requires = Array.isArray(given) ? given : (given[name] ?? []);
  const distribution = name.replace(/[^\\w\\d.]+/g, '_');
  const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'stub-wheel-'));
  fs.mkdirSync(path.join(folder, distribution + '-' + version + '.dist-info'));
  fs.writeFileSync(path.join(folder, distribution + '-' + version + '.dist-info', 'METADATA'), ['Metadata-Version: 2.4', 'Name: ' + name, 'Version: ' + version, ...requires.map(line => 'Requires-Dist: ' + line)].join('\\n') + '\\n');
  execFileSync('zip', ['-q', '-r', '-X', path.join(output, distribution + '-' + version + '-py3-none-any.whl'), '.'], { cwd: folder });
  fs.rmSync(folder, { recursive: true, force: true });
  return 0;
}
// The report of \`-m pip install --dry-run --report - <wheel>\`: the metadata of the .dist-info of the distribution that the file
// name of the wheel names, as pip reads it.
function pipReport(args) {
  const file = args[args.length - 1];
  const [distribution, version] = path.basename(file).split('-');
  const metadata = execFileSync('unzip', ['-p', file, distribution + '-' + version + '.dist-info/METADATA'], { encoding: 'utf8' });
  const field = key => (new RegExp('^' + key + ': (.*)$', 'm').exec(metadata) || [])[1];
  const requires = [...metadata.matchAll(/^Requires-Dist: (.*)$/gm)].map(match => match[1]);
  console.log(JSON.stringify({ version: '1', install: [{ metadata: { name: field('Name'), version: field('Version'), requires_dist: requires } }] }));
  return 0;
}
function logCall(args) {
  if (process.env.STUB_PYTHON_LOG) {
    const requirements = args.includes('-r') ? fs.readFileSync(args[args.indexOf('-r') + 1], 'utf8') : null;
    fs.appendFileSync(process.env.STUB_PYTHON_LOG, JSON.stringify({ args, cwd: process.cwd(), requirements }) + '\\n');
  }
}
// uv build --wheel --python PY --out-dir DIR SRC builds the wheel of SRC into DIR.
function uvStub(args) {
  logCall(args);
  if (args[0] === 'build' && args.includes('--wheel')) return buildWheel(args[args.indexOf('--out-dir') + 1], args[args.length - 1]);
  return 1;
}
function pipStub(args) {
  logCall(args);
  if (args[2] === 'install' && args.includes('--dry-run') && args.includes('--report')) return pipReport(args);
  return 1;
}
`;

// The Python stub of a release sandbox: the pip call that reads the metadata of a wheel, and nothing else.
export const PYTHON3_WHEEL_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
${PIP_FUNCTIONS}
const args = process.argv.slice(2);
if (args[0] === '-m' && args[1] === 'pip') process.exit(pipStub(args));
console.error('python3 stub: unexpected arguments ' + JSON.stringify(args));
process.exit(1);
`;

// The uv stub of a release sandbox: the wheel build, and nothing else.
export const UV_WHEEL_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
${PIP_FUNCTIONS}
process.exit(uvStub(process.argv.slice(2)));
`;
