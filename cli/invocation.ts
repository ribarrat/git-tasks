import { execSync } from 'node:child_process';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Returns a shell-ready invocation of this CLI for embedding in git hooks
 * or git config (e.g. merge driver). Prefers the `git-tasks` binary on PATH;
 * falls back to an absolute `node /abs/path/to/index.js` invocation.
 */
export function gitTasksInvocation(): string {
  try {
    execSync('command -v git-tasks >/dev/null 2>&1', { shell: '/bin/sh' });
    return 'git-tasks';
  } catch {
    return `${shellQuote(process.execPath)} ${shellQuote(process.argv[1])}`;
  }
}
