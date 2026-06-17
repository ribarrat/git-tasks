import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findRepoRoot,
  getCurrentCommitSHA,
  getFileAtCommit,
  getRepoRoot,
  getUserEmail,
  getUserName,
  isCurrentUser,
  isGitRepo,
} from '../src/gitHelper';
import { TempRepo, makeTempRepo } from './helpers';

describe('gitHelper — repository detection', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => repo.cleanup());

  it('isGitRepo returns true inside a repo, false outside', () => {
    expect(isGitRepo(repo.root)).toBe(true);
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tasks-nonrepo-'));
    try {
      expect(isGitRepo(nonRepo)).toBe(false);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it('getRepoRoot returns the repo root from within a subdirectory', () => {
    const sub = path.join(repo.root, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const root = getRepoRoot(sub);
    // git normalizes paths; macOS may resolve /var → /private/var via symlinks.
    expect(fs.realpathSync(root!)).toBe(fs.realpathSync(repo.root));
  });

  it('findRepoRoot walks up to the directory containing .git', () => {
    const sub = path.join(repo.root, 'a', 'b', 'c');
    fs.mkdirSync(sub, { recursive: true });
    expect(findRepoRoot(sub)).toBe(repo.root);
  });

  it('findRepoRoot returns undefined when no .git ancestor exists', () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tasks-nonrepo-'));
    try {
      expect(findRepoRoot(nonRepo)).toBeUndefined();
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });
});

describe('gitHelper — commit and user metadata', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => repo.cleanup());

  it('getCurrentCommitSHA returns the HEAD SHA', () => {
    const sha = getCurrentCommitSHA(repo.root);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sha).toBe(repo.git('rev-parse', 'HEAD'));
  });

  it('getCurrentCommitSHA falls back to zero-SHA in an empty repo', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tasks-empty-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
      expect(getCurrentCommitSHA(empty)).toBe('0'.repeat(40));
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('getUserName / getUserEmail read git config', () => {
    expect(getUserName(repo.root)).toBe('Test User');
    expect(getUserEmail(repo.root)).toBe('test@example.com');
  });

  it('isCurrentUser matches case-insensitively on name or email', () => {
    expect(isCurrentUser(repo.root, 'test user')).toBe(true);
    expect(isCurrentUser(repo.root, 'TEST@EXAMPLE.COM')).toBe(true);
    expect(isCurrentUser(repo.root, 'someone-else')).toBe(false);
    expect(isCurrentUser(repo.root, '')).toBe(false);
    expect(isCurrentUser(repo.root, undefined)).toBe(false);
  });
});

describe('gitHelper — getFileAtCommit', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => repo.cleanup());

  it('returns the file content at a given commit', () => {
    repo.writeFile('src/x.ts', 'version 1\n');
    const sha1 = repo.commitAll('add x v1');
    repo.writeFile('src/x.ts', 'version 2\n');
    repo.commitAll('bump x');

    expect(getFileAtCommit(repo.root, sha1, 'src/x.ts')?.trim()).toBe('version 1');
    expect(getFileAtCommit(repo.root, 'HEAD', 'src/x.ts')?.trim()).toBe('version 2');
  });

  it('returns undefined for a non-existent path', () => {
    expect(getFileAtCommit(repo.root, 'HEAD', 'nope.ts')).toBeUndefined();
  });
});
