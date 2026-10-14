#!/usr/bin/env node
// Sets the exact pin of a Python requirement in a pyproject.toml (`make dependency-review UPDATE=1` runs it for each
// PyPI dependency that has a newer stable release):
//
//   node scripts/kit/pin-python-dependency.mts <manifest> <package> <version>
//
// It sets the version of each requirement of the package in the dependency arrays of the file ([project] dependencies,
// [project.optional-dependencies] and [dependency-groups]) that pins it exactly (`==<version>`), and writes the file through a
// temporary file and a rename. A requirement is found by the normalized name of the package (PEP 503), and its written name,
// extras and marker are kept. The requirement is read with pip-requirements-js and the file is edited with a TOML editor
// (@decimalturn/toml-patch), so its comments, its layout
// and every other value stay as they were. A package that no dependency array pins exactly fails the command.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, patch } from '@decimalturn/toml-patch';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { isMain } from './paths.mts';
import { isJsonList, isJsonObject, writeAtomic } from './bootstrap/files.mts';

/** The normalized name of a Python distribution (PEP 503). */
const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');

/** The text of the file with the pin of `name` set to `version`; the number of changed requirements is returned with it. */
export function pinPythonRequirement(text: string, name: string, version: string): { text: string; count: number } {
  // toml-patch parses into any; the document is read as the JSON value that it is.
  const document: unknown = parse(text);
  if (!isJsonObject(document)) throw new Error('the pyproject holds no TOML table');
  let count = 0;
  const pin = (requirements: unknown) => {
    if (!isJsonList(requirements)) return;
    requirements.forEach((requirement: unknown, index) => {
      // A dependency group may hold an { include-group } table (PEP 735), which pins nothing.
      if (typeof requirement !== 'string') return;
      // pip-requirements-js reads the requirement (PEP 508); one exact `==` pin of the package is set in its written form.
      const parsed = parsePipRequirementsLine(requirement);
      if (parsed?.type !== 'ProjectName' || normalize(parsed.name) !== normalize(name)) return;
      const [spec, ...more] = parsed.versionSpec ?? [];
      if (!spec || more.length > 0 || spec.operator !== '==') return;
      const pinned = new RegExp(`==\\s*${spec.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.])`);
      requirements[index] = requirement.replace(pinned, `==${version}`);
      count += 1;
    });
  };
  // A table that the pyproject lacks holds no requirement.
  const table = (value: unknown): Record<string, unknown> => (isJsonObject(value) ? value : {});
  const project = table(document.project);
  pin(project.dependencies);
  for (const requirements of Object.values(table(project['optional-dependencies']))) pin(requirements);
  for (const requirements of Object.values(table(document['dependency-groups']))) pin(requirements);
  if (count === 0) throw new Error(`no exact pin of ${name} in the dependency arrays`);
  return { text: patch(text, document), count };
}

if (isMain(import.meta.url)) {
  const [manifest, name, version] = process.argv.slice(2);
  if (!manifest || !name || !version) {
    console.error('usage: node scripts/kit/pin-python-dependency.mts <manifest> <package> <version>');
    process.exit(2);
  }
  const file = path.resolve(manifest);
  const { text } = pinPythonRequirement(readFileSync(file, 'utf8'), name, version);
  writeAtomic(file, text);
  console.log(`[pin-python-dependency] ${manifest}: ${name}==${version}`);
}
