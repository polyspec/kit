#!/usr/bin/env node
// The guard of suite commands: CI runs them normally. An explicit FINAL_RUN=1 permits a local final verification
// on a clean committed tree with no active checklist items; pending items may await this verification.
//
//   make ci-targets FINAL_RUN=1 TARGETS="<target>..."
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, repositoryRoot } from './paths.mts';
import { present } from './present.mts';
import { inspectTrackers, loadConfig, readChecklist, trackersOf, workingPlanFiles } from './checklist.mts';
import { gitResult } from './git.mts';

const UNIT_TESTS = 'node scripts/kit/run-tests.mts <tool> -- <test file>';

/** The refusal of `command` outside CI or an explicit final run without a clean committed tree and settled checklist state. */
export function ciRefusal(command: string, env: NodeJS.ProcessEnv = process.env, root?: string): string | null {
  if (env.GITHUB_ACTIONS === 'true') return null;
  if (env.FINAL_RUN === '1') {
    try {
      const checkout = root ?? repositoryRoot();
      const trackers = trackersOf(loadConfig(checkout), workingPlanFiles(checkout));
      if (trackers.length === 0) return `${command}: expected at least one checklist; actual: no checklist in ${checkout}`;
      const { active, problems } = inspectTrackers(trackers, file => readFileSync(path.join(checkout, file), 'utf8'), { open: true });
      if (problems.length) return `${command}: expected readable matching checklists; actual: ${problems.join('; ')}`;
      const running = active.filter(item => {
        const tracker = present(trackers.find(entry => entry.path === item.file), 'open item tracker');
        const { items } = readChecklist(readFileSync(path.join(checkout, item.file), 'utf8'), tracker);
        return present(items.find(entry => entry.id === item.id), 'open item').state === '[~]';
      });
      if (running.length) return `${command}: expected no active checklist items before FINAL_RUN=1; actual: ${running.map(item => {
        const tracker = present(trackers.find(entry => entry.path === item.file), 'open item tracker');
        const { items } = readChecklist(readFileSync(path.join(checkout, item.file), 'utf8'), tracker);
        return `${item.file}: ${item.id} ${present(items.find(entry => entry.id === item.id), 'open item').state}`;
      }).join('; ')}`;
      const head = gitResult(checkout, 'rev-parse', '--verify', 'HEAD');
      if (head.error || head.status !== 0) return `${command}: expected a committed tree before FINAL_RUN=1; actual: ${head.error?.message ?? head.stderr.trim()}`;
      const status = gitResult(checkout, 'status', '--porcelain', '--untracked-files=all');
      if (status.error || status.status !== 0) return `${command}: expected a readable clean tree before FINAL_RUN=1; actual: ${status.error?.message ?? status.stderr.trim()}`;
      if (status.stdout.trim()) return `${command}: expected a clean committed tree before FINAL_RUN=1; actual: ${status.stdout.trim().replace(/\n/g, '; ')}`;
      return null;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return `${command}: expected valid checklists for FINAL_RUN=1; actual: ${error.message}`;
    }
  }
  return `${command} runs only in CI (GITHUB_ACTIONS=true), on a push to main or a manual run of the workflow; locally run the unit tests that own the change: ${UNIT_TESTS}, or a name filter of the runner`;
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
