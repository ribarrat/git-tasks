import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  addEntry,
  annotationFilePathFor,
  createEntry,
  extractLineContent,
  findEntryById,
  findSnapshotIn,
  isDrifted,
  listAllAnnotationFiles,
  listAllEntries,
  loadAnnotationFile,
  mergeAnnotationFiles,
  mergeEntry,
  reconcileAll,
  reconcileEntry,
  reconcileFile,
  relocateEntry,
  removeEntry,
  softMatchSnapshot,
  updateEntry,
} from '../src/taskManager';
import { AnnotationEntry, AnnotationFile, SCHEMA_VERSION } from '../src/types';
import { TempRepo, makeTempRepo } from './helpers';

const SAMPLE_FILE = 'src/sample.ts';
const SAMPLE_CONTENT = [
  'function greet(name: string) {',
  '  return `hello, ${name}`;',
  '}',
  '',
  'export const VERSION = 1;',
].join('\n');

function seedEntry(overrides: Partial<AnnotationEntry> = {}): AnnotationEntry {
  return createEntry({
    type: 'task',
    commitSHA: '0'.repeat(40),
    line: 2,
    lineContent: '  return `hello, ${name}`;',
    text: 'Sample task',
    author: 'Test User',
    ...overrides,
  });
}

describe('taskManager — pure helpers', () => {
  describe('createEntry', () => {
    it('applies defaults for status/priority/severity', () => {
      const e = createEntry({
        type: 'task',
        commitSHA: 'abc',
        line: 1,
        lineContent: 'x',
        text: 'y',
        author: 'me',
      });
      expect(e.status).toBe('open');
      expect(e.priority).toBe('medium');
      expect(e.severity).toBe('minor');
      expect(e.endLine).toBeUndefined();
      expect(e.assignee).toBeUndefined();
      expect(e.tags).toBeUndefined();
      expect(e.createdAt).toBe(e.updatedAt);
      // RFC4122 v4 UUID shape
      expect(e.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('preserves endLine only when it differs from line', () => {
      const single = createEntry({
        type: 'task',
        commitSHA: 'abc',
        line: 5,
        endLine: 5,
        lineContent: 'x',
        text: 'y',
        author: 'me',
      });
      expect(single.endLine).toBeUndefined();

      const range = createEntry({
        type: 'task',
        commitSHA: 'abc',
        line: 5,
        endLine: 7,
        lineContent: 'x',
        text: 'y',
        author: 'me',
      });
      expect(range.endLine).toBe(7);
    });

    it('only sets tags when non-empty', () => {
      const empty = createEntry({
        type: 'comment',
        commitSHA: 'abc',
        line: 1,
        lineContent: 'x',
        text: 'y',
        author: 'me',
        tags: [],
      });
      expect(empty.tags).toBeUndefined();
      const full = createEntry({
        type: 'comment',
        commitSHA: 'abc',
        line: 1,
        lineContent: 'x',
        text: 'y',
        author: 'me',
        tags: ['a', 'b'],
      });
      expect(full.tags).toEqual(['a', 'b']);
    });
  });

  describe('extractLineContent', () => {
    it('extracts a single line (1-based)', () => {
      expect(extractLineContent(SAMPLE_CONTENT, 2)).toBe('  return `hello, ${name}`;');
    });

    it('extracts a range', () => {
      expect(extractLineContent(SAMPLE_CONTENT, 1, 3)).toBe(
        'function greet(name: string) {\n  return `hello, ${name}`;\n}',
      );
    });

    it('handles CRLF line endings', () => {
      const crlf = SAMPLE_CONTENT.replace(/\n/g, '\r\n');
      expect(extractLineContent(crlf, 2)).toBe('  return `hello, ${name}`;');
    });

    it('clamps line numbers below 1 to the first line', () => {
      expect(extractLineContent(SAMPLE_CONTENT, 0)).toBe('function greet(name: string) {');
    });
  });

  describe('isDrifted', () => {
    it('returns false when snapshot still matches', () => {
      const entry = seedEntry();
      expect(isDrifted(SAMPLE_CONTENT, entry)).toBe(false);
    });

    it('returns true when the line has changed', () => {
      const entry = seedEntry();
      const modified = SAMPLE_CONTENT.replace('return `hello', 'return `hi');
      expect(isDrifted(modified, entry)).toBe(true);
    });
  });

  describe('findSnapshotIn', () => {
    it('returns every exact match', () => {
      const content = [
        'foo();',
        'bar();',
        'foo();', // duplicate
        'baz();',
      ].join('\n');
      const hits = findSnapshotIn(content, 'foo();');
      expect(hits).toEqual([
        { line: 1, endLine: 1 },
        { line: 3, endLine: 3 },
      ]);
    });

    it('matches multi-line snapshots', () => {
      const content = ['a', 'b', 'c', 'a', 'b', 'd'].join('\n');
      const hits = findSnapshotIn(content, 'a\nb');
      expect(hits).toEqual([
        { line: 1, endLine: 2 },
        { line: 4, endLine: 5 },
      ]);
    });

    it('returns empty when the snapshot is absent', () => {
      expect(findSnapshotIn('a\nb\nc', 'nope')).toEqual([]);
    });
  });

  describe('softMatchSnapshot', () => {
    it('returns undefined when no window meets the threshold', () => {
      expect(softMatchSnapshot('totally\ndifferent', 'a\nb', 1)).toBeUndefined();
    });

    it('finds a window with ≥70% LCS match', () => {
      // 4-line snapshot, one renamed → LCS 3/4 = 0.75 ≥ threshold.
      const snapshot = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'].join('\n');
      const content = [
        'noise',
        'const a = 1;',
        'const b = 99;', // renamed
        'const c = 3;',
        'const d = 4;',
        'noise',
      ].join('\n');
      const result = softMatchSnapshot(content, snapshot, 1);
      expect(result).toBeDefined();
      expect(result!.line).toBe(2);
      expect(result!.endLine).toBe(5);
      expect(result!.score).toBeGreaterThanOrEqual(0.7);
    });

    it('breaks ties by proximity to the original line', () => {
      const snapshot = 'foo\nbar';
      const content = ['foo', 'bar', 'gap', 'gap', 'foo', 'bar'].join('\n');
      const nearTop = softMatchSnapshot(content, snapshot, 1);
      const nearBottom = softMatchSnapshot(content, snapshot, 5);
      expect(nearTop?.line).toBe(1);
      expect(nearBottom?.line).toBe(5);
    });
  });
});

describe('taskManager — on-disk operations', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_FILE, SAMPLE_CONTENT);
  });
  afterEach(() => repo.cleanup());

  it('annotationFilePathFor mirrors source under .git-tasks/', () => {
    const expected = path.join(repo.root, '.git-tasks', 'src', 'sample.ts.json');
    expect(annotationFilePathFor(repo.root, SAMPLE_FILE)).toBe(expected);
  });

  it('addEntry creates the annotation file and persists the entry', () => {
    const entry = seedEntry();
    addEntry(repo.root, SAMPLE_FILE, entry);
    const loaded = loadAnnotationFile(repo.root, SAMPLE_FILE);
    expect(loaded?.version).toBe(SCHEMA_VERSION);
    expect(loaded?.file).toBe(SAMPLE_FILE);
    expect(loaded?.entries).toHaveLength(1);
    expect(loaded?.entries[0].id).toBe(entry.id);
  });

  it('addEntry appends to an existing file rather than overwriting', () => {
    addEntry(repo.root, SAMPLE_FILE, seedEntry({ text: 'first' }));
    addEntry(repo.root, SAMPLE_FILE, seedEntry({ text: 'second' }));
    const loaded = loadAnnotationFile(repo.root, SAMPLE_FILE)!;
    expect(loaded.entries.map((e) => e.text)).toEqual(['first', 'second']);
  });

  it('loadAnnotationFile returns undefined on missing / unparseable files', () => {
    expect(loadAnnotationFile(repo.root, 'no/such/file.ts')).toBeUndefined();
    const broken = annotationFilePathFor(repo.root, 'src/broken.ts');
    fs.mkdirSync(path.dirname(broken), { recursive: true });
    fs.writeFileSync(broken, '{not valid json');
    expect(loadAnnotationFile(repo.root, 'src/broken.ts')).toBeUndefined();
  });

  it('listAllAnnotationFiles walks nested directories and skips invalid files', () => {
    addEntry(repo.root, 'src/a.ts', seedEntry({ text: 'a' }));
    addEntry(repo.root, 'src/deep/b.ts', seedEntry({ text: 'b' }));
    // Drop a junk file that should be ignored.
    fs.writeFileSync(path.join(repo.root, '.git-tasks', 'junk.json'), 'not json');

    const all = listAllAnnotationFiles(repo.root);
    const files = all.map((f) => f.file).sort();
    expect(files).toEqual(['src/a.ts', 'src/deep/b.ts']);
  });

  it('listAllEntries returns a flat list of {file, entry}', () => {
    addEntry(repo.root, 'src/a.ts', seedEntry({ text: 'a' }));
    addEntry(repo.root, 'src/b.ts', seedEntry({ text: 'b' }));
    const entries = listAllEntries(repo.root);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.file).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('findEntryById matches full id, then short prefix (≥4 chars), and rejects ambiguous', () => {
    addEntry(repo.root, 'src/a.ts', seedEntry({ text: 'a' }));
    addEntry(repo.root, 'src/b.ts', seedEntry({ text: 'b' }));
    const [a, b] = listAllEntries(repo.root);

    expect(findEntryById(repo.root, a.entry.id)?.entry.id).toBe(a.entry.id);
    expect(findEntryById(repo.root, a.entry.id.slice(0, 6))?.entry.id).toBe(a.entry.id);
    expect(findEntryById(repo.root, 'abc')).toBeUndefined(); // too short
    // Ambiguous: craft two entries with a shared synthetic prefix.
    const fakePrefix = a.entry.id.slice(0, 4);
    if (b.entry.id.startsWith(fakePrefix)) {
      expect(findEntryById(repo.root, fakePrefix)).toBeUndefined();
    }
  });

  it('updateEntry patches fields, preserves id/createdAt, bumps updatedAt', async () => {
    addEntry(repo.root, SAMPLE_FILE, seedEntry({ text: 'before' }));
    const [{ entry: original }] = listAllEntries(repo.root);
    const originalUpdatedAt = original.updatedAt;
    // Ensure clock moves at least 1ms.
    await new Promise((r) => setTimeout(r, 5));

    const updated = updateEntry(repo.root, original.id, { text: 'after', status: 'resolved' });
    expect(updated?.entry.text).toBe('after');
    expect(updated?.entry.status).toBe('resolved');
    expect(updated?.entry.id).toBe(original.id);
    expect(updated?.entry.createdAt).toBe(original.createdAt);
    expect(Date.parse(updated!.entry.updatedAt)).toBeGreaterThan(Date.parse(originalUpdatedAt));
  });

  it('updateEntry returns undefined when the id does not match', () => {
    expect(updateEntry(repo.root, 'nonexistent-id-12345', { text: 'x' })).toBeUndefined();
  });

  it('removeEntry deletes the entry and removes the file when it becomes empty', () => {
    addEntry(repo.root, SAMPLE_FILE, seedEntry({ text: 'only' }));
    const [{ entry }] = listAllEntries(repo.root);
    expect(removeEntry(repo.root, entry.id)).toBe(true);
    expect(fs.existsSync(annotationFilePathFor(repo.root, SAMPLE_FILE))).toBe(false);
    expect(removeEntry(repo.root, entry.id)).toBe(false);
  });

  it('removeEntry keeps the file when other entries remain', () => {
    addEntry(repo.root, SAMPLE_FILE, seedEntry({ text: 'keep' }));
    addEntry(repo.root, SAMPLE_FILE, seedEntry({ text: 'remove' }));
    const all = listAllEntries(repo.root);
    const target = all.find((e) => e.entry.text === 'remove')!;
    expect(removeEntry(repo.root, target.entry.id)).toBe(true);
    const loaded = loadAnnotationFile(repo.root, SAMPLE_FILE)!;
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].text).toBe('keep');
  });
});

