import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  AnnotationEntry,
  ENTRY_PRIORITIES,
  ENTRY_SEVERITIES,
  ENTRY_STATUSES,
  ENTRY_TYPES,
  EntryPriority,
  EntrySeverity,
  EntryStatus,
  EntryType,
} from './types';
import {
  addEntry,
  createEntry,
  extractLineContent,
  findEntryById,
  loadAnnotationFile,
  reconcileAll,
  removeEntry,
  updateEntry,
} from './commentManager';
import {
  getCurrentCommitSHA,
  getUserEmail,
  getUserName,
  isGitRepo,
} from './gitHelper';
import { GutterProvider } from './gutterProvider';
import { AnnotationHoverProvider } from './hoverProvider';
import { SidebarProvider, EntryNode } from './sidebarProvider';
import { AnnotationsWatcher } from './fileWatcher';

let repoRoot: string | undefined;
let gutter: GutterProvider | undefined;
let sidebar: SidebarProvider | undefined;
let statusItem: vscode.StatusBarItem | undefined;

function findWorkspaceRepoRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  for (const f of folders) {
    if (isGitRepo(f.uri.fsPath)) return f.uri.fsPath;
  }
  return undefined;
}

function relPath(uri: vscode.Uri): string | undefined {
  if (!repoRoot) return undefined;
  const abs = uri.fsPath;
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join('/');
}

function refreshActiveEditor(): void {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !repoRoot || !gutter) return;
  const rel = relPath(editor.document.uri);
  if (!rel) {
    gutter.clear(editor);
    return;
  }
  const af = loadAnnotationFile(repoRoot, rel);
  if (!af || af.entries.length === 0) {
    gutter.clear(editor);
    return;
  }
  gutter.apply(editor, repoRoot, af.entries);
}

export function activate(context: vscode.ExtensionContext): void {
  repoRoot = findWorkspaceRepoRoot();

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  context.subscriptions.push(statusItem);

  if (!repoRoot) {
    statusItem.text = '$(git-branch) git-tasks: no git repo';
    statusItem.show();
    return;
  }

  statusItem.text = '$(git-branch) git-tasks';
  statusItem.tooltip = `git-tasks active (${getUserName(repoRoot)} <${getUserEmail(repoRoot)}>)`;
  statusItem.show();

  gutter = new GutterProvider(context);
  context.subscriptions.push(gutter);

  sidebar = new SidebarProvider(context, () => repoRoot);
  const tree = vscode.window.createTreeView('gitTasksPanel', {
    treeDataProvider: sidebar,
    showCollapseAll: true,
  });
  context.subscriptions.push(tree);

  const hover = new AnnotationHoverProvider(() => repoRoot);
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hover),
  );

  const watcher = new AnnotationsWatcher(repoRoot, {
    onAnnotationsChanged: () => {
      refreshActiveEditor();
      sidebar?.refresh();
    },
  });
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshActiveEditor()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) {
        refreshActiveEditor();
      }
    }),
  );

  // Initial paint.
  refreshActiveEditor();
  sidebar.refresh();

  registerCommands(context);
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.addAnnotation', addAnnotationCmd),
    vscode.commands.registerCommand('git-tasks.editAnnotation', editAnnotationCmd),
    vscode.commands.registerCommand('git-tasks.resolveAnnotation', resolveAnnotationCmd),
    vscode.commands.registerCommand('git-tasks.deleteAnnotation', deleteAnnotationCmd),
    vscode.commands.registerCommand('git-tasks.refreshPanel', () => {
      sidebar?.refresh();
      refreshActiveEditor();
    }),
    vscode.commands.registerCommand('git-tasks.reconcile', () => {
      if (!repoRoot) return;
      const report = reconcileAll(repoRoot, { apply: true });
      refreshActiveEditor();
      sidebar?.refresh();
      const issues = report.softMatch.length + report.stale.length + report.orphan.length;
      const msg =
        `git-tasks: relocated ${report.applied} · ${report.ok} ok` +
        (issues > 0
          ? ` · ${report.softMatch.length} soft-match · ${report.stale.length} stale · ${report.orphan.length} orphan`
          : '');
      if (issues > 0) vscode.window.showWarningMessage(msg);
      else vscode.window.showInformationMessage(msg);
    }),
    vscode.commands.registerCommand('git-tasks.filterByStatus', filterByStatusCmd),
    vscode.commands.registerCommand('git-tasks.filterByType', filterByTypeCmd),
    vscode.commands.registerCommand('git-tasks.filterAssignedToMe', filterAssignedToMeCmd),
    vscode.commands.registerCommand(
      'git-tasks.openAnnotation',
      async (filePath: string, entryId: string) => {
        if (!repoRoot) return;
        const af = loadAnnotationFile(repoRoot, filePath);
        if (!af) return;
        const entry = af.entries.find((e) => e.id === entryId);
        if (!entry) return;
        const fullPath = path.join(repoRoot, filePath);
        const doc = await vscode.workspace.openTextDocument(fullPath);
        const editor = await vscode.window.showTextDocument(doc);
        const startLine = Math.max(0, entry.line - 1);
        const endLine = Math.max(startLine, (entry.endLine ?? entry.line) - 1);
        const start = new vscode.Position(startLine, 0);
        const end = editor.document.lineAt(
          Math.min(endLine, editor.document.lineCount - 1),
        ).range.end;
        const range = new vscode.Range(start, end);
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      },
    ),
  );
}

