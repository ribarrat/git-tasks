import * as readline from 'node:readline';
import { listAllEntries, removeEntry } from '../../src/taskManager';
import { EntryStatus } from '../../src/types';
import { bold, dim, ensureRepoRoot, red, shortId } from '../util';

const TERMINAL_STATUSES: EntryStatus[] = ['resolved', 'closed'];

export interface PurgeOpts {
  status?: string;
  olderThan?: string;
  apply?: boolean;
  force?: boolean;
  json?: boolean;
}

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export async function runPurge(opts: PurgeOpts): Promise<void> {
  const repoRoot = ensureRepoRoot();

  const targetStatuses: EntryStatus[] = opts.status
    ? (opts.status.split(',').map((s) => s.trim()) as EntryStatus[])
    : TERMINAL_STATUSES;

  const invalidStatuses = targetStatuses.filter(
    (s) => !['open', 'in-progress', 'resolved', 'closed'].includes(s),
  );
  if (invalidStatuses.length > 0) {
    console.error(red(`Unknown status value(s): ${invalidStatuses.join(', ')}`));
    process.exit(1);
  }

  const olderThanDays = opts.olderThan !== undefined ? parseInt(opts.olderThan, 10) : undefined;
  if (olderThanDays !== undefined && (isNaN(olderThanDays) || olderThanDays < 0)) {
    console.error(red(`--older-than must be a non-negative integer (days).`));
    process.exit(1);
  }

  const cutoff =
    olderThanDays !== undefined
      ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
      : undefined;

  const candidates = listAllEntries(repoRoot).filter(({ entry }) => {
    if (!targetStatuses.includes(entry.status)) return false;
    if (cutoff !== undefined && new Date(entry.updatedAt) > cutoff) return false;
    return true;
  });

  if (candidates.length === 0) {
    console.log(dim('No tasks matched — nothing to purge.'));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(candidates.map(({ entry }) => ({
      id: entry.id,
      status: entry.status,
      updatedAt: entry.updatedAt,
      text: entry.text.slice(0, 80),
    })), null, 2));
    if (!opts.apply) process.exit(0);
  }

  if (!opts.apply) {
    console.log(bold(`Dry run — ${candidates.length} task(s) would be purged:`));
    for (const { entry } of candidates) {
      console.log(`  ${shortId(entry.id)}  [${entry.status}]  ${entry.text.slice(0, 72)}`);
    }
    console.log(dim('\nRe-run with --apply to delete them.'));
    return;
  }

  if (!opts.force) {
    const ok = await confirm(
      `Permanently delete ${candidates.length} task(s) with status [${targetStatuses.join(', ')}]${olderThanDays !== undefined ? ` older than ${olderThanDays} day(s)` : ''}?`,
    );
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }

  let removed = 0;
  for (const { entry } of candidates) {
    removeEntry(repoRoot, entry.id);
    removed++;
  }

  console.log(`Purged ${removed} task(s).`);
}
