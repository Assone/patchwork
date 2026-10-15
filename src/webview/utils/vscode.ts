declare function acquireVsCodeApi(): {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  getState<T>(): T | undefined;
  setState<T>(newState: T): void;
};

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeWebviewApi;
  }
}

export type VsCodeWebviewApi = ReturnType<typeof acquireVsCodeApi>;
