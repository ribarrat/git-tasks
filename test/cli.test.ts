import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { addEntry, createEntry } from '../src/taskManager';
import { AnnotationEntry } from '../src/types';
import { CLI_PATH, TempRepo, makeTempRepo, runCli, runCliAllowFail } from './helpers';

beforeAll(() => {
  if (!fs.existsSync(CLI_PATH)) {
    throw new Error(
      `Compiled CLI not found at ${CLI_PATH}. Run \`npm run compile\` before \`npm test\`.`,
    );
  }
});

const SAMPLE_PATH = 'src/sample.ts';
const SAMPLE_CONTENT = [
  'function greet(name: string) {',
  '  return `hello, ${name}`;',
  '}',
  '',
  'export const VERSION = 1;',
].join('\n');

function seed(repo: TempRepo, overrides: Partial<AnnotationEntry> = {}): AnnotationEntry {
  const entry = createEntry({
    type: 'task',
    commitSHA: repo.git('rev-parse', 'HEAD'),
    line: 2,
    lineContent: '  return `hello, ${name}`;',
    text: 'Sample task',
    author: 'Test User',
    ...overrides,
  });
  addEntry(repo.root, SAMPLE_PATH, entry);
  return entry;
}

describe('CLI — list / show / update / remove', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT);
    repo.commitAll('seed sample');
  });
  afterEach(() => repo.cleanup());

  it('list --json returns every annotation', () => {
    const e1 = seed(repo, { text: 'first' });
    const e2 = seed(repo, { text: 'second' });
    const { status, stdout } = runCli(repo.root, ['list', '--json']);
    expect(status).toBe(0);
    const rows = JSON.parse(stdout);
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual([e1.id, e2.id].sort());
  });

  it('list filters by --type and --status', () => {
    seed(repo, { type: 'task', status: 'open' });
    seed(repo, { type: 'issue', status: 'resolved' });
    const { stdout } = runCli(repo.root, ['list', '--type', 'issue', '--json']);
    const rows = JSON.parse(stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('issue');
  });

  it('list --mine matches the current git user', () => {
    seed(repo, { assignee: 'test@example.com', text: 'mine' });
    seed(repo, { assignee: 'someone@else.com', text: 'theirs' });
    const { stdout } = runCli(repo.root, ['list', '--mine', '--json']);
    const rows = JSON.parse(stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('mine');
  });

  it('show <id> resolves a short prefix', () => {
    const entry = seed(repo);
    const { status, stdout } = runCli(repo.root, ['show', entry.id.slice(0, 6)]);
    expect(status).toBe(0);
    expect(stdout).toContain(entry.id);
    expect(stdout).toContain('Sample task');
  });

  it('update <id> patches the entry on disk', () => {
    const entry = seed(repo);
    runCli(repo.root, ['update', entry.id, '--status', 'resolved', '--priority', 'high']);
    const reloaded = repo.readAnnotationFile(SAMPLE_PATH);
    expect(reloaded.entries[0].status).toBe('resolved');
    expect(reloaded.entries[0].priority).toBe('high');
  });

  it('remove --force deletes the entry and the file', () => {
    const entry = seed(repo);
    runCli(repo.root, ['remove', entry.id, '--force']);
    const file = path.join(repo.root, '.git-tasks', SAMPLE_PATH + '.json');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('exits non-zero outside of a git repo', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tasks-nonrepo-'));
    try {
      const { status, stderr } = runCliAllowFail(tmp, ['list']);
      expect(status).not.toBe(0);
      expect(stderr).toContain('Not inside a Git repository');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('CLI — reconcile', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT);
    repo.commitAll('seed sample');
  });
  afterEach(() => repo.cleanup());

  it('exits 0 and reports zeros when everything is pinned', () => {
    seed(repo);
    const { status, stdout } = runCli(repo.root, ['reconcile', '--json']);
    expect(status).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.total).toBe(1);
    expect(report.ok).toBe(1);
    expect(report.moved).toHaveLength(0);
  });

  it('auto-applies moved entries when content shifts', () => {
    seed(repo);
    // Insert a new line at the top → shifts everything by 1.
    repo.writeFile(SAMPLE_PATH, '// new header\n' + SAMPLE_CONTENT);
    const { status, stdout } = runCli(repo.root, ['reconcile', '--json']);
    expect(status).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.applied).toBe(1);
    const reloaded = repo.readAnnotationFile(SAMPLE_PATH);
    expect(reloaded.entries[0].line).toBe(3);
  });

  it('--dry-run does not mutate annotation files', () => {
    const entry = seed(repo);
    repo.writeFile(SAMPLE_PATH, '// new header\n' + SAMPLE_CONTENT);
    runCli(repo.root, ['reconcile', '--dry-run', '--json']);
    const reloaded = repo.readAnnotationFile(SAMPLE_PATH);
    expect(reloaded.entries[0].line).toBe(entry.line); // unchanged
  });

  it('exits 1 when entries are orphaned (source file deleted)', () => {
    seed(repo);
    fs.unlinkSync(path.join(repo.root, SAMPLE_PATH));
    const { status, stdout } = runCliAllowFail(repo.root, ['reconcile', '--json']);
    expect(status).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.orphan).toHaveLength(1);
  });
});

