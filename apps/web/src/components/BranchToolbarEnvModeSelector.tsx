import { CheckIcon, FolderGit2Icon } from "lucide-react";
import { memo } from "react";

import { type EnvMode } from "./BranchToolbar.logic";

interface BranchToolbarEnvModeSelectorProps {
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
}

/** Small square that mirrors the app checkbox look, reflecting the `checked` state. */
function WorktreeCheckboxBox({ checked, muted }: { checked: boolean; muted?: boolean }) {
  return (
    <span
      aria-hidden
      data-checked={checked || undefined}
      className={`relative flex size-3.5 shrink-0 items-center justify-center rounded-[.25rem] border border-input bg-background text-primary-foreground transition-colors data-checked:border-primary data-checked:bg-primary${
        muted ? " opacity-70" : ""
      }`}
    >
      {checked ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
    </span>
  );
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
}: BranchToolbarEnvModeSelectorProps) {
  const isWorktree = effectiveEnvMode === "worktree";

  if (envLocked) {
    // Read-only: the selection is frozen, so just reflect the current state.
    const lockedChecked = isWorktree || activeWorktreePath !== null;
    return (
      <span className="inline-flex h-7 shrink-0 select-none items-center gap-1.5 px-[calc(--spacing(2)-1px)] text-sm font-medium text-muted-foreground/70 sm:h-6 sm:text-xs">
        <WorktreeCheckboxBox checked={lockedChecked} muted />
        <FolderGit2Icon className="size-3" />
        <span>Worktree</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={isWorktree}
      aria-label={`Worktree ${isWorktree ? "enabled" : "disabled"}`}
      title="Run this thread in a new git worktree"
      onClick={() => onEnvModeChange(isWorktree ? "local" : "worktree")}
      className="inline-flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-md px-[calc(--spacing(2)-1px)] text-sm font-medium text-muted-foreground/80 outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:h-6 sm:text-xs"
    >
      <WorktreeCheckboxBox checked={isWorktree} />
      <FolderGit2Icon className="size-3" />
      <span>Worktree</span>
    </button>
  );
});
