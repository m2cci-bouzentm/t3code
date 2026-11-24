import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import {
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadTicketStage } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  refreshArchivedThreadsForEnvironment,
  useArchivedThreadSnapshots,
} from "../../lib/archivedThreadsState";
import { resolveNewThreadDefaults } from "../../lib/newThreadDefaults";
import { newThreadId } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { requestCustomSnooze } from "../CustomSnoozeDialog";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";
import { pickSnoozePreset, resolveSnoozePresets, type SnoozePreset } from "../Sidebar.snooze";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { DEFAULT_BOARD_FILTERS, ThreadBoard, type BoardProject } from "./ThreadBoard";
import {
  listThreadBoardThreads,
  planThreadBoardMove,
  THREAD_BOARD_COLUMN_LABELS,
  type ThreadBoardColumn,
  type ThreadBoardOrderAssignment,
  type ThreadBoardStep,
  type ThreadBoardThread,
} from "@t3tools/client-runtime/state/thread-board";

type BoardCommandResult = AtomCommandResult<unknown, unknown>;
type BoardCommandFailure = Extract<BoardCommandResult, { readonly _tag: "Failure" }>;

const BOARD_FILTERS_KEY = "t3code:board:filters";

const BoardFiltersSchema = Schema.Struct({
  projectKey: Schema.String,
  quickProjectKeys: Schema.Array(Schema.String),
  archivedOpen: Schema.Boolean,
});

function reportBoardFailure(title: string, result: BoardCommandFailure) {
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function ThreadBoardPage() {
  const [filters, setFilters] = useLocalStorage(
    BOARD_FILTERS_KEY,
    DEFAULT_BOARD_FILTERS,
    BoardFiltersSchema,
  );
  const navigate = useNavigate();
  const nowMinute = useNowMinute();
  const liveThreads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const environmentProjects = useProjects();
  const allProjects = useSidebarProjectGroups();
  const confirmThreadArchive = useClientSettings((settings) => settings.confirmThreadArchive);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    archiveThread,
    unarchiveThread,
    reorderActiveThread,
    confirmAndDeleteThread,
  } = useThreadActions();
  const stageThread = useOrchestrationCommand(threadEnvironment.stage, { reportFailure: false });
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });

  const now = `${nowMinute}:00Z`;
  const projects = pickableProjectGroups(allProjects);
  const environmentIds: EnvironmentId[] = [
    ...new Set(environmentProjects.map((project) => project.environmentId)),
  ];
  const { snapshots: archivedSnapshots } = useArchivedThreadSnapshots(environmentIds);
  const listedThreads = listThreadBoardThreads({
    liveThreads,
    archivedSnapshots,
    delegatedUnderParent,
  });

  const runStep = (step: ThreadBoardStep, thread: ThreadBoardThread) => {
    const target = scopeThreadRef(thread.environmentId, thread.id);
    switch (step) {
      case "unarchive":
        return unarchiveThread(target);
      case "unsnooze":
        return unsnoozeThread(target);
      case "unsettle":
        return unsettleThread(target);
      case "settle":
        return settleThread(target);
      case "archive":
        return archiveThread(target);
      case "stage-backlog":
        return stageThread({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, stage: "backlog" },
        });
      case "stage-ready":
        return stageThread({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, stage: "ready" },
        });
    }
  };

  const isArchiveConfirmed = async (thread: ThreadBoardThread) => {
    const localApi = readLocalApi();
    if (!confirmThreadArchive || !localApi) return true;
    const confirmed = await settlePromise(() =>
      localApi.dialogs.confirm(`Archive thread "${thread.title}"?`),
    );
    return confirmed._tag === "Success" && confirmed.value;
  };

  const moveThread = async (
    thread: ThreadBoardThread,
    to: ThreadBoardColumn,
    order: readonly ThreadBoardOrderAssignment[],
  ) => {
    const steps = planThreadBoardMove(thread, to, { now, status: resolveSidebarThreadStatus });
    if (steps.includes("archive")) {
      const confirmed = await isArchiveConfirmed(thread);
      if (!confirmed) return;
    }
    for (const step of steps) {
      const result: BoardCommandResult = await runStep(step, thread);
      if (result._tag === "Failure") {
        reportBoardFailure(`Failed to move thread to ${THREAD_BOARD_COLUMN_LABELS[to]}`, result);
        return;
      }
    }
    for (const assignment of order) {
      const target = scopeThreadRef(assignment.thread.environmentId, assignment.thread.id);
      const result: BoardCommandResult = await reorderActiveThread(target, assignment.orderKey);
      if (result._tag === "Failure") {
        reportBoardFailure("Failed to save the order of the threads", result);
        return;
      }
    }
    refreshArchivedThreadsForEnvironment(thread.environmentId);
  };

  const listSnoozePresets = (thread: ThreadBoardThread) =>
    resolveSnoozePresets(new Date(), timestampFormat, thread.environmentId);

  const snoozeBoardThread = async (
    thread: ThreadBoardThread,
    presets: readonly SnoozePreset[],
    preset: SnoozePreset | null,
  ) => {
    const choice = preset
      ? pickSnoozePreset(presets, preset.id, timestampFormat, thread.environmentId)
      : await requestCustomSnooze();
    if (!choice) return;
    const target = scopeThreadRef(thread.environmentId, thread.id);
    const result: BoardCommandResult = await snoozeThread(target, choice.snoozedUntil);
    if (result._tag === "Failure") reportBoardFailure("Failed to snooze thread", result);
  };

  const deleteThread = async (thread: ThreadBoardThread) => {
    const target = scopeThreadRef(thread.environmentId, thread.id);
    const result: BoardCommandResult = await confirmAndDeleteThread(target, thread.title);
    if (result._tag === "Failure") {
      reportBoardFailure("Failed to delete thread", result);
      return;
    }
    refreshArchivedThreadsForEnvironment(thread.environmentId);
  };

  const createTicket = async (project: BoardProject, title: string, stage: ThreadTicketStage) => {
    const defaults = resolveNewThreadDefaults(project);
    if (defaults === null) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to add ticket",
          description: "No model is available for this project.",
        }),
      );
      return;
    }
    const threadId = newThreadId();
    const created: BoardCommandResult = await createThread({
      environmentId: project.environmentId,
      input: {
        threadId,
        projectId: project.id,
        title,
        modelSelection: defaults.modelSelection,
        runtimeMode: defaults.runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
      },
    });
    if (created._tag === "Failure") {
      reportBoardFailure("Failed to add ticket", created);
      return;
    }
    const staged: BoardCommandResult = await stageThread({
      environmentId: project.environmentId,
      input: { threadId, stage },
    });
    if (staged._tag === "Failure") reportBoardFailure("Failed to add ticket", staged);
  };

  const handleOpenThread = (thread: ThreadBoardThread) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };

  return (
    <AppRouteModal label="Board">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
          <h1 className="text-sm font-medium">Board</h1>
          <div className="flex-1" />
          <AppRouteModalClose />
        </header>
        <ThreadBoard
          threads={listedThreads}
          projects={projects}
          allProjects={allProjects}
          filters={filters}
          now={now}
          onFiltersChange={setFilters}
          onOpen={handleOpenThread}
          onMove={moveThread}
          listSnoozePresets={listSnoozePresets}
          formatWakeTime={(snoozedUntil) => formatUpcomingTimestamp(snoozedUntil, timestampFormat)}
          onSnooze={snoozeBoardThread}
          onDelete={deleteThread}
          onCreate={createTicket}
        />
      </div>
    </AppRouteModal>
  );
}
