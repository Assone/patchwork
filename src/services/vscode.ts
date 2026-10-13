import { Context, Effect } from "effect";
import type { WorkspaceFolder } from "vscode";

interface VSCodeServiceApi {
  showInformationMessage(message: string): Effect.Effect<void>;
  showErrorMessage(message: string): Effect.Effect<void>;
  showWarningMessage(message: string): Effect.Effect<void>;
  getWorkspaceFolders(): Effect.Effect<readonly WorkspaceFolder[]>;
}

export class VSCodeService extends Context.Service<VSCodeService, VSCodeServiceApi>()(
  "patchwork/VSCodeService",
) {}
