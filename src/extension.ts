import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
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
  reconcileFile,
  removeEntry,
  updateEntry,
} from './taskManager';
import { findGitTasksOnPath, hooksInstalled, installHooks } from './hooks';
import { DESCRIPTION_HEADER, stripDescriptionHeader } from './description';
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

function updateLineHasAnnotationContext(): void {
  let lineHasAnnotation = false;
  const editor = vscode.window.activeTextEditor;
  if (editor && repoRoot) {
    const rel = relPath(editor.document.uri);
    if (rel) {
      const af = loadAnnotationFile(repoRoot, rel);
      if (af && af.entries.length > 0) {
        const ln = editor.selection.start.line + 1;
        lineHasAnnotation = af.entries.some(
          (e) => ln >= e.line && ln <= (e.endLine ?? e.line),
        );
      }
    }
  }
  void vscode.commands.executeCommand(
    'setContext',
    'gitTasks.lineHasAnnotation',
    lineHasAnnotation,
  );
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
  const showResolved = vscode.workspace
    .getConfiguration('git-tasks')
    .get<boolean>('showResolved', false);
  const entries = showResolved
    ? af.entries
    : af.entries.filter((e) => e.status !== 'resolved');
  gutter.apply(editor, repoRoot, entries);
}


// ---------- Description input ----------

/**
 * Open a scratch markdown buffer holding the current description. Saving the
 * file applies it; closing it without saving cancels. Save is the gesture the
 * editor already trains you to use, so it is the one that commits the text —
 * a notification button would be missed, and missing it would look like the
 * edit silently vanished.
 */
async function editDescriptionInEditor(initial: string): Promise<string | undefined> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-tasks-desc-'));
  const file = path.join(dir, 'DESCRIPTION.md');
  fs.writeFileSync(file, DESCRIPTION_HEADER + initial, 'utf8');

  const uri = vscode.Uri.file(file);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });

  const isOurs = (d: vscode.TextDocument): boolean => d.uri.fsPath === uri.fsPath;

  const result = await new Promise<string | undefined>((resolve) => {
    let settled = false;
    const settle = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      saveSub.dispose();
      closeSub.dispose();
      resolve(value);
    };
    const saveSub = vscode.workspace.onDidSaveTextDocument((d) => {
      if (isOurs(d)) settle(stripDescriptionHeader(d.getText()));
    });
    const closeSub = vscode.workspace.onDidCloseTextDocument((d) => {
      // Closing after a save also fires this; `settled` keeps the save result.
      if (isOurs(d)) settle(undefined);
    });
  });

  await closeDescriptionEditor(doc);
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

/**
 * Close the scratch editor if it is still open. It has just been saved (or is
 * being abandoned), so this never prompts about unsaved work.
 */
async function closeDescriptionEditor(doc: vscode.TextDocument): Promise<void> {
  const stillOpen = vscode.window.visibleTextEditors.some(
    (e) => e.document.uri.fsPath === doc.uri.fsPath,
  );
  if (!stillOpen) return;
  try {
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  } catch {
    // Best effort — the user may have closed it in the meantime.
  }
}

/**
 * Prompt for a description. The inline box stays the fast path for a one-line
 * note; the button escapes to a real editor when the text needs line breaks,
 * lists or links, which `showInputBox` cannot accept (Enter submits it).
 */
async function promptDescription(initial: string): Promise<string | undefined> {
  const box = vscode.window.createInputBox();
  box.title = 'Description (optional)';
  box.value = initial;
  box.placeholder = 'Longer context — why, acceptance criteria, links';
  box.prompt = 'Press Enter to accept, or use the pencil for multi-line markdown';
  const editButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('edit'),
    tooltip: 'Edit in editor…',
  };
  box.buttons = [editButton];

  try {
    const action = await new Promise<
      { kind: 'accept'; value: string } | { kind: 'editor'; value: string } | undefined
    >((resolve) => {
      let settled = false;
      const settle = (
        v: { kind: 'accept'; value: string } | { kind: 'editor'; value: string } | undefined,
      ) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      box.onDidAccept(() => settle({ kind: 'accept', value: box.value }));
      box.onDidTriggerButton(() => settle({ kind: 'editor', value: box.value }));
      box.onDidHide(() => settle(undefined));
      box.show();
    });

    if (!action) return undefined;
    box.hide();
    if (action.kind === 'accept') return action.value.trim();

    const edited = await editDescriptionInEditor(action.value);
    if (edited !== undefined) return edited;
    // Closing the scratch buffer means "I didn't write one", not "throw the
    // task away" — keep what was already typed and say so, rather than
    // aborting the whole flow with nothing to show for it.
    vscode.window.showInformationMessage(
      'git-tasks: description editor closed without saving — description left unchanged.',
    );
    return action.value.trim();
  } finally {
    box.dispose();
  }
}

/**
 * Settle drift for one file the moment it is saved. Inserting lines above a
 * task shifts it every time; without this the gutter stays flagged for the
 * whole editing session and only clears at the next commit or merge.
 */
function reconcileOnSave(document: vscode.TextDocument): void {
  if (!repoRoot) return;
  const rel = relPath(document.uri);
  if (!rel) return;
  const report = reconcileFile(repoRoot, rel, {
    apply: true,
    sourceContent: document.getText(),
  });
  if (report.applied > 0) {
    refreshActiveEditor();
    sidebar?.refresh();
  }
}