describe('CLI — check (CI gate)', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT);
    repo.commitAll('seed sample');
  });
  afterEach(() => repo.cleanup());

  it('exits 0 when there are no failures', () => {
    seed(repo);
    const { status } = runCli(repo.root, ['check']);
    expect(status).toBe(0);
  });

  it('--fail-on orphan trips when source files are missing', () => {
    seed(repo);
    fs.unlinkSync(path.join(repo.root, SAMPLE_PATH));
    const { status, stderr } = runCliAllowFail(repo.root, ['check', '--fail-on', 'orphan']);
    expect(status).toBe(1);
    expect(stderr).toContain('orphan');
  });

  it('--fail-on-open-severity reports matching open entries', () => {
    seed(repo, { severity: 'critical', status: 'open', text: 'leak' });
    const { status, stdout } = runCliAllowFail(repo.root, [
      'check',
      '--fail-on-open-severity',
      'critical',
      '--format',
      'json',
    ]);
    expect(status).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.openHits).toHaveLength(1);
    expect(report.openHits[0].severity).toBe('critical');
  });

  it('--fail-on-open-severity with --base only fails when changed files overlap', () => {
    seed(repo, { severity: 'critical', status: 'open' });
    const baseSha = repo.git('rev-parse', 'HEAD');

    // Modify a different file → critical annotation should not trip.
    repo.writeFile('src/other.ts', 'export const x = 1;\n');
    repo.commitAll('add other file');
    const offScope = runCliAllowFail(repo.root, [
      'check',
      '--fail-on-open-severity',
      'critical',
      '--base',
      baseSha,
    ]);
    expect(offScope.status).toBe(0);

    // Now touch the sample file → critical annotation should trip.
    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT + '\n// touched\n');
    repo.commitAll('touch sample');
    const inScope = runCliAllowFail(repo.root, [
      'check',
      '--fail-on-open-severity',
      'critical',
      '--base',
      baseSha,
    ]);
    expect(inScope.status).toBe(1);
  });
});

describe('CLI — diff', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT);
    repo.commitAll('seed sample');
  });
  afterEach(() => repo.cleanup());

  it('returns only annotations on files changed since base', () => {
    seed(repo, { text: 'sample-annot' });
    addEntry(
      repo.root,
      'src/other.ts',
      createEntry({
        type: 'comment',
        commitSHA: repo.git('rev-parse', 'HEAD'),
        line: 1,
        lineContent: 'x',
        text: 'other-annot',
        author: 'Test User',
      }),
    );
    const baseSha = repo.git('rev-parse', 'HEAD');

    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT + '\n// edit\n');
    repo.commitAll('touch sample only');

    const { status, stdout } = runCli(repo.root, ['diff', '--base', baseSha, '--json']);
    expect(status).toBe(0);
    const hits = JSON.parse(stdout);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('sample-annot');
  });

  it('--github-annotations emits one ::warning::/::error:: per hit', () => {
    seed(repo, { type: 'issue', text: 'real issue' });
    const baseSha = repo.git('rev-parse', 'HEAD');
    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT + '\n// edit\n');
    repo.commitAll('touch');

    const { stdout } = runCli(repo.root, [
      'diff',
      '--base',
      baseSha,
      '--github-annotations',
    ]);
    expect(stdout).toMatch(/^::error file=src\/sample\.ts/m);
    expect(stdout).toContain('real issue');
  });

  it('errors when --base is missing', () => {
    const { status, stderr } = runCliAllowFail(repo.root, ['diff']);
    expect(status).not.toBe(0);
    expect(stderr.toLowerCase()).toContain('base');
  });
});

describe('CLI — purge', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_PATH, SAMPLE_CONTENT);
    repo.commitAll('seed sample');
  });
  afterEach(() => repo.cleanup());

  it('dry run (no --apply) lists candidates without deleting', () => {
    seed(repo, { status: 'resolved', text: 'done task' });
    seed(repo, { status: 'open', text: 'still open' });
    const { status, stdout } = runCli(repo.root, ['purge']);
    expect(status).toBe(0);
    expect(stdout).toContain('done task');
    expect(stdout).not.toContain('still open');
    // Entry still on disk
    const remaining = runCli(repo.root, ['list', '--json']);
    expect(JSON.parse(remaining.stdout)).toHaveLength(2);
  });

  it('--apply removes resolved and closed tasks', () => {
    const r = seed(repo, { status: 'resolved', text: 'resolved task' });
    const c = seed(repo, { status: 'closed', text: 'closed task' });
    seed(repo, { status: 'open', text: 'open task' });
    const { status, stdout } = runCliAllowFail(repo.root, ['purge', '--apply', '--force']);
    expect(status).toBe(0);
    expect(stdout).toContain('Purged 2');
    const remaining = JSON.parse(runCli(repo.root, ['list', '--json']).stdout);
    expect(remaining.map((e: { id: string }) => e.id)).not.toContain(r.id);
    expect(remaining.map((e: { id: string }) => e.id)).not.toContain(c.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('open task');
  });

  it('--status limits which statuses are purged', () => {
    seed(repo, { status: 'resolved', text: 'resolved' });
    seed(repo, { status: 'closed', text: 'closed' });
    runCliAllowFail(repo.root, ['purge', '--apply', '--force', '--status', 'resolved']);
    const remaining = JSON.parse(runCli(repo.root, ['list', '--json']).stdout);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].status).toBe('closed');
  });

  it('--older-than skips recently updated tasks', () => {
    seed(repo, { status: 'resolved', text: 'fresh resolved' });
    const { stdout } = runCli(repo.root, ['purge', '--older-than', '30']);
    expect(stdout).toContain('nothing to purge');
  });

  it('--json outputs matched tasks before deletion', () => {
    seed(repo, { status: 'resolved', text: 'to purge' });
    const { stdout } = runCli(repo.root, ['purge', '--json']);
    const hits = JSON.parse(stdout);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe('resolved');
  });

  it('reports nothing to purge when no candidates match', () => {
    seed(repo, { status: 'open' });
    const { status, stdout } = runCli(repo.root, ['purge']);
    expect(status).toBe(0);
    expect(stdout).toContain('nothing to purge');
  });
});
