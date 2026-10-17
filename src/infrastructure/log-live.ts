import { Layer } from "effect";
import { LoggerService } from "../services/log";
import * as vscode from "vscode";

export const LoggerServiceLive = (channel: vscode.LogOutputChannel) =>
  Layer.succeed(LoggerService, {
    debug: (message, ...args) => channel.debug(message, ...args),
    info: (message, ...args) => channel.info(message, ...args),
    warn: (message, ...args) => channel.warn(message, ...args),
    error: (message, ...args) => channel.error(message, ...args),
    dispose: () => channel.dispose(),
  });
