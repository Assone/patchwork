import { Context } from "effect";

export interface LoggerServiceApi {
  readonly trace: (message: string) => void;
  readonly debug: (message: string) => void;
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly error: (message: string) => void;
  readonly dispose: () => void;
}

export class LoggerService extends Context.Service<LoggerService, LoggerServiceApi>()(
  "patchwork/LoggerService",
) {}
