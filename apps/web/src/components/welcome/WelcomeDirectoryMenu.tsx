import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "~/lib/utils";

/** Structural shape of the projects this menu renders (a subset of EnvironmentProject). */
interface DirectoryMenuProject {
  environmentId: EnvironmentId;
  id: ProjectId;
  title: string;
  workspaceRoot: string;
}

interface WelcomeDirectoryMenuProps {
  projects: ReadonlyArray<DirectoryMenuProject>;
  /** `scopedProjectKey` of the selected project, or null when none is selected. */
  selectedKey: string | null;
  onSelectProject: (ref: ScopedProjectRef) => void;
  onPickFolder: () => void;
  isPicking: boolean;
  canPickFolder: boolean;
}

/**
 * Combined directory control for the welcome landing: a dropdown of existing
 * projects plus a "Choose a folder…" action that opens the native picker.
 *
 * Built on `Popover` (not `Select`) deliberately — a Select sentinel item would
 * commit its value through normal selection, which we don't want for the
 * folder-picker action.
 */
export function WelcomeDirectoryMenu({
  projects,
  selectedKey,
  onSelectProject,
  onPickFolder,
  isPicking,
  canPickFolder,
}: WelcomeDirectoryMenuProps) {
  const [open, setOpen] = useState(false);

  const selected = projects.find(
    (project) =>
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) === selectedKey,
  );
  const triggerLabel = isPicking
    ? "Opening folder picker…"
    : (selected?.title ?? "Select a directory");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button className="max-w-72 gap-1.5" size="sm" variant="outline" />}>
        <FolderIcon className="size-4" />
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <ChevronDownIcon className="size-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1" side="bottom">
        {projects.length > 0 ? (
          <div className="max-h-64 overflow-y-auto">
            {projects.map((project) => {
              const ref = scopeProjectRef(project.environmentId, project.id);
              const key = scopedProjectKey(ref);
              const isActive = key === selectedKey;
              return (
                <button
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                    isActive && "bg-accent/60",
                  )}
                  key={key}
                  onClick={() => {
                    onSelectProject(ref);
                    setOpen(false);
                  }}
                  type="button"
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-foreground">{project.title}</span>
                    <span className="truncate text-xs text-muted-foreground/70">
                      {project.workspaceRoot}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {canPickFolder ? (
          <>
            {projects.length > 0 ? <div className="my-1 h-px bg-border" /> : null}
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60"
              disabled={isPicking}
              onClick={() => {
                setOpen(false);
                onPickFolder();
              }}
              type="button"
            >
              <FolderPlusIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-foreground">Choose a folder…</span>
            </button>
          </>
        ) : null}
        {projects.length === 0 && !canPickFolder ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No projects available.</div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
