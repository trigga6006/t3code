import type { PreviewViewportSetting } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BROWSER_VIEWPORT_COMMIT_TIMEOUT_MS,
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
    expect(second).toHaveBeenCalledWith(
      { _tag: "freeform", width: 900, height: 700 },
      expect.any(AbortSignal),
    );

    unsubscribeSecond();
    await expect(
      commitBrowserViewportChange("tab-1", {
        _tag: "freeform",
        width: 800,
        height: 600,
      }),
    ).rejects.toThrow("No visible browser viewport handler");
  });

  it("commits viewport changes in order for each tab", async () => {
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const calls: Array<number> = [];
    const unsubscribe = subscribeBrowserViewportChange("tab-serial", async (setting) => {
      if (setting._tag === "fill") return;
      calls.push(setting.width);
      if (setting.width === 800) {
        markFirstStarted?.();
        await firstPending;
      }
    });

    const first = commitBrowserViewportChange("tab-serial", {
      _tag: "freeform",
      width: 800,
      height: 600,
    });
    const second = commitBrowserViewportChange("tab-serial", {
      _tag: "freeform",
      width: 900,
      height: 700,
    });
    await firstStarted;
    expect(calls).toEqual([800]);

    releaseFirst?.();
    await Promise.all([first, second]);
    expect(calls).toEqual([800, 900]);
    unsubscribe();
  });

  it("releases the per-tab queue when a viewport handler never settles", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<void>(() => undefined);
      const handler = vi.fn(
        async (_setting: PreviewViewportSetting, _signal: AbortSignal): Promise<void> => undefined,
      );
      handler.mockImplementationOnce(() => never).mockResolvedValueOnce(undefined);
      const unsubscribe = subscribeBrowserViewportChange("tab-timeout", handler);
      const first = commitBrowserViewportChange("tab-timeout", {
        _tag: "freeform",
        width: 800,
        height: 600,
      });
      const firstResult = expect(first).rejects.toThrow(
        "Timed out committing the browser viewport for tab tab-timeout",
      );
      const second = commitBrowserViewportChange("tab-timeout", {
        _tag: "freeform",
        width: 900,
        height: 700,
      });

      await vi.advanceTimersByTimeAsync(BROWSER_VIEWPORT_COMMIT_TIMEOUT_MS);
      await firstResult;
      await second;

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
      expect((handler.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(true);
      expect(handler.mock.calls[1]?.[0]).toMatchObject({ width: 900, height: 700 });
      expect(handler.mock.calls[1]?.[1]).toBeInstanceOf(AbortSignal);
      expect((handler.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(false);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