async function addAnnotationCmd(): Promise<void> {
  if (!repoRoot) {
    vscode.window.showWarningMessage('git-tasks: not inside a Git repository.');
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('git-tasks: open a file first.');
    return;
  }
  const rel = relPath(editor.document.uri);
  if (!rel) {
    vscode.window.showWarningMessage('git-tasks: file is outside the Git repo.');
    return;
  }

  const selection = editor.selection;
  const line = selection.start.line + 1;
  const endLine = selection.end.line + 1;
  const isRange = !selection.isSingleLine && endLine !== line;
  const lineContent = extractLineContent(
    editor.document.getText(),
    line,
    isRange ? endLine : undefined,
  );

  const type = await vscode.window.showQuickPick(ENTRY_TYPES, {
    placeHolder: 'Type',
  });
  if (!type) return;

  const text = await vscode.window.showInputBox({
    prompt: 'Annotation text',
    placeHolder: 'Describe the task / comment / issue',
  });
  if (!text) return;

  const priority = (await vscode.window.showQuickPick(ENTRY_PRIORITIES, {
    placeHolder: 'Priority',
  })) as EntryPriority | undefined;
  if (!priority) return;

  const severity = (await vscode.window.showQuickPick(ENTRY_SEVERITIES, {
    placeHolder: 'Severity',
  })) as EntrySeverity | undefined;
  if (!severity) return;

  const assigneeInput = await vscode.window.showInputBox({
    prompt: 'Assignee (name or email, optional)',
    placeHolder: 'leave empty for unassigned',
  });
  // showInputBox returns undefined only if cancelled — empty string is "skip".
  if (assigneeInput === undefined) return;

  const tagsInput = await vscode.window.showInputBox({
    prompt: 'Tags, comma-separated (optional)',
    placeHolder: 'perf,security',
  });
  if (tagsInput === undefined) return;
  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const commitSHA = getCurrentCommitSHA(repoRoot);
  const author = getUserName(repoRoot);

  const entry = createEntry({
    type: type as EntryType,
    commitSHA,
    line,
    endLine: isRange ? endLine : undefined,
    lineContent,
    text,
    author,
    assignee: assigneeInput.trim() || undefined,
    priority,
    severity,
    tags,
  });

  addEntry(repoRoot, rel, entry);
  refreshActiveEditor();
  sidebar?.refresh();

  const rangeLabel = isRange ? `lines ${line}–${endLine}` : `line ${line}`;
  vscode.window.showInformationMessage(`git-tasks: added ${type} on ${rangeLabel}.`);
}

