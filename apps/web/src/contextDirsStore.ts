import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { ThreadId } from "@t3tools/contracts";

/**
 * Transient, non-persisted store for the extra context directories a user
 * attaches to a draft thread before the first message is sent.
 *
 * These directories are chosen in the composer's branch toolbar (the `(+)`
 * affordance) and travel to the agent via the `thread.create` bootstrap's
 * `additionalDirectories`. Once the thread has a server-side first turn the
 * selection becomes static, so there is no need to persist it across reloads —
 * keeping it out of the versioned composer-draft store avoids a storage
 * migration for what is inherently pre-send, throwaway state.
 *
 * Keyed by `ThreadId` because both the draft session and the branch toolbar
 * reference the same active thread id.
 */
interface ContextDirsStoreState {
  dirsByThread: Record<string, readonly string[]>;
  getDirs: (threadId: ThreadId) => readonly string[];
  addDir: (threadId: ThreadId, dir: string) => void;
  removeDir: (threadId: ThreadId, dir: string) => void;
  clearDirs: (threadId: ThreadId) => void;
}

const EMPTY_DIRS: readonly string[] = Object.freeze([]);

function normalizeDir(dir: string): string {
  return dir.trim();
}

export const useContextDirsStore = create<ContextDirsStoreState>((set, get) => ({
  dirsByThread: {},
  getDirs: (threadId) => get().dirsByThread[threadId] ?? EMPTY_DIRS,
  addDir: (threadId, dir) => {
    const normalized = normalizeDir(dir);
    if (normalized.length === 0) return;
    set((state) => {
      const existing = state.dirsByThread[threadId] ?? EMPTY_DIRS;
      if (existing.includes(normalized)) return state;
      return {
        dirsByThread: {
          ...state.dirsByThread,
          [threadId]: [...existing, normalized],
        },
      };
    });
  },
  removeDir: (threadId, dir) => {
    set((state) => {
      const existing = state.dirsByThread[threadId];
      if (!existing || !existing.includes(dir)) return state;
      const next = existing.filter((entry) => entry !== dir);
      const dirsByThread = { ...state.dirsByThread };
      if (next.length === 0) {
        delete dirsByThread[threadId];
      } else {
        dirsByThread[threadId] = next;
      }
      return { dirsByThread };
    });
  },
  clearDirs: (threadId) => {
    set((state) => {
      if (!(threadId in state.dirsByThread)) return state;
      const dirsByThread = { ...state.dirsByThread };
      delete dirsByThread[threadId];
      return { dirsByThread };
    });
  },
}));

/** Reactive view of the context directories attached to a draft thread. */
export function useContextDirs(threadId: ThreadId): readonly string[] {
  return useContextDirsStore(useShallow((store) => store.dirsByThread[threadId] ?? EMPTY_DIRS));
}
