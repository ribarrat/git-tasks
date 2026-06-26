import { execSync } from 'node:child_process';
import { listAllEntries } from '../../src/taskManager';
import { AnnotationEntry } from '../../src/types';
import { bold, dim, ensureRepoRoot, red, shortId, truncate } from '../util';

interface DiffOpts {
  base?: string;
  json?: boolean;
  githubAnnotations?: boolean;
}

interface Hit {
  file: string;
  entry: AnnotationEntry;
}

export function runDiff(opts: DiffOpts): void {
  const repoRoot = ensureRepoRoot();
  if (!opts.base) {
    console.error(red('git-tasks diff: --base <ref> is required.'));
    process.exit(2);
  }
  let changed: Set<string>;
  try {
    const out = execSync(`git diff --name-only ${opts.base}...HEAD`, {
      cwd: repoRoot,
    })
      .toString()
      .trim();
    changed = new Set(out.split('\n').filter(Boolean));
  } catch (err) {
    console.error(red(`git-tasks diff: failed to diff against ${opts.base}: ${(err as Error).message}`));
    process.exit(2);
  }

  const hits: Hit[] = [];
  for (const e of listAllEntries(repoRoot)) {
    if (changed.has(e.file)) hits.push({ file: e.file, entry: e.entry });
  }

  if (opts.githubAnnotations) {
    // Emit one workflow command per entry. GitHub renders these as
    // inline annotations on the PR diff and the Files Changed tab.
    for (const h of hits) {
      const level = h.entry.type === 'issue' ? 'error' : 'warning';
      const title = `git-tasks ${h.entry.type} · ${h.entry.severity}/${h.entry.priority} · status ${h.entry.status}`;
      const msg = h.entry.text.replace(/\r?\n/g, ' ');
      const endLine = h.entry.endLine ?? h.entry.line;
      // ::warning file=path,line=N,endLine=M,title=...::message
      console.log(
        `::${level} file=${h.file},line=${h.entry.line},endLine=${endLine},title=${escape(title)}::${escape(msg)}`,
      );
    }
    return;
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        hits.map((h) => ({ file: h.file, ...h.entry })),
        null,
        2,
      ),
    );
    return;
  }

  if (hits.length === 0) {
    console.log(dim(`No annotations on files changed since ${opts.base}.`));
    return;
  }

  console.log(
    bold(`${hits.length} annotation${hits.length === 1 ? '' : 's'} on files changed since ${opts.base}:`),
  );
  for (const h of hits) {
    const range = h.entry.endLine && h.entry.endLine !== h.entry.line
      ? `${h.entry.line}-${h.entry.endLine}`
      : `${h.entry.line}`;
    console.log(
      `  ${shortId(h.entry.id)}  ${h.file}:${range}  [${h.entry.type}/${h.entry.severity}/${h.entry.status}]  ${truncate(h.entry.text, 60)}`,
    );
  }
}

function escape(s: string): string {
  // GitHub workflow commands need %0A/%0D/%25 escapes inside the values.
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
