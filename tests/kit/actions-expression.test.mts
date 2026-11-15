import assert from 'node:assert/strict';
import test from 'node:test';
import { Literal } from '@actions/expressions/ast';
import { EnvironmentRefusal, environmentRefusal, environmentValue, mergeEnvironment } from '../../scripts/kit/environment.mts';
import { Lexer } from '@actions/expressions';
import { callsStatus, evaluate, evaluateTemplate, parseExpression, parseTemplate, references, toText, truthy, type Value } from '../../scripts/kit/actions-expression.mts';

// K1228: the expressions of GitHub Actions evaluate as the runner evaluates them, through @actions/expressions with the
// contexts and the status functions of the run.
const CONTEXTS: Record<string, Value> = {
  matrix: { os: 'Linux', shard: 2, tools: ['php', 'go'], labels: [{ name: 'a' }, { other: 1 }, { name: 'b' }] },
  steps: { plan: { outputs: { common_tools: '["php","composer"]', empty: '[]' }, outcome: 'success' } },
  env: { PATH: '/bin' },
};

function value(source: string, status = { success: true, failure: false, cancelled: false }): Value {
  return evaluate(parseExpression(source), CONTEXTS, status);
}

for (const [label, source, expected] of [
  ['multiple escaped quotes', "'it''s ''fine'''", "it's 'fine'"],
  ['a literal of quotes alone', "''''''", "''"],
  ['a format string', "format('it''s {0}, ''fine''', 'ok')", "it's ok, 'fine'"],
  ['a format argument', "format('{0}', 'it''s ''fine''')", "it's 'fine'"],
  ['adjacent literal quotes', "format('''''{0}''''', 'ok')", "''ok''"],
] as const) {
  test(`K1228-1: ${label} decode every escaped single quote once`, () => {
    assert.equal(value(source), expected);
  });
}

test('K1228-1: raw lexemes, source ranges and native syntax rejection are preserved', () => {
  const source = "  'it''s ''fine'''";
  const native = new Lexer(source).lex().tokens[0];
  const parsed = parseExpression(source);
  assert.ok(parsed instanceof Literal);
  assert.equal(parsed.token.lexeme, native?.lexeme);
  assert.deepEqual(parsed.token.range, native?.range);
  assert.throws(() => parseExpression("'it''s ''fine''"), /Unexpected symbol/);
  assert.throws(() => parseExpression('"fine"'), /Unexpected symbol/);
  assert.equal(evaluateTemplate(parseTemplate("prefix ${{ 'it''s ''fine''' }} suffix"), CONTEXTS), "prefix it's 'fine' suffix");
});

test('K1228: literals, property access and the filter', () => {
  assert.equal(value("'it''s'"), "it's");
  assert.equal(value('0x1F'), 31);
  assert.equal(value('0o17'), 15);
  assert.equal(value('-1.5e2'), -150);
  assert.equal(value('null'), null);
  assert.equal(value('true'), true);
  assert.equal(value('matrix.os'), 'Linux');
  assert.equal(value("matrix['shard']"), 2);
  assert.equal(value('Matrix.OS'), 'Linux');
  assert.equal(value('matrix.tools[1]'), 'go');
  assert.equal(value('matrix.missing'), null);
  assert.equal(value('matrix.os.deeper'), null);
  assert.deepEqual(value('matrix.labels.*.name'), ['a', 'b']);
  assert.equal(value('env.PATH'), '/bin');
  assert.equal(value('steps.plan.outputs.common_tools'), '["php","composer"]');
});

test('K1228: operators follow the precedence and the coercion of GitHub', () => {
  assert.equal(value("'abc' == 'ABC'"), true);
  assert.equal(value("'1' == 1"), true);
  assert.equal(value("'' == 0"), true);
  assert.equal(value("null == ''"), true);
  assert.equal(value('true == 1'), true);
  assert.equal(value("'x' == 0"), false);
  assert.equal(value("fromJSON('[]') == fromJSON('[]')"), false);
  assert.equal(value('matrix.tools == matrix.tools'), true);
  assert.equal(value("'b' > 'A'"), true);
  assert.equal(value("'2' <= 2"), true);
  assert.equal(value("'10' < 9"), false);
  assert.equal(value('!0'), true);
  assert.equal(value("!''"), true);
  assert.equal(value("!fromJSON('{}')"), false);
  assert.equal(value("'' || 'fallback'"), 'fallback');
  assert.equal(value("'first' && 'second'"), 'second');
  assert.equal(value("0 && 'never'"), 0);
  assert.equal(value('false || true && false'), false);
  assert.equal(value('(false || true) && !false'), true);
  assert.equal(value("matrix.shard == 2 && matrix.os != 'windows'"), true);
});

