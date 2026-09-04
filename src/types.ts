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
}

export interface AnnotationFile {
  version: string;
  file: string;
  entries: AnnotationEntry[];
}

export const SCHEMA_VERSION = '1.1';

export const ENTRY_TYPES: EntryType[] = ['task', 'comment', 'issue'];
export const ENTRY_STATUSES: EntryStatus[] = ['open', 'in-progress', 'resolved', 'closed'];
export const ENTRY_PRIORITIES: EntryPriority[] = ['high', 'medium', 'low'];
export const ENTRY_SEVERITIES: EntrySeverity[] = ['critical', 'major', 'minor', 'trivial'];
