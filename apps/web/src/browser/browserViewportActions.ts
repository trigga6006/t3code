import type { PreviewViewportSetting } from "@t3tools/contracts";

type BrowserViewportHandler = (
  setting: PreviewViewportSetting,
  signal: AbortSignal,
) => Promise<void>;

export const BROWSER_VIEWPORT_COMMIT_TIMEOUT_MS = 15_000;

export class BrowserViewportCommitTimeoutError extends Error {
  override readonly name = "BrowserViewportCommitTimeoutError";

  constructor(readonly tabId: string) {
    super(`Timed out committing the browser viewport for tab ${tabId}`);
  }
}

const handlers = new Map<string, BrowserViewportHandler>();
const commitTails = new Map<string, Promise<void>>();

const runHandlerWithTimeout = (
  tabId: string,
  handler: BrowserViewportHandler,
  setting: PreviewViewportSetting,
): Promise<void> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new BrowserViewportCommitTimeoutError(tabId));
    }, BROWSER_VIEWPORT_COMMIT_TIMEOUT_MS);
  });
  return Promise.race([
    Promise.resolve().then(() => handler(setting, controller.signal)),
    timeout,
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
};

export function subscribeBrowserViewportChange(
  tabId: string,
  handler: BrowserViewportHandler,
): () => void {
  handlers.set(tabId, handler);
  return () => {
    if (handlers.get(tabId) === handler) handlers.delete(tabId);
  };
}

export function commitBrowserViewportChange(
  tabId: string,
  setting: PreviewViewportSetting,
): Promise<void> {
  const previous = commitTails.get(tabId) ?? Promise.resolve();
  const commit = previous
    .catch(() => undefined)
    .then(() => {
      const handler = handlers.get(tabId);
      return handler
        ? runHandlerWithTimeout(tabId, handler, setting)
        : Promise.reject(new Error(`No visible browser viewport handler for tab ${tabId}`));
    });
  commitTails.set(tabId, commit);
  const clear = () => {
    if (commitTails.get(tabId) === commit) commitTails.delete(tabId);
  };
  void commit.then(clear, clear);
  return commit;
}
