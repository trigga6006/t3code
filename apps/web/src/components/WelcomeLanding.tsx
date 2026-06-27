import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_MODEL,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScopedProjectRef,
  type ServerProvider,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { createModelSelection } from "@t3tools/shared/model";
import { truncate } from "@t3tools/shared/String";
import { useNavigate } from "@tanstack/react-router";
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { parseStandaloneComposerSlashCommand } from "../composer-logic";
import {
  useComposerDraftStore,
  type ComposerImageAttachment,
  type DraftId,
} from "../composerDraftStore";
import { useContextDirsStore } from "../contextDirsStore";
import { appendElementContextsToPrompt, formatElementContextLabel } from "../lib/elementContext";
import { appendPreviewAnnotationPrompt } from "../lib/previewAnnotation";
import { appendTerminalContextsToPrompt, formatTerminalContextLabel } from "../lib/terminalContext";
import { appendReviewCommentsToPrompt, type ReviewCommentContext } from "../reviewCommentContext";
import { useEnsureProjectDraft } from "../hooks/useEnsureProjectDraft";
import { useResolveProjectForDirectory } from "../hooks/useResolveProjectForDirectory";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { newMessageId } from "../lib/utils";
import { getProjectOrderKey } from "../logicalProject";
import { readLocalApi } from "../localApi";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { derivePhase } from "../session-logic";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useServerConfigs } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "../uiStateStore";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { deriveComposerSendState, readFileAsDataUrl } from "./ChatView.logic";
import { orderItemsByPreferredIds } from "./Sidebar.logic";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { WelcomeDirectoryMenu } from "./welcome/WelcomeDirectoryMenu";
import {
  buildLandingTitleSeed,
  formatWelcomeOutgoingPrompt,
  pickWelcomeHeadline,
} from "./WelcomeLanding.logic";
import { APP_DISPLAY_NAME } from "~/branding";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { sanitizeThreadErrorMessage } from "~/rpc/transportError";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

const noop = () => {};
const asyncNoop = async () => undefined;
const EMPTY_PROVIDERS: ServerProvider[] = [];

/**
 * Default landing page shown at the root chat route when no thread is selected.
 *
 * Codex-style centered experience: a rotating warm headline, a combined
 * directory menu (existing projects + "Choose a folder…"), and the REAL
 * `ChatComposer` bound to a freshly-created draft for the selected project.
 * Sending auto-creates the project's thread (via the same `startTurn` +
 * `bootstrap.createThread` path ChatView uses) and navigates into the live
 * thread. See `ChatView.tsx` for the canonical send path this mirrors.
 */
export function WelcomeLanding() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  if (!primaryEnvironmentId) {
    return (
      <LandingShell>
        <Empty className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle className="text-foreground text-xl">Getting things ready…</EmptyTitle>
              <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
                Connecting to your environment.
              </EmptyDescription>
            </EmptyHeader>
          </div>
        </Empty>
      </LandingShell>
    );
  }
  return <WelcomeLandingReady primaryEnvironmentId={primaryEnvironmentId} />;
}

