import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AnnotationEntry,
  AnnotationFile,
  EntryDrift,
  EntryOrigin,
  EntryPriority,
  EntrySeverity,
  EntryStatus,
  EntryType,
  SCHEMA_VERSION,
} from './types';

export const ANNOTATIONS_DIR = '.git-tasks';

function annotationsRoot(repoRoot: string): string {
  return path.join(repoRoot, ANNOTATIONS_DIR);
}

/**
 * Path to the JSON file for a given source file (relative to repo root).
 * Mirrors the source path and appends `.json`.
 */
export function annotationFilePathFor(repoRoot: string, relFilePath: string): string {
  const normalized = relFilePath.split(path.sep).join('/');
  return path.join(annotationsRoot(repoRoot), normalized + '.json');
}

export function ensureAnnotationsDir(repoRoot: string): void {
  const dir = annotationsRoot(repoRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadAnnotationFile(
  repoRoot: string,
  relFilePath: string,
): AnnotationFile | undefined {
  const p = annotationFilePathFor(repoRoot, relFilePath);
  if (!fs.existsSync(p)) return undefined;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as AnnotationFile;
    return parsed;
  } catch {
    return undefined;
  }
}

export function saveAnnotationFile(repoRoot: string, file: AnnotationFile): void {
  const p = annotationFilePathFor(repoRoot, file.file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Any write goes out at the current schema version — entries may have picked
  // up an `origin` block since the file was last read.
  const out: AnnotationFile = { ...file, version: SCHEMA_VERSION };
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

export function deleteAnnotationFileIfEmpty(repoRoot: string, relFilePath: string): void {
  const p = annotationFilePathFor(repoRoot, relFilePath);
  if (!fs.existsSync(p)) return;
  const f = loadAnnotationFile(repoRoot, relFilePath);
  if (f && f.entries.length === 0) {
    fs.unlinkSync(p);
  }
}

/**
 * Walk the .git-tasks/ tree and yield all annotation files.
 */
export function listAllAnnotationFiles(repoRoot: string): AnnotationFile[] {
  const dir = annotationsRoot(repoRoot);
  if (!fs.existsSync(dir)) return [];
  const out: AnnotationFile[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const raw = fs.readFileSync(full, 'utf8');
          const parsed = JSON.parse(raw) as AnnotationFile;
          if (parsed && Array.isArray(parsed.entries)) out.push(parsed);
        } catch {
          // skip invalid file
        }
      }
    }
  };
  walk(dir);
  return out;
}

export function listAllEntries(
  repoRoot: string,
): Array<{ file: string; entry: AnnotationEntry }> {
  const out: Array<{ file: string; entry: AnnotationEntry }> = [];
  for (const af of listAllAnnotationFiles(repoRoot)) {
    for (const e of af.entries) out.push({ file: af.file, entry: e });
  }
  return out;
}

export interface CreateEntryInput {
  type: EntryType;
  commitSHA: string;
  line: number;
  endLine?: number;
  lineContent: string;
  text: string;
  description?: string;
  author: string;
  assignee?: string;
  status?: EntryStatus;
  priority?: EntryPriority;
  severity?: EntrySeverity;
  tags?: string[];
}

export function createEntry(input: CreateEntryInput): AnnotationEntry {
  const now = new Date().toISOString();
  const entry: AnnotationEntry = {
    id: randomUUID(),
    type: input.type,
    commitSHA: input.commitSHA,
    line: input.line,
    lineContent: input.lineContent,
    text: input.text,
    author: input.author,
    createdAt: now,
    updatedAt: now,
    status: input.status ?? 'open',
    priority: input.priority ?? 'medium',
    severity: input.severity ?? 'minor',
  };
  if (input.endLine !== undefined && input.endLine !== input.line) {
    entry.endLine = input.endLine;
  }
  if (input.description) entry.description = input.description;
  if (input.assignee) entry.assignee = input.assignee;
  if (input.tags && input.tags.length > 0) entry.tags = input.tags;
  entry.origin = originFrom(entry);
  return entry;
}

/**
 * Snapshot an entry's current pin as an immutable origin record.
 */