const HOOK_PROMPT_KEY = 'gitTasks.hookPromptDismissed';

/**
 * Reconcile-on-save only covers files edited in this window. Pulls, branch
 * switches and CLI-driven changes need the git hooks, so offer them once.
 */
async function maybePromptInstallHooks(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (!repoRoot) return;
  if (context.workspaceState.get<boolean>(HOOK_PROMPT_KEY)) return;
  if (hooksInstalled(repoRoot)) return;

  const choice = await vscode.window.showInformationMessage(
    'git-tasks: install git hooks so tasks re-anchor automatically on pull, checkout and commit?',
    'Install hooks',
    'Not now',
    "Don't ask again",
  );
  if (choice === 'Install hooks') {
    await installHooksCmd();
  } else if (choice === "Don't ask again") {
    await context.workspaceState.update(HOOK_PROMPT_KEY, true);
  }
}

async function installHooksCmd(): Promise<void> {
  if (!repoRoot) {
    vscode.window.showWarningMessage('git-tasks: not inside a Git repository.');
    return;
  }
  const invocation = findGitTasksOnPath();
  if (!invocation) {
    const pick = await vscode.window.showWarningMessage(
      'git-tasks: the `git-tasks` CLI is not on your PATH. Git hooks run in a bare shell and need it to be installed globally.',
      'Copy install command',
    );
    if (pick === 'Copy install command') {
      await vscode.env.clipboard.writeText('npm install -g @ribarrat/git-tasks');
      vscode.window.showInformationMessage('git-tasks: install command copied to clipboard.');
    }
    return;
  }
  try {
    installHooks(repoRoot, 'git-tasks');
    vscode.window.showInformationMessage(
      'git-tasks: installed post-merge, post-checkout and pre-commit hooks.',
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `git-tasks: could not install hooks — ${(err as Error).message}`,
    );
  }
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
      updateLineHasAnnotationContext();
    },
  });
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      refreshActiveEditor();
      updateLineHasAnnotationContext();
    }),
    vscode.window.onDidChangeTextEditorSelection(() => updateLineHasAnnotationContext()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) {
        refreshActiveEditor();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => reconcileOnSave(doc)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('git-tasks.showResolved')) {
        refreshActiveEditor();
        sidebar?.refresh();
      }
    }),
  );

  // Initial paint.
  refreshActiveEditor();
  sidebar.refresh();
  updateLineHasAnnotationContext();

  registerCommands(context);

  void maybePromptInstallHooks(context);
}

function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('git-tasks.addAnnotation', addAnnotationCmd),
    vscode.commands.registerCommand('git-tasks.editAnnotation', editAnnotationCmd),
    vscode.commands.registerCommand('git-tasks.resolveAnnotation', resolveAnnotationCmd),
    vscode.commands.registerCommand('git-tasks.reopenAnnotation', reopenAnnotationCmd),
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
    vscode.commands.registerCommand('git-tasks.installHooks', installHooksCmd),
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
    prompt: 'Task title',
    placeHolder: 'Short summary of the task / comment / issue',
  });
  if (!text) return;

  // Cancelling aborts; an empty string just means "no description".
  const descriptionInput = await promptDescription('');
  if (descriptionInput === undefined) return;

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
    description: descriptionInput || undefined,
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
            { placeHolder: 'Multiple tasks on this line' },
          );
          return pick?.id;
        }
      }
    }
  }
  vscode.window.showWarningMessage('git-tasks: no task found.');
  return undefined;
}

async function editAnnotationCmd(arg?: unknown): Promise<void> {
  if (!repoRoot) return;
  const id = await pickEntryId(arg);
  if (!id) return;
  const found = findEntryById(repoRoot, id);
  if (!found) {
    vscode.window.showWarningMessage('git-tasks: task not found.');
    return;
  }
  const newText = await vscode.window.showInputBox({
    prompt: 'Title',
    value: found.entry.text,
  });
  if (newText === undefined) return;

  const newDescription = await promptDescription(found.entry.description ?? '');
  if (newDescription === undefined) return;

  const newStatus = (await vscode.window.showQuickPick(ENTRY_STATUSES, {
    placeHolder: 'Status',
  })) as EntryStatus | undefined;

  const patch: Partial<AnnotationEntry> = {
    text: newText,
    description: newDescription || undefined,
  };
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
  vscode.window.showInformationMessage('git-tasks: task resolved.');
}

async function reopenAnnotationCmd(arg?: unknown): Promise<void> {
  if (!repoRoot) return;
  const id = await pickEntryId(arg);
  if (!id) return;
  updateEntry(repoRoot, id, { status: 'open' });
  refreshActiveEditor();
  sidebar?.refresh();
  vscode.window.showInformationMessage('git-tasks: task reopened.');
}

async function deleteAnnotationCmd(arg?: unknown): Promise<void> {
  if (!repoRoot) return;
  const id = await pickEntryId(arg);
  if (!id) return;
  const confirm = await vscode.window.showWarningMessage(
    'Delete this task?',
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
    `git-tasks: ${!current ? 'showing only tasks assigned to you' : 'showing all tasks'}`,
  );
}

export function deactivate(): void {
  // disposables registered with context.subscriptions are cleaned up by VS Code.
}
