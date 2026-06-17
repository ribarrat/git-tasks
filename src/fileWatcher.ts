import * as vscode from 'vscode';
import * as path from 'node:path';

export interface WatcherHandlers {
  onAnnotationsChanged: (changedFile?: string) => void;
}

/**
 * Watch .git-tasks/ for any JSON changes (e.g. after git pull, or CLI edits).
 */
export class AnnotationsWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher;

  constructor(repoRoot: string, handlers: WatcherHandlers) {
    const pattern = new vscode.RelativePattern(repoRoot, '.git-tasks/**/*.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const fire = (uri: vscode.Uri) => {
      const rel = path.relative(repoRoot, uri.fsPath).split(path.sep).join('/');
      handlers.onAnnotationsChanged(rel);
    };
    this.watcher.onDidCreate(fire);
    this.watcher.onDidChange(fire);
    this.watcher.onDidDelete(fire);
  }

  dispose(): void {
    this.watcher.dispose();
  }
}
