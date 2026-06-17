import { execSync, ExecSyncOptions } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

function run(cmd: string, cwd: string): string {
  const opts: ExecSyncOptions = { cwd, stdio: ['ignore', 'pipe', 'pipe'] };
  return execSync(cmd, opts).toString().trim();
}

function safeRun(cmd: string, cwd: string): string | undefined {
  try {
    return run(cmd, cwd);
  } catch {
    return undefined;
  }
}

export function isGitRepo(cwd: string): boolean {
  const out = safeRun('git rev-parse --is-inside-work-tree', cwd);
  return out === 'true';
}

export function getRepoRoot(cwd: string): string | undefined {
  return safeRun('git rev-parse --show-toplevel', cwd);
}

export function getCurrentCommitSHA(cwd: string): string {
  // If the repo has no commits yet, fall back to an all-zero SHA.
  const out = safeRun('git rev-parse HEAD', cwd);
  return out ?? '0000000000000000000000000000000000000000';
}

export function getUserName(cwd: string): string {
  return safeRun('git config user.name', cwd) ?? 'unknown';
}

export function getUserEmail(cwd: string): string {
  return safeRun('git config user.email', cwd) ?? '';
}

export function getFileAtCommit(
  cwd: string,
  commitSHA: string,
  relPath: string,
): string | undefined {
  // Escape path-special chars by quoting.
  const safePath = relPath.replace(/"/g, '\\"');
  return safeRun(`git show "${commitSHA}:${safePath}"`, cwd);
}

/**
 * Returns true if the given assignee string matches the current git user
 * (case-insensitive, checks both user.name and user.email).
 */
export function isCurrentUser(cwd: string, assignee: string | undefined): boolean {
  if (!assignee) return false;
  const target = assignee.trim().toLowerCase();
  if (!target) return false;
  const name = getUserName(cwd).trim().toLowerCase();
  const email = getUserEmail(cwd).trim().toLowerCase();
  return target === name || target === email;
}

/**
 * Walks up from the given path looking for a directory containing `.git`,
 * returning that directory (the repo root) or undefined if none.
 */
export function findRepoRoot(startPath: string): string | undefined {
  let dir = fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
