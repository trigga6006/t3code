import type { ThreadId } from "@t3tools/contracts";
import { FolderIcon, FolderPlusIcon, XIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useContextDirs, useContextDirsStore } from "../contextDirsStore";
import { Button } from "./ui/button";

interface BranchToolbarContextDirsProps {
  threadId: ThreadId;
  /** The thread's primary working directory (worktree path or project root). */
  mainWorkingDir: string | null;
  /**
   * When true the selection is frozen (server thread already has a first turn,
   * or the environment is locked): render static labels with no add/remove
   * affordances.
   */
  locked: boolean;
}

/** Last path segment of a POSIX or Windows path, for compact display. */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const segments = trimmed.split(/[/\\]/);
  return segments[segments.length - 1] || trimmed;
}

export const BranchToolbarContextDirs = memo(function BranchToolbarContextDirs({
  threadId,
  mainWorkingDir,
  locked,
}: BranchToolbarContextDirsProps) {
  const contextDirs = useContextDirs(threadId);
  const addDir = useContextDirsStore((store) => store.addDir);
  const removeDir = useContextDirsStore((store) => store.removeDir);
  const [isPicking, setIsPicking] = useState(false);

  const handleAdd = useCallback(async () => {
    if (isPicking) return;
    const api = readLocalApi();
    if (!api) return;
    setIsPicking(true);
    let picked: string | null = null;
    try {
      picked = await api.dialogs.pickFolder(
        mainWorkingDir ? { initialPath: mainWorkingDir } : undefined,
      );
    } catch {
      setIsPicking(false);
      return;
    }
    setIsPicking(false);
    if (picked) {
      addDir(threadId, picked);
    }
  }, [addDir, isPicking, mainWorkingDir, threadId]);

  const showAddButton = !locked && isElectron;

  return (
    <div className="flex min-w-0 items-center gap-1">
      {mainWorkingDir ? (
        <span
          className="inline-flex min-w-0 shrink items-center gap-1 text-sm font-medium text-muted-foreground/70 sm:text-xs"
          title={mainWorkingDir}
        >
          <FolderIcon className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{basename(mainWorkingDir)}</span>
        </span>
      ) : null}

      {contextDirs.map((dir) =>
        locked ? (
          <span
            key={dir}
            className="inline-flex min-w-0 shrink items-center gap-1 rounded-md border border-border/40 px-1.5 py-0.5 text-xs font-medium text-muted-foreground/70"
            title={dir}
          >
            <FolderIcon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{basename(dir)}</span>
          </span>
        ) : (
          <span
            key={dir}
            className="group inline-flex min-w-0 shrink items-center gap-1 rounded-md border border-border/50 bg-surface/50 py-0.5 pl-1.5 pr-0.5 text-xs font-medium text-muted-foreground/80"
            title={dir}
          >
            <FolderIcon className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{basename(dir)}</span>
            <button
              type="button"
              aria-label={`Remove context folder ${basename(dir)}`}
              className="inline-flex size-3.5 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:bg-muted hover:text-foreground"
              onClick={() => removeDir(threadId, dir)}
            >
              <XIcon className="size-2.5" />
            </button>
          </span>
        ),
      )}

      {showAddButton ? (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 text-muted-foreground/60 hover:text-foreground/80"
          aria-label="Add context folder"
          title="Add a context folder for the agent"
          disabled={isPicking}
          onClick={handleAdd}
        >
          <FolderPlusIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  );
});
