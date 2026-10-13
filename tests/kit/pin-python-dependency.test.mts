// Tests of scripts/kit/pin-python-dependency.mts: the exact pin of a Python requirement in the dependency arrays of a
// pyproject.toml is set to a version, through a TOML editor that keeps the rest of the file as it was. The requirement is
// found by its normalized name (PEP 503) with its extras and marker kept; text outside the arrays, a comment included, is
// never changed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { pinPythonRequirement } from '../../scripts/kit/pin-python-dependency.mts';

const PYPROJECT = `# The project. A note names "idna==3.0" in a comment.
[project]
name = "app"
version = "0.0.0"
dependencies = [
  "requests==2.34.2",  # the HTTP client
  "idna==3.0; python_version >= '3.8'",
]

[project.optional-dependencies]
socks = ["requests[socks]==2.34.2"]

[dependency-groups]
dev = ["Foo_Bar==1.0"]
`;

test('every exact pin of the package in the dependency arrays is set, and the rest of the file is kept', () => {
  const { text, count } = pinPythonRequirement(PYPROJECT, 'requests', '2.35.0');
  assert.equal(count, 2);
  assert.equal(text, PYPROJECT.replace('"requests==2.34.2",  # the HTTP client', '"requests==2.35.0",  # the HTTP client').replace('"requests[socks]==2.34.2"', '"requests[socks]==2.35.0"'));
});

test('a pin with a marker keeps the marker, and a comment that names the pin is not changed', () => {
  const { text, count } = pinPythonRequirement(PYPROJECT, 'idna', '3.20');
  assert.equal(count, 1);
  assert.match(text, /^# The project\. A note names "idna==3\.0" in a comment\.$/m);
  assert.match(text, /^ {2}"idna==3\.20; python_version >= '3\.8'",$/m);
});

test('the package is found by its normalized name, and its written name is kept', () => {
  const { text, count } = pinPythonRequirement(PYPROJECT, 'foo-bar', '2.0');
  assert.equal(count, 1);
  assert.match(text, /^dev = \["Foo_Bar==2\.0"\]$/m);
});

test('a package that no dependency array pins exactly fails', () => {
  assert.throws(() => pinPythonRequirement(PYPROJECT, 'urllib3', '2.0'), /no exact pin of urllib3 in the dependency arrays/);
  assert.throws(() => pinPythonRequirement('[project]\ndependencies = ["idna>=3"]\n', 'idna', '3.20'), /no exact pin of idna in the dependency arrays/);
});
