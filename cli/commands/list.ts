import { listAllAnnotationFiles } from '../../src/commentManager';
import { AnnotationEntry, EntryPriority, EntryStatus, EntryType } from '../../src/types';
import { isCurrentUser } from '../../src/gitHelper';
import { bold, dim, ensureRepoRoot, relPathFromRepoArg, shortId, truncate } from '../util';

interface ListOpts {
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  mine?: boolean;
  json?: boolean;
}

interface Row {
  file: string;
  entry: AnnotationEntry;
  mine: boolean;
}

export function runList(file: string | undefined, opts: ListOpts): void {
  const repoRoot = ensureRepoRoot();
  const targetRel = file ? relPathFromRepoArg(repoRoot, file) : undefined;

  const all = listAllAnnotationFiles(repoRoot);
  const rows: Row[] = [];
  for (const af of all) {
    if (targetRel && af.file !== targetRel) continue;
    for (const e of af.entries) {
      if (opts.type && e.type !== opts.type) continue;
      if (opts.status && e.status !== opts.status) continue;
      if (opts.priority && e.priority !== opts.priority) continue;
      const mine = isCurrentUser(repoRoot, e.assignee);
      if (opts.mine && !mine) continue;
      if (opts.assignee) {
        const a = (e.assignee ?? '').toLowerCase();
        if (a !== opts.assignee.toLowerCase()) continue;
      }
      rows.push({ file: af.file, entry: e, mine });
    }
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        rows.map((r) => ({ file: r.file, ...r.entry, mine: r.mine })),
        null,
        2,
      ),
    );
    return;
  }

  if (rows.length === 0) {
    console.log(dim('No annotations found.'));
    return;
  }

  rows.sort((a, b) => {
    const f = a.file.localeCompare(b.file);
    if (f !== 0) return f;
    return a.entry.line - b.entry.line;
  });

  const header =
    '  ID       FILE                          LINES     TYPE     PRIORITY  STATUS       TEXT';
  console.log(bold(header));
  console.log(dim('─'.repeat(110)));
  for (const r of rows) {
    const range = r.entry.endLine && r.entry.endLine !== r.entry.line
      ? `${r.entry.line}-${r.entry.endLine}`
      : `${r.entry.line}`;
    const marker = r.mine ? '→' : ' ';
    const text = truncate(r.entry.text, 40) + (r.mine ? ' (assigned to you)' : '');
    const line = [
      marker,
      shortId(r.entry.id).padEnd(8),
      truncate(r.file, 30).padEnd(30),
      range.padEnd(9),
      r.entry.type.padEnd(8),
      r.entry.priority.padEnd(9),
      r.entry.status.padEnd(12),
      text,
    ].join(' ');
    console.log(r.mine ? bold(line) : line);
  }
}

// re-export type unions for parser hint
export type { EntryType, EntryStatus, EntryPriority };