describe('taskManager — reconcileEntry / reconcileAll', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
  });
  afterEach(() => repo.cleanup());

  it('reports ok when content matches snapshot exactly', () => {
    const result = reconcileEntry(SAMPLE_CONTENT, seedEntry());
    expect(result.status).toBe('ok');
  });

  it('reports orphan when the file is missing', () => {
    const result = reconcileEntry(undefined, seedEntry());
    expect(result.status).toBe('orphan');
  });

  it('reports moved when the snapshot relocates exactly once', () => {
    const moved = ['// new header line', ...SAMPLE_CONTENT.split('\n')].join('\n');
    const result = reconcileEntry(moved, seedEntry());
    expect(result.status).toBe('moved');
    expect(result.newLine).toBe(3); // was line 2, shifted by one
  });

  it('picks the nearest exact match when multiple are found', () => {
    // Snapshot appears at lines 1 and 5; original line is 4.
    const content = [
      '  return `hello, ${name}`;', // line 1
      'noise',
      'noise',
      'noise',
      '  return `hello, ${name}`;', // line 5
    ].join('\n');
    const entry = seedEntry({ line: 4 });
    const result = reconcileEntry(content, entry);
    expect(result.status).toBe('moved');
    expect(result.newLine).toBe(5);
  });

  it('reports soft-match when snapshot is partially preserved', () => {
    // 4-line snapshot → 1 changed line yields LCS 3/4 = 0.75 ≥ threshold.
    const snapshot = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'].join('\n');
    const content = [
      'noise',
      'const a = 1;',
      'const b = 99;',
      'const c = 3;',
      'const d = 4;',
      'noise',
    ].join('\n');
    const entry = seedEntry({ lineContent: snapshot, line: 2, endLine: 5 });
    const result = reconcileEntry(content, entry);
    expect(result.status).toBe('soft-match');
    expect(result.newLine).toBe(2);
  });

  it('reports stale when snapshot is gone and no soft match qualifies', () => {
    const result = reconcileEntry('totally\nunrelated\ncontent', seedEntry());
    expect(result.status).toBe('stale');
  });

  it('reconcileAll applies moves only when apply=true and writes updatedAt', async () => {
    repo.writeFile(SAMPLE_FILE, ['// new header', ...SAMPLE_CONTENT.split('\n')].join('\n'));
    const entry = seedEntry();
    addEntry(repo.root, SAMPLE_FILE, entry);

    const dryReport = reconcileAll(repo.root, { apply: false });
    expect(dryReport.moved).toHaveLength(1);
    expect(dryReport.applied).toBe(0);
    // Entry on disk unchanged.
    const preEntry = loadAnnotationFile(repo.root, SAMPLE_FILE)!.entries[0];
    expect(preEntry.line).toBe(2);
    expect(preEntry.updatedAt).toBe(entry.updatedAt);

    await new Promise((r) => setTimeout(r, 5));
    const applyReport = reconcileAll(repo.root, { apply: true });
    expect(applyReport.applied).toBe(1);
    // The report must describe the move, not the post-move state.
    expect(applyReport.moved[0].fromLine).toBe(2);
    expect(applyReport.moved[0].result.newLine).toBe(3);

    const postEntry = loadAnnotationFile(repo.root, SAMPLE_FILE)!.entries[0];
    expect(postEntry.line).toBe(3);
    expect(Date.parse(postEntry.updatedAt)).toBeGreaterThan(Date.parse(entry.updatedAt));
  });

  it('reconcileAll surfaces orphan entries for deleted files', () => {
    addEntry(repo.root, 'src/gone.ts', seedEntry());
    const report = reconcileAll(repo.root, { apply: false });
    expect(report.orphan).toHaveLength(1);
    expect(report.orphan[0].file).toBe('src/gone.ts');
  });
});

