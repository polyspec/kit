// A consumer may pin a local branch that an explicit cancellation instruction requires it to keep. A missing local ref is
// normal on CI; when the ref exists, its full commit must match the declaration before cleanup or push succeeds.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gitResult } from './git.mts';
import { readConfig } from './schema-validate.mts';

export const RETAINED_BRANCHES_CONFIG = 'config/retained-branches.json';

export interface RetainedBranch {
  branch: string;
  commit: string;
  reason: string;
  removalCondition: string;
}

interface RetainedBranchesConfig {
  schema: 1;
  branches: RetainedBranch[];
}

/** Reads the optional branch-retention declaration and rejects an existing branch whose ref moved from its pinned commit. */
export function retainedBranches(root: string): RetainedBranch[] {
  if (!existsSync(path.join(root, RETAINED_BRANCHES_CONFIG))) return [];
  const { branches } = readConfig<RetainedBranchesConfig>(root, RETAINED_BRANCHES_CONFIG, 'retained-branches.schema.json');
  const names = new Set<string>();
  for (const entry of branches) {
    if (names.has(entry.branch)) throw new Error(`${RETAINED_BRANCHES_CONFIG}: branch ${entry.branch} is declared more than once`);
    names.add(entry.branch);
    if (entry.reason.trim() === '' || entry.removalCondition.trim() === '') throw new Error(`${RETAINED_BRANCHES_CONFIG}: branch ${entry.branch} needs a reason and a removal condition`);
    const validName = gitResult(root, 'check-ref-format', `refs/heads/${entry.branch}`);
    if (validName.error || validName.status !== 0) throw new Error(`${RETAINED_BRANCHES_CONFIG}: ${entry.branch} is not a valid local branch name`);
    const current = gitResult(root, 'rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}^{commit}`);
    if (current.error || (current.status !== 0 && current.status !== 1)) throw new Error(`${RETAINED_BRANCHES_CONFIG}: could not inspect refs/heads/${entry.branch}: ${current.error?.message ?? current.stderr.trim()}`);
    if (current.status === 0 && current.stdout.trim() !== entry.commit) {
      throw new Error(`${RETAINED_BRANCHES_CONFIG}: refs/heads/${entry.branch} is ${current.stdout.trim()}, expected pinned commit ${entry.commit}; restore the declared commit or update/remove the retention record`);
    }
  }
  return branches;
}

/** The retention record for `branch`, if the declaration pins it. */
export const retainedBranch = (branches: readonly RetainedBranch[], branch: string): RetainedBranch | undefined =>
  branches.find(entry => entry.branch === branch);
