import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BEGIN_MARK,
  HOOK_NAMES,
  hookIsManaged,
  hooksInstalled,
  installHooks,
  uninstallHooks,
} from '../src/hooks';
import { TempRepo, makeTempRepo } from './helpers';

describe('hooks module', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => repo.cleanup());

  const hookPath = (name: string) => path.join(repo.root, '.git', 'hooks', name);

  it('installs all three managed hooks as executable files', () => {
    const actions = installHooks(repo.root, 'git-tasks');
    for (const name of HOOK_NAMES) {
      expect(actions[name]).toBe('created');
      const p = hookPath(name);
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.readFileSync(p, 'utf8')).toContain('git-tasks reconcile');
      // owner-executable
      expect(fs.statSync(p).mode & 0o100).toBeTruthy();
    }
    expect(hooksInstalled(repo.root)).toBe(true);
  });

  it('reports not-installed when only some hooks are present', () => {
    installHooks(repo.root, 'git-tasks');
    fs.unlinkSync(hookPath('pre-commit'));
    expect(hooksInstalled(repo.root)).toBe(false);
    expect(hookIsManaged(repo.root, 'post-merge')).toBe(true);
  });

  it('is idempotent — reinstalling does not duplicate the managed block', () => {
    installHooks(repo.root, 'git-tasks');
    const actions = installHooks(repo.root, 'git-tasks');
    expect(actions['post-merge']).toBe('updated');
    const body = fs.readFileSync(hookPath('post-merge'), 'utf8');
    expect(body.split(BEGIN_MARK).length - 1).toBe(1);
  });

  it('preserves unmanaged content already in a hook', () => {
    const p = hookPath('pre-commit');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '#!/bin/sh\necho "my own check"\n', 'utf8');

    installHooks(repo.root, 'git-tasks');
    expect(fs.readFileSync(p, 'utf8')).toContain('echo "my own check"');

    uninstallHooks(repo.root);
    const after = fs.readFileSync(p, 'utf8');
    expect(after).toContain('echo "my own check"');
    expect(after).not.toContain(BEGIN_MARK);
  });

  it('pre-commit distinguishes an unrunnable CLI from stale annotations', () => {
    installHooks(repo.root, 'git-tasks');
    const body = fs.readFileSync(hookPath('pre-commit'), 'utf8');
    // A missing or non-executable binary exits 126/127 via the shell; that must
    // not be reported as an annotation problem.
    expect(body).toContain('126');
    expect(body).toContain('127');
    expect(body).toMatch(/skipping annotation check/);
  });

  it('pre-commit exits 0 when the CLI cannot be executed', () => {
    // Point the hook at a file that exists but is not executable.
    const fake = path.join(repo.root, 'not-executable');
    fs.writeFileSync(fake, 'echo nope\n', 'utf8');
    fs.chmodSync(fake, 0o644);
    installHooks(repo.root, fake);

    const res = spawnSync('/bin/sh', [hookPath('pre-commit')], {
      cwd: repo.root,
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(res.stderr).toContain('skipping annotation check');
  });

  it('uninstall removes hooks it fully owns and reports what it touched', () => {
    installHooks(repo.root, 'git-tasks');
    const removed = uninstallHooks(repo.root);
    expect(removed.sort()).toEqual([...HOOK_NAMES].sort());
    expect(fs.existsSync(hookPath('post-merge'))).toBe(false);
    expect(hooksInstalled(repo.root)).toBe(false);
    // A second pass has nothing left to do.
    expect(uninstallHooks(repo.root)).toEqual([]);
  });
});
