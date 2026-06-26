import { findEntryById } from '../../src/taskManager';
import { isCurrentUser } from '../../src/gitHelper';
import { bold, dim, ensureRepoRoot, red } from '../util';

export function runShow(id: string): void {
  const repoRoot = ensureRepoRoot();
  const found = findEntryById(repoRoot, id);
  if (!found) {
    console.error(red(`Annotation not found: ${id}`));
    process.exit(1);
  }
  const e = found.entry;
  const range = e.endLine && e.endLine !== e.line ? `${e.line}-${e.endLine}` : `${e.line}`;
  const mine = isCurrentUser(repoRoot, e.assignee);
  const assigneeStr = e.assignee
    ? mine
      ? bold(`${e.assignee} (you)`)
      : e.assignee
    : dim('unassigned');

  console.log(bold(`${e.type.toUpperCase()}  ${e.id}`));
  console.log(`${found.file}:${range}`);
  console.log(`status: ${e.status}   priority: ${e.priority}   severity: ${e.severity}`);
  console.log(`author: ${e.author}   assignee: ${assigneeStr}`);
  console.log(`created: ${e.createdAt}`);
  console.log(`updated: ${e.updatedAt}`);
  console.log(`commit:  ${e.commitSHA}`);
  if (e.tags && e.tags.length > 0) console.log(`tags:    ${e.tags.join(', ')}`);
  console.log();
  console.log(e.text);
  console.log();
  console.log(dim('--- line content snapshot ---'));
  console.log(e.lineContent);
}
