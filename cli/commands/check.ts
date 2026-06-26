import { execSync } from 'node:child_process';
import {
  listAllEntries,
  reconcileAll,
  ReconcileReport,
} from '../../src/taskManager';
import { AnnotationEntry, EntrySeverity } from '../../src/types';
import { bold, dim, ensureRepoRoot, red, shortId } from '../util';

interface CheckOpts {
  format?: string;
  failOn?: string;
  failOnOpenSeverity?: string;
  base?: string;
}

interface OpenHit {
  file: string;
  entry: AnnotationEntry;
}

export function runCheck(opts: CheckOpts): void {
  const repoRoot = ensureRepoRoot();
  const failOn = (opts.failOn ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const failSeverities = (opts.failOnOpenSeverity ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as EntrySeverity[];

  const report = reconcileAll(repoRoot, { apply: false });

  // Open-entry check (scoped to changed files when --base is given).
  const openHits: OpenHit[] = [];
  if (failSeverities.length > 0) {
    let scope: Set<string> | undefined;
    if (opts.base) {
      try {
        const out = execSync(`git diff --name-only ${opts.base}...HEAD`, {
          cwd: repoRoot,
        })
          .toString()
          .trim();
        scope = new Set(out.split('\n').filter(Boolean));
      } catch {
        console.error(red(`git-tasks check: failed to diff against base ${opts.base}.`));
        process.exit(2);
      }
    }
    for (const e of listAllEntries(repoRoot)) {
      if (e.entry.status !== 'open' && e.entry.status !== 'in-progress') continue;
      if (!failSeverities.includes(e.entry.severity)) continue;
      if (scope && !scope.has(e.file)) continue;
      openHits.push({ file: e.file, entry: e.entry });
    }
  }

  if (opts.format === 'json') {
    console.log(
      JSON.stringify(
        {
          total: report.total,
          ok: report.ok,
          moved: report.moved.length,
          softMatch: report.softMatch.length,
          stale: report.stale.length,
          orphan: report.orphan.length,
          openHits: openHits.map((h) => ({
            file: h.file,
            id: h.entry.id,
            line: h.entry.line,
            endLine: h.entry.endLine,
            type: h.entry.type,
            severity: h.entry.severity,
            status: h.entry.status,
            text: h.entry.text,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `${bold('git-tasks check')}: ${report.total} entries · ${report.ok} ok · ${report.moved.length} drifted · ${report.softMatch.length} soft-match · ${report.stale.length} stale · ${report.orphan.length} orphan`,
    );
    if (openHits.length > 0) {
      console.log('');
      console.log(bold(`Open entries matching --fail-on-open-severity:`));
      for (const h of openHits) {
        const range = h.entry.endLine ? `${h.entry.line}-${h.entry.endLine}` : `${h.entry.line}`;
        console.log(
          `  ${shortId(h.entry.id)}  ${h.file}:${range}  [${h.entry.severity}] ${h.entry.text}`,
        );
      }
    }
    if (report.stale.length + report.orphan.length + report.softMatch.length + report.moved.length === 0 && openHits.length === 0) {
      console.log(dim('OK.'));
    }
  }

  const fails: string[] = [];
  if (failOn.includes('drift') && report.moved.length > 0) fails.push('drift');
  if (failOn.includes('soft-match') && report.softMatch.length > 0) fails.push('soft-match');
  if (failOn.includes('stale') && report.stale.length > 0) fails.push('stale');
  if (failOn.includes('orphan') && report.orphan.length > 0) fails.push('orphan');
  if (openHits.length > 0) fails.push('open-severity');

  if (fails.length > 0) {
    if (opts.format !== 'json') {
      console.error(red(`\nFailing on: ${fails.join(', ')}`));
    }
    process.exit(1);
  }
}

// keep tsc from complaining about an unused import in the JSON branch
void ((): ReconcileReport | undefined => undefined)();