test('K1228: the functions of GitHub', () => {
  assert.equal(value("contains(steps.plan.outputs.common_tools, 'PHP')"), true);
  assert.equal(value("contains(fromJSON('[1,3]'), '3')"), true);
  assert.equal(value("contains(matrix.tools, 'rust')"), false);
  assert.equal(value("startsWith('Hello', 'he')"), true);
  assert.equal(value("endsWith('Hello', 'LO')"), true);
  assert.equal(value("format('{0}-{1} {{x}}', matrix.os, matrix.shard)"), 'Linux-2 {x}');
  assert.throws(() => value("format('{2}', 'a')"));
  assert.equal(value("join(fromJSON(steps.plan.outputs.common_tools), ' ')"), 'php composer');
  assert.equal(value('join(matrix.tools)'), 'php,go');
  assert.equal(value("join('text', ' ')"), 'text');
  assert.equal(value("steps.plan.outputs.empty != '[]'"), false);
  assert.equal(value('toJSON(matrix.tools)'), '[\n  "php",\n  "go"\n]');
  assert.deepEqual(value('fromJSON(\'{"a":[1,true,null]}\')'), { a: [1, true, null] });
  assert.throws(() => value("fromJSON('{')"));
  assert.throws(() => parseExpression("hashFiles('**/lock')"), /hashFiles/);
  assert.throws(() => parseExpression("contains('a')"), /contains/);
  assert.throws(() => parseExpression('unknown.key'), /unknown/);
});

test('K1228: the status functions give the status of the run', () => {
  const failed = { success: false, failure: true, cancelled: false };
  assert.equal(value('success()', failed), false);
  assert.equal(value('failure()', failed), true);
  assert.equal(value('always()', failed), true);
  assert.equal(value('!cancelled()', failed), true);
  assert.equal(callsStatus(parseExpression("always() && steps.x.outcome != 'skipped'")), true);
  assert.equal(callsStatus(parseExpression("matrix.os == 'Linux'")), false);
});

test('K1228: a text with ${{ }} is one expression as GitHub reads it, and references name their contexts', () => {
  const joined = parseTemplate("make ${{ format('{0}}}', 'a') }} 'done' {x}");
  assert.equal(joined.parts.length, 3);
  assert.equal(evaluateTemplate(joined, CONTEXTS), "make a} 'done' {x}");
  assert.deepEqual(evaluateTemplate(parseTemplate('${{ matrix.tools }}'), CONTEXTS), ['php', 'go']);
  assert.equal(evaluateTemplate(parseTemplate("it's 'quoted' twice"), CONTEXTS), "it's 'quoted' twice");
  assert.equal(evaluateTemplate(parseTemplate('${{ matrix.shard }}-${{ matrix.tools }}'), CONTEXTS), '2-Array');
  assert.throws(() => parseTemplate('echo ${{ matrix.os'), /without its closing/);
  assert.equal(toText(null), '');
  assert.equal(toText(1.5), '1.5');
  assert.equal(toText(['a']), 'Array');
  assert.equal(toText({ a: 1 }), 'Object');
  assert.equal(truthy('0'), true);
  assert.equal(truthy(Number.NaN), false);
  assert.deepEqual(references(parseExpression("toJSON(needs) && needs.shared.outputs['runner'] && github[matrix.key] && fromJSON(steps.x.outputs.y).z")), [
    { path: ['needs'], dynamic: false },
    { path: ['needs', 'shared', 'outputs', 'runner'], dynamic: false },
    { path: ['matrix', 'key'], dynamic: false },
    { path: ['github'], dynamic: true },
    { path: ['steps', 'x', 'outputs', 'y'], dynamic: false },
  ]);
});


test('K1228-2: native environment lookup, filters and serialization preserve the platform key comparison', () => {
  const contexts: Record<string, Value> = { env: { MODE: 'upper', mode: 'lower', constructor: 'owned' }, matrix: { MODE: 'upper', mode: 'lower' } };
  const run = (source: string) => evaluate(parseExpression(source), contexts);
  const windows = process.platform === 'win32';
  assert.equal(run('env.MODE'), windows ? 'lower' : 'upper');
  assert.equal(run('ENV.mode'), 'lower');
  assert.equal(run('env.constructor'), 'owned');
  assert.equal(run('env.Missing'), null);
  assert.deepEqual(run('env.*'), windows ? ['lower', 'owned'] : ['upper', 'lower', 'owned']);
  const serialized = run('toJSON(env)');
  assert.ok(typeof serialized === 'string');
  assert.deepEqual(JSON.parse(serialized), windows ? { MODE: 'lower', constructor: 'owned' } : { MODE: 'upper', mode: 'lower', constructor: 'owned' });
  assert.equal(run('MATRIX.mode'), 'upper', 'non-environment contexts keep the native Dictionary lookup');
});

