import { scopedProjectKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_SERVER_SETTINGS,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { useCallback } from "react";

import {
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
  type DraftId,
} from "../composerDraftStore";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import { newDraftId, newThreadId } from "../lib/utils";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { readThreadShell, useProjects, useServerConfigs } from "../state/entities";
import { useClientSettings } from "./useSettings";

/**
 * Non-navigating sibling of `useNewThreadHandler` (see `useHandleNewThread.ts`).
 *
 * Returns a stable `DraftId` for a project WITHOUT navigating, so the welcome
 * landing can bind the real `ChatComposer` to it in place. It mirrors the
 * navigating hook's "reuse stored draft" and "create new draft" branches —
 * including logical-project-key grouping and stale-promoted-draft cleanup — so
 * the two stay in sync. The third branch in `useNewThreadHandler` (reuse the
 * draft already on the current route) is a navigation optimization that does
 * not apply here, since the landing is never mounted on a draft route.
 *
 * NOTE: keep this in sync with `useNewThreadHandler` if its draft-creation
 * logic changes.
 */
export function useEnsureProjectDraft(): (projectRef: ScopedProjectRef) => DraftId {
  const projects = useProjects();
  const serverConfigs = useServerConfigs();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);

  return useCallback(
    (projectRef: ScopedProjectRef): DraftId => {
      const {
        getDraftSessionByLogicalProjectKey,
        applyStickyState,
        setLogicalProjectDraftThreadId,
      } = useComposerDraftStore.getState();

      const project = projects.find(
        (candidate) =>
          candidate.id === projectRef.projectId &&
          candidate.environmentId === projectRef.environmentId,
      );
      const environmentSettings =
        serverConfigs.get(projectRef.environmentId)?.settings ?? DEFAULT_SERVER_SETTINGS;
      const logicalProjectKey = project
        ? deriveLogicalProjectKeyFromSettings(project, projectGroupingSettings)
        : scopedProjectKey(projectRef);

      const storedDraftThread = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      const storedDraftThreadRef = storedDraftThread
        ? scopeThreadRef(storedDraftThread.environmentId, storedDraftThread.threadId)
        : null;
      // A stored draft whose thread already materialized on the server has been
      // promoted; it is no longer reusable as a draft.
      const reusableStoredDraftThread =
        storedDraftThreadRef && readThreadShell(storedDraftThreadRef) !== null
          ? null
          : storedDraftThread;
      if (storedDraftThreadRef && reusableStoredDraftThread === null) {
        markPromotedDraftThreadByRef(storedDraftThreadRef);
      }

      if (reusableStoredDraftThread) {
        setLogicalProjectDraftThreadId(
          logicalProjectKey,
          projectRef,
          reusableStoredDraftThread.draftId,
          { threadId: reusableStoredDraftThread.threadId },
        );
        return reusableStoredDraftThread.draftId;
      }

      const draftId = newDraftId();
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      const initialEnvMode = environmentSettings.defaultThreadEnvMode;
      setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, {
        threadId,
        createdAt,
        branch: null,
        worktreePath: null,
        envMode: initialEnvMode,
        startFromOrigin: resolveNewDraftStartFromOrigin({
          envMode: initialEnvMode,
          newWorktreesStartFromOrigin: environmentSettings.newWorktreesStartFromOrigin,
        }),
        runtimeMode: DEFAULT_RUNTIME_MODE,
      });
      applyStickyState(draftId);
      return draftId;
    },
    [projectGroupingSettings, projects, serverConfigs],
  );
}
