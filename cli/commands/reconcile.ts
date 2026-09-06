import { reconcileAll, ReconcileItem, ReconcileReport } from '../../src/taskManager';
import { bold, dim, ensureRepoRoot, shortId } from '../util';

interface ReconcileOpts {
  auto?: boolean;
  dryRun?: boolean;
  quiet?: boolean;
  json?: boolean;
  strict?: boolean;
}

export function runReconcile(opts: ReconcileOpts): void {
  const repoRoot = ensureRepoRoot();
  const apply = !opts.dryRun && (opts.auto ?? true);
  const report = reconcileAll(repoRoot, { apply });
  const code = exitCodeFor(report, opts.strict ?? false);

  if (opts.json) {
    console.log(JSON.stringify(toJson(report), null, 2));
    process.exit(code);
  }

  if (opts.quiet) {
    if (report.applied > 0) {
      console.log(`git-tasks: relocated ${report.applied} annotation${report.applied === 1 ? '' : 's'}.`);
    }
    if (report.softMatch.length + report.stale.length + report.orphan.length > 0) {
      console.log(
        dim(
          `git-tasks: ${report.softMatch.length} soft-match · ${report.stale.length} stale · ${report.orphan.length} orphan${
            apply ? ' — marked on the entries' : ''
          } (run \`git-tasks reconcile\` for details)`,
        ),
      );
    }
    process.exit(code);
  }

  printHuman(report, apply);
  process.exit(code);
}

/**
 * Unresolvable drift is a property of the annotations, not of the code, so it
 * is never a build failure: reconcile records it on the entries and exits 0.
 * `--strict` restores the old gate for callers that opted into blocking on it
 * (the pre-commit hook), and is the only way to get a non-zero exit.
 */
function exitCodeFor(report: ReconcileReport, strict: boolean): number {
  if (!strict) return 0;
  if (report.stale.length > 0 || report.orphan.length > 0) return 1;
  return 0;
}

function toJson(report: ReconcileReport) {
  const mapItem = (i: ReconcileItem) => ({
    file: i.file,
    id: i.entry.id,
    status: i.result.status,
    fromLine: i.fromLine,
    fromEndLine: i.fromEndLine,
    toLine: i.result.newLine,
    toEndLine: i.result.newEndLine,
  });
  return {
    total: report.total,
    ok: report.ok,
    applied: report.applied,
    marked: report.marked,
    cleared: report.cleared,
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
  if (applied && (report.marked > 0 || report.cleared > 0)) {
    console.log(
      dim(
        `  ${report.marked} entr${report.marked === 1 ? 'y' : 'ies'} marked as drifted · ${report.cleared} mark${
          report.cleared === 1 ? '' : 's'
        } cleared`,
      ),
    );
  }

  const section = (
    title: string,
    items: ReconcileReport['moved'],
    showTarget: boolean,
  ) => {
    if (items.length === 0) return;
    console.log('');
    console.log(bold(title));
    for (const it of items) {
      const from = it.fromEndLine ? `${it.fromLine}-${it.fromEndLine}` : `${it.fromLine}`;
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

  if (applied && report.marked > 0) {
    console.log('');
    console.log(
      dim('These entries carry a `drift` mark. Nothing is blocked — repin or remove them when convenient.'),
    );
  }

  if (
    report.moved.length === 0 &&
    report.softMatch.length === 0 &&
    report.stale.length === 0 &&
    report.orphan.length === 0
  ) {
    console.log(dim('All annotations pinned correctly.'));
  }
}
