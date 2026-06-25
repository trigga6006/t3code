"use client";

import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type PreviewAutomationNavigateInput,
  type PreviewAutomationOpenInput,
  type PreviewAutomationHost as PreviewAutomationHostState,
  type PreviewAutomationRequest,
  type PreviewAutomationStatus,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Atom } from "effect/unstable/reactivity";

import {
  applyPreviewServerSnapshot,
  prunePreviewSessions,
  readThreadPreviewState,
} from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { resolveBrowserNavigationTarget } from "~/browser/browserTargetResolver";
import { startBrowserRecording, stopBrowserRecording } from "~/browser/browserRecording";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { isElectron } from "~/env";
import { useEnvironments } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { useAtomCommand } from "~/state/use-atom-command";

import { previewBridge } from "./previewBridge";
import {
  PreviewAutomationNavigationTimeoutError,
  PreviewAutomationOperationError,
  PreviewAutomationOverlayTimeoutError,
  PreviewAutomationRecordingNotActiveError,
  PreviewAutomationTargetUnavailableError,
} from "./previewAutomationErrors";
import { createPreviewAutomationRequestConsumerAtom } from "./previewAutomationRequestConsumer";
import { createPreviewAutomationClientId } from "./previewAutomationClientId";

const waitForDesktopOverlay = async (
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  timeoutMs: number,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = readThreadPreviewState(threadRef);
    if (state.desktopByTabId[tabId] && previewBridge) {
      const status = await previewBridge.automation.status(tabId);
      if (status.available) return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new PreviewAutomationOverlayTimeoutError({
    requestId,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    timeoutMs,
  });
};

const waitForNavigationReadiness = async (
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  readiness: PreviewAutomationNavigateInput["readiness"],
  timeoutMs: number,
): Promise<void> => {
  const targetReadiness = readiness ?? "load";
  if (!previewBridge || targetReadiness === "none") return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (targetReadiness === "domContentLoaded") {
      const readyState = await previewBridge.automation.evaluate(tabId, {
        expression: "document.readyState",
      });
      if (readyState === "interactive" || readyState === "complete") return;
    } else {
      const status = await previewBridge.automation.status(tabId);
      if (!status.loading) return;
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
  }
  throw new PreviewAutomationNavigationTimeoutError({
    requestId,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    tabId,
    readiness: targetReadiness,
    timeoutMs,
  });
};

const currentStatus = async (
  threadRef: ScopedThreadRef,
  requestedTabId: string | null,
): Promise<PreviewAutomationStatus> => {
  const state = readThreadPreviewState(threadRef);
  const tabId = requestedTabId ?? state.snapshot?.tabId ?? null;
  const snapshot = (tabId ? state.sessions[tabId] : null) ?? state.snapshot;
  const visible = tabId
    ? (useBrowserSurfaceStore.getState().byTabId[tabId]?.visible ?? false)
    : false;
  if (tabId && previewBridge && state.desktopByTabId[tabId]) {
    const status = await previewBridge.automation.status(tabId);
    return { ...status, visible };
  }
  const navStatus = snapshot?.navStatus;
  return {
    available: Boolean(previewBridge?.automation),
    visible,
    tabId,
    url: navStatus && navStatus._tag !== "Idle" ? navStatus.url : null,
    title: navStatus && navStatus._tag !== "Idle" ? navStatus.title : null,
    loading: navStatus?._tag === "Loading",
  };
};

export function PreviewAutomationHosts() {
  const { environments } = useEnvironments();
  if (!isElectron || !previewBridge?.automation) return null;
  return (
    <>
      {/*
       * Host lifetime follows the desktop runtime's environment connections,
       * not the routed thread. This keeps background threads automatable and
       * lets the subscription runtime own reconnects for every saved target.
       */}
      {environments.map((environment) => (
        <PreviewAutomationHost
          key={environment.environmentId}
          environmentId={environment.environmentId}
        />
      ))}
    </>
  );
}

function PreviewAutomationHost(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const registry = useContext(RegistryContext);
  const [automationClientId] = useState(createPreviewAutomationClientId);
  const initialAutomationHost = useMemo<PreviewAutomationHostState>(
    () => ({
      clientId: automationClientId,
      environmentId,
    }),
    [automationClientId, environmentId],
  );
  const automationRequestsAtom = previewEnvironment.automationRequests({
    environmentId,
    input: initialAutomationHost,
  });
  const listPreviews = useAtomQueryRunner(previewEnvironment.list, {
    reportFailure: false,
  });
  const open = useAtomCommand(previewEnvironment.open, {
    reportFailure: false,
  });
  const respondToAutomation = useAtomCommand(
    previewEnvironment.respondToAutomation,
    "preview automation response",
  );
  const focusAutomationHost = useAtomCommand(
    previewEnvironment.focusAutomationHost,
    "preview automation host focus",
  );
  const [automationConnectionAtom] = useState(() => Atom.make<string | null>(null));
  const automationConnectionId = useAtomValue(automationConnectionAtom);

  const handleRequest = useCallback(
    async (request: PreviewAutomationRequest): Promise<unknown> => {
      const threadRef: ScopedThreadRef = {
        environmentId,
        threadId: request.threadId,
      };
      let tabId = request.tabId ?? null;
      try {
        let state = readThreadPreviewState(threadRef);
        const needsSessionSync =
          Object.keys(state.sessions).length === 0 ||
          (request.tabId !== undefined && state.sessions[request.tabId] === undefined);
        if (needsSessionSync) {
          const listTarget = {
            environmentId,
            input: { threadId: request.threadId },
          } as const;
          registry.refresh(previewEnvironment.list(listTarget));
          const result = await listPreviews(listTarget);
          if (result._tag === "Failure") {
            throw squashAtomCommandFailure(result);
          }
          const serverTabIds = new Set<string>();
          for (const snapshot of result.value.sessions) {
            applyPreviewServerSnapshot(threadRef, snapshot);
            serverTabIds.add(snapshot.tabId);
          }
          prunePreviewSessions(threadRef, serverTabIds);
          state = readThreadPreviewState(threadRef);
        }
        tabId = request.tabId ?? state.snapshot?.tabId ?? null;
        const unavailableTarget = {
          requestId: request.requestId,
          operation: request.operation,
          environmentId,
          threadId: request.threadId,
          tabId,
          bridgeAvailable: Boolean(previewBridge),
        };
        const requireReadyTab = async () => {
          const bridge = previewBridge;
          const readyTabId = tabId;
          if (!bridge || !readyTabId) {
            throw new PreviewAutomationTargetUnavailableError(unavailableTarget);
          }
          await waitForDesktopOverlay(threadRef, request.requestId, readyTabId, request.timeoutMs);
          return { bridge, tabId: readyTabId };
        };
        switch (request.operation) {
          case "status":
            return await currentStatus(threadRef, tabId);
          case "open": {
            const input = request.input as PreviewAutomationOpenInput;
            let activeTabId =
              (input.reuseExistingTab ?? true) ? (state.snapshot?.tabId ?? null) : null;
            const reusedExistingTab = activeTabId !== null;
            tabId = activeTabId;
            if (!activeTabId) {
              const result = await open({
                environmentId,
                input: {
                  threadId: request.threadId,
                  ...(input.url ? { url: input.url } : {}),
                },
              });
              if (result._tag === "Failure") {
                throw squashAtomCommandFailure(result);
              }
              const snapshot = result.value;
              applyPreviewServerSnapshot(threadRef, snapshot);
              activeTabId = snapshot.tabId;
              tabId = activeTabId;
            }
            if (input.show ?? true) {
              useRightPanelStore.getState().openBrowser(threadRef, activeTabId);
            }
            await waitForDesktopOverlay(
              threadRef,
              request.requestId,
              activeTabId,
              request.timeoutMs,
            );
            if (reusedExistingTab && input.url && previewBridge) {
              await previewBridge.navigate(activeTabId, input.url);
              await waitForNavigationReadiness(
                threadRef,
                request.requestId,
                activeTabId,
                "load",
                request.timeoutMs,
              );
            }
            return await currentStatus(threadRef, activeTabId);
          }
          case "navigate": {
            const ready = await requireReadyTab();
            const input = request.input as PreviewAutomationNavigateInput;
            const resolution = resolveBrowserNavigationTarget(
              environmentId,
              input.target ?? {
                kind: "url",
                url: input.url!,
              },
            );
            await ready.bridge.navigate(ready.tabId, resolution.resolvedUrl);
            await waitForNavigationReadiness(
              threadRef,
              request.requestId,
              ready.tabId,
              input.readiness ?? "load",
              input.timeoutMs ?? request.timeoutMs,
            );
            return await currentStatus(threadRef, ready.tabId);
          }
          case "snapshot": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.snapshot(ready.tabId);
          }
          case "click": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.click(
              ready.tabId,
              request.input as Parameters<typeof ready.bridge.automation.click>[1],
            );
          }
          case "type": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.type(
              ready.tabId,
              request.input as Parameters<typeof ready.bridge.automation.type>[1],
            );
          }
          case "press": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.press(
              ready.tabId,
              request.input as Parameters<typeof ready.bridge.automation.press>[1],
            );
          }
          case "scroll": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.scroll(
              ready.tabId,
              request.input as Parameters<typeof ready.bridge.automation.scroll>[1],
            );
          }
          case "evaluate": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.evaluate(
              ready.tabId,
              request.input as Parameters<typeof ready.bridge.automation.evaluate>[1],
            );
          }
          case "waitFor": {
            const ready = await requireReadyTab();
            return await ready.bridge.automation.waitFor(
              ready.tabId,
              request.input as Parameters<typeof ready.bridge.automation.waitFor>[1],
            );
          }
          case "recordingStart": {
            const ready = await requireReadyTab();
            const startedAt = await startBrowserRecording(ready.tabId);
            return {
              tabId: ready.tabId,
              recording: true,
              startedAt,
            };
          }
          case "recordingStop": {
            const ready = await requireReadyTab();
            const artifact = await stopBrowserRecording(ready.tabId);
            if (!artifact) {
              throw new PreviewAutomationRecordingNotActiveError({
                requestId: request.requestId,
                environmentId,
                threadId: request.threadId,
                tabId: ready.tabId,
              });
            }
            return artifact;
          }
        }
      } catch (cause) {
        throw PreviewAutomationOperationError.fromCause({
          requestId: request.requestId,
          operation: request.operation,
          environmentId,
          threadId: request.threadId,
          tabId,
          cause,
        });
      }
    },
    [environmentId, listPreviews, open, registry],
  );
  const [requestHandlerAtom] = useState(() => Atom.make({ handle: handleRequest }));
  const setRequestHandler = useAtomSet(requestHandlerAtom);
  useEffect(() => {
    setRequestHandler({ handle: handleRequest });
  }, [handleRequest, setRequestHandler]);

  const automationRequestConsumerAtom = useMemo(
    () =>
      createPreviewAutomationRequestConsumerAtom({
        requestsAtom: automationRequestsAtom,
        clientId: automationClientId,
        connectionAtom: automationConnectionAtom,
        environmentId,
        requestHandlerAtom,
        respond: (response) =>
          respondToAutomation({
            environmentId,
            input: response,
          }),
        label: `preview:automation-host:${environmentId}:${automationClientId}`,
      }),
    [
      automationClientId,
      automationConnectionAtom,
      automationRequestsAtom,
      requestHandlerAtom,
      respondToAutomation,
      environmentId,
    ],
  );
  useAtomValue(automationRequestConsumerAtom);

  useEffect(() => {
    const report = () => {
      if (!automationConnectionId) return;
      void focusAutomationHost({
        environmentId,
        input: {
          clientId: automationClientId,
          environmentId,
          connectionId: automationConnectionId,
          focused: document.hasFocus(),
        },
      });
    };
    report();
    window.addEventListener("focus", report);
    window.addEventListener("blur", report);
    return () => {
      window.removeEventListener("focus", report);
      window.removeEventListener("blur", report);
    };
  }, [automationClientId, automationConnectionId, environmentId, focusAutomationHost]);

  return null;
}
