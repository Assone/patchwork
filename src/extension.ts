import { Layer, ManagedRuntime } from "effect";
import * as vscode from "vscode";
import { GitServiceLive } from "./infrastructure/git-live";
import { LoggerServiceLive } from "./infrastructure/log-live";
import { RepositoryServiceLive } from "./infrastructure/repository-live";
import { SecretServiceLive } from "./infrastructure/secret-live";
import { VSCodeServiceLive } from "./infrastructure/vscode-live";
import { type API as GitAPI, type GitExtension } from "./types/git";
import template from "./webview/index.html";
import path from "node:path";

export async function activate(context: vscode.ExtensionContext) {
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const git = await getGitAPI();

  const logger = vscode.window.createOutputChannel("Patchwork", {
    log: true,
  });

  const AppLive = Layer.mergeAll(
    LoggerServiceLive(logger),
    SecretServiceLive(context),
    GitServiceLive,
    RepositoryServiceLive(git),
    VSCodeServiceLive,
  );
  const runtime = ManagedRuntime.make(AppLive);

  context.subscriptions.push(
    vscode.commands.registerCommand("patchwork.openCommitComposer", () => {
      const panel = vscode.window.createWebviewPanel(
        "patchwork.commitComposer", // viewType
        "Commit Composer", // 标题
        vscode.ViewColumn.One,
        {
          localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "dist"))],
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );

      if (isDev) {
        const distPath = vscode.Uri.joinPath(context.extensionUri, "dist").fsPath;
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(distPath, "*"),
        );

        watcher.onDidChange(() => {
          vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
        });

        watcher.onDidCreate(() => {
          vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
        });

        watcher.onDidDelete(() => {
          vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
        });

        context.subscriptions.push(watcher);
      }

      panel.webview.html = getHtmlForWebview(context, panel.webview);
    }),
  );
}

export function deactivate() {}

const getGitAPI = async (): Promise<GitAPI> => {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");

  if (!extension) {
    throw new Error("VS Code Git extension is not available");
  }

  const gitExtension = extension.isActive ? extension.exports : await extension.activate();

  return gitExtension.getAPI(1);
};

const getHtmlForWebview = (context: vscode.ExtensionContext, webview: vscode.Webview) => {
  const nonce = getNonce();

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js"),
  );
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.css"),
  );

  return template
    .replaceAll("{{NONCE}}", nonce)
    .replaceAll("{{CSP_SOURCE}}", webview.cspSource)
    .replaceAll("{{SCRIPT_URI}}", scriptUri.toString())
    .replaceAll("{{CSS_URI}}", cssUri.toString());
};

const getNonce = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
};
