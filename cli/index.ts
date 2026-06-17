#!/usr/bin/env node
import { Command } from 'commander';
import { runAdd } from './commands/add';
import { runList } from './commands/list';
import { runUpdate } from './commands/update';
import { runRemove } from './commands/remove';
import { runShow } from './commands/show';
import { runReconcile } from './commands/reconcile';
import { runCheck } from './commands/check';
import { runInstallHooks, runUninstallHooks } from './commands/installHooks';
import {
  runInstallMergeDriver,
  runUninstallMergeDriver,
} from './commands/installMergeDriver';
import { runMergeDriver } from './commands/mergeDriver';
import { runDiff } from './commands/diff';
import { runStats } from './commands/stats';

const program = new Command();
program
  .name('git-tasks')
  .description('Annotate lines of code with tasks, comments, and issues stored in your Git repo.')
  .version('0.1.0');

program
  .command('add')
  .description('Add an annotation. <line> can be a single line (e.g. 42) or a range (e.g. 42-48).')
  .argument('<file>', 'Path to source file')
  .argument('<line>', 'Line number or range, e.g. 42 or 42-48')
  .requiredOption('--type <type>', 'task | comment | issue')
  .requiredOption('--text <text>', 'Annotation text')
  .option('--priority <priority>', 'high | medium | low', 'medium')
  .option('--severity <severity>', 'critical | major | minor | trivial', 'minor')
  .option('--assignee <assignee>', 'Name or email')
  .option('--tags <tags>', 'Comma-separated tags')
  .action((file: string, line: string, opts) => runAdd(file, line, opts));

program
  .command('list')
  .description('List annotations.')
  .argument('[file]', 'Optionally filter to one file')
  .option('--type <type>', 'task | comment | issue')
  .option('--status <status>', 'open | in-progress | resolved | closed')
  .option('--priority <priority>', 'high | medium | low')
  .option('--assignee <assignee>', 'Name or email')
  .option('--mine', 'Only show annotations assigned to the current git user')
  .option('--json', 'Output JSON')
  .action((file: string | undefined, opts) => runList(file, opts));

program
  .command('show')
  .description('Show a single annotation in full.')
  .argument('<id>', 'Annotation ID (full or short prefix)')
  .action((id: string) => runShow(id));

program
  .command('update')
  .description('Update fields on an annotation.')
  .argument('<id>', 'Annotation ID (full or short prefix)')
  .option('--text <text>', 'New text')
  .option('--status <status>', 'open | in-progress | resolved | closed')
  .option('--priority <priority>', 'high | medium | low')
  .option('--severity <severity>', 'critical | major | minor | trivial')
  .option('--assignee <assignee>', 'Name or email')
  .option('--tags <tags>', 'Comma-separated tags (replaces existing)')
  .action((id: string, opts) => runUpdate(id, opts));

program
  .command('remove')
  .description('Delete an annotation.')
  .argument('<id>', 'Annotation ID (full or short prefix)')
  .option('--force', 'Skip confirmation prompt')
  .action((id: string, opts) => runRemove(id, opts));

program
  .command('reconcile')
  .description('Detect line drift and auto-relocate annotations when the snapshot is found elsewhere in the file.')
  .option('--auto', 'Apply moved results without prompting (default)', true)
  .option('--dry-run', 'Report what would change without writing anything')
  .option('--quiet', 'Minimal output (for hooks)')
  .option('--json', 'Output JSON')
  .action((opts) => runReconcile(opts));

program
  .command('check')
  .description('CI gate: report drift / stale / orphan annotations, optionally fail on open severities in changed files.')
  .option('--format <format>', 'text | json', 'text')
  .option('--fail-on <list>', 'Comma-separated: drift,soft-match,stale,orphan')
  .option('--fail-on-open-severity <list>', 'Comma-separated: critical,major,minor,trivial')
  .option('--base <ref>', 'Git ref to scope --fail-on-open-severity to changed files (e.g. origin/main)')
  .action((opts) => runCheck(opts));

program
  .command('install-hooks')
  .description('Install git post-merge and post-checkout hooks that run reconcile automatically.')
  .action(() => runInstallHooks());

program
  .command('uninstall-hooks')
  .description('Remove the git-tasks managed block from git hooks.')
  .action(() => runUninstallHooks());

program
  .command('install-merge-driver')
  .description('Register a custom three-way merge driver for .git-tasks/*.json to avoid false textual conflicts.')
  .action(() => runInstallMergeDriver());

program
  .command('uninstall-merge-driver')
  .description('Remove the git-tasks JSON merge driver from .git/config and .gitattributes.')
  .action(() => runUninstallMergeDriver());

program
  .command('diff')
  .description('List annotations on files changed since <base>. Designed for PR-time integrations.')
  .requiredOption('--base <ref>', 'Git ref to diff against (e.g. origin/main)')
  .option('--json', 'Output JSON')
  .option('--github-annotations', 'Emit GitHub Actions workflow commands (::warning::) — one inline annotation per entry in the PR diff view')
  .action((opts) => runDiff(opts));

program
  .command('stats')
  .description('Density and SLA report — aggregates by file, type, status, severity, and surfaces aged open annotations.')
  .option('--json', 'Output JSON')
  .option('--sla-days <n>', 'Age threshold in days for "aged open" (default 30)', '30')
  .option('--fail-on-aged-critical', 'Exit non-zero if any critical annotation has been open longer than --sla-days')
  .action((opts) => runStats(opts));

program
  .command('merge-driver')
  .description('(internal) git merge-driver entry point: git-tasks merge-driver %O %A %B %P')
  .argument('<ancestor>', 'Ancestor temp file (%O)')
  .argument('<ours>', 'Our temp file (%A) — merged result written here')
  .argument('<theirs>', 'Their temp file (%B)')
  .argument('[path]', 'Path inside the worktree (%P)')
  .action((ancestor: string, ours: string, theirs: string, p: string | undefined) =>
    runMergeDriver([ancestor, ours, theirs, ...(p ? [p] : [])]),
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
