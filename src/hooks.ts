import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const BEGIN_MARK = '# >>> git-tasks (managed)';
export const END_MARK = '# <<< git-tasks (managed)';

export type HookName = 'post-merge' | 'post-checkout' | 'pre-commit';
export const HOOK_NAMES: HookName[] = ['post-merge', 'post-checkout', 'pre-commit'];

export type HookAction = 'created' | 'updated';

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
# 126/127 mean the shell could not execute the CLI at all (missing, or a
# broken/non-executable link). That is not an annotation problem, so report it
# and let the commit through rather than blocking with a misleading reason.
if [ "$status" -eq 126 ] || [ "$status" -eq 127 ]; then
  echo "" >&2
  echo "git-tasks: cannot run '${invocation}' (exit $status) — skipping annotation check." >&2
  echo "Reinstall the CLI, or run 'git-tasks uninstall-hooks' to remove this hook." >&2
  exit 0
fi
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

function bodyFor(hook: HookName, invocation: string): string {
  switch (hook) {
    case 'post-merge':
      return postMergeBody(invocation);
    case 'post-checkout':
      return postCheckoutBody(invocation);
    case 'pre-commit':
      return preCommitBody(invocation);
  }
}

/** The markers contain `(managed)`, so they must be escaped before use in a regex. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function managedBlockRe(): RegExp {
  return new RegExp(`${escapeRe(BEGIN_MARK)}[\\s\\S]*?${escapeRe(END_MARK)}\\n?`, 'm');
}

export function hooksDirFor(repoRoot: string): string {
  return path.join(repoRoot, '.git', 'hooks');
}

function writeManagedHook(hookPath: string, body: string): HookAction {
  let action: HookAction = 'created';
  let existing = '';
  if (fs.existsSync(hookPath)) {
    existing = fs.readFileSync(hookPath, 'utf8');
    action = 'updated';
  } else {
    existing = '#!/bin/sh\n';
  }
  const re = managedBlockRe();
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
  const re = managedBlockRe();
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

/**
 * True when the given hook exists and carries our managed block.
 */
export function hookIsManaged(repoRoot: string, hook: HookName): boolean {
  const p = path.join(hooksDirFor(repoRoot), hook);
  if (!fs.existsSync(p)) return false;
  return managedBlockRe().test(fs.readFileSync(p, 'utf8'));
}

/**
 * True only when every managed hook is present — a partial install still
 * leaves some drift unhandled, so it counts as not installed.
 */
export function hooksInstalled(repoRoot: string): boolean {
  return HOOK_NAMES.every((h) => hookIsManaged(repoRoot, h));
}

export function installHooks(
  repoRoot: string,
  invocation: string,
): Record<HookName, HookAction> {
  const dir = hooksDirFor(repoRoot);
  const result = {} as Record<HookName, HookAction>;
  for (const hook of HOOK_NAMES) {
    result[hook] = writeManagedHook(path.join(dir, hook), bodyFor(hook, invocation));
  }
  return result;
}

export function uninstallHooks(repoRoot: string): HookName[] {
  const dir = hooksDirFor(repoRoot);
  return HOOK_NAMES.filter((hook) => removeManagedBlock(path.join(dir, hook)));
}

/**
 * Absolute path to a `git-tasks` binary on PATH, or undefined. Hooks run in a
 * bare shell with no editor environment, so an invocation that only resolves
 * inside VS Code would silently fail there.
 */
export function findGitTasksOnPath(): string | undefined {
  try {
    const out = execSync('command -v git-tasks', { shell: '/bin/sh' })
      .toString()
      .trim();
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
