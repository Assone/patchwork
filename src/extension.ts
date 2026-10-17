import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import * as vscode from "vscode";
import { GitServiceLive } from "./infrastructure/git-live";
import { LoggerServiceLive } from "./infrastructure/log-live";
import { LLMConfigServiceLive } from "./infrastructure/config-live";
import { LLMServiceLive } from "./infrastructure/llm-live";
import { RepositoryServiceLive } from "./infrastructure/repository-live";
import {
  createHostClient,
  createHostTransport,
  createLoggerObserver,
  createWebviewWire,
} from "./rpc/host";
import { SecretServiceLive } from "./infrastructure/secret-live";
import { type API as GitAPI, type GitExtension } from "./types/git";
import type { HostApi, WebviewApi } from "./rpc/protocol";
import { RepositoryService } from "./services/repository";

import path from "node:path";
import { registerClientHandler } from "./host/handlers";
import { getHtmlForWebview } from "./host/webview-html";
import { setupWebviewReload } from "./host/dev-reload";

export async function activate(context: vscode.ExtensionContext) {
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const git = await getGitAPI();

  const logger = vscode.window.createOutputChannel("Patchwork", {
    log: true,
  });
  context.subscriptions.push(logger);

  const secretLayer = SecretServiceLive(context);

  const AppLive = Layer.mergeAll(
    LoggerServiceLive(logger),
    secretLayer,
    RepositoryServiceLive(git),
    GitServiceLive(git.git.path),
    LLMServiceLive.pipe(Layer.provide(secretLayer)),
    LLMConfigServiceLive.pipe(Layer.provide(secretLayer)),
  );
  const runtime = ManagedRuntime.make(AppLive);

  context.subscriptions.push({
    dispose: () => {
      void runtime.dispose();
    },
  });

  // Registered once per activation, not per panel: `setupWebviewReload`
  // appends its watcher to `context.subscriptions`, so calling it inside
  // the command would accumulate one watcher for every composer the user
  // ever opened.
  if (isDev) {
    setupWebviewReload(context);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "patchwork.openCommitComposer",
      async (sourceControl?: vscode.SourceControl) => {
        const repositoryRoot = await resolveRepositoryRoot(git, sourceControl);
        if (repositoryRoot === undefined) {
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          "patchwork.commitComposer",
          `Patchwork · ${path.basename(repositoryRoot)}`,
          vscode.ViewColumn.One,
          {
            localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "dist"))],
            enableScripts: true,
            retainContextWhenHidden: true,
          },
        );

        const transport = createHostTransport(createWebviewWire(panel.webview), {
          includeErrorStacks: isDev,
          observer: createLoggerObserver(runtime),
        });

        const client = createHostClient<HostApi>(transport);
        const notifier = createHostClient<WebviewApi>(transport);

        const disposeHandlers = registerClientHandler(client, notifier, runtime, repositoryRoot);

        const pushFiber = runtime.runFork(
          Effect.gen(function* () {
            const repository = yield* RepositoryService;
            yield* Stream.runForEach(repository.changes, (change) =>
              change.repository.root === repositoryRoot
                ? Effect.sync(() => {
                    notifier.notify("repo.invalidate", { reason: change.reason });
                  })
                : Effect.void,
            );
          }),
        );

        panel.webview.html = getHtmlForWebview(context, panel.webview);

        panel.onDidDispose(() => {
          // Abort provider requests before tearing down the wire: the
          // webview is going away, so nothing should keep streaming.
          disposeHandlers();
          pushFiber.interruptUnsafe();
          client.dispose();
        });
      },
    ),
  );
}

/**
 * The composer is bound to one repository. The SCM title passes its
 * `SourceControl`; the command palette falls back to a picker.
 */
const resolveRepositoryRoot = async (
  git: GitAPI,
  sourceControl?: vscode.SourceControl,
): Promise<string | undefined> => {
  const repositories = git.repositories;
  const sourceRoot = sourceControl?.rootUri?.fsPath;
  if (sourceRoot !== undefined) {
    const match = repositories.find((repository) => repository.rootUri.fsPath === sourceRoot);
    if (match !== undefined) {
      return match.rootUri.fsPath;
    }
  }

  if (repositories.length === 1) {
    return repositories[0]?.rootUri.fsPath;
  }

  if (repositories.length > 1) {
    const pick = await vscode.window.showQuickPick(
      repositories.map((repository) => ({
        label: path.basename(repository.rootUri.fsPath),
        description: repository.rootUri.fsPath,
        root: repository.rootUri.fsPath,
      })),
      { title: "Patchwork · choose a repository", ignoreFocusOut: true },
    );
    return pick?.root;
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) {
    return folders[0]?.uri.fsPath;
  }
  if (folders.length > 1) {
    const pick = await vscode.window.showQuickPick(
      folders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        root: folder.uri.fsPath,
      })),
      { title: "Patchwork · choose a workspace folder", ignoreFocusOut: true },
    );
    return pick?.root;
  }

  void vscode.window.showErrorMessage("Patchwork: no repository or workspace folder is open.");
  return undefined;
};

export function deactivate() {}

const getGitAPI = async (): Promise<GitAPI> => {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");

  if (!extension) {
    throw new Error("VS Code Git extension is not available");
  }

  const gitExtension = extension.isActive ? extension.exports : await extension.activate();

  return gitExtension.getAPI(1);
};