function originFrom(entry: AnnotationEntry): EntryOrigin {
  const origin: EntryOrigin = {
    line: entry.line,
    lineContent: entry.lineContent,
    commitSHA: entry.commitSHA,
  };
  if (entry.endLine !== undefined) origin.endLine = entry.endLine;
  return origin;
}

/**
 * Entries created before schema 1.1 have no `origin`. The first time such an
 * entry is about to move, freeze where it currently sits as its origin — that
 * is the oldest position we can still prove, so it is the honest answer.
 */
export function ensureOrigin(entry: AnnotationEntry): void {
  if (!entry.origin) entry.origin = originFrom(entry);
}

export function addEntry(
  repoRoot: string,
  relFilePath: string,
  entry: AnnotationEntry,
): AnnotationFile {
  ensureAnnotationsDir(repoRoot);
  const existing =
    loadAnnotationFile(repoRoot, relFilePath) ?? {
      version: SCHEMA_VERSION,
      file: relFilePath.split(path.sep).join('/'),
      entries: [],
    };
  existing.entries.push(entry);
  saveAnnotationFile(repoRoot, existing);
  return existing;
}

/**
 * Find a single entry by id (or id-prefix of length >= 4).
 */
export function findEntryById(
  repoRoot: string,
  idOrPrefix: string,
): { file: string; entry: AnnotationEntry } | undefined {
  const all = listAllEntries(repoRoot);
  const exact = all.find((e) => e.entry.id === idOrPrefix);
  if (exact) return exact;
  if (idOrPrefix.length < 4) return undefined;
  const matches = all.filter((e) => e.entry.id.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0];
  return undefined;
}

export function updateEntry(
  repoRoot: string,
  idOrPrefix: string,
  patch: Partial<Omit<AnnotationEntry, 'id' | 'createdAt'>>,
): { file: string; entry: AnnotationEntry } | undefined {
  const found = findEntryById(repoRoot, idOrPrefix);
  if (!found) return undefined;
  const af = loadAnnotationFile(repoRoot, found.file)!;
  const idx = af.entries.findIndex((e) => e.id === found.entry.id);
  if (idx < 0) return undefined;
  const updated: AnnotationEntry = {
    ...af.entries[idx],
    ...patch,
    id: af.entries[idx].id,
    createdAt: af.entries[idx].createdAt,
    origin: af.entries[idx].origin,
    updatedAt: new Date().toISOString(),
  };
  af.entries[idx] = updated;
  saveAnnotationFile(repoRoot, af);
  return { file: af.file, entry: updated };
}

