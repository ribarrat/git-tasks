import * as vscode from 'vscode';
import * as path from 'node:path';
import { AnnotationEntry, EntryPriority, EntrySeverity, EntryStatus } from './types';
import { isDrifted, loadAnnotationFile } from './taskManager';
import { isCurrentUser } from './gitHelper';
import { escapeHtml, preserveLineBreaks } from './description';

const COLOR_BLUE = '#2f80ed';
const COLOR_GREEN = '#3fb950';
const COLOR_ORANGE = '#f0883e';
const COLOR_RED = '#f85149';
const COLOR_GRAY = '#8b949e';

function statusColor(s: EntryStatus): string {
  switch (s) {
    case 'open':
      return COLOR_BLUE;
    case 'in-progress':
      return COLOR_ORANGE;
    case 'resolved':
      return COLOR_GREEN;
    case 'closed':
      return COLOR_GRAY;
  }
}

function priorityColor(p: EntryPriority): string {
  switch (p) {
    case 'high':
      return COLOR_RED;
    case 'medium':
      return COLOR_ORANGE;
    case 'low':
      return COLOR_BLUE;
  }
}

function severityColor(s: EntrySeverity): string {
  switch (s) {
    case 'critical':
      return COLOR_RED;
    case 'major':
      return COLOR_ORANGE;
    case 'minor':
      return COLOR_BLUE;
    case 'trivial':
      return COLOR_GRAY;
  }
}

function colored(value: string, color: string): string {
  return `<span style="color:${color};">\`${value}\`</span>`;
}

/**
 * Commands the hover is allowed to invoke. Annotation files travel through
 * `git pull`, so their text is written by other people — scoping `isTrusted`
 * to this list means an injected `command:` link in a task body is inert while
 * our own action links keep working.
 */
const ENABLED_COMMANDS = [
  'git-tasks.editAnnotation',
  'git-tasks.resolveAnnotation',
  'git-tasks.reopenAnnotation',
  'git-tasks.deleteAnnotation',
];

function formatRange(e: AnnotationEntry): string {
  return e.endLine && e.endLine !== e.line
    ? `Lines ${e.line}–${e.endLine}`
    : `Line ${e.line}`;
}

/**
 * A task that has been relocated shows where it started out, so the pin's
 * history stays visible even though the live line number has moved on.
 */
function formatOrigin(e: AnnotationEntry): string {
  const o = e.origin;
  if (!o) return '';
  if (o.line === e.line && (o.endLine ?? o.line) === (e.endLine ?? e.line)) return '';
  const range =
    o.endLine && o.endLine !== o.line ? `${o.line}–${o.endLine}` : `${o.line}`;
  return ` · originally ${range}`;
}

function entryToMarkdown(repoRoot: string, e: AnnotationEntry, drifted: boolean): string {
  const mine = isCurrentUser(repoRoot, e.assignee);
  const assignee = e.assignee ? escapeHtml(e.assignee) : undefined;
  const assigneeStr = assignee
    ? mine
      ? `**${assignee}** _(you)_`
      : assignee
    : '_unassigned_';

  const typeLabel = e.type.toUpperCase();
  const header =
    `**${typeLabel}** · priority ${colored(e.priority, priorityColor(e.priority))}` +
    ` · severity ${colored(e.severity, severityColor(e.severity))}` +
    ` · status ${colored(e.status, statusColor(e.status))}`;
  const dateStr = new Date(e.createdAt).toLocaleString();
  const descriptionStr = e.description
    ? `\n\n${preserveLineBreaks(escapeHtml(e.description))}`
    : '';
  const tagsStr =
    e.tags && e.tags.length > 0
      ? `\n\nTags: ${e.tags.map((t) => `\`${escapeHtml(t)}\``).join(' ')}`
      : '';
  // A recorded mark is more specific than live drift detection — it says which
  // kind of drift reconcile hit and when — so prefer it when present.
  const driftStr = e.drift
    ? `\n\n> ⚠ Drifted (\`${e.drift.kind}\`) since ${new Date(e.drift.detectedAt).toLocaleDateString()}` +
      (e.drift.suggestedLine !== undefined
        ? ` — reconcile suggests line ${e.drift.suggestedLine}.`
        : ` — the pinned snapshot is no longer in the file.`)
    : drifted
      ? `\n\n> ⚠ The file content has changed since this annotation was written — lines may have moved.`
      : '';

  const args = encodeURIComponent(JSON.stringify([e.id]));
  const editLink = `[Edit](command:git-tasks.editAnnotation?${args})`;
  const toggleLink =
    e.status === 'resolved'
      ? `[Reopen](command:git-tasks.reopenAnnotation?${args})`
      : `[Resolve](command:git-tasks.resolveAnnotation?${args})`;
  const deleteLink = `[Delete](command:git-tasks.deleteAnnotation?${args})`;
  const actions = `\n\n${editLink} · ${toggleLink} · ${deleteLink}`;

  return [
    header,
    `${formatRange(e)}${formatOrigin(e)} · by ${escapeHtml(e.author)} · assigned to ${assigneeStr} · ${dateStr}`,
    '',
    `**${escapeHtml(e.text)}**`,
    descriptionStr,
    tagsStr,
    driftStr,
    actions,
  ]
    .filter((s) => s !== '')
    .join('\n\n');
}

export class AnnotationHoverProvider implements vscode.HoverProvider {
  constructor(
    private getRepoRoot: () => string | undefined,
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const repoRoot = this.getRepoRoot();
    if (!repoRoot) return undefined;
    const rel = path.relative(repoRoot, document.uri.fsPath).split(path.sep).join('/');
    const af = loadAnnotationFile(repoRoot, rel);
    if (!af) return undefined;

    const lineNum = position.line + 1;
    const content = document.getText();
    const showResolved = vscode.workspace
      .getConfiguration('git-tasks')
      .get<boolean>('showResolved', false);

    const matches = af.entries.filter((e) => {
      if (!showResolved && e.status === 'resolved') return false;
      const start = e.line;
      const end = e.endLine ?? e.line;
      return lineNum >= start && lineNum <= end;
    });
    if (matches.length === 0) return undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = { enabledCommands: ENABLED_COMMANDS };
    md.supportHtml = true;
    for (let i = 0; i < matches.length; i++) {
      const drifted = isDrifted(content, matches[i]);
      md.appendMarkdown(entryToMarkdown(repoRoot, matches[i], drifted));
      if (i < matches.length - 1) md.appendMarkdown('\n\n---\n\n');
    }
    return new vscode.Hover(md);
  }
}
