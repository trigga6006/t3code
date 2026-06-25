import type { PreviewViewportSetting } from "@t3tools/contracts";

type BrowserViewportHandler = (setting: PreviewViewportSetting) => Promise<void>;

const handlers = new Map<string, BrowserViewportHandler>();

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
  const handler = handlers.get(tabId);
  return handler
    ? handler(setting)
    : Promise.reject(new Error(`No visible browser viewport handler for tab ${tabId}`));
}