export function removeEntry(repoRoot: string, idOrPrefix: string): boolean {
  const found = findEntryById(repoRoot, idOrPrefix);
  if (!found) return false;
  const af = loadAnnotationFile(repoRoot, found.file)!;
  af.entries = af.entries.filter((e) => e.id !== found.entry.id);
  if (af.entries.length === 0) {
    const p = annotationFilePathFor(repoRoot, af.file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } else {
    saveAnnotationFile(repoRoot, af);
  }
  return true;
}

/**
 * Extract the snapshot for the lines covered by an entry from raw file content.
 */
export function extractLineContent(
  fileContent: string,
  line: number,
  endLine?: number,
): string {
  const lines = fileContent.split(/\r?\n/);
  const start = Math.max(1, line) - 1;
  const end = endLine !== undefined ? Math.max(1, endLine) - 1 : start;
  return lines.slice(start, end + 1).join('\n');
}

/**
 * True when the current file's lines no longer match the stored snapshot.
 */
export function isDrifted(
  currentFileContent: string,
  entry: AnnotationEntry,
): boolean {
  const live = extractLineContent(currentFileContent, entry.line, entry.endLine);
  return live !== entry.lineContent;
}

// ---------- Reconcile ----------

export type ReconcileStatus =
  | 'ok'
  | 'moved'
  | 'soft-match'
  | 'stale'
  | 'orphan';

export interface ReconcileResult {
  entryId: string;
  status: ReconcileStatus;
  newLine?: number;
  newEndLine?: number;
}

export interface ReconcileItem {
  file: string;
  entry: AnnotationEntry;
  result: ReconcileResult;
  /**
   * Where the entry was pinned *before* this run. Captured by value because
   * `entry` is a live reference that `relocateEntry` mutates in place — reading
   * `entry.line` after an applied move would report the destination as the
   * origin and render every "from → to" line a no-op.
   */
  fromLine: number;
  fromEndLine?: number;
}

export interface ReconcileReport {
  total: number;
  ok: number;
  applied: number;
  /** Entries newly carrying (or still carrying) a drift mark after this run. */
  marked: number;
  /** Entries whose drift mark was removed because they pin cleanly again. */
  cleared: number;
  moved: ReconcileItem[];
  softMatch: ReconcileItem[];
  stale: ReconcileItem[];
  orphan: ReconcileItem[];
}

/**
 * Find every starting line (1-based) in fileContent where snapshot matches
 * exactly. The match always spans `snapshotLines` lines.
 */
export function findSnapshotIn(
  fileContent: string,
  snapshot: string,
): Array<{ line: number; endLine: number }> {
  const fileLines = fileContent.split(/\r?\n/);
  const snapshotLines = snapshot.split(/\r?\n/);
  const n = snapshotLines.length;
  if (n === 0) return [];
  const hits: Array<{ line: number; endLine: number }> = [];
  for (let i = 0; i + n <= fileLines.length; i++) {
    let match = true;
    for (let j = 0; j < n; j++) {
      if (fileLines[i + j] !== snapshotLines[j]) {
        match = false;
        break;
      }
    }
    if (match) hits.push({ line: i + 1, endLine: i + n });
  }
  return hits;
}

function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev + 1;
      } else if (dp[j - 1] > dp[j]) {
        dp[j] = dp[j - 1];
      }
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * Soft-match: slide a window of the snapshot's size across the file, pick the
 * window with the best LCS ratio against the snapshot, accept if >= 0.7. Ties
 * are broken by nearness to the original line number.
 */
export function softMatchSnapshot(
  fileContent: string,
  snapshot: string,
  originalLine: number,
  threshold = 0.7,
): { line: number; endLine: number; score: number } | undefined {
  const fileLines = fileContent.split(/\r?\n/);
  const snapshotLines = snapshot.split(/\r?\n/);
  const n = snapshotLines.length;
  if (n === 0 || fileLines.length < n) return undefined;
  let best: { line: number; endLine: number; score: number } | undefined;
  for (let start = 0; start + n <= fileLines.length; start++) {
    const window = fileLines.slice(start, start + n);
    const score = lcsLength(snapshotLines, window) / n;
    if (score < threshold) continue;
    const candidate = { line: start + 1, endLine: start + n, score };
    if (!best) {
      best = candidate;
      continue;
    }
    if (
      candidate.score > best.score ||
      (candidate.score === best.score &&
        Math.abs(candidate.line - originalLine) < Math.abs(best.line - originalLine))
    ) {
      best = candidate;
    }
  }
  return best;
}

export function reconcileEntry(
  fileContent: string | undefined,
  entry: AnnotationEntry,
): ReconcileResult {
  if (fileContent === undefined) {
    return { entryId: entry.id, status: 'orphan' };
  }
  const live = extractLineContent(fileContent, entry.line, entry.endLine);
  if (live === entry.lineContent) {
    return { entryId: entry.id, status: 'ok' };
  }
  const hits = findSnapshotIn(fileContent, entry.lineContent);
  if (hits.length === 1) {
    return {
      entryId: entry.id,
      status: 'moved',
      newLine: hits[0].line,
      newEndLine: hits[0].endLine,
    };
  }
  if (hits.length > 1) {
    const nearest = hits.reduce((best, h) =>
      Math.abs(h.line - entry.line) < Math.abs(best.line - entry.line) ? h : best,
    );
    return {
      entryId: entry.id,
      status: 'moved',
      newLine: nearest.line,
      newEndLine: nearest.endLine,
    };
  }
  const sm = softMatchSnapshot(fileContent, entry.lineContent, entry.line);
  if (sm) {
    return {
      entryId: entry.id,
      status: 'soft-match',
      newLine: sm.line,
      newEndLine: sm.endLine,
    };
  }
  return { entryId: entry.id, status: 'stale' };
}