test('K1228-2: computed references use the environment key comparison', () => {
  const contexts: Record<string, Value> = { env: { PRODUCER: 'external', producer: 'local' } };
  const refs = references(parseExpression('steps[env.producer].outputs.value'), contexts);
  assert.ok(refs.some(reference => reference.path.join('.') === 'steps.local.outputs.value'), JSON.stringify(refs));
  assert.equal(evaluate(parseExpression('env.PRODUCER'), contexts), process.platform === 'win32' ? 'local' : 'external');
});

test('K1228-2: an unsupported native JSON environment key fails by name instead of disappearing', () => {
  const env = Object.fromEntries([['__proto__', 'owned']]);
  assert.throws(() => evaluate(parseExpression('toJSON(env)'), { env }), /environment key __proto__.*native JSON/);
});


test('K1228-2: Windows merge policy keeps first spelling and last values without claiming native process proof', () => {
  const parent = { Path: 'parent', CaseKey: 'workflow', __PROTO__: 'safe' };
  const job = { PATH: 'job', casekey: 'job' };
  const step = { pAtH: 'step', CASEKEY: 'step' };
  const insensitive = mergeEnvironment([parent, job, step], false);
  assert.deepEqual(insensitive, { Path: 'step', CaseKey: 'step', __PROTO__: 'safe' });
  assert.equal(environmentValue(insensitive, 'PATH', false), 'step');
  assert.equal(environmentValue(insensitive, 'casekey', false), 'step');
  const sensitive = mergeEnvironment([parent, job, step], true);
  assert.deepEqual(sensitive, { ...parent, ...job, ...step });
  assert.equal(environmentValue(sensitive, 'PATH', true), 'job');
  assert.equal(environmentValue(sensitive, 'path', true), undefined);
  assert.deepEqual(parent, { Path: 'parent', CaseKey: 'workflow', __PROTO__: 'safe' });
  assert.throws(() => mergeEnvironment([Object.fromEntries([['__proto__', 'lost']])], false), /environment key __proto__.*native JSON/);
});


test('K1228-2: Windows policy refuses Unicode names instead of approximating OrdinalIgnoreCase', () => {
  // OrdinalIgnoreCase uppercases µ to Μ; JavaScript lowercasing would keep those lookup keys distinct.
  for (const name of ['µ', 'Μ', 'Σ', 'ς']) {
    assert.throws(() => mergeEnvironment([Object.fromEntries([[name, 'Unicode value']])], false), /Windows environment name.*non-ASCII/);
    assert.throws(() => environmentValue({ MODE: 'value' }, name, false), /Windows environment name.*non-ASCII/);
  }
  assert.deepEqual(mergeEnvironment([{ MODE: 'µΜΣς値' }, { mode: 'آخر' }], false), { MODE: 'آخر' });
  assert.deepEqual(mergeEnvironment([{ 'µ': 'micro', 'Μ': 'mu', 'Σ': 'sigma', 'ς': 'final' }], true), { 'µ': 'micro', 'Μ': 'mu', 'Σ': 'sigma', 'ς': 'final' });
});

test('K1228-2: native POSIX environment names preserve Unicode while all platforms preserve Unicode values', () => {
  const contexts: Record<string, Value> = { env: { 'µ': 'micro', 'Μ': 'mu', VALUE: 'µΜΣς値' } };
  if (process.platform === 'win32') assert.throws(() => evaluate(parseExpression('env.VALUE'), contexts), /Windows environment name.*non-ASCII/);
  else {
    assert.equal(evaluate(parseExpression("env['µ']"), contexts), 'micro');
    assert.equal(evaluate(parseExpression("env['Μ']"), contexts), 'mu');
    assert.equal(evaluate(parseExpression('env.VALUE'), contexts), 'µΜΣς値');
  }
  assert.equal(evaluate(parseExpression('env.VALUE'), { env: { VALUE: 'µΜΣς値' } }), 'µΜΣς値');
});


test('K1228-2: native error wrappers preserve typed capability refusal without converting ordinary errors', () => {
  const refused = new EnvironmentRefusal('unsupported environment');
  assert.equal(environmentRefusal(refused), refused);
  const wrapped = new Error('native index wrapper', { cause: refused });
  const restored = environmentRefusal(wrapped);
  assert.ok(restored instanceof EnvironmentRefusal);
  assert.equal(restored.message, 'native index wrapper');
  assert.equal(restored.cause, wrapped);
  assert.equal(environmentRefusal(new Error('ordinary native command failure')), undefined);
  const cycle = new Error('ordinary cyclic cause');
  cycle.cause = cycle;
  assert.equal(environmentRefusal(cycle), undefined);
});
