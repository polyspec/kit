// R3 of the language-parity check: the checker runs the binding of every suite unit in every implementation of its profile and
// keeps, in memory, the ledger of the runs and of the cases that each run reported. A binding holds its unit when its command
// exits with 0 and the cases that passed are exactly the cases of the suite file: a failed, skipped, missing or extra case is a
// finding. No saved report is read.
import path from 'node:path';
import { execute } from './process.mjs';
import { finding } from './parity-declaration.mjs';
import { runOf } from './parity-runners.mjs';
import { pairs } from './parity-units.mjs';

/** The names of `cases` (a map from case to outcome) whose outcome is `outcome`. */
const named = (cases, outcome) => [...cases].filter(([, value]) => value === outcome).map(([name]) => name);

/** The ledger `{ runs, cases }` of every bound suite pair and the R3 findings; `say` prints a line for each step. */
export function runBindings(model, root, { env, say }) {
  const ledger = { runs: [], cases: [] };
  const findings = [];
  for (const { unit, implementation } of pairs(model, 'suite')) {
    const binding = unit.bindings.find(entry => entry.implementation === implementation.name);
    if (!binding) continue;
    const where = { unit: unit.id, implementation: implementation.name, place: binding.test };
    const run = runOf(implementation, root, binding, unit.id, env);
    if (run.error) {
      findings.push(finding('R3', run.error, where));
      continue;
    }
    say(`run ${unit.id} ${implementation.name}: ${[run.command, ...run.args].join(' ')} (in ${run.cwd})`);
    const result = execute(run.command, run.args, { cwd: path.join(root, run.cwd), env: run.env });
    const status = result.error ? null : result.status;
    ledger.runs.push({ unit: unit.id, implementation: implementation.name, command: run.command, args: run.args, cwd: run.cwd, status });
    const cases = result.error ? new Map() : run.cases(result);
    for (const [name, outcome] of cases) ledger.cases.push({ unit: unit.id, implementation: implementation.name, case: name, outcome });
    const expected = model.cases.get(unit.id);
    const problems = [
      result.error && `${run.command} could not start: ${result.error.message}`,
      !result.error && status !== 0 && `exited with ${status ?? result.signal}${result.stderr.trim() ? `: ${result.stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`,
      named(cases, 'fail').length && `failed: ${named(cases, 'fail').join(', ')}`,
      named(cases, 'skip').length && `skipped: ${named(cases, 'skip').join(', ')}`,
      `not executed: ${expected.filter(name => !cases.has(name)).join(', ')}`,
      `not in the suite: ${[...cases.keys()].filter(name => !expected.includes(name)).join(', ')}`,
    ].filter(part => part && !part.endsWith(': '));
    say(`${unit.id} ${implementation.name}: ${status === 0 ? 'exit 0' : `exit ${status ?? 'none'}`}, ${named(cases, 'pass').length} of ${expected.length} cases passed`);
    if (problems.length) findings.push(finding('R3', problems.join('; '), where));
  }
  return { ledger, findings };
}
