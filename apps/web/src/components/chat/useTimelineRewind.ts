import { msg } from "gt-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { m } from "~/i18n/messages";
import type { EnvironmentThreadShell, ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { ComposerThreadTarget } from "../../composerDraftStore";
import type { ComposerHandleRef } from "../../composerHandleContext";
import type { SessionPhase } from "../../types";
import { useStableCallback } from "../../hooks/useStableCallback";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type MessageId,
  type ScopedThreadRef,
  type ThreadId,
  type RunId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { readLocalApi } from "../../localApi";
import { findRevertCheckpoint } from "../../session-logic";
import { type ChatMessage, DEFAULT_INTERACTION_MODE } from "../../types";
import { newThreadId } from "~/lib/utils";
import { resolveNewThreadDefaults } from "~/lib/newThreadDefaults";
import {
  importedHistoryFromTranscript,
  threadTranscriptThroughRun,
} from "~/lib/threadContextAttachment";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useScratchProject } from "../../hooks/useScratchProject";
import { type EnvironmentPresentation, useEnvironments } from "../../state/environments";
import type { EnvironmentOption } from "../BranchToolbar.logic";
import type { ForkEnvironment, OtherMachineFork } from "./timelineRowContext";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useComposerDraftStore } from "../../composerDraftStore";
import { threadEnvironment } from "../../state/threads";
import { readProject, waitForThreadShell } from "../../state/entities";
import { openRevertConfirm } from "./ChatOverlayHosts";
import { assetEnvironment } from "../../state/assets";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { rewindToMessage } from "./chatViewSend";
import { makeThreadErrorSetter } from "../ChatView.logic";
interface TimelineRewindInput {
  readonly environmentId: EnvironmentId;
  readonly routeThreadRef: ScopedThreadRef;
  readonly routeThreadKey: string;
  readonly currentRouteThreadKeyRef: { readonly current: string | null };
  readonly serverProjection: ThreadStructure | null;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly logicalProjectEnvironments: ReadonlyArray<EnvironmentOption>;
  readonly timelineMessages: ReadonlyArray<ChatMessage>;
  readonly phase: SessionPhase;
  readonly isSendBusy: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly supportsConversationRollback: boolean;
  readonly activeEnvironmentUnavailable: boolean;
  readonly activeEnvironmentUnavailableLabel: string | null;
  readonly promptRef: { current: string };
  readonly composerRef: ComposerHandleRef;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
}

function otherMachines(input: {
  readonly environments: ReadonlyArray<Pick<EnvironmentPresentation, "environmentId" | "label">>;
  readonly projectEnvironments: ReadonlyArray<EnvironmentOption>;
  readonly environmentId: EnvironmentId;
  readonly scratchWorkspaceRootFor: (environmentId: EnvironmentId) => string | null;
}): ForkEnvironment[] {
  return input.environments.flatMap((environment) => {
    if (environment.environmentId === input.environmentId) return [];
    const withProject = input.projectEnvironments.find(
      (option) => option.environmentId === environment.environmentId,
    );
    const projectId = withProject === undefined ? null : withProject.projectId;
    if (projectId === null && input.scratchWorkspaceRootFor(environment.environmentId) === null) {
      return [];
    }
    return [{ environmentId: environment.environmentId, projectId, label: environment.label }];
  });
}

/**
 * Going back in a thread's timeline: reverting to an earlier turn (restoring that message into
 * the composer) and forking a new thread from a run.
 */
