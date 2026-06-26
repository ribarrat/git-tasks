import * as vscode from 'vscode';
import * as path from 'node:path';
import { AnnotationEntry } from './types';
import { isDrifted } from './taskManager';
import { isCurrentUser } from './gitHelper';

interface DecoSet {
  task: vscode.TextEditorDecorationType;
  taskMine: vscode.TextEditorDecorationType;
  comment: vscode.TextEditorDecorationType;
  commentMine: vscode.TextEditorDecorationType;
  issue: vscode.TextEditorDecorationType;
  issueMine: vscode.TextEditorDecorationType;
  drift: vscode.TextEditorDecorationType;
  driftMine: vscode.TextEditorDecorationType;
}

export class GutterProvider implements vscode.Disposable {
  private decos: DecoSet;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    const make = (file: string): vscode.TextEditorDecorationType =>
      vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.file(
          path.join(context.extensionPath, 'resources', 'icons', file),
        ),
        gutterIconSize: 'contain',
        overviewRulerLane: vscode.OverviewRulerLane.Center,
        isWholeLine: false,
      });
    this.decos = {
      task: make('task.svg'),
      taskMine: make('task-mine.svg'),
      comment: make('comment.svg'),
      commentMine: make('comment-mine.svg'),
      issue: make('issue.svg'),
      issueMine: make('issue-mine.svg'),
      drift: make('drift.svg'),
      driftMine: make('drift-mine.svg'),
    };
  }

  /**
   * Apply gutter decorations for the given entries to the editor.
   * `repoRoot` is used for assignee matching.
   */
  apply(
    editor: vscode.TextEditor,
    repoRoot: string,
    entries: AnnotationEntry[],
  ): void {
    const content = editor.document.getText();

    const buckets: Record<keyof DecoSet, vscode.DecorationOptions[]> = {
      task: [],
      taskMine: [],
      comment: [],
      commentMine: [],
      issue: [],
      issueMine: [],
      drift: [],
      driftMine: [],
    };

    for (const e of entries) {
      const mine = isCurrentUser(repoRoot, e.assignee);
      const drifted = isDrifted(content, e);
      const startLine = Math.max(0, e.line - 1);
      const endLine = Math.max(startLine, (e.endLine ?? e.line) - 1);

      const lastLineIdx = Math.max(0, editor.document.lineCount - 1);
      const clampedStart = Math.min(startLine, lastLineIdx);
      const clampedEnd = Math.min(endLine, lastLineIdx);

      for (let ln = clampedStart; ln <= clampedEnd; ln++) {
        const range = editor.document.lineAt(ln).range;
        const opt: vscode.DecorationOptions = { range };
        let bucket: keyof DecoSet;
        if (drifted) {
          bucket = mine ? 'driftMine' : 'drift';
        } else {
          switch (e.type) {
            case 'task':
              bucket = mine ? 'taskMine' : 'task';
              break;
            case 'comment':
              bucket = mine ? 'commentMine' : 'comment';
              break;
            case 'issue':
              bucket = mine ? 'issueMine' : 'issue';
              break;
          }
        }
        buckets[bucket].push(opt);
      }
    }

    for (const key of Object.keys(buckets) as Array<keyof DecoSet>) {
      editor.setDecorations(this.decos[key], buckets[key]);
    }
  }

  clear(editor: vscode.TextEditor): void {
    for (const key of Object.keys(this.decos) as Array<keyof DecoSet>) {
      editor.setDecorations(this.decos[key], []);
    }
  }

  dispose(): void {
    for (const key of Object.keys(this.decos) as Array<keyof DecoSet>) {
      this.decos[key].dispose();
    }
  }
}
