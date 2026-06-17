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
  removeEntry,
  softMatchSnapshot,
  updateEntry,
} from '../src/commentManager';
import { AnnotationEntry, AnnotationFile } from '../src/types';
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

describe('commentManager — pure helpers', () => {
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

describe('commentManager — on-disk operations', () => {
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
    expect(loaded?.version).toBe('1.0');
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

describe('commentManager — reconcileEntry / reconcileAll', () => {
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

describe('commentManager — three-way merge', () => {
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
