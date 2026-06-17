import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  addEntry,
  createEntry,
  extractLineContent,
} from '../../src/commentManager';
import {
  EntryPriority,
  EntrySeverity,
  EntryType,
  ENTRY_PRIORITIES,
  ENTRY_SEVERITIES,
  ENTRY_TYPES,
} from '../../src/types';
import {
  getCurrentCommitSHA,
  getUserName,
} from '../../src/gitHelper';
import {
  ensureRepoRoot,
  parseLineArg,
  red,
  relPathFromRepoArg,
  shortId,
} from '../util';

interface AddOpts {
  type: string;
  text: string;
  priority?: string;
  severity?: string;
  assignee?: string;
  tags?: string;
}

export function runAdd(file: string, lineArg: string, opts: AddOpts): void {
  const repoRoot = ensureRepoRoot();
  const rel = relPathFromRepoArg(repoRoot, file);

  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    console.error(red(`File does not exist: ${rel}`));
    process.exit(1);
  }

  const { line, endLine } = parseLineArg(lineArg);

  if (!ENTRY_TYPES.includes(opts.type as EntryType)) {
    console.error(red(`Invalid --type: ${opts.type}. Expected one of ${ENTRY_TYPES.join('|')}.`));
    process.exit(1);
  }
  const priority = (opts.priority ?? 'medium') as EntryPriority;
  if (!ENTRY_PRIORITIES.includes(priority)) {
    console.error(red(`Invalid --priority: ${opts.priority}.`));
    process.exit(1);
  }
  const severity = (opts.severity ?? 'minor') as EntrySeverity;
  if (!ENTRY_SEVERITIES.includes(severity)) {
    console.error(red(`Invalid --severity: ${opts.severity}.`));
    process.exit(1);
  }

  const fileContent = fs.readFileSync(abs, 'utf8');
  const lineCount = fileContent.split(/\r?\n/).length;
  if (line < 1 || line > lineCount || (endLine !== undefined && endLine > lineCount)) {
    console.error(red(`Line range out of bounds (file has ${lineCount} lines).`));
    process.exit(1);
  }
  const lineContent = extractLineContent(fileContent, line, endLine);

  const tags = opts.tags
    ? opts.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    : undefined;

  const entry = createEntry({
    type: opts.type as EntryType,
    commitSHA: getCurrentCommitSHA(repoRoot),
    line,
    endLine,
    lineContent,
    text: opts.text,
    author: getUserName(repoRoot),
    assignee: opts.assignee,
    priority,
    severity,
    tags,
  });

  addEntry(repoRoot, rel, entry);
  const range = endLine && endLine !== line ? `${line}-${endLine}` : `${line}`;
  console.log(`Added ${entry.type} ${shortId(entry.id)} on ${rel}:${range}`);
}
