#!/usr/bin/env node
// Writes the review record of tests/kit/fixture with the review tool and the stub registries of FIXTURE_REGISTRY, so the
// committed record is the output of the tool and a second run changes only the time (`make kit-fixture-record`).
//
//   node tests/kit/record-fixture.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE_REGISTRY, stubRegistries } from './registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = stubRegistries({ after() {} });
stub.registry(FIXTURE_REGISTRY);
const run = spawnSync(process.execPath, [path.join(here, '../../scripts/kit/dependency-review.mjs'), '--root', path.join(here, 'fixture'), '--record'], {
  encoding: 'utf8', env: stub.env,
});
process.stdout.write(run.stdout);
process.stderr.write(run.stderr);
process.exitCode = run.status ?? 1;