/**
 * Apply a relocation to an entry in place: freeze its origin (first move only),
 * repoint line/endLine, and re-snapshot the content now under those lines.
 * Returns false when the result carries no new position.
 */
export function relocateEntry(
  fileContent: string,
  entry: AnnotationEntry,
  result: ReconcileResult,
): boolean {
  if (result.newLine === undefined) return false;
  const newEndLine = result.newEndLine ?? result.newLine;
  if (entry.line === result.newLine && (entry.endLine ?? entry.line) === newEndLine) {
    return false;
  }
  ensureOrigin(entry);
  entry.line = result.newLine;
  if (newEndLine !== result.newLine) entry.endLine = newEndLine;
  else delete entry.endLine;
  // Re-snapshot: for an exact match this is a no-op, but a soft match lands on
  // text that has genuinely changed and the pin must follow it.
  entry.lineContent = extractLineContent(fileContent, entry.line, entry.endLine);
  entry.updatedAt = new Date().toISOString();
  return true;
}

/**
 * Record an unresolvable drift on the entry. The annotation keeps its current
 * pin — we never guess — but carries a mark describing what reconcile found so
 * tooling can surface it instead of a pipeline having to fail over it.
 *
 * `detectedAt` is preserved while the same kind of drift persists, so the mark
 * answers "since when" rather than "as of the last run". Deliberately does NOT
 * touch `updatedAt`: that field is the merge driver's last-writer-wins
 * tiebreaker for human edits, and a machine-derived mark must not win it.
 *
 * Returns true when the mark changed, i.e. the file needs persisting.
 */
export function markDrift(entry: AnnotationEntry, result: ReconcileResult): boolean {
  const kind = result.status;
  if (kind !== 'soft-match' && kind !== 'stale' && kind !== 'orphan') return false;
  const next: EntryDrift = {
    kind,
    detectedAt:
      entry.drift?.kind === kind ? entry.drift.detectedAt : new Date().toISOString(),
    line: entry.line,
    lineContent: entry.lineContent,
  };
  if (entry.endLine !== undefined) next.endLine = entry.endLine;
  if (result.newLine !== undefined) next.suggestedLine = result.newLine;
  if (result.newEndLine !== undefined && result.newEndLine !== result.newLine) {
    next.suggestedEndLine = result.newEndLine;
  }
  if (driftEqual(entry.drift, next)) return false;
  entry.drift = next;
  return true;
}

/** Drop a drift mark once the entry pins cleanly again. Returns true if one was removed. */
export function clearDrift(entry: AnnotationEntry): boolean {
  if (!entry.drift) return false;
  delete entry.drift;
  return true;
}

function driftEqual(a: EntryDrift | undefined, b: EntryDrift): boolean {
  if (!a) return false;
  return (
    a.kind === b.kind &&
    a.detectedAt === b.detectedAt &&
    a.line === b.line &&
    a.endLine === b.endLine &&
    a.lineContent === b.lineContent &&
    a.suggestedLine === b.suggestedLine &&
    a.suggestedEndLine === b.suggestedEndLine
  );
}

/**
 * Reconcile every entry in one already-loaded annotation file against its
 * source. Mutates `af` when `apply` is set; the caller persists it.
 */
