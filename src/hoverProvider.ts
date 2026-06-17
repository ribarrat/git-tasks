import * as vscode from 'vscode';
import * as path from 'node:path';
import { AnnotationEntry } from './types';
import { isDrifted, loadAnnotationFile } from './commentManager';
import { isCurrentUser } from './gitHelper';

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
  const header = `**${typeLabel}** · priority \`${e.priority}\` · severity \`${e.severity}\` · status \`${e.status}\``;
  const dateStr = new Date(e.createdAt).toLocaleString();
  const tagsStr = e.tags && e.tags.length > 0 ? `\n\nTags: ${e.tags.map((t) => `\`${t}\``).join(' ')}` : '';
  const driftStr = drifted
    ? `\n\n> ⚠ The file content has changed since this annotation was written — lines may have moved.`
    : '';

  const args = encodeURIComponent(JSON.stringify([e.id]));
  const editLink = `[Edit](command:git-tasks.editAnnotation?${args})`;
  const resolveLink = `[Resolve](command:git-tasks.resolveAnnotation?${args})`;
  const actions = `\n\n${editLink} · ${resolveLink}`;

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

    const matches = af.entries.filter((e) => {
      const start = e.line;
      const end = e.endLine ?? e.line;
      return lineNum >= start && lineNum <= end;
    });
    if (matches.length === 0) return undefined;

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = false;
    for (let i = 0; i < matches.length; i++) {
      const drifted = isDrifted(content, matches[i]);
      md.appendMarkdown(entryToMarkdown(repoRoot, matches[i], drifted));
      if (i < matches.length - 1) md.appendMarkdown('\n\n---\n\n');
    }
    return new vscode.Hover(md);
  }
}
