import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_MODEL,
  ProviderInstanceId,
  type EnvironmentId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { useCallback } from "react";

import {
  findProjectByPath,
  inferProjectTitleFromPath,
  resolveProjectPathForDispatch,
} from "../lib/projectPaths";
import { newProjectId } from "../lib/utils";
import { useProjects } from "../state/entities";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";

export type ResolveProjectForDirectoryResult =
  | { ok: true; projectRef: ScopedProjectRef }
  | { ok: false; error: string | null };

/**
 * Resolves a directory path to a project ref in the given environment, reusing
 * an existing project for the same path or creating a new one. This mirrors the
 * find-or-create half of `CommandPalette.handleAddProject`, minus navigation and
 * toasts, so it can be shared by the welcome landing's directory picker. The
 * caller is responsible for surfacing the `error` (e.g. via a toast) and for
 * navigation/draft creation.
 */
export function useResolveProjectForDirectory(): (
  rawCwd: string,
  environmentId: EnvironmentId,
) => Promise<ResolveProjectForDirectoryResult> {
  const projects = useProjects();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });

  return useCallback(
    async (rawCwd, environmentId) => {
      const cwd = resolveProjectPathForDispatch(rawCwd, null);
      if (cwd.length === 0) {
        return { ok: false, error: "Could not resolve that directory." };
      }

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === environmentId),
        cwd,
      );
      if (existing) {
        return { ok: true, projectRef: scopeProjectRef(existing.environmentId, existing.id) };
      }

      const projectId = newProjectId();
      const createResult = await createProject({
        environmentId,
        input: {
          projectId,
          title: inferProjectTitleFromPath(cwd),
          workspaceRoot: cwd,
          createWorkspaceRootIfMissing: true,
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          },
        },
      });
      if (createResult._tag === "Failure") {
        // Interrupted commands are intentional (e.g. environment teardown); the
        // caller should stay silent in that case.
        if (isAtomCommandInterrupted(createResult)) {
          return { ok: false, error: null };
        }
        const error = squashAtomCommandFailure(createResult);
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to add project.",
        };
      }

      return { ok: true, projectRef: scopeProjectRef(environmentId, projectId) };
    },
    [createProject, projects],
  );
}
