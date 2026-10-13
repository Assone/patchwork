import { Layer } from "effect";
import { LoggerService } from "../services/log";
import * as vscode from "vscode";

export const LoggerServiceLive = (channel: vscode.LogOutputChannel) =>
  Layer.succeed(LoggerService, {
    trace: (message) => channel.trace(message),
    debug: (message) => channel.debug(message),
    info: (message) => channel.info(message),
    warn: (message) => channel.warn(message),
    error: (message) => channel.error(message),
    dispose: () => channel.dispose(),
  });
