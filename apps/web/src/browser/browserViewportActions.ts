import type { PreviewViewportSetting } from "@t3tools/contracts";

type BrowserViewportHandler = (setting: PreviewViewportSetting) => Promise<void>;

const handlers = new Map<string, BrowserViewportHandler>();
const commitTails = new Map<string, Promise<void>>();

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
        ? handler(setting)
        : Promise.reject(new Error(`No visible browser viewport handler for tab ${tabId}`));
    });
  commitTails.set(tabId, commit);
  const clear = () => {
    if (commitTails.get(tabId) === commit) commitTails.delete(tabId);
  };
  void commit.then(clear, clear);
  return commit;
}
