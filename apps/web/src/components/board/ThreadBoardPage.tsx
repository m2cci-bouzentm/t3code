import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import {
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import type {
  EnvironmentId,
  ModelSelection,
  RuntimeMode,
  ThreadTicketStage,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  refreshArchivedThreadsForEnvironment,
  useArchivedThreadSnapshots,
} from "../../lib/archivedThreadsState";
import { newThreadId } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { useDelegatedUnderParent, useProjects, useQuietThreadShells } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { DEFAULT_BOARD_FILTERS, ThreadBoard, type BoardProject } from "./ThreadBoard";
import {
  planThreadBoardMove,
  THREAD_BOARD_COLUMN_LABELS,
  type ThreadBoardColumn,
  type ThreadBoardStep,
  type ThreadBoardThread,
} from "./threadBoard.logic";

interface TicketDefaults {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
}

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

/** The model and mode a new thread in this project starts with, read when the ticket is made. */
function resolveTicketDefaults(project: BoardProject): TicketDefaults | null {
  const settings = appAtomRegistry.get(serverEnvironment.settingsValueAtom(project.environmentId));
  if (settings === null) return null;
  const projectSettings = resolveProjectSettings(settings, project.id, project).settings;
  const runtimeMode = projectSettings.defaultRuntimeMode;
  if (projectSettings.defaultModelSelection) {
    return { modelSelection: projectSettings.defaultModelSelection, runtimeMode };
  }
  const providersByEnvironment = appAtomRegistry.get(
    environmentPresentations.providersByEnvironmentAtom,
  );
  const providers = providersByEnvironment.get(project.environmentId);
  if (providers === undefined) return null;
  const modelSelection = resolveProjectDefaultProviderModelSelection(
    providers,
    settings,
    project.id,
  );
  if (modelSelection === null) return null;
  return { modelSelection, runtimeMode };
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
  const {
    settleThread,
    unsettleThread,
    unsnoozeThread,
    archiveThread,
    unarchiveThread,
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
  const liveThreadKeys = new Set(
    liveThreads.map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
  );
  const archivedThreads = archivedSnapshots
    .flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => presentThreadShell(environmentId, thread)),
    )
    .filter(
      (thread) =>
        !liveThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
  const listedThreads = [...liveThreads, ...archivedThreads].filter(
    (thread) =>
      !isShownUnderParent(
        scopeThreadRef(thread.environmentId, thread.id),
        thread.lineage,
        delegatedUnderParent,
      ),
  );

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

  const moveThread = async (thread: ThreadBoardThread, to: ThreadBoardColumn) => {
    const steps = planThreadBoardMove(thread, to, { now });
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
    refreshArchivedThreadsForEnvironment(thread.environmentId);
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
    const defaults = resolveTicketDefaults(project);
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
          onDelete={deleteThread}
          onCreate={createTicket}
        />
      </div>
    </AppRouteModal>
  );
}