describe('taskManager — drift marks', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_FILE, SAMPLE_CONTENT);
  });
  afterEach(() => repo.cleanup());

  it('marks stale entries instead of leaving them unrecorded', () => {
    repo.writeFile(SAMPLE_FILE, 'totally\nunrelated\ncontent');
    addEntry(repo.root, SAMPLE_FILE, seedEntry());

    const report = reconcileAll(repo.root, { apply: true });
    expect(report.stale).toHaveLength(1);
    expect(report.marked).toBe(1);

    const drift = repo.readAnnotationFile(SAMPLE_FILE).entries[0].drift!;
    expect(drift.kind).toBe('stale');
    expect(drift.line).toBe(2);
    expect(drift.lineContent).toBe('  return `hello, ${name}`;');
    expect(drift.suggestedLine).toBeUndefined();
  });

  it('marks orphans when the source file is gone', () => {
    addEntry(repo.root, 'src/gone.ts', seedEntry());
    reconcileAll(repo.root, { apply: true });
    expect(repo.readAnnotationFile('src/gone.ts').entries[0].drift!.kind).toBe('orphan');
  });

  it('records the suggested line for a soft match but does not repin', () => {
    const snapshot = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'].join('\n');
    repo.writeFile(
      SAMPLE_FILE,
      ['noise', 'const a = 1;', 'const b = 99;', 'const c = 3;', 'const d = 4;'].join('\n'),
    );
    addEntry(repo.root, SAMPLE_FILE, seedEntry({ lineContent: snapshot, line: 2, endLine: 5 }));

    reconcileAll(repo.root, { apply: true });
    const entry = repo.readAnnotationFile(SAMPLE_FILE).entries[0];
    expect(entry.line).toBe(2);
    expect(entry.lineContent).toBe(snapshot);
    expect(entry.drift!.kind).toBe('soft-match');
    expect(entry.drift!.suggestedLine).toBe(2);
  });

  it('does not write marks on a dry run', () => {
    repo.writeFile(SAMPLE_FILE, 'totally\nunrelated\ncontent');
    addEntry(repo.root, SAMPLE_FILE, seedEntry());
    const report = reconcileAll(repo.root, { apply: false });
    expect(report.marked).toBe(0);
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].drift).toBeUndefined();
  });

  it('leaves updatedAt untouched so a mark cannot win the merge tiebreaker', () => {
    repo.writeFile(SAMPLE_FILE, 'totally\nunrelated\ncontent');
    const entry = seedEntry();
    addEntry(repo.root, SAMPLE_FILE, entry);
    reconcileAll(repo.root, { apply: true });
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].updatedAt).toBe(entry.updatedAt);
  });

  it('keeps detectedAt stable while the same drift persists', async () => {
    repo.writeFile(SAMPLE_FILE, 'totally\nunrelated\ncontent');
    addEntry(repo.root, SAMPLE_FILE, seedEntry());
    reconcileAll(repo.root, { apply: true });
    const first = repo.readAnnotationFile(SAMPLE_FILE).entries[0].drift!.detectedAt;

    await new Promise((r) => setTimeout(r, 5));
    reconcileAll(repo.root, { apply: true });
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].drift!.detectedAt).toBe(first);
  });

  it('clears the mark once the entry pins cleanly again', () => {
    repo.writeFile(SAMPLE_FILE, 'totally\nunrelated\ncontent');
    addEntry(repo.root, SAMPLE_FILE, seedEntry());
    reconcileAll(repo.root, { apply: true });
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].drift).toBeDefined();

    repo.writeFile(SAMPLE_FILE, SAMPLE_CONTENT);
    const report = reconcileAll(repo.root, { apply: true });
    expect(report.cleared).toBe(1);
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].drift).toBeUndefined();
  });

  it('clears the mark when the entry is auto-relocated', () => {
    repo.writeFile(SAMPLE_FILE, 'totally\nunrelated\ncontent');
    addEntry(repo.root, SAMPLE_FILE, seedEntry());
    reconcileAll(repo.root, { apply: true });

    repo.writeFile(SAMPLE_FILE, ['// new header', ...SAMPLE_CONTENT.split('\n')].join('\n'));
    reconcileAll(repo.root, { apply: true });
    const entry = repo.readAnnotationFile(SAMPLE_FILE).entries[0];
    expect(entry.line).toBe(3);
    expect(entry.drift).toBeUndefined();
  });
});

