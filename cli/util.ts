import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  findRepoRoot,
  isGitRepo,
} from '../src/gitHelper';

export function bold(s: string): string {
  return process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s;
}

export function dim(s: string): string {
  return process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s;
}

export function red(s: string): string {
  return process.stdout.isTTY ? `\x1b[31m${s}\x1b[39m` : s;
}

export function ensureRepoRoot(): string {
  const root = findRepoRoot(process.cwd());
  if (!root || !isGitRepo(root)) {
    console.error(red('Not inside a Git repository.'));
    process.exit(1);
  }
  return root;
}

export function relPathFromRepoArg(repoRoot: string, fileArg: string): string {
  const abs = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg);
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    console.error(red(`Path is outside the repo: ${fileArg}`));
    process.exit(1);
  }
  return rel.split(path.sep).join('/');
}

export function readFileIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return undefined;
  }
}

export function parseLineArg(arg: string): { line: number; endLine?: number } {
  const m = arg.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) {
    console.error(red(`Invalid line spec: ${arg}. Expected N or N-M.`));
    process.exit(1);
  }
  const line = parseInt(m[1], 10);
  const endLine = m[2] ? parseInt(m[2], 10) : undefined;
  if (endLine !== undefined && endLine < line) {
    console.error(red(`End line ${endLine} must be >= start line ${line}.`));
    process.exit(1);
  }
  return { line, endLine };
}

export function shortId(id: string): string {
  return id.slice(0, 6);
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
