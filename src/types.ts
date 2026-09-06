export type EntryType = 'task' | 'comment' | 'issue';
export type EntryStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type EntryPriority = 'high' | 'medium' | 'low';
export type EntrySeverity = 'critical' | 'major' | 'minor' | 'trivial';

/**
 * Where an annotation was originally pinned, captured once when it is created
 * and never rewritten afterwards. `line`/`lineContent` on the entry itself
 * track the *current* location and are updated by reconcile as the code moves;
 * this block is what lets the UI say "line 42, originally line 17".
 */
export interface EntryOrigin {
  line: number;
  endLine?: number;
  lineContent: string;
  commitSHA: string;
}

/**
 * A drift condition reconcile could not resolve on its own, recorded on the
 * entry so it travels with the annotation instead of failing a build.
 *
 * `soft-match` — the snapshot survives only approximately; a candidate line is
 * suggested but not applied, because following a fuzzy match silently would
 * quietly repoint the annotation at code it may no longer describe.
 * `stale` — the snapshot is gone from the file entirely.
 * `orphan` — the source file itself is gone.
 *
 * The mark is derived state: reconcile rewrites it every run and clears it the
 * moment the entry pins cleanly again. Nothing in the SDLC should block on it.
 */
export type DriftKind = 'soft-match' | 'stale' | 'orphan';

export interface EntryDrift {
  kind: DriftKind;
  /** When this drift was first observed (preserved across runs while it persists). */
  detectedAt: string;
  /** Where the entry was pinned, and what it expected to find, at detection time. */
  line: number;
  endLine?: number;
  lineContent: string;
  /** For `soft-match`: the line reconcile believes the code moved to. */
  suggestedLine?: number;
  suggestedEndLine?: number;
}

export interface AnnotationEntry {
  id: string;
  type: EntryType;
  commitSHA: string;
  line: number;
  endLine?: number;
  lineContent: string;
  text: string;
  description?: string;
  author: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  status: EntryStatus;
  priority: EntryPriority;
  severity: EntrySeverity;
  tags?: string[];
  origin?: EntryOrigin;
  drift?: EntryDrift;
}

export interface AnnotationFile {
  version: string;
  file: string;
  entries: AnnotationEntry[];
}

export const SCHEMA_VERSION = '1.2';

export const ENTRY_TYPES: EntryType[] = ['task', 'comment', 'issue'];
export const ENTRY_STATUSES: EntryStatus[] = ['open', 'in-progress', 'resolved', 'closed'];
export const ENTRY_PRIORITIES: EntryPriority[] = ['high', 'medium', 'low'];
export const ENTRY_SEVERITIES: EntrySeverity[] = ['critical', 'major', 'minor', 'trivial'];
export const DRIFT_KINDS: DriftKind[] = ['soft-match', 'stale', 'orphan'];