function WelcomeLandingReady({
  primaryEnvironmentId,
}: {
  primaryEnvironmentId: ReturnType<typeof usePrimaryEnvironmentId> & {};
}) {
  const navigate = useNavigate();
  const projects = useProjects();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );

  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  // Default to the most-recently-used project once projects are available.
  useEffect(() => {
    if (selectedProjectKey !== null) return;
    const first = orderedProjects[0];
    if (first) {
      setSelectedProjectKey(scopedProjectKey(scopeProjectRef(first.environmentId, first.id)));
    }
  }, [orderedProjects, selectedProjectKey]);

  const selectedProject = useMemo(
    () =>
      orderedProjects.find(
        (project) =>
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)) ===
          selectedProjectKey,
      ) ?? null,
    [orderedProjects, selectedProjectKey],
  );
  const selectedProjectRef = useMemo(
    () =>
      selectedProject ? scopeProjectRef(selectedProject.environmentId, selectedProject.id) : null,
    [selectedProject],
  );
  const composerEnvironmentId = selectedProject?.environmentId ?? primaryEnvironmentId;

  // Bind the composer to a stable per-project draft (created without navigating).
  const ensureProjectDraft = useEnsureProjectDraft();
  const [draftId, setDraftId] = useState<DraftId | null>(null);
  useEffect(() => {
    if (!selectedProjectRef) {
      setDraftId(null);
      return;
    }
    setDraftId(ensureProjectDraft(selectedProjectRef));
  }, [selectedProjectRef, ensureProjectDraft]);

  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );

  // --- Environment-scoped composer inputs ---
  // Mirror ChatView: providers/keybindings come from the selected project's
  // environment server config, not necessarily the primary environment.
  const settings = useEnvironmentSettings(composerEnvironmentId);
  const serverConfigs = useServerConfigs();
  const serverConfig = serverConfigs.get(composerEnvironmentId) ?? null;
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const keybindings = serverConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const { resolvedTheme } = useTheme();
  const phase = useMemo(() => derivePhase(null), []);

  // --- Mode (read from the bound draft, mirroring ChatView) ---
  const composerRuntimeMode = useComposerDraftStore((store) =>
    draftId ? (store.getComposerDraft(draftId)?.runtimeMode ?? null) : null,
  );
  const composerInteractionMode = useComposerDraftStore((store) =>
    draftId ? (store.getComposerDraft(draftId)?.interactionMode ?? null) : null,
  );
  const runtimeMode = composerRuntimeMode ?? DEFAULT_RUNTIME_MODE;
  const interactionMode = composerInteractionMode ?? DEFAULT_INTERACTION_MODE;

  // --- Draft store actions ---
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftElementContexts = useComposerDraftStore(
    (store) => store.setElementContexts,
  );
  const setComposerDraftPreviewAnnotations = useComposerDraftStore(
    (store) => store.setPreviewAnnotations,
  );
  const setComposerDraftReviewComments = useComposerDraftStore((store) => store.setReviewComments);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);

  // --- Refs the composer keeps in sync ---
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraftType[]>([]);
  const composerElementContextsRef = useRef<ElementContextDraftType[]>([]);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const sendInFlightRef = useRef(false);

  const [isSendBusy, setIsSendBusy] = useState(false);
  const [landingError, setLandingError] = useState<string | null>(null);
  const [isPickingFolder, setIsPickingFolder] = useState(false);

  const headline = useMemo(() => pickWelcomeHeadline(), []);
  const startThreadTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const resolveProjectForDirectory = useResolveProjectForDirectory();
  const canPickFolder = isElectron;

  // Focus the composer when it (re)binds to a project draft.
  useEffect(() => {
    if (!draftId) return;
    const handle = window.requestAnimationFrame(() => composerRef.current?.focusAtEnd());
    return () => window.cancelAnimationFrame(handle);
  }, [draftId]);

  const focusComposer = useCallback(() => composerRef.current?.focusAtEnd(), []);
  const scheduleComposerFocus = useCallback(
    () => window.requestAnimationFrame(() => composerRef.current?.focusAtEnd()),
    [],
  );

  const onProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!draftId) return;
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) {
        scheduleComposerFocus();
        return;
      }
      const next = { instanceId, model: resolvedModel };
      setComposerDraftModelSelection(draftId, next);
      setStickyComposerModelSelection(next);
      scheduleComposerFocus();
    },
    [
      draftId,
      providerStatuses,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      settings,
    ],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (!draftId || mode === runtimeMode) return;
      setComposerDraftRuntimeMode(draftId, mode);
      setDraftThreadContext(draftId, { runtimeMode: mode });
      scheduleComposerFocus();
    },
    [
      draftId,
      runtimeMode,
      scheduleComposerFocus,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (!draftId || mode === interactionMode) return;
      setComposerDraftInteractionMode(draftId, mode);
      setDraftThreadContext(draftId, { interactionMode: mode });
      scheduleComposerFocus();
    },
    [
      draftId,
      interactionMode,
      scheduleComposerFocus,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
    ],
  );

  const toggleInteractionMode = useCallback(
    () => handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan"),
    [handleInteractionModeChange, interactionMode],
  );

  const setThreadError = useCallback(
    (_threadId: unknown, error: string | null) =>
      setLandingError(error ? sanitizeThreadErrorMessage(error) : null),
    [],
  );

  const onPickFolder = useCallback(async () => {
    if (!canPickFolder || isPickingFolder) return;
    const api = readLocalApi();
    if (!api) return;
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder(undefined);
    } catch {
      setIsPickingFolder(false);
      return;
    }
    setIsPickingFolder(false);
    if (!pickedPath) return;
    const result = await resolveProjectForDirectory(pickedPath, primaryEnvironmentId);
    if (!result.ok) {
      if (result.error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to add project",
            description: result.error,
          }),
        );
      }
      return;
    }
    setSelectedProjectKey(scopedProjectKey(result.projectRef));
    scheduleComposerFocus();
  }, [
    canPickFolder,
    isPickingFolder,
    primaryEnvironmentId,
    resolveProjectForDirectory,
    scheduleComposerFocus,
  ]);

  const onSelectProject = useCallback((ref: ScopedProjectRef) => {
    setSelectedProjectKey(scopedProjectKey(ref));
  }, []);

  const handleSend = useCallback(
    async (event?: { preventDefault: () => void }) => {
      event?.preventDefault();
      if (!selectedProject || !draftId || !draftSession || isSendBusy || sendInFlightRef.current) {
        return;
      }
      const sendCtx = composerRef.current?.getSendContext();
      if (!sendCtx) return;

      const promptForSend = promptRef.current;
      const { trimmedPrompt, sendableTerminalContexts, hasSendableContent } =
        deriveComposerSendState({
          prompt: promptForSend,
          imageCount: sendCtx.images.length,
          terminalContexts: sendCtx.terminalContexts,
          elementContextCount:
            sendCtx.elementContexts.length +
            sendCtx.previewAnnotations.length +
            sendCtx.reviewComments.length,
        });

      // A bare slash command (e.g. "/plan", "/default") only toggles mode when
      // there is no other content (matches ChatView).
      const hasNonPromptContent =
        sendCtx.images.length > 0 ||
        sendableTerminalContexts.length > 0 ||
        sendCtx.elementContexts.length > 0 ||
        sendCtx.previewAnnotations.length > 0 ||
        sendCtx.reviewComments.length > 0;
      if (!hasNonPromptContent) {
        const slashCommand = parseStandaloneComposerSlashCommand(trimmedPrompt);
        if (slashCommand) {
          handleInteractionModeChange(slashCommand);
          promptRef.current = "";
          clearComposerDraftContent(draftId);
          composerRef.current?.resetCursorState();
          return;
        }
      }
      if (!hasSendableContent) return;

      const imagesSnapshot = [...sendCtx.images];
      const terminalContextsSnapshot = [...sendableTerminalContexts];
      const elementContextsSnapshot = [...sendCtx.elementContexts];
      const previewAnnotationsSnapshot = [...sendCtx.previewAnnotations];
      const reviewCommentsSnapshot: ReviewCommentContext[] = [...sendCtx.reviewComments];

      sendInFlightRef.current = true;
      setIsSendBusy(true);
      setLandingError(null);
      try {
        const messageId = newMessageId();
        const messageCreatedAt = new Date().toISOString();

        // Append composer contexts to the message text (matches ChatView).
        const messageTextWithContexts = appendElementContextsToPrompt(
          appendTerminalContextsToPrompt(promptForSend, terminalContextsSnapshot),
          elementContextsSnapshot,
        );
        const messageTextWithPreviewAnnotations = previewAnnotationsSnapshot.reduce(
          (text, annotation) => appendPreviewAnnotationPrompt(text, annotation),
          messageTextWithContexts,
        );
        const messageTextForSend = appendReviewCommentsToPrompt(
          messageTextWithPreviewAnnotations,
          reviewCommentsSnapshot,
        );
        const outgoingMessageText = formatWelcomeOutgoingPrompt({
          provider: sendCtx.selectedProvider,
          model: sendCtx.selectedModel,
          models: sendCtx.selectedProviderModels,
          effort: sendCtx.selectedPromptEffort,
          text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
        });
        const attachments = await Promise.all(
          imagesSnapshot.map(async (image) => ({
            type: "image" as const,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl: await readFileAsDataUrl(image.file),
          })),
        );
        const titleSeed = buildLandingTitleSeed({
          trimmedPrompt,
          firstImageName: imagesSnapshot[0]?.name ?? null,
          firstTerminalLabel: terminalContextsSnapshot[0]
            ? formatTerminalContextLabel(terminalContextsSnapshot[0])
            : null,
          firstElementLabel: elementContextsSnapshot[0]
            ? formatElementContextLabel(elementContextsSnapshot[0])
            : null,
        });
        const title = truncate(titleSeed);
        const threadCreateModelSelection = createModelSelection(
          sendCtx.selectedModelSelection.instanceId,
          sendCtx.selectedModel || selectedProject.defaultModelSelection?.model || DEFAULT_MODEL,
          sendCtx.selectedModelSelection.options,
        );

        // Extra context directories attached to this draft before its first send.
        const contextDirsForSend = [
          ...useContextDirsStore.getState().getDirs(draftSession.threadId),
        ];

        // Clear the composer immediately so the transition feels responsive.
        promptRef.current = "";
        clearComposerDraftContent(draftId);
        composerRef.current?.resetCursorState();

        const startResult = await startThreadTurn({
          environmentId: selectedProject.environmentId,
          input: {
            threadId: draftSession.threadId,
            message: {
              messageId,
              role: "user",
              text: outgoingMessageText,
              attachments,
            },
            modelSelection: sendCtx.selectedModelSelection,
            titleSeed: title,
            runtimeMode,
            interactionMode,
            bootstrap: {
              createThread: {
                projectId: selectedProject.id,
                title,
                modelSelection: threadCreateModelSelection,
                runtimeMode,
                interactionMode,
                branch: null,
                worktreePath: null,
                ...(contextDirsForSend.length > 0
                  ? { additionalDirectories: contextDirsForSend }
                  : {}),
                createdAt: draftSession.createdAt,
              },
            },
            createdAt: messageCreatedAt,
          },
        });

        if (startResult._tag === "Failure") {
          // Restore composer content for retry, but only if the user hasn't
          // started adding something new during the in-flight send (matches ChatView).
          const draftAfterSend = useComposerDraftStore.getState().getComposerDraft(draftId);
          if (
            promptRef.current.length === 0 &&
            composerImagesRef.current.length === 0 &&
            composerTerminalContextsRef.current.length === 0 &&
            composerElementContextsRef.current.length === 0 &&
            (draftAfterSend?.previewAnnotations.length ?? 0) === 0 &&
            (draftAfterSend?.reviewComments.length ?? 0) === 0
          ) {
            promptRef.current = promptForSend;
            setComposerDraftPrompt(draftId, promptForSend);
            if (imagesSnapshot.length > 0) addComposerDraftImages(draftId, imagesSnapshot);
            if (terminalContextsSnapshot.length > 0) {
              setComposerDraftTerminalContexts(draftId, terminalContextsSnapshot);
            }
            if (elementContextsSnapshot.length > 0) {
              setComposerDraftElementContexts(draftId, elementContextsSnapshot);
            }
            if (previewAnnotationsSnapshot.length > 0) {
              setComposerDraftPreviewAnnotations(draftId, previewAnnotationsSnapshot);
            }
            if (reviewCommentsSnapshot.length > 0) {
              setComposerDraftReviewComments(draftId, reviewCommentsSnapshot);
            }
            composerRef.current?.resetCursorState({
              cursor: promptForSend.length,
              prompt: promptForSend,
              detectTrigger: true,
            });
          }
          if (!isAtomCommandInterrupted(startResult)) {
            const error = squashAtomCommandFailure(startResult);
            setLandingError(error instanceof Error ? error.message : "Failed to send message.");
          }
          sendInFlightRef.current = false;
          setIsSendBusy(false);
          return;
        }

        // Success: the draft's context dirs were consumed by thread.create.
        if (contextDirsForSend.length > 0) {
          useContextDirsStore.getState().clearDirs(draftSession.threadId);
        }
        // Hop to the draft route, which observes the now-materialized server
        // thread and redirects into the live conversation. Stay busy through
        // navigation so the composer can't double-submit.
        await navigate({ to: "/draft/$draftId", params: { draftId } });
      } catch (error) {
        promptRef.current = promptForSend;
        setComposerDraftPrompt(draftId, promptForSend);
        setLandingError(error instanceof Error ? error.message : "Failed to send message.");
        sendInFlightRef.current = false;
        setIsSendBusy(false);
      }
    },
    [
      addComposerDraftImages,
      clearComposerDraftContent,
      draftId,
      draftSession,
      handleInteractionModeChange,
      interactionMode,
      isSendBusy,
      navigate,
      runtimeMode,
      selectedProject,
      setComposerDraftElementContexts,
      setComposerDraftPreviewAnnotations,
      setComposerDraftPrompt,
      setComposerDraftReviewComments,
      setComposerDraftTerminalContexts,
      startThreadTurn,
    ],
  );

  const composerReady = Boolean(selectedProject && draftId && draftSession);

  return (
    <LandingShell>
      <div className="chat-composer-horizontal-inset flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-10">
        <div className="flex w-full max-w-2xl flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{headline}</h1>
            <WelcomeDirectoryMenu
              canPickFolder={canPickFolder}
              isPicking={isPickingFolder}
              onPickFolder={onPickFolder}
              onSelectProject={onSelectProject}
              projects={orderedProjects}
              selectedKey={selectedProjectKey}
            />
          </div>

          {landingError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-center text-sm text-destructive-foreground">
              {landingError}
            </div>
          ) : null}

          {composerReady && selectedProject && draftId && draftSession ? (
            <ChatComposer
              activePendingApproval={null}
              activePendingDraftAnswers={{}}
              activePendingIsResponding={false}
              activePendingProgress={null}
              activePendingQuestionIndex={0}
              activePendingResolvedAnswers={null}
              activePlan={null}
              activeProjectDefaultModelSelection={selectedProject.defaultModelSelection}
              activeProposedPlan={null}
              activeThread={undefined}
              activeThreadActivities={undefined}
              activeThreadEnvironmentId={selectedProject.environmentId}
              activeThreadId={draftSession.threadId}
              activeThreadModelSelection={null}
              composerDraftTarget={draftId}
              composerElementContextsRef={composerElementContextsRef}
              composerImagesRef={composerImagesRef}
              composerRef={composerRef}
              composerTerminalContextsRef={composerTerminalContextsRef}
              draftId={draftId}
              environmentId={selectedProject.environmentId}
              environmentUnavailable={null}
              focusComposer={focusComposer}
              getModelDisabledReason={() => null}
              gitCwd={selectedProject.workspaceRoot}
              handleInteractionModeChange={handleInteractionModeChange}
              handleRuntimeModeChange={handleRuntimeModeChange}
              interactionMode={interactionMode}
              isConnecting={false}
              isLocalDraftThread={true}
              isPreparingWorktree={false}
              isSendBusy={isSendBusy}
              isServerThread={false}
              key={draftId}
              keybindings={keybindings}
              lockedProvider={null}
              onAdvanceActivePendingUserInput={noop}
              onChangeActivePendingUserInputCustomAnswer={noop}
              onExpandImage={noop}
              onImplementPlanInNewThread={noop}
              onInterrupt={noop}
              onPreviousActivePendingUserInputQuestion={noop}
              onProviderModelSelect={onProviderModelSelect}
              onRespondToApproval={asyncNoop}
              onSelectActivePendingUserInputOption={noop}
              onSend={handleSend}
              pendingApprovals={[]}
              pendingUserInputs={[]}
              phase={phase}
              planSidebarLabel=""
              planSidebarOpen={false}
              promptRef={promptRef}
              providerStatuses={providerStatuses as ServerProvider[]}
              respondingRequestIds={[]}
              resolvedTheme={resolvedTheme}
              routeKind="draft"
              routeThreadRef={scopeThreadRef(selectedProject.environmentId, draftSession.threadId)}
              runtimeMode={runtimeMode}
              scheduleComposerFocus={scheduleComposerFocus}
              settings={settings}
              setThreadError={setThreadError}
              showPlanFollowUpPrompt={false}
              sidebarProposedPlan={null}
              terminalOpen={false}
              toggleInteractionMode={toggleInteractionMode}
              togglePlanSidebar={noop}
            />
          ) : (
            <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/20 px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground/80">
                {canPickFolder
                  ? "Choose a folder to start your first thread."
                  : "Add a project from the sidebar to start your first thread."}
              </p>
              {canPickFolder ? (
                <Button disabled={isPickingFolder} onClick={onPickFolder} size="sm">
                  <FolderPlusIcon className="size-4" />
                  Choose a folder…
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </LandingShell>
  );
}

function LandingShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "border-b border-border px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
            isElectron ? "workspace-topbar drag-region" : "workspace-topbar",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          {isElectron ? (
            <span className="text-xs text-muted-foreground/50 wco:pr-[var(--workspace-native-controls-inset)]">
              {APP_DISPLAY_NAME}
            </span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
                {APP_DISPLAY_NAME}
              </span>
            </div>
          )}
        </header>
        {children}
      </div>
    </SidebarInset>
  );
}

// Local aliases so the ref types match `ChatComposerProps` without widening.
type TerminalContextDraftType = import("../lib/terminalContext").TerminalContextDraft;
type ElementContextDraftType = import("../lib/elementContext").ElementContextDraft;

// Re-declared from ChatView.tsx (module-local there). Keep in sync.
const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";
