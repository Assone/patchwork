import { Effect, Layer, ManagedRuntime } from "effect";
import * as vscode from "vscode";
import { GitServiceLive } from "./infrastructure/git-live";
import { LoggerServiceLive } from "./infrastructure/log-live";
import { RepositoryServiceLive } from "./infrastructure/repository-live";
import {
  createHostClient,
  createHostTransport,
  createLoggerObserver,
  createWebviewWire,
  registerEffectHandler,
} from "./rpc/host";
import { SecretServiceLive } from "./infrastructure/secret-live";
import { VSCodeServiceLive } from "./infrastructure/vscode-live";
import { type API as GitAPI, type GitExtension } from "./types/git";
import { GitService } from "./services/git";
import { RepositoryService } from "./services/repository";
import { VSCodeService } from "./services/vscode";
import template from "./webview/index.html";
import path from "node:path";

/**
 * The repository the webview is currently operating on.
 *
 * The webview has no filesystem or workspace access of its own, so the
 * host is the authority on which repository is in play. Resolution
 * order: an open git repository first, then the first workspace
 * folder, so a plain folder without git still works.
 */
const getCurrentRepositoryRoot = Effect.fn("getCurrentRepositoryRoot")(function* () {
  const repository = yield* RepositoryService;
  const repositories = yield* repository.getRepositories;
  const openRepository = repositories[0]?.root;
  if (openRepository !== undefined) {
    return openRepository;
  }

  const vsCode = yield* VSCodeService;
  const workspaceFolders = yield* vsCode.getWorkspaceFolders();
  const workspaceFolder = workspaceFolders[0];
  if (workspaceFolder === undefined) {
    throw new Error("No repository or workspace folder is open");
  }
  return workspaceFolder.uri.fsPath;
});

export async function activate(context: vscode.ExtensionContext) {
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const git = await getGitAPI();

  const logger = vscode.window.createOutputChannel("Patchwork", {
    log: true,
  });

  const AppLive = Layer.mergeAll(
    LoggerServiceLive(logger),
    SecretServiceLive(context),
    RepositoryServiceLive(git),
    GitServiceLive,
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

      // Expose the host's Effect services to the webview over RPC. The
      // webview calls `git.getChangedFiles(...)` and awaits a plain
      // Promise; the Effect never leaves this process.
      //
      // The observer matters: handler failures are answered to the
      // webview, so without it the host's log would show nothing at all
      // when something goes wrong on this side.
      const client = createHostClient(
        createHostTransport(createWebviewWire(panel.webview), {
          includeErrorStacks: isDev,
          observer: createLoggerObserver(runtime),
        }),
      );
      const registerRPCHandler = registerEffectHandler(client, runtime);

      registerRPCHandler("host.handshake", () =>
        Effect.gen(function* () {
          const vsCode = yield* VSCodeService;
          const workspaceFolders = (yield* vsCode.getWorkspaceFolders()).map(
            (folder) => folder.uri.fsPath,
          );
          const repositoryRoot = yield* getCurrentRepositoryRoot();
          return { repositoryRoot, workspaceFolders };
        }),
      );
      registerRPCHandler("git.getChangedFiles", () =>
        Effect.gen(function* () {
          const git = yield* GitService;
          const repositoryRoot = yield* getCurrentRepositoryRoot();
          return yield* git.getChangedFiles(repositoryRoot);
        }),
      );
      registerRPCHandler("git.getFileDiff", ({ path }) =>
        Effect.gen(function* () {
          const git = yield* GitService;
          const repositoryRoot = yield* getCurrentRepositoryRoot();

          const changed = yield* git.getChangedFiles(repositoryRoot);
          const target = changed.find((file) => file.path === path);
          const area = target?.staged === true ? "staged" : "unstaged";

          return yield* git.getFileDiff(repositoryRoot, path, area);
        }),
      );

      context.subscriptions.push(client);
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
