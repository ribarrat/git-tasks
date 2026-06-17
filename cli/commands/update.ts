import { updateEntry } from '../../src/commentManager';
import {
  AnnotationEntry,
  EntryPriority,
  EntrySeverity,
  EntryStatus,
  ENTRY_PRIORITIES,
  ENTRY_SEVERITIES,
  ENTRY_STATUSES,
} from '../../src/types';
import { ensureRepoRoot, red, shortId } from '../util';

interface UpdateOpts {
  text?: string;
  status?: string;
  priority?: string;
  severity?: string;
  assignee?: string;
  tags?: string;
}

export function runUpdate(id: string, opts: UpdateOpts): void {
  const repoRoot = ensureRepoRoot();
  const patch: Partial<AnnotationEntry> = {};

  if (opts.text !== undefined) patch.text = opts.text;
  if (opts.status !== undefined) {
    if (!ENTRY_STATUSES.includes(opts.status as EntryStatus)) {
      console.error(red(`Invalid --status: ${opts.status}.`));
      process.exit(1);
    }
    patch.status = opts.status as EntryStatus;
  }
  if (opts.priority !== undefined) {
    if (!ENTRY_PRIORITIES.includes(opts.priority as EntryPriority)) {
      console.error(red(`Invalid --priority: ${opts.priority}.`));
      process.exit(1);
    }
    patch.priority = opts.priority as EntryPriority;
  }
  if (opts.severity !== undefined) {
    if (!ENTRY_SEVERITIES.includes(opts.severity as EntrySeverity)) {
      console.error(red(`Invalid --severity: ${opts.severity}.`));
      process.exit(1);
    }
    patch.severity = opts.severity as EntrySeverity;
  }
  if (opts.assignee !== undefined) {
    patch.assignee = opts.assignee.trim() || undefined;
  }
  if (opts.tags !== undefined) {
    const tags = opts.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    patch.tags = tags.length > 0 ? tags : undefined;
  }

  if (Object.keys(patch).length === 0) {
    console.error(red('No fields specified to update.'));
    process.exit(1);
  }

  const updated = updateEntry(repoRoot, id, patch);
  if (!updated) {
    console.error(red(`Annotation not found: ${id}`));
    process.exit(1);
  }
  console.log(`Updated ${shortId(updated.entry.id)} (${updated.file}:${updated.entry.line}).`);
}