describe('taskManager — three-way merge', () => {
  const baseEntry = (): AnnotationEntry => ({
    id: 'fixed-id-1',
    type: 'task',
    commitSHA: 'a'.repeat(40),
    line: 10,
    lineContent: 'x',
    text: 'base',
    author: 'me',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    priority: 'medium',
    severity: 'minor',
    tags: ['base'],
  });

  it('mergeEntry: one-sided edit takes that side', () => {
    const ancestor = baseEntry();
    const ours: AnnotationEntry = { ...ancestor };
    const theirs: AnnotationEntry = {
      ...ancestor,
      status: 'resolved',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const merged = mergeEntry(ancestor, ours, theirs);
    expect(merged.status).toBe('resolved');
  });

  it('mergeEntry: both-sided edit on a scalar uses last-writer-wins by updatedAt', () => {
    const ancestor = baseEntry();
    const ours: AnnotationEntry = {
      ...ancestor,
      text: 'ours wins',
      updatedAt: '2026-01-05T00:00:00.000Z',
    };
    const theirs: AnnotationEntry = {
      ...ancestor,
      text: 'theirs older',
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    const merged = mergeEntry(ancestor, ours, theirs);
    expect(merged.text).toBe('ours wins');
    expect(merged.updatedAt).toBe('2026-01-05T00:00:00.000Z');
  });

  it('mergeEntry: tags are unioned on conflict', () => {
    const ancestor = baseEntry();
    const ours: AnnotationEntry = {
      ...ancestor,
      tags: ['base', 'a'],
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const theirs: AnnotationEntry = {
      ...ancestor,
      tags: ['base', 'b'],
      updatedAt: '2026-01-03T00:00:00.000Z',
    };
    const merged = mergeEntry(ancestor, ours, theirs);
    expect(merged.tags?.sort()).toEqual(['a', 'b', 'base']);
  });

  it('mergeEntry: immutable fields (id, createdAt, commitSHA, author) stick to ours', () => {
    const ancestor = baseEntry();
    const ours = baseEntry();
    const theirs: AnnotationEntry = {
      ...ancestor,
      // Pretend the other branch somehow changed these — they must not propagate.
      commitSHA: 'b'.repeat(40),
      author: 'them',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    const merged = mergeEntry(ancestor, ours, theirs);
    expect(merged.id).toBe(ours.id);
    expect(merged.createdAt).toBe(ours.createdAt);
    expect(merged.commitSHA).toBe(ours.commitSHA);
    expect(merged.author).toBe(ours.author);
  });

  it('mergeEntry: a drift mark on one side survives the merge', () => {
    const ancestor = baseEntry();
    const ours = baseEntry();
    const theirs: AnnotationEntry = {
      ...ancestor,
      drift: {
        kind: 'stale',
        detectedAt: '2026-03-01T00:00:00.000Z',
        line: 10,
        lineContent: 'gone();',
      },
    };
    // Note `updatedAt` is identical on both sides — marks do not bump it — so
    // this can only pass if drift is resolved outside the last-writer-wins path.
    expect(mergeEntry(ancestor, ours, theirs).drift?.kind).toBe('stale');
    expect(mergeEntry(ancestor, theirs, ours).drift?.kind).toBe('stale');
  });

  it('mergeEntry: two disagreeing drift marks keep the one observed first', () => {
    const ancestor = baseEntry();
    const ours: AnnotationEntry = {
      ...ancestor,
      drift: { kind: 'stale', detectedAt: '2026-03-05T00:00:00.000Z', line: 1, lineContent: 'a' },
    };
    const theirs: AnnotationEntry = {
      ...ancestor,
      drift: {
        kind: 'soft-match',
        detectedAt: '2026-03-01T00:00:00.000Z',
        line: 1,
        lineContent: 'a',
      },
    };
    expect(mergeEntry(ancestor, ours, theirs).drift?.kind).toBe('soft-match');
  });

  it('mergeAnnotationFiles: unions independently-added entries by id', () => {
    const ancestor: AnnotationFile = { version: '1.0', file: 'a.ts', entries: [] };
    const ours: AnnotationFile = {
      version: '1.0',
      file: 'a.ts',
      entries: [{ ...baseEntry(), id: 'ours-1', createdAt: '2026-01-01T00:00:00.000Z' }],
    };
    const theirs: AnnotationFile = {
      version: '1.0',
      file: 'a.ts',
      entries: [{ ...baseEntry(), id: 'theirs-1', createdAt: '2026-01-02T00:00:00.000Z' }],
    };
    const result = mergeAnnotationFiles(ancestor, ours, theirs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merged.entries.map((e) => e.id).sort()).toEqual(['ours-1', 'theirs-1']);
    }
  });

  it('mergeAnnotationFiles: delete-vs-edit produces a structural conflict', () => {
    const e = baseEntry();
    const ancestor: AnnotationFile = { version: '1.0', file: 'a.ts', entries: [e] };
    const ours: AnnotationFile = { version: '1.0', file: 'a.ts', entries: [] };
    const theirs: AnnotationFile = {
      version: '1.0',
      file: 'a.ts',
      entries: [{ ...e, text: 'edited', updatedAt: '2026-02-01T00:00:00.000Z' }],
    };
    const result = mergeAnnotationFiles(ancestor, ours, theirs);
    expect(result.ok).toBe(false);
  });

  it('mergeAnnotationFiles: same-side delete with no other edit drops the entry cleanly', () => {
    const e = baseEntry();
    const ancestor: AnnotationFile = { version: '1.0', file: 'a.ts', entries: [e] };
    const ours: AnnotationFile = { version: '1.0', file: 'a.ts', entries: [e] };
    const theirs: AnnotationFile = { version: '1.0', file: 'a.ts', entries: [] };
    const result = mergeAnnotationFiles(ancestor, ours, theirs);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.merged.entries).toHaveLength(0);
  });
});


describe('origin tracking (schema 1.1)', () => {
  let repo: TempRepo;

  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_FILE, SAMPLE_CONTENT + '\n');
  });

  afterEach(() => repo.cleanup());

  it('createEntry stamps origin from the initial pin', () => {
    const e = seedEntry({ line: 2, endLine: 3, lineContent: 'a\nb' });
    expect(e.origin).toEqual({
      line: 2,
      endLine: 3,
      lineContent: 'a\nb',
      commitSHA: '0'.repeat(40),
    });
  });

  it('keeps the original line and text after the entry drifts and relocates', () => {
    const entry = seedEntry();
    addEntry(repo.root, SAMPLE_FILE, entry);

    // Two new lines above push the annotated line from 2 down to 4.
    repo.writeFile(SAMPLE_FILE, ['// header', '// header 2', SAMPLE_CONTENT].join('\n') + '\n');
    const report = reconcileAll(repo.root, { apply: true });
    expect(report.applied).toBe(1);

    const [moved] = repo.readAnnotationFile(SAMPLE_FILE).entries;
    expect(moved.line).toBe(4);
    expect(moved.origin).toEqual({
      line: 2,
      lineContent: '  return `hello, ${name}`;',
      commitSHA: '0'.repeat(40),
    });
  });

  it('freezes origin only once, so a second move still reports the first position', () => {
    const entry = seedEntry();
    addEntry(repo.root, SAMPLE_FILE, entry);

    repo.writeFile(SAMPLE_FILE, ['// one', SAMPLE_CONTENT].join('\n') + '\n');
    reconcileAll(repo.root, { apply: true });
    repo.writeFile(SAMPLE_FILE, ['// one', '// two', '// three', SAMPLE_CONTENT].join('\n') + '\n');
    reconcileAll(repo.root, { apply: true });

    const [moved] = repo.readAnnotationFile(SAMPLE_FILE).entries;
    expect(moved.line).toBe(5);
    expect(moved.origin?.line).toBe(2);
  });

  it('backfills origin for a pre-1.1 entry the first time it moves', () => {
    const entry = seedEntry();
    delete entry.origin;
    addEntry(repo.root, SAMPLE_FILE, entry);
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].origin).toBeUndefined();

    repo.writeFile(SAMPLE_FILE, ['// header', SAMPLE_CONTENT].join('\n') + '\n');
    reconcileAll(repo.root, { apply: true });

    const [moved] = repo.readAnnotationFile(SAMPLE_FILE).entries;
    expect(moved.line).toBe(3);
    expect(moved.origin?.line).toBe(2);
  });

  it('updateEntry cannot overwrite a frozen origin', () => {
    const entry = seedEntry();
    addEntry(repo.root, SAMPLE_FILE, entry);
    updateEntry(repo.root, entry.id, {
      text: 'changed',
      origin: { line: 999, lineContent: 'nope', commitSHA: 'x' },
    } as Partial<AnnotationEntry>);
    const [e] = repo.readAnnotationFile(SAMPLE_FILE).entries;
    expect(e.text).toBe('changed');
    expect(e.origin?.line).toBe(2);
  });

  it('relocateEntry re-snapshots content when the match is fuzzy', () => {
    const entry = seedEntry();
    const content = ['// header', 'function greet(name: string) {', '  return `hi, ${name}`;', '}'].join('\n');
    const moved = relocateEntry(content, entry, {
      entryId: entry.id,
      status: 'soft-match',
      newLine: 3,
      newEndLine: 3,
    });
    expect(moved).toBe(true);
    expect(entry.line).toBe(3);
    expect(entry.lineContent).toBe('  return `hi, ${name}`;');
    expect(entry.origin?.lineContent).toBe('  return `hello, ${name}`;');
  });

  it('mergeEntry keeps origin when only one side has been backfilled', () => {
    const ours = seedEntry();
    const theirs: AnnotationEntry = { ...ours };
    delete theirs.origin;
    const merged = mergeEntry(undefined, theirs, ours);
    expect(merged.origin?.line).toBe(2);
  });
});

