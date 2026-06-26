import * as vscode from 'vscode';
import * as path from 'node:path';
import { AnnotationEntry, EntryPriority, EntrySeverity, EntryStatus } from './types';
import { isDrifted, loadAnnotationFile } from './taskManager';
import { isCurrentUser } from './gitHelper';

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

function formatRange(e: AnnotationEntry): string {
  return e.endLine && e.endLine !== e.line
    ? `Lines ${e.line}–${e.endLine}`
    : `Line ${e.line}`;
}

function entryToMarkdown(repoRoot: string, e: AnnotationEntry, drifted: boolean): string {
  const mine = isCurrentUser(repoRoot, e.assignee);
  const assigneeStr = e.assignee
    ? mine
      ? `**${e.assignee}** _(you)_`
      : e.assignee
    : '_unassigned_';

  const typeLabel = e.type.toUpperCase();
  const header =
    `**${typeLabel}** · priority ${colored(e.priority, priorityColor(e.priority))}` +
    ` · severity ${colored(e.severity, severityColor(e.severity))}` +
    ` · status ${colored(e.status, statusColor(e.status))}`;
  const dateStr = new Date(e.createdAt).toLocaleString();
  const tagsStr = e.tags && e.tags.length > 0 ? `\n\nTags: ${e.tags.map((t) => `\`${t}\``).join(' ')}` : '';
  const driftStr = drifted
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
    `${formatRange(e)} · by ${e.author} · assigned to ${assigneeStr} · ${dateStr}`,
    '',
    e.text,
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
    md.isTrusted = true;
    md.supportHtml = true;
    for (let i = 0; i < matches.length; i++) {
      const drifted = isDrifted(content, matches[i]);
      md.appendMarkdown(entryToMarkdown(repoRoot, matches[i], drifted));
      if (i < matches.length - 1) md.appendMarkdown('\n\n---\n\n');
    }
    return new vscode.Hover(md);
  }
}