function reconcileLoadedFile(
  af: AnnotationFile,
  sourceContent: string | undefined,
  opts: { apply: boolean },
  report: ReconcileReport,
): boolean {
  let mutated = false;
  for (const entry of af.entries) {
    report.total++;
    const result = reconcileEntry(sourceContent, entry);
    const item: ReconcileItem = {
      file: af.file,
      entry,
      result,
      fromLine: entry.line,
      fromEndLine: entry.endLine,
    };
    switch (result.status) {
      case 'ok':
        report.ok++;
        break;
      case 'moved':
        report.moved.push(item);
        if (opts.apply && relocateEntry(sourceContent!, entry, result)) {
          mutated = true;
          report.applied++;
        }
        break;
      case 'soft-match':
        report.softMatch.push(item);
        break;
      case 'stale':
        report.stale.push(item);
        break;
      case 'orphan':
        report.orphan.push(item);
        break;
    }
    if (opts.apply) {
      // Resolved one way or another (exact pin or a relocation we trust) ⇒ the
      // mark, if any, no longer describes reality. Otherwise record the drift
      // on the entry so it is visible without anything having to fail.
      if (result.status === 'ok' || result.status === 'moved') {
        if (clearDrift(entry)) {
          mutated = true;
          report.cleared++;
        }
      } else {
        if (markDrift(entry, result)) mutated = true;
        report.marked++;
      }
    }
  }
  return mutated;
}

function emptyReport(): ReconcileReport {
  return {
    total: 0,
    ok: 0,
    applied: 0,
    marked: 0,
    cleared: 0,
    moved: [],
    softMatch: [],
    stale: [],
    orphan: [],
  };
}

function readSource(repoRoot: string, relFilePath: string): string | undefined {
  const abs = path.join(repoRoot, relFilePath);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
}

/**
 * Reconcile the annotations for a single source file. Used by the editor to
 * settle drift the moment a file is saved, without walking the whole repo.
 */
export function reconcileFile(
  repoRoot: string,
  relFilePath: string,
  opts: { apply: boolean; sourceContent?: string },
): ReconcileReport {
  const report = emptyReport();
  const af = loadAnnotationFile(repoRoot, relFilePath);
  if (!af || af.entries.length === 0) return report;
  const sourceContent = opts.sourceContent ?? readSource(repoRoot, af.file);
  const mutated = reconcileLoadedFile(af, sourceContent, opts, report);
  if (mutated) saveAnnotationFile(repoRoot, af);
  return report;
}

/**
 * Walk all annotation files; reconcile every entry. When `apply` is true,
 * `'moved'` results are written back to disk (line numbers updated, origin
 * frozen, `updatedAt` bumped). Other statuses are reported but not
 * auto-applied.
 */
export function reconcileAll(
  repoRoot: string,
  opts: { apply: boolean },
): ReconcileReport {
  const report = emptyReport();
  for (const af of listAllAnnotationFiles(repoRoot)) {
    const sourceContent = readSource(repoRoot, af.file);
    if (reconcileLoadedFile(af, sourceContent, opts, report)) {
      saveAnnotationFile(repoRoot, af);
    }
  }
  return report;
}

// ---------- JSON merge driver ----------

type EntryField = keyof AnnotationEntry;
const IMMUTABLE_FIELDS: EntryField[] = ['id', 'createdAt', 'commitSHA', 'author', 'origin'];

function fieldEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Three-way merge of two AnnotationEntry copies that share an id.
 * Returns the merged entry. `ancestor` may be undefined if the entry was
 * added independently on both sides (caller decides what to do with that;
 * see mergeAnnotationFiles).
 */
