import { Layer, Effect } from "effect";
import * as vscode from "vscode";
import { VSCodeService } from "../services/vscode";

export const VSCodeServiceLive = Layer.succeed(VSCodeService, {
  showInformationMessage: (message) =>
    Effect.promise(async () => {
      await vscode.window.showInformationMessage(message);
    }),
  showErrorMessage: (message) =>
    Effect.promise(async () => {
      await vscode.window.showErrorMessage(message);
    }),
  showWarningMessage: (message) =>
    Effect.promise(async () => {
      await vscode.window.showErrorMessage(message);
    }),
  getWorkspaceFolders: () => Effect.sync(() => vscode.workspace.workspaceFolders ?? []),
});
