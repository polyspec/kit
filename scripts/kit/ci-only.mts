#!/usr/bin/env node
// The guard of the commands that run a suite: the full suite, a group of its targets, the owners of the changed paths or a
// test run without a selection. Such a command runs in a GitHub Actions run, which sets GITHUB_ACTIONS=true, and in the final
// full run of a repository, which its caller states with KIT_FULL_RUN=final (K649); otherwise only the unit tests that own a change
// run, each selected by its file or a name filter (PRINCIPLES.md, Verification).
//
//   node scripts/kit/ci-only.mts <command>...   exit 0 in CI, otherwise print the refusal and exit 1
import { isMain } from './paths.mts';

const UNIT_TESTS = 'node scripts/kit/run-tests.mts <tool> -- <test file>';

/** The refusal of `command` outside CI, or null in a GitHub Actions run and in the final full run (K649). */
export function ciRefusal(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.GITHUB_ACTIONS === 'true' || env.KIT_FULL_RUN === 'final') return null;
  return `${command} runs only in CI (GITHUB_ACTIONS=true), on a push to main or a manual run of the workflow, or in the final full run (KIT_FULL_RUN=final); locally run the unit tests that own the change: ${UNIT_TESTS}, or a name filter of the runner`;
}

if (isMain(import.meta.url)) {
  const words = process.argv.slice(2);
  if (words.length === 0) {
    console.error('usage: node scripts/kit/ci-only.mts <command>...');
    process.exit(2);
  }
  const message = ciRefusal(words.join(' '));
  if (message) {
    console.error(`[ci-only] refuse: ${message}`);
    process.exit(1);
  }
}