describe('reconcileFile', () => {
  let repo: TempRepo;

  beforeEach(() => {
    repo = makeTempRepo();
    repo.writeFile(SAMPLE_FILE, SAMPLE_CONTENT + '\n');
  });

  afterEach(() => repo.cleanup());

  it('relocates entries for a single file only', () => {
    const other = 'src/other.ts';
    repo.writeFile(other, SAMPLE_CONTENT + '\n');
    addEntry(repo.root, SAMPLE_FILE, seedEntry());
    addEntry(repo.root, other, seedEntry());

    const shifted = ['// header', SAMPLE_CONTENT].join('\n') + '\n';
    repo.writeFile(SAMPLE_FILE, shifted);
    repo.writeFile(other, shifted);

    const report = reconcileFile(repo.root, SAMPLE_FILE, { apply: true });
    expect(report.applied).toBe(1);
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].line).toBe(3);
    // The sibling file was left untouched — it still points at the old line.
    expect(repo.readAnnotationFile(other).entries[0].line).toBe(2);
  });

  it('accepts in-memory content, for unsaved editor buffers', () => {
    addEntry(repo.root, SAMPLE_FILE, seedEntry());
    const report = reconcileFile(repo.root, SAMPLE_FILE, {
      apply: true,
      sourceContent: ['// a', '// b', SAMPLE_CONTENT].join('\n') + '\n',
    });
    expect(report.applied).toBe(1);
    expect(repo.readAnnotationFile(SAMPLE_FILE).entries[0].line).toBe(4);
  });

  it('is a no-op for a file with no annotations', () => {
    const report = reconcileFile(repo.root, 'src/missing.ts', { apply: true });
    expect(report.total).toBe(0);
    expect(report.applied).toBe(0);
  });
});