export function useTimelineRewind(input: TimelineRewindInput) {
  const {
    environmentId,
    routeThreadRef,
    routeThreadKey,
    currentRouteThreadKeyRef,
    serverProjection,
    activeThread,
    logicalProjectEnvironments,
    timelineMessages,
    phase,
    isSendBusy,
    isRevertingCheckpoint,
    supportsConversationRollback,
    activeEnvironmentUnavailable,
    activeEnvironmentUnavailableLabel,
    promptRef,
    composerRef,
    composerDraftTarget,
    setThreadError,
  } = input;
  const navigate = useNavigate();
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const { environments } = useEnvironments();
  const { scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const createAttachmentAssetUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });

  const revertThreadCheckpoint = useOrchestrationCommand(threadEnvironment.revertCheckpoint, {
    reportFailure: false,
  });
  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, {
    reportFailure: false,
  });
  const loadThreadTranscript = useAtomCommand(orchestrationEnvironment.threadTranscript, {
    reportFailure: false,
  });

  const onRevertToTurnCount = async (
    turnCount: number,
    messageId: MessageId,
    restoreFiles?: boolean,
  ) => {
    const localApi = readLocalApi();
    if (
      !localApi ||
      !activeThread ||
      isRevertingCheckpoint ||
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const message = timelineMessages.find((message) => message.id === messageId);
    if (!message || message.role !== "user") return;

    if (!supportsConversationRollback) {
      setThreadError(
        activeThread.id,
        m(
          msg(
            "This provider does not support reverting conversation history. Start a new thread instead.",
          ),
        ),
      );
      return;
    }
    if (activeEnvironmentUnavailable && activeEnvironmentUnavailableLabel) {
      setThreadError(
        activeThread.id,
        m(
          msg("Reconnect {environment} before reverting checkpoints.", {
            environment: activeEnvironmentUnavailableLabel,
          }),
        ),
      );
      return;
    }
    if (phase === "running" || isSendBusy) {
      setThreadError(
        activeThread.id,
        m(msg("Interrupt the current turn before reverting checkpoints.")),
      );
      return;
    }
    if (restoreFiles === undefined) {
      openRevertConfirm(routeThreadKey, { turnCount, messageId });
      return;
    }

    useComposerDraftStore.setState((store) => ({
      rewindingThreadKeys: new Set(store.rewindingThreadKeys).add(routeThreadKey),
    }));
    setThreadError(activeThread.id, null);
    const rewind = await rewindToMessage({
      message,
      environmentId,
      routeThreadRef,
      threadId: activeThread.id,
      turnCount,
      restoreFiles,
      // Keep the live checkpoint identity when command context refetches a bounded window.
      checkpoint: findRevertCheckpoint(serverProjection?.checkpoints ?? [], turnCount),
      draftTarget: composerDraftTarget,
      composerHasPendingAttachments: composerRef.current?.hasPendingAttachments() === true,
      createAssetUrl: createAttachmentAssetUrl,
      revertThreadCheckpoint,
    });
    useComposerDraftStore.setState((store) => {
      const remaining = new Set(store.rewindingThreadKeys);
      remaining.delete(routeThreadKey);
      return { rewindingThreadKeys: remaining };
    });
    if (rewind.error !== null) {
      setThreadError(activeThread.id, rewind.error);
      return;
    }
    if (currentRouteThreadKeyRef.current === routeThreadKey) {
      const nextPrompt = rewind.prompt;
      promptRef.current = nextPrompt;
      composerRef.current?.resetCursorState({ prompt: nextPrompt, cursor: nextPrompt.length });
      requestAnimationFrame(() => {
        if (currentRouteThreadKeyRef.current === routeThreadKey) composerRef.current?.focusAtEnd();
      });
    }
  };
  const onRevertToTurnCountStable = useStableCallback(onRevertToTurnCount);
  const onConfirmRevert = (turnCount: number, messageId: MessageId, restoreFiles: boolean) => {
    void onRevertToTurnCount(turnCount, messageId, restoreFiles);
  };
  const onConfirmRevertStable = useStableCallback(onConfirmRevert);

  const onForkFromRun = async (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => {
    if (!activeThread || activeEnvironmentUnavailable) return;
    const targetThreadId = newThreadId();
    const targetThreadRef = scopeThreadRef(environmentId, targetThreadId);
    const result = await forkThreadFromRun({
      environmentId,
      input: {
        sourceThreadId: input.sourceThreadId,
        targetThreadId,
        runId: input.runId,
        title: `${activeThread.title} fork`,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          thrownErrorMessage(error, m) ?? m(msg("Failed to fork this response.")),
        );
      }
      return;
    }
    const targetThreadReady = await waitForThreadShell(targetThreadRef);
    if (!targetThreadReady) {
      setThreadError(
        activeThread.id,
        m(
          msg(
            "The fork was created, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.",
          ),
        ),
      );
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
  };
  const onForkFromRunStable = useStableCallback(onForkFromRun);

  const onForkToEnvironment = async (forkInput: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
    readonly environment: ForkEnvironment;
  }) => {
    if (!activeThread || activeEnvironmentUnavailable) return;
    const transcript = await loadThreadTranscript({
      environmentId,
      input: { threadId: forkInput.sourceThreadId },
    });
    if (transcript._tag === "Failure") {
      if (!isAtomCommandInterrupted(transcript)) {
        const error = squashAtomCommandFailure(transcript);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to read this thread for the fork.",
        );
      }
      return;
    }
    const target = forkInput.environment;
    const project =
      target.projectId === null
        ? await openScratchProject(target.environmentId, "Could not fork without a project")
        : readProject(scopeProjectRef(target.environmentId, target.projectId));
    if (project === null) return;
    const defaults = resolveNewThreadDefaults(project);
    if (defaults === null) {
      setThreadError(activeThread.id, `No model is available for the fork on ${target.label}.`);
      return;
    }
    const targetThreadRef = scopeThreadRef(target.environmentId, newThreadId());
    const created = await createThread({
      environmentId: target.environmentId,
      input: {
        threadId: targetThreadRef.threadId,
        projectId: project.id,
        title: `${activeThread.title} fork`,
        modelSelection: defaults.modelSelection,
        runtimeMode: defaults.runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        importedHistory: importedHistoryFromTranscript(
          threadTranscriptThroughRun(transcript.value, forkInput.runId),
        ),
      },
    });
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) {
        const error = squashAtomCommandFailure(created);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : `Failed to fork on ${target.label}.`,
        );
      }
      return;
    }
    const targetThreadReady = await waitForThreadShell(targetThreadRef);
    if (!targetThreadReady) {
      setThreadError(
        activeThread.id,
        `The fork was created on ${target.label}, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.`,
      );
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
  };
  const onForkToEnvironmentStable = useStableCallback(onForkToEnvironment);
  const otherMachineFork: OtherMachineFork = {
    environments: otherMachines({
      environments,
      projectEnvironments: logicalProjectEnvironments,
      environmentId,
      scratchWorkspaceRootFor,
    }),
    fork: onForkToEnvironmentStable,
  };
  const onRevertTimelineTurn = (targetTurnCount: number, messageId: MessageId) => {
    void onRevertToTurnCountStable(targetTurnCount, messageId);
  };
  const onRevertTimelineTurnStable = useStableCallback(onRevertTimelineTurn);
  return {
    onConfirmRevertStable,
    onForkFromRunStable,
    otherMachineFork,
    onRevertTimelineTurnStable,
  };
}
