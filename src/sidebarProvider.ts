import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AnnotationEntry,
  EntryStatus,
  EntryType,
} from './types';
import { listAllAnnotationFiles, reconcileEntry } from './taskManager';
import { isCurrentUser } from './gitHelper';

type Node = FileNode | EntryNode;

class FileNode extends vscode.TreeItem {
  contextValue = 'file';
  constructor(
    public readonly filePath: string,
    public readonly entries: AnnotationEntry[],
  ) {
    super(filePath, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('file');
    this.description = `${entries.length} task${entries.length === 1 ? '' : 's'}`;
    this.id = `file:${filePath}`;
  }
}

class EntryNode extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly entry: AnnotationEntry,
    mine: boolean,
    repoRoot: string,
    driftBadge: string,
  ) {
    const range =
      entry.endLine && entry.endLine !== entry.line
        ? `L${entry.line}-${entry.endLine}`
        : `L${entry.line}`;
    const mineMarker = mine ? '👤 ' : '';
    const short = entry.text.length > 60 ? entry.text.slice(0, 57) + '…' : entry.text;
    super(`${mineMarker}${short}`, vscode.TreeItemCollapsibleState.None);
    this.id = `entry:${entry.id}`;
    this.description = `${range} · ${entry.type} · ${entry.priority} · ${entry.status}${driftBadge}`;
    this.tooltip = entry.text;
    this.contextValue = entry.status === 'resolved' ? 'annotation:resolved' : 'annotation:open';

    const iconFile = EntryNode.iconForType(entry.type);
    this.iconPath = vscode.Uri.file(
      path.join(EntryNode.extensionPath, 'resources', 'icons', iconFile),
    );

    this.command = {
      command: 'git-tasks.openAnnotation',
      title: 'Open',
      arguments: [filePath, entry.id, repoRoot],
    };
  }

  static extensionPath = '';

  private static iconForType(t: EntryType): string {
    switch (t) {
      case 'task':
        return 'task.svg';
      case 'comment':
        return 'comment.svg';
      case 'issue':
        return 'issue.svg';
    }
  }
}

export interface SidebarFilter {
  status?: EntryStatus | 'all';
  type?: EntryType | 'all';
  assignedToMe?: boolean;
}

export class SidebarProvider implements vscode.TreeDataProvider<Node> {
  private _onDidChange = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private filter: SidebarFilter = {};

  constructor(
    private context: vscode.ExtensionContext,
    private getRepoRoot: () => string | undefined,
  ) {
    EntryNode.extensionPath = context.extensionPath;
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  setFilter(patch: Partial<SidebarFilter>): void {
    this.filter = { ...this.filter, ...patch };
    this.refresh();
  }

  getFilter(): SidebarFilter {
    return { ...this.filter };
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): vscode.ProviderResult<Node[]> {
    const repoRoot = this.getRepoRoot();
    if (!repoRoot) return [];

    if (!element) {
      const files = listAllAnnotationFiles(repoRoot);
      const result: FileNode[] = [];
      for (const af of files) {
        const filtered = af.entries.filter((e) => this.passes(e, repoRoot));
        if (filtered.length > 0) {
          result.push(new FileNode(af.file, filtered));
        }
      }
      result.sort((a, b) => a.filePath.localeCompare(b.filePath));
      return result;
    }

    if (element instanceof FileNode) {
      const repoRoot2 = this.getRepoRoot();
      if (!repoRoot2) return [];
      const sourceAbs = path.join(repoRoot2, element.filePath);
      const sourceContent = fs.existsSync(sourceAbs)
        ? fs.readFileSync(sourceAbs, 'utf8')
        : undefined;
      const sorted = [...element.entries].sort((a, b) => a.line - b.line);
      return sorted.map((e) => {
        const r = reconcileEntry(sourceContent, e);
        const badge =
          r.status === 'ok'
            ? ''
            : r.status === 'moved'
              ? ' · ⚠ drifted'
              : r.status === 'soft-match'
                ? ' · ⚠ soft-match'
                : r.status === 'stale'
                  ? ' · ⚠ stale'
                  : ' · ⚠ orphan';
        return new EntryNode(
          element.filePath,
          e,
          isCurrentUser(repoRoot2, e.assignee),
          repoRoot2,
          badge,
        );
      });
    }
    return [];
  }

  private passes(e: AnnotationEntry, repoRoot: string): boolean {
    if (this.filter.status && this.filter.status !== 'all' && e.status !== this.filter.status) {
      return false;
    }
    if (this.filter.type && this.filter.type !== 'all' && e.type !== this.filter.type) {
      return false;
    }
    if (this.filter.assignedToMe && !isCurrentUser(repoRoot, e.assignee)) {
      return false;
    }
    // Hide resolved unless the user explicitly asked to see them (config flag,
    // or status filter set to 'resolved' — handled by the first check above).
    if (e.status === 'resolved' && this.filter.status !== 'resolved') {
      const showResolved = vscode.workspace
        .getConfiguration('git-tasks')
        .get<boolean>('showResolved', false);
      if (!showResolved) return false;
    }
    return true;
  }
}

export { FileNode, EntryNode };
