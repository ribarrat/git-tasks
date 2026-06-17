export type EntryType = 'task' | 'comment' | 'issue';
export type EntryStatus = 'open' | 'in-progress' | 'resolved' | 'closed';
export type EntryPriority = 'high' | 'medium' | 'low';
export type EntrySeverity = 'critical' | 'major' | 'minor' | 'trivial';

export interface AnnotationEntry {
  id: string;
  type: EntryType;
  commitSHA: string;
  line: number;
  endLine?: number;
  lineContent: string;
  text: string;
  author: string;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  status: EntryStatus;
  priority: EntryPriority;
  severity: EntrySeverity;
  tags?: string[];
}

export interface AnnotationFile {
  version: string;
  file: string;
  entries: AnnotationEntry[];
}

export const SCHEMA_VERSION = '1.0';

export const ENTRY_TYPES: EntryType[] = ['task', 'comment', 'issue'];
export const ENTRY_STATUSES: EntryStatus[] = ['open', 'in-progress', 'resolved', 'closed'];
export const ENTRY_PRIORITIES: EntryPriority[] = ['high', 'medium', 'low'];
export const ENTRY_SEVERITIES: EntrySeverity[] = ['critical', 'major', 'minor', 'trivial'];
