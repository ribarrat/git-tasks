import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  mergeAnnotationFiles,
  reconcileEntry,
  relocateEntry,
} from '../../src/taskManager';
import { getRepoRoot } from '../../src/gitHelper';
import { AnnotationFile, SCHEMA_VERSION } from '../../src/types';
import { red } from '../util';

function parseFile(p: string): AnnotationFile | undefined {
  if (!fs.existsSync(p)) return undefined;
  const raw = fs.readFileSync(p, 'utf8');
  if (raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as AnnotationFile;
    if (!parsed.entries) parsed.entries = [];
    if (!parsed.version) parsed.version = SCHEMA_VERSION;
    if (!parsed.file) parsed.file = '';
    return parsed;
  } catch (err) {
    console.error(red(`git-tasks merge-driver: cannot parse ${p}: ${(err as Error).message}`));
    return undefined;
  }
}

/**
 * The source file a given annotation file describes. Prefers the `file` field
 * recorded inside the JSON, falling back to deriving it from %P
 * (`.git-tasks/<source path>.json`).
 */
function sourcePathFor(merged: AnnotationFile, worktreePath?: string): string | undefined {
  if (merged.file) return merged.file;
  if (!worktreePath) return undefined;
  const normalized = worktreePath.split(path.sep).join('/');
  const m = /^\.git-tasks\/(.+)\.json$/.exec(normalized);
  return m ? m[1] : undefined;
}

/**
 * A merge only reconciles positions once the source file itself is settled.
 * If git left conflict markers in it, the line numbers we'd compute are
 * meaningless, so leave the pins alone and let the post-merge hook retry.
 */
function hasConflictMarkers(content: string): boolean {
  return /^<{7}[ \t]|^={7}$|^>{7}[ \t]/m.test(content);
}

/**
 * Relocate merged entries against the current worktree copy of the source.
 * Only exact-snapshot relocations are applied; ambiguous ones are left for
 * `git-tasks reconcile` to report. Returns the number of entries moved.
 */
function relocateAgainstWorktree(
  merged: AnnotationFile,
  worktreePath: string | undefined,
): number {
  const repoRoot = getRepoRoot(process.cwd());
  if (!repoRoot) return 0;
  const rel = sourcePathFor(merged, worktreePath);
  if (!rel) return 0;
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return 0;
  const content = fs.readFileSync(abs, 'utf8');
  if (hasConflictMarkers(content)) return 0;

  let moved = 0;
  for (const entry of merged.entries) {
    const result = reconcileEntry(content, entry);
    if (result.status !== 'moved') continue;
    if (relocateEntry(content, entry, result)) moved++;
  }
  return moved;
}

/**
 * Custom git merge driver invoked as:
 *   git-tasks merge-driver %O %A %B %P
 * where %O = ancestor temp path, %A = our temp path (written back here),
 * %B = their temp path, %P = original path inside the worktree.
 * Exit 0 on successful merge, 1 on structural conflict (git falls back to
 * its normal conflict markers in that case).
 */
export function runMergeDriver(argv: string[]): void {
  if (argv.length < 3) {
    console.error(red('Usage: git-tasks merge-driver <ancestor> <ours> <theirs> [<path>]'));
    process.exit(2);
  }
  const [ancestorPath, oursPath, theirsPath, worktreePath] = argv;

  const ancestor = parseFile(ancestorPath);
  const ours = parseFile(oursPath);
  const theirs = parseFile(theirsPath);

  if (!ours || !theirs) {
    console.error(red('git-tasks merge-driver: missing ours or theirs version.'));
    process.exit(1);
  }

  const outcome = mergeAnnotationFiles(ancestor, ours, theirs);
  if (!outcome.ok) {
    console.error(red(`git-tasks merge-driver: ${outcome.reason}`));
    process.exit(1);
  }
  // A merge is exactly when both sides' line numbers go stale, so settle the
  // pins here rather than leaving the result drifted until someone reconciles.
  relocateAgainstWorktree(outcome.merged, worktreePath);

  // Write merged back to ours (%A).
  fs.writeFileSync(oursPath, JSON.stringify(outcome.merged, null, 2) + '\n', 'utf8');
  process.exit(0);
}