export function mergeEntry(
  ancestor: AnnotationEntry | undefined,
  ours: AnnotationEntry,
  theirs: AnnotationEntry,
): AnnotationEntry {
  const out: AnnotationEntry = { ...ours };
  // immutable fields: take ours (== theirs in practice for the same id)
  for (const f of IMMUTABLE_FIELDS) {
    (out as any)[f] = ours[f];
  }
  // `origin` is frozen at creation, so both sides agree whenever both have it.
  // The one case that matters is a pre-1.1 entry that was backfilled on only
  // one side — prefer the ancestor's record, then whichever side has one.
  const origin = ancestor?.origin ?? ours.origin ?? theirs.origin;
  if (origin) out.origin = origin;
  else delete out.origin;
  // `drift` is derived state that the next reconcile recomputes, and it is
  // written without bumping `updatedAt`, so the last-writer-wins tiebreaker
  // below cannot decide it meaningfully. Prefer whichever side actually has a
  // mark (absence usually just means that side never ran reconcile), and on a
  // genuine disagreement keep the one observed first.
  const drift = pickDrift(ours.drift, theirs.drift);
  if (drift) out.drift = drift;
  else delete out.drift;
  const allKeys = new Set<EntryField>([
    ...(Object.keys(ours) as EntryField[]),
    ...(Object.keys(theirs) as EntryField[]),
    ...(ancestor ? (Object.keys(ancestor) as EntryField[]) : []),
  ]);
  for (const f of allKeys) {
    if (IMMUTABLE_FIELDS.includes(f) || f === 'drift') continue;
    const a = ours[f] as unknown;
    const b = theirs[f] as unknown;
    const o = ancestor ? (ancestor[f] as unknown) : undefined;
    if (fieldEqual(a, b)) {
      (out as any)[f] = a;
      continue;
    }
    if (ancestor && fieldEqual(a, o)) {
      // only theirs changed
      (out as any)[f] = b;
      continue;
    }
    if (ancestor && fieldEqual(b, o)) {
      // only ours changed
      (out as any)[f] = a;
      continue;
    }
    // both sides changed (or no ancestor and they differ)
    if (f === 'tags') {
      const aa = Array.isArray(a) ? (a as string[]) : [];
      const bb = Array.isArray(b) ? (b as string[]) : [];
      const union = Array.from(new Set([...aa, ...bb])).sort();
      (out as any)[f] = union.length > 0 ? union : undefined;
      continue;
    }
    // last-writer-wins by updatedAt
    const aTs = Date.parse(ours.updatedAt);
    const bTs = Date.parse(theirs.updatedAt);
    (out as any)[f] = bTs > aTs ? b : a;
  }
  // updatedAt: max of both
  out.updatedAt =
    Date.parse(ours.updatedAt) >= Date.parse(theirs.updatedAt)
      ? ours.updatedAt
      : theirs.updatedAt;
  return out;
}

function pickDrift(
  a: EntryDrift | undefined,
  b: EntryDrift | undefined,
): EntryDrift | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.detectedAt) <= Date.parse(b.detectedAt) ? a : b;
}

export type MergeOutcome =
  | { ok: true; merged: AnnotationFile }
  | { ok: false; reason: string };

/**
 * Three-way merge of two annotation-file versions. Returns the merged file
 * or a structural conflict (entry deleted on one side, edited on the other).
 */
export function mergeAnnotationFiles(
  ancestor: AnnotationFile | undefined,
  ours: AnnotationFile,
  theirs: AnnotationFile,
): MergeOutcome {
  const file = ours.file ?? theirs.file ?? ancestor?.file ?? '';
  const version = ours.version ?? theirs.version ?? ancestor?.version ?? SCHEMA_VERSION;

  const byId = (f: AnnotationFile | undefined): Map<string, AnnotationEntry> => {
    const m = new Map<string, AnnotationEntry>();
    if (!f) return m;
    for (const e of f.entries) m.set(e.id, e);
    return m;
  };
  const oMap = byId(ancestor);
  const aMap = byId(ours);
  const bMap = byId(theirs);

  const allIds = new Set<string>([...oMap.keys(), ...aMap.keys(), ...bMap.keys()]);
  const merged: AnnotationEntry[] = [];
  for (const id of allIds) {
    const o = oMap.get(id);
    const a = aMap.get(id);
    const b = bMap.get(id);

    if (a && !b) {
      // present ours only
      if (o && !fieldEqual(a.updatedAt, o.updatedAt)) {
        // theirs deleted, ours edited → conflict
        return { ok: false, reason: `entry ${id} deleted on one side but edited on the other` };
      }
      if (!o) {
        // added by us
        merged.push(a);
      } else {
        // theirs deleted with no edit on our side either → drop
        // (but ours == ancestor here; safe to drop)
      }
      continue;
    }
    if (b && !a) {
      if (o && !fieldEqual(b.updatedAt, o.updatedAt)) {
        return { ok: false, reason: `entry ${id} deleted on one side but edited on the other` };
      }
      if (!o) {
        merged.push(b);
      }
      continue;
    }
    if (a && b) {
      merged.push(mergeEntry(o, a, b));
    }
  }

  merged.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  return {
    ok: true,
    merged: { version, file, entries: merged },
  };
}
