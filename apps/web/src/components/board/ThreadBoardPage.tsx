import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { presentThreadShell, type EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
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
import { useNavigate, useSearch } from "@tanstack/react-router";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadActions } from "../../hooks/useThreadActions";
import {
  refreshArchivedThreadsForEnvironment,
  useArchivedThreadSnapshots,
} from "../../lib/archivedThreadsState";
import { newThreadId } from "../../lib/utils";
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
import { ALL_PROJECTS, projectKey, ThreadBoard, threadProjectKey } from "./ThreadBoard";
import {
  planThreadBoardMove,
  THREAD_BOARD_COLUMN_LABELS,
  type ThreadBoardColumn,
  type ThreadBoardStep,
  type ThreadBoardThread,
} from "./threadBoard.logic";

export interface ThreadBoardSearch {
  /** `environmentId:projectId`; absent shows every project. */
  readonly project?: string;
}

interface TicketDefaults {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
}

type BoardCommandResult = AtomCommandResult<unknown, unknown>;
type BoardCommandFailure = Extract<BoardCommandResult, { readonly _tag: "Failure" }>;

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
function resolveTicketDefaults(project: EnvironmentProject): TicketDefaults | null {
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
  const search = useSearch({ from: "/_chat/board" });
  const navigate = useNavigate();
  const nowMinute = useNowMinute();
  const liveThreads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const allProjects = useProjects();
  const { settleThread, unsettleThread, unsnoozeThread, archiveThread, unarchiveThread } =
    useThreadActions();
  const stageThread = useOrchestrationCommand(threadEnvironment.stage, { reportFailure: false });
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });

  const now = `${nowMinute}:00Z`;
  const projects = allProjects.filter((project) => project.archivedAt == null);
  const environmentIds: EnvironmentId[] = [
    ...new Set(allProjects.map((project) => project.environmentId)),
  ];
  const { snapshots: archivedSnapshots } = useArchivedThreadSnapshots(environmentIds);
  const scopedProject = projects.find((project) => projectKey(project) === search.project);
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
  const boardThreads = listedThreads.filter(
    (thread) => scopedProject === undefined || threadProjectKey(thread) === search.project,
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

  const moveThread = async (thread: ThreadBoardThread, to: ThreadBoardColumn) => {
    for (const step of planThreadBoardMove(thread, to, { now })) {
      const result: BoardCommandResult = await runStep(step, thread);
      if (result._tag === "Failure") {
        reportBoardFailure(`Failed to move thread to ${THREAD_BOARD_COLUMN_LABELS[to]}`, result);
        return;
      }
    }
    refreshArchivedThreadsForEnvironment(thread.environmentId);
  };

  const createTicket = async (
    project: EnvironmentProject,
    title: string,
    stage: ThreadTicketStage,
  ) => {
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

  const handleProjectChange = (nextProjectKey: string) => {
    void navigate({
      to: "/board",
      search: nextProjectKey === ALL_PROJECTS ? {} : { project: nextProjectKey },
      replace: true,
    });
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
          threads={boardThreads}
          projects={projects}
          allProjects={allProjects}
          scopedProject={scopedProject}
          now={now}
          onProjectChange={handleProjectChange}
          onOpen={handleOpenThread}
          onMove={moveThread}
          onCreate={createTicket}
        />
      </div>
    </AppRouteModal>
  );
}
