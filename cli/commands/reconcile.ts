import { reconcileAll, ReconcileReport } from '../../src/taskManager';
import { bold, dim, ensureRepoRoot, shortId } from '../util';

interface ReconcileOpts {
  auto?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export function runReconcile(opts: ReconcileOpts): void {
  const repoRoot = ensureRepoRoot();
  const apply = !opts.dryRun && (opts.auto ?? true);
  const report = reconcileAll(repoRoot, { apply });

  if (opts.json) {
    console.log(JSON.stringify(toJson(report), null, 2));
    process.exit(exitCodeFor(report));
  }

  if (opts.quiet) {
    if (report.applied > 0) {
      console.log(`git-tasks: relocated ${report.applied} annotation${report.applied === 1 ? '' : 's'}.`);
    }
    if (report.softMatch.length + report.stale.length + report.orphan.length > 0) {
      console.log(
        dim(
          `git-tasks: ${report.softMatch.length} soft-match · ${report.stale.length} stale · ${report.orphan.length} orphan (run \`git-tasks reconcile\` for details)`,
        ),
      );
    }
    process.exit(exitCodeFor(report));
  }

  printHuman(report, apply);
  process.exit(exitCodeFor(report));
}

function exitCodeFor(report: ReconcileReport): number {
  if (report.stale.length > 0 || report.orphan.length > 0) return 1;
  return 0;
}

function toJson(report: ReconcileReport) {
  const mapItem = (i: { file: string; entry: { id: string; line: number; endLine?: number }; result: { newLine?: number; newEndLine?: number; status: string } }) => ({
    file: i.file,
    id: i.entry.id,
    status: i.result.status,
    fromLine: i.entry.line,
    fromEndLine: i.entry.endLine,
    toLine: i.result.newLine,
    toEndLine: i.result.newEndLine,
  });
  return {
    total: report.total,
    ok: report.ok,
    applied: report.applied,
    moved: report.moved.map(mapItem),
    softMatch: report.softMatch.map(mapItem),
    stale: report.stale.map(mapItem),
    orphan: report.orphan.map(mapItem),
  };
}

function printHuman(report: ReconcileReport, applied: boolean): void {
  console.log(
    `${bold('Reconcile')}: ${report.total} total · ${report.ok} ok · ${
      applied ? report.applied : report.moved.length
    } moved · ${report.softMatch.length} soft-match · ${report.stale.length} stale · ${report.orphan.length} orphan`,
  );

  const section = (
    title: string,
    items: ReconcileReport['moved'],
    showTarget: boolean,
  ) => {
    if (items.length === 0) return;
    console.log('');
    console.log(bold(title));
    for (const it of items) {
      const from = it.entry.endLine ? `${it.entry.line}-${it.entry.endLine}` : `${it.entry.line}`;
      const to =
        showTarget && it.result.newLine !== undefined
          ? `→ ${it.result.newEndLine && it.result.newEndLine !== it.result.newLine ? `${it.result.newLine}-${it.result.newEndLine}` : it.result.newLine}`
          : '';
      console.log(`  ${shortId(it.entry.id)}  ${it.file}:${from}  ${to}`);
    }
  };

  section(applied ? 'Moved (applied)' : 'Moved (would apply)', report.moved, true);
  section('Soft-match (review manually)', report.softMatch, true);
  section('Stale (snapshot no longer found)', report.stale, false);
  section('Orphan (source file missing)', report.orphan, false);

  if (
    report.moved.length === 0 &&
    report.softMatch.length === 0 &&
    report.stale.length === 0 &&
    report.orphan.length === 0
  ) {
    console.log(dim('All annotations pinned correctly.'));
  }
}
