import * as readline from 'node:readline';
import { findEntryById, removeEntry } from '../../src/taskManager';
import { ensureRepoRoot, red, shortId } from '../util';

interface RemoveOpts {
  force?: boolean;
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

export async function runRemove(id: string, opts: RemoveOpts): Promise<void> {
  const repoRoot = ensureRepoRoot();
  const found = findEntryById(repoRoot, id);
  if (!found) {
    console.error(red(`Annotation not found: ${id}`));
    process.exit(1);
  }
  if (!opts.force) {
    const ok = await confirm(
      `Delete ${found.entry.type} ${shortId(found.entry.id)} on ${found.file}:${found.entry.line}?`,
    );
    if (!ok) {
      console.log('Aborted.');
      return;
    }
  }
  removeEntry(repoRoot, id);
  console.log(`Removed ${shortId(found.entry.id)}.`);
}