async function pickEntryId(arg: unknown): Promise<string | undefined> {
  if (typeof arg === 'string') return arg;
  if (arg instanceof EntryNode) return arg.entry.id;
  if (!repoRoot) return undefined;

  // Try the line under the active cursor.
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const rel = relPath(editor.document.uri);
    if (rel) {
      const af = loadAnnotationFile(repoRoot, rel);
      if (af) {
        const ln = editor.selection.start.line + 1;
        const matches = af.entries.filter(
          (e) => ln >= e.line && ln <= (e.endLine ?? e.line),
        );
        if (matches.length === 1) return matches[0].id;
        if (matches.length > 1) {
          const pick = await vscode.window.showQuickPick(
            matches.map((m) => ({
              label: `${m.type}: ${m.text.slice(0, 60)}`,
              description: m.endLine ? `L${m.line}-${m.endLine}` : `L${m.line}`,
              id: m.id,
            })),
            { placeHolder: 'Multiple annotations on this line' },
          );
          return pick?.id;
        }
      }
    }
  }
  vscode.window.showWarningMessage('git-tasks: no annotation found.');
  return undefined;
}

async function editAnnotationCmd(arg?: unknown): Promise<void> {
  if (!repoRoot) return;
  const id = await pickEntryId(arg);
  if (!id) return;
  const found = findEntryById(repoRoot, id);
  if (!found) {
    vscode.window.showWarningMessage('git-tasks: annotation not found.');
    return;
  }
  const newText = await vscode.window.showInputBox({
    prompt: 'New text',
    value: found.entry.text,
  });
  if (newText === undefined) return;

  const newStatus = (await vscode.window.showQuickPick(ENTRY_STATUSES, {
    placeHolder: 'Status',
  })) as EntryStatus | undefined;

  const patch: Partial<AnnotationEntry> = { text: newText };
  if (newStatus) patch.status = newStatus;
  updateEntry(repoRoot, id, patch);
  refreshActiveEditor();
  sidebar?.refresh();
}

async function resolveAnnotationCmd(arg?: unknown): Promise<void> {
  if (!repoRoot) return;
  const id = await pickEntryId(arg);
  if (!id) return;
  updateEntry(repoRoot, id, { status: 'resolved' });
  refreshActiveEditor();
  sidebar?.refresh();
  vscode.window.showInformationMessage('git-tasks: annotation resolved.');
}

async function deleteAnnotationCmd(arg?: unknown): Promise<void> {
  if (!repoRoot) return;
  const id = await pickEntryId(arg);
  if (!id) return;
  const confirm = await vscode.window.showWarningMessage(
    'Delete this annotation?',
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;
  removeEntry(repoRoot, id);
  refreshActiveEditor();
  sidebar?.refresh();
}

async function filterByStatusCmd(): Promise<void> {
  const pick = await vscode.window.showQuickPick(['all', ...ENTRY_STATUSES], {
    placeHolder: 'Filter by status',
  });
  if (!pick) return;
  sidebar?.setFilter({ status: pick as EntryStatus | 'all' });
}

async function filterByTypeCmd(): Promise<void> {
  const pick = await vscode.window.showQuickPick(['all', ...ENTRY_TYPES], {
    placeHolder: 'Filter by type',
  });
  if (!pick) return;
  sidebar?.setFilter({ type: pick as EntryType | 'all' });
}

async function filterAssignedToMeCmd(): Promise<void> {
  const current = sidebar?.getFilter().assignedToMe ?? false;
  sidebar?.setFilter({ assignedToMe: !current });
  vscode.window.showInformationMessage(
    `git-tasks: ${!current ? 'showing only annotations assigned to you' : 'showing all annotations'}`,
  );
}

export function deactivate(): void {
  // disposables registered with context.subscriptions are cleaned up by VS Code.
}
