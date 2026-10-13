import { Layer, ManagedRuntime } from "effect";
import * as vscode from "vscode";
import { GitServiceLive } from "./infrastructure/git-live";
import { LoggerServiceLive } from "./infrastructure/log-live";
import { RepositoryServiceLive } from "./infrastructure/repository-live";
import { SecretServiceLive } from "./infrastructure/secret-live";
import { VSCodeServiceLive } from "./infrastructure/vscode-live";
import { type API as GitAPI, type GitExtension } from "./types/git";

export const getGitAPI = async (): Promise<GitAPI> => {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");

  if (!extension) {
    throw new Error("VS Code Git extension is not available");
  }

  const gitExtension = extension.isActive ? extension.exports : await extension.activate();

  return gitExtension.getAPI(1);
};

export async function activate(context: vscode.ExtensionContext) {
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

  const disposable = vscode.commands.registerCommand("patchwork.helloWorld", () => {
    vscode.window.showInformationMessage("Hello World from patchwork!");
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
