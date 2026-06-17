import * as fs from 'node:fs';
import { mergeAnnotationFiles } from '../../src/commentManager';
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
  const [ancestorPath, oursPath, theirsPath] = argv;

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
  // Write merged back to ours (%A).
  fs.writeFileSync(oursPath, JSON.stringify(outcome.merged, null, 2) + '\n', 'utf8');
  process.exit(0);
}
