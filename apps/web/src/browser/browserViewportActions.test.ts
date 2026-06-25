import { describe, expect, it, vi } from "vite-plus/test";

import {
  commitBrowserViewportChange,
  subscribeBrowserViewportChange,
} from "./browserViewportActions";

describe("browserViewportActions", () => {
  it("routes drag commits to the visible tab handler and cleans up exactly that handler", async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    const unsubscribeFirst = subscribeBrowserViewportChange("tab-1", first);
    const unsubscribeSecond = subscribeBrowserViewportChange("tab-1", second);

    unsubscribeFirst();
    await commitBrowserViewportChange("tab-1", {
      _tag: "freeform",
      width: 900,
      height: 700,
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ _tag: "freeform", width: 900, height: 700 });

    unsubscribeSecond();
    await expect(
      commitBrowserViewportChange("tab-1", {
        _tag: "freeform",
        width: 800,
        height: 600,
      }),
    ).rejects.toThrow("No visible browser viewport handler");
  });
});
