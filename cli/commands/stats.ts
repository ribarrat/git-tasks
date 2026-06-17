import { listAllEntries } from '../../src/commentManager';
import { AnnotationEntry, EntrySeverity } from '../../src/types';
import { bold, dim, ensureRepoRoot, red, shortId, truncate } from '../util';

interface StatsOpts {
  json?: boolean;
  slaDays?: string;
  failOnAgedCritical?: boolean;
}

interface PerFile {
  file: string;
  total: number;
  open: number;
  critical: number;
  oldestOpenAgeDays: number;
}

const SEVERITY_ORDER: EntrySeverity[] = ['critical', 'major', 'minor', 'trivial'];

export function runStats(opts: StatsOpts): void {
  const repoRoot = ensureRepoRoot();
  const slaDays = opts.slaDays ? parseInt(opts.slaDays, 10) : 30;
  const now = Date.now();

  const entries = listAllEntries(repoRoot);

  const byFile = new Map<string, PerFile>();
  const bySeverity: Record<EntrySeverity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
    trivial: 0,
  };
  const byType: Record<string, number> = { task: 0, comment: 0, issue: 0 };
  const byStatus: Record<string, number> = {
    open: 0,
    'in-progress': 0,
    resolved: 0,
    closed: 0,
  };

  const agedOpen: Array<{ file: string; entry: AnnotationEntry; ageDays: number }> = [];

  for (const { file, entry } of entries) {
    bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1;
    byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;

    const ageDays = Math.floor((now - Date.parse(entry.createdAt)) / 86_400_000);
    const isOpen = entry.status === 'open' || entry.status === 'in-progress';
    if (isOpen && ageDays > slaDays) {
      agedOpen.push({ file, entry, ageDays });
    }

    let row = byFile.get(file);
    if (!row) {
      row = { file, total: 0, open: 0, critical: 0, oldestOpenAgeDays: 0 };
      byFile.set(file, row);
    }
    row.total += 1;
    if (isOpen) {
      row.open += 1;
      if (entry.severity === 'critical') row.critical += 1;
      if (ageDays > row.oldestOpenAgeDays) row.oldestOpenAgeDays = ageDays;
    }
  }

  const files = Array.from(byFile.values()).sort((a, b) => {
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.open !== a.open) return b.open - a.open;
    return b.total - a.total;
  });

  const stats = {
    total: entries.length,
    slaDays,
    bySeverity,
    byType,
    byStatus,
    topFiles: files.slice(0, 10),
    agedOpen: agedOpen
      .sort((a, b) => b.ageDays - a.ageDays)
      .map((a) => ({
        file: a.file,
        id: a.entry.id,
        line: a.entry.line,
        endLine: a.entry.endLine,
        type: a.entry.type,
        severity: a.entry.severity,
        priority: a.entry.priority,
        status: a.entry.status,
        ageDays: a.ageDays,
        text: a.entry.text,
      })),
  };

  if (opts.json) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    printHuman(stats);
  }

  if (opts.failOnAgedCritical) {
    const agedCriticals = stats.agedOpen.filter((a) => a.severity === 'critical');
    if (agedCriticals.length > 0) {
      console.error(
        red(
          `\ngit-tasks stats: ${agedCriticals.length} critical annotation${agedCriticals.length === 1 ? '' : 's'} open for more than ${slaDays} days.`,
        ),
      );
      process.exit(1);
    }
  }
}

function printHuman(s: ReturnType<typeof buildSig>): void {
  console.log(bold(`Annotation stats — ${s.total} total · SLA window: ${s.slaDays} days`));
  console.log('');
  console.log(bold('By type:    ') + Object.entries(s.byType).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log(bold('By status:  ') + Object.entries(s.byStatus).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log(
    bold('By severity:') +
      ' ' +
      SEVERITY_ORDER.map((sev) => `${sev}=${s.bySeverity[sev]}`).join('  '),
  );

  if (s.topFiles.length > 0) {
    console.log('');
    console.log(bold('Top files by open / critical:'));
    console.log(dim('  open  crit  total  oldest  file'));
    for (const f of s.topFiles) {
      console.log(
        `  ${String(f.open).padStart(4)}  ${String(f.critical).padStart(4)}  ${String(f.total).padStart(5)}  ${String(f.oldestOpenAgeDays).padStart(5)}d  ${f.file}`,
      );
    }
  }

  if (s.agedOpen.length > 0) {
    console.log('');
    console.log(bold(`Aged open annotations (>${s.slaDays} days):`));
    for (const a of s.agedOpen) {
      const range = a.endLine ? `${a.line}-${a.endLine}` : `${a.line}`;
      console.log(
        `  ${shortId(a.id)}  ${a.file}:${range}  [${a.severity}/${a.status}]  ${a.ageDays}d  ${truncate(a.text, 60)}`,
      );
    }
  } else {
    console.log('');
    console.log(dim(`No open annotations older than ${s.slaDays} days.`));
  }
}

// Helper just for the type alias above.
function buildSig() {
  return {
    total: 0,
    slaDays: 0,
    bySeverity: { critical: 0, major: 0, minor: 0, trivial: 0 } as Record<EntrySeverity, number>,
    byType: { task: 0, comment: 0, issue: 0 } as Record<string, number>,
    byStatus: { open: 0, 'in-progress': 0, resolved: 0, closed: 0 } as Record<string, number>,
    topFiles: [] as PerFile[],
    agedOpen: [] as Array<{
      file: string;
      id: string;
      line: number;
      endLine?: number;
      type: string;
      severity: EntrySeverity;
      priority: string;
      status: string;
      ageDays: number;
      text: string;
    }>,
  };
}
