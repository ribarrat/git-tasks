import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureRepoRoot, red } from '../util';
import { gitTasksInvocation } from '../invocation';

const BEGIN_MARK = '# >>> git-tasks (managed)';
const END_MARK = '# <<< git-tasks (managed)';

function postMergeBody(invocation: string): string {
  return `${BEGIN_MARK}
${invocation} reconcile --auto --quiet 2>/dev/null || true
${END_MARK}
`;
}

function postCheckoutBody(invocation: string): string {
  return `${BEGIN_MARK}
# Only reconcile on branch checkouts (3rd arg = 1), not file checkouts.
if [ "\${3:-1}" = "1" ]; then
  ${invocation} reconcile --auto --quiet 2>/dev/null || true
fi
${END_MARK}
`;
}

function preCommitBody(invocation: string): string {
  return `${BEGIN_MARK}
# Block commits that would leave stale or orphan annotations behind.
# Drift that can be auto-relocated is fixed in place and re-staged.
${invocation} reconcile --auto --quiet
status=$?
if ! git diff --quiet -- .git-tasks 2>/dev/null; then
  git add .git-tasks
fi
if [ "$status" -ne 0 ]; then
  echo "" >&2
  echo "git-tasks: commit blocked — stale or orphan annotations." >&2
  echo "Run 'git-tasks reconcile' for details, then update or remove them." >&2
  exit 1
fi
${END_MARK}
`;
}

function writeManagedHook(hookPath: string, body: string): 'created' | 'updated' {
  let action: 'created' | 'updated' = 'created';
  let existing = '';
  if (fs.existsSync(hookPath)) {
    existing = fs.readFileSync(hookPath, 'utf8');
    action = 'updated';
  } else {
    existing = '#!/bin/sh\n';
  }
  const re = new RegExp(`${BEGIN_MARK}[\\s\\S]*?${END_MARK}\\n?`, 'm');
  const cleaned = re.test(existing) ? existing.replace(re, '') : existing;
  const next = cleaned.endsWith('\n') ? `${cleaned}${body}` : `${cleaned}\n${body}`;
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, next, 'utf8');
  fs.chmodSync(hookPath, 0o755);
  return action;
}

function removeManagedBlock(hookPath: string): boolean {
  if (!fs.existsSync(hookPath)) return false;
  const existing = fs.readFileSync(hookPath, 'utf8');
  const re = new RegExp(`${BEGIN_MARK}[\\s\\S]*?${END_MARK}\\n?`, 'm');
  if (!re.test(existing)) return false;
  const cleaned = existing.replace(re, '');
  // If the file is now just a shebang and whitespace, remove it entirely.
  if (cleaned.replace(/\s+/g, '') === '#!/bin/sh') {
    fs.unlinkSync(hookPath);
  } else {
    fs.writeFileSync(hookPath, cleaned, 'utf8');
  }
  return true;
}

export function runInstallHooks(): void {
  const repoRoot = ensureRepoRoot();
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  if (!fs.existsSync(path.dirname(hooksDir))) {
    console.error(red('git-tasks install-hooks: .git directory not found.'));
    process.exit(1);
  }
  const invocation = gitTasksInvocation();
  const a = writeManagedHook(path.join(hooksDir, 'post-merge'), postMergeBody(invocation));
  const b = writeManagedHook(
    path.join(hooksDir, 'post-checkout'),
    postCheckoutBody(invocation),
  );
  const c = writeManagedHook(path.join(hooksDir, 'pre-commit'), preCommitBody(invocation));
  console.log(`Installed hooks (post-merge ${a}, post-checkout ${b}, pre-commit ${c}).`);
  console.log('  post-merge / post-checkout: auto-reconcile on pull and branch switch.');
  console.log('  pre-commit: relocate drift, block commits that leave stale or orphan annotations.');
}

export function runUninstallHooks(): void {
  const repoRoot = ensureRepoRoot();
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  const removed = [
    removeManagedBlock(path.join(hooksDir, 'post-merge')) ? 'post-merge' : null,
    removeManagedBlock(path.join(hooksDir, 'post-checkout')) ? 'post-checkout' : null,
    removeManagedBlock(path.join(hooksDir, 'pre-commit')) ? 'pre-commit' : null,
  ].filter(Boolean);
  if (removed.length === 0) {
    console.log('No managed git-tasks hooks found.');
  } else {
    console.log(`Removed git-tasks block from: ${removed.join(', ')}.`);
  }
}
