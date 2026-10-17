import * as vscode from "vscode";

/** Reloads open webviews whenever the dev bundle changes. */
export const setupWebviewReload = (context: vscode.ExtensionContext) => {
  const distPath = vscode.Uri.joinPath(context.extensionUri, "dist").fsPath;
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(distPath, "*"),
  );
  const reload = () =>
    vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");

  watcher.onDidChange(reload);
  watcher.onDidCreate(reload);
  watcher.onDidDelete(reload);
  context.subscriptions.push(watcher);
};
