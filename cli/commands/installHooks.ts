import * as fs from 'node:fs';
import * as path from 'node:path';
import { installHooks, uninstallHooks } from '../../src/hooks';
import { ensureRepoRoot, red } from '../util';
import { gitTasksInvocation } from '../invocation';

export function runInstallHooks(): void {
  const repoRoot = ensureRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    console.error(red('git-tasks install-hooks: .git directory not found.'));
    process.exit(1);
  }
  const actions = installHooks(repoRoot, gitTasksInvocation());
  console.log(
    `Installed hooks (post-merge ${actions['post-merge']}, post-checkout ${actions['post-checkout']}, pre-commit ${actions['pre-commit']}).`,
  );
  console.log('  post-merge / post-checkout: auto-reconcile on pull and branch switch.');
  console.log('  pre-commit: relocate drift, block commits that leave stale or orphan annotations.');
}

export function runUninstallHooks(): void {
  const repoRoot = ensureRepoRoot();
  const removed = uninstallHooks(repoRoot);
  if (removed.length === 0) {
    console.log('No managed git-tasks hooks found.');
  } else {
    console.log(`Removed git-tasks block from: ${removed.join(', ')}.`);
  }
}
