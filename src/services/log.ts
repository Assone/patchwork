import { Context } from "effect";

export interface LoggerServiceApi {
  readonly debug: (message: string, ...args: any[]) => void;
  readonly info: (message: string, ...args: any[]) => void;
  readonly warn: (message: string, ...args: any[]) => void;
  readonly error: (message: string, ...args: any[]) => void;
  readonly dispose: () => void;
}

export class LoggerService extends Context.Service<LoggerService, LoggerServiceApi>()(
  "patchwork/LoggerService",
) {}
