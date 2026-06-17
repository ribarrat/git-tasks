import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AnnotationFile } from '../src/types';

export interface TempRepo {
  root: string;
  cleanup: () => void;
  writeFile: (relPath: string, content: string) => void;
  readFile: (relPath: string) => string;
  readAnnotationFile: (relSourcePath: string) => AnnotationFile;
  git: (...args: string[]) => string;
  commitAll: (message: string) => string;
}

const GIT_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

export function makeTempRepo(): TempRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tasks-test-'));

  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: root,
      env: { ...process.env, ...GIT_ENV },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();

  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');

  const writeFile = (relPath: string, content: string): void => {
    const abs = path.join(root, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };

  const readFile = (relPath: string): string =>
    fs.readFileSync(path.join(root, relPath), 'utf8');

  const readAnnotationFile = (relSourcePath: string): AnnotationFile => {
    const p = path.join(root, '.git-tasks', relSourcePath + '.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')) as AnnotationFile;
  };

  const commitAll = (message: string): string => {
    git('add', '-A');
    git('commit', '-q', '-m', message, '--allow-empty');
    return git('rev-parse', 'HEAD');
  };

  // Seed an initial commit so HEAD always resolves.
  writeFile('README.md', '# test repo\n');
  commitAll('init');

  const cleanup = (): void => {
    fs.rmSync(root, { recursive: true, force: true });
  };

  return { root, cleanup, writeFile, readFile, readAnnotationFile, git, commitAll };
}

/**
 * Path to the compiled CLI entry point, used by integration tests.
 * Tests using this should declare a dependency on `npm run compile`
 * (handled by the `pretest` hook in package.json).
 */
export const CLI_PATH = path.resolve(__dirname, '..', 'out', 'cli', 'index.js');

/**
 * Run the compiled CLI in a given cwd, returning stdout/stderr/exit code.
 * Never throws on non-zero exits — tests assert on the returned code.
 */
export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runCli(cwd: string, args: string[]): CliResult {
  const res = execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    env: { ...process.env, ...GIT_ENV, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
  return { status: 0, stdout: res, stderr: '' };
}

/**
 * Variant of runCli that captures the exit code instead of throwing.
 * Use this when the command is expected to fail.
 */
export function runCliAllowFail(cwd: string, args: string[]): CliResult {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...GIT_ENV, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}
