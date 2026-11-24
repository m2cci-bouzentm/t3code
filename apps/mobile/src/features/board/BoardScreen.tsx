import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  groupThreadsByBoardColumn,
  isThreadBoardOrderedColumn,
  listThreadBoardThreads,
  planThreadBoardMove,
  planThreadBoardOrder,
  THREAD_BOARD_COLUMNS,
  type ThreadBoardColumn,
  type ThreadBoardOptions,
  type ThreadBoardStep,
  type ThreadBoardThread,
} from "@t3tools/client-runtime/state/thread-board";
import { canSnooze } from "@t3tools/client-runtime/state/thread-settled";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ThreadId,
  type EnvironmentId,
  type ThreadTicketStage,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chip } from "../../components/ui/Chip";
import * as Dialog from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import type { MessageResolver } from "../../i18n/messages";
import { scopedProjectKey, scopedThreadKey } from "../../lib/scopedEntities";
import { uuidv4 } from "../../lib/uuid";
import { useProjects } from "../../state/entities";
import { threadListEnvironmentsAtom } from "../../state/presentation";
import {
  environmentThreadShells,
  steadyNavigationThreadShellsAtom,
  threadEnvironment,
} from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  refreshArchivedThreadsForEnvironment,
  useArchivedThreadSnapshots,
} from "../archive/useArchivedThreadSnapshots";
import { useHomeListOptions } from "../home/home-list-options";
import { buildHomeProjectScopes, type HomeProjectScope } from "../home/homeThreadList";
import { useArchivedThreadListActions, useThreadListActions } from "../home/useThreadListActions";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import {
  resolveThreadListV2SnoozeMenuSelection,
  resolveThreadListV2SnoozePresets,
  resolveThreadListV2Status,
} from "../threads/threadListV2";
import { resolveNewThreadDefaults } from "../threads/newThreadDefaults";
import { ThreadCard } from "../threads/ThreadCard";
import { useThreadListNow } from "../threads/use-thread-list-now";

const COLUMN_LABELS: Record<ThreadBoardColumn, string> = {
  backlog: msg("Backlog", { $context: "board column, tickets not started" }),
  ready: msg("Ready", { $context: "board column, tickets ready to start" }),
  active: msg("Active", { $context: "board column, threads under way" }),
  "needs-you": msg("Needs you", { $context: "board column, threads waiting on the user" }),
  snoozed: msg("Snoozed", { $context: "board column" }),
  settled: msg("Settled", { $context: "board column, finished threads" }),
  archived: msg("Archived", { $context: "board column" }),
};

const MOVE_LABELS: Record<ThreadBoardColumn, string> = {
  backlog: msg("Move to Backlog"),
  ready: msg("Move to Ready"),
  active: msg("Move to Active"),
  "needs-you": msg("Move to Needs you"),
  snoozed: msg("Move to Snoozed"),
  settled: msg("Settle"),
  archived: msg("Archive"),
};

function boardOptions(now: string): ThreadBoardOptions {
  return { now, status: resolveThreadListV2Status };
}

function isThreadInScope(thread: ThreadBoardThread, scope: HomeProjectScope): boolean {
  return scope.projectRefs.some(
    (ref) => ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
  );
}

function projectTitles(projects: ReadonlyArray<EnvironmentProject>): Map<string, string> {
  return new Map(
    projects.map((project) => [scopedProjectKey(project.environmentId, project.id), project.title]),
  );
}

function environmentIdsOf(projects: ReadonlyArray<EnvironmentProject>): EnvironmentId[] {
  return [...new Set(projects.map((project) => project.environmentId))];
}

function moveTargets(thread: ThreadBoardThread, options: ThreadBoardOptions): ThreadBoardColumn[] {
  return THREAD_BOARD_COLUMNS.filter(
    (target) => planThreadBoardMove(thread, target, options).length > 0,
  );
}

function BoardCard(props: {
  readonly thread: ThreadBoardThread;
  readonly projectTitle: string | undefined;
  readonly now: string;
  readonly actions: MenuAction[];
  readonly onAction: (thread: ThreadBoardThread, event: string) => void;
  readonly onOpen: (thread: ThreadBoardThread) => void;
}) {
  const { thread } = props;
  return (
    <Menu
      accessibilityLabel={thread.title}
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onAction(thread, nativeEvent.event)}
      shouldOpenOnLongPress
    >
      <ThreadCard
        thread={thread}
        subtitle={props.projectTitle}
        now={props.now}
        onOpen={props.onOpen}
      />
    </Menu>
  );
}

function cardActions(input: {
  readonly thread: ThreadBoardThread;
  readonly column: ThreadBoardColumn;
  readonly position: number;
  readonly count: number;
  readonly options: ThreadBoardOptions;
  readonly snoozePresetActions: MenuAction[];
  readonly resolve: MessageResolver;
}): MenuAction[] {
  const { thread, column, resolve } = input;
  const moves = moveTargets(thread, input.options).map((target) => ({
    id: `move:${target}`,
    title: resolve(MOVE_LABELS[target]),
  }));
  const isOrdered = isThreadBoardOrderedColumn(column);
  const orderActions = [
    ...(isOrdered && input.position > 0
      ? [{ id: "order:up", title: resolve(msg("Move up")) }]
      : []),
    ...(isOrdered && input.position < input.count - 1
      ? [{ id: "order:down", title: resolve(msg("Move down")) }]
      : []),
  ];
  return [
    ...orderActions,
    ...(moves.length > 0
      ? [{ id: "moves", title: resolve(msg("Move to")), subactions: moves }]
      : []),
    ...(input.snoozePresetActions.length > 0
      ? [{ id: "snooze", title: resolve(msg("Snooze")), subactions: input.snoozePresetActions }]
      : []),
    { id: "delete", title: resolve(msg("Delete")), attributes: { destructive: true } },
  ];
}

export function BoardScreen() {
  const [selectedColumn, setSelectedColumn] = useState<ThreadBoardColumn>("active");
  const [projectKey, setProjectKey] = useState<string | null>(null);

  const m = useMessages();
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const liveThreads = useAtomValue(steadyNavigationThreadShellsAtom);
  const delegatedUnderParent = useAtomValue(environmentThreadShells.delegatedUnderParentAtom);
  const listEnvironments = useAtomValue(threadListEnvironmentsAtom);
  const projects = useProjects();
  const environmentIds = environmentIdsOf(projects);
  const { snapshots } = useArchivedThreadSnapshots(environmentIds);
  const { options: listOptions } = useHomeListOptions(new Set(environmentIds));
  const now = useThreadListNow(liveThreads);
  const selectDetail = useSelectWorkspaceDetail();
  const actions = useThreadListActions();
  const archived = useArchivedThreadListActions((thread) =>
    refreshArchivedThreadsForEnvironment(thread.environmentId),
  );
  const stageThread = useAtomCommand(threadEnvironment.stage, { reportFailure: false });
  const reorderActive = useAtomCommand(threadEnvironment.reorderActive, { reportFailure: false });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });

  const options = boardOptions(now);
  const scopes = buildHomeProjectScopes(
    { projects, environmentId: null, projectGroupingMode: listOptions.projectGroupingMode },
    m,
  );
  const scope = scopes.find((candidate) => candidate.key === projectKey);
  const threads = listThreadBoardThreads({
    liveThreads,
    archivedSnapshots: snapshots,
    delegatedUnderParent,
  });
  const shownThreads =
    scope === undefined ? threads : threads.filter((thread) => isThreadInScope(thread, scope));
  const columns = groupThreadsByBoardColumn(shownThreads, options);
  const unfilteredColumns = groupThreadsByBoardColumn(threads, options);
  const titles = projectTitles(projects);
  const cards = columns[selectedColumn];
  const isTicketColumn = selectedColumn === "backlog" || selectedColumn === "ready";

  const runStep = async (step: ThreadBoardStep, thread: ThreadBoardThread): Promise<boolean> => {
    switch (step) {
      case "unarchive":
        return archived.unarchiveThread(thread);
      case "unsnooze":
        return actions.unsnoozeThread(thread);
      case "unsettle":
        return actions.unsettleThread(thread);
      case "settle":
        return actions.settleThread(thread);
      case "archive":
        return actions.archiveThread(thread);
      case "stage-backlog":
      case "stage-ready": {
        const stage: ThreadTicketStage = step === "stage-backlog" ? "backlog" : "ready";
        const result = await stageThread({
          environmentId: thread.environmentId,
          input: { threadId: thread.id, stage },
        });
        return result._tag === "Success";
      }
    }
  };

  const moveThread = async (thread: ThreadBoardThread, to: ThreadBoardColumn) => {
    for (const step of planThreadBoardMove(thread, to, options)) {
      const succeeded = await runStep(step, thread);
      if (!succeeded) {
        Dialog.alert(m(msg("Could not move the ticket")), m(msg("The board did not change.")));
        return;
      }
    }
  };

  const orderThread = async (thread: ThreadBoardThread, direction: "up" | "down") => {
    const position = cards.indexOf(thread);
    const index = direction === "up" ? position - 1 : position + 2;
    const assignments = planThreadBoardOrder({
      shownThreads: cards,
      columnThreads: unfilteredColumns[selectedColumn],
      movedThread: thread,
      index,
    });
    for (const assignment of assignments) {
      const result = await reorderActive({
        environmentId: assignment.thread.environmentId,
        input: { threadId: assignment.thread.id, orderKey: assignment.orderKey },
      });
      if (result._tag === "Failure") {
        Dialog.alert(m(msg("Could not move the ticket")), m(msg("The order did not change.")));
        return;
      }
    }
  };

  const snoozePresetsOf = (thread: ThreadBoardThread) =>
    resolveThreadListV2SnoozePresets(
      {
        secondary: "snooze",
        now,
        presets: listEnvironments.snoozePresetsByEnvironmentId.get(thread.environmentId),
      },
      m,
    );

  const snoozeActionsOf = (thread: ThreadBoardThread): MenuAction[] => {
    const isSnoozable =
      selectedColumn !== "archived" &&
      listEnvironments.snoozeEnvironmentIds.has(thread.environmentId) &&
      canSnooze(thread, { now });
    if (!isSnoozable) return [];
    return snoozePresetsOf(thread).map((preset) => ({
      id: `snooze:${preset.id}`,
      title: preset.label,
      subtitle: preset.whenLabel,
    }));
  };

  const handleCardAction = (thread: ThreadBoardThread, event: string) => {
    if (event.startsWith("move:")) {
      void moveThread(thread, event.slice("move:".length) as ThreadBoardColumn);
      return;
    }
    if (event === "order:up" || event === "order:down") {
      void orderThread(thread, event === "order:up" ? "up" : "down");
      return;
    }
    if (event === "delete") {
      if (selectedColumn === "archived") archived.confirmDeleteThread(thread);
      else actions.confirmDeleteThread(thread);
      return;
    }
    const selection = resolveThreadListV2SnoozeMenuSelection({
      event,
      displayedPresets: snoozePresetsOf(thread),
      now: new Date(now),
      presets: listEnvironments.snoozePresetsByEnvironmentId.get(thread.environmentId),
    });
    if (selection._tag === "selected")
      void actions.snoozeThread(thread, selection.preset.snoozedUntil);
  };

  const openThread = (thread: ThreadBoardThread) =>
    selectDetail({
      name: "Thread",
      params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
    });

  const createTicket = async (project: EnvironmentProject, title: string) => {
    const defaults = resolveNewThreadDefaults(project);
    if (defaults === null) {
      Dialog.alert(
        m(msg("Could not add the ticket")),
        m(msg("No model is available for this project.")),
      );
      return;
    }
    const threadId = ThreadId.make(uuidv4());
    const created = await createThread({
      environmentId: project.environmentId,
      input: {
        threadId,
        projectId: project.id,
        title,
        modelSelection: defaults.modelSelection,
        runtimeMode: defaults.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
      },
    });
    const stage: ThreadTicketStage = selectedColumn === "ready" ? "ready" : "backlog";
    const staged =
      created._tag === "Success"
        ? await stageThread({ environmentId: project.environmentId, input: { threadId, stage } })
        : created;
    if (staged._tag === "Failure") {
      Dialog.alert(m(msg("Could not add the ticket")), m(msg("The server refused the ticket.")));
    }
  };

  const promptNewTicket = (project: EnvironmentProject) =>
    Dialog.prompt({
      title: m(msg("New ticket in {project}", { project: project.title })),
      placeholder: m(msg("What needs doing?")),
      initialValue: "",
      confirmText: m(msg("Add", { $context: "verb, adds a ticket to the board" })),
      onConfirm: (title) => {
        const trimmed = title.trim();
        if (trimmed === "") return;
        void createTicket(project, trimmed);
      },
    });

  const projectMenuActions: MenuAction[] = [
    { id: "project:all", title: m(msg("All projects")), state: scope === undefined ? "on" : "off" },
    ...scopes.map((candidate) => ({
      id: `project:${candidate.key}`,
      title: candidate.title,
      state: candidate.key === projectKey ? ("on" as const) : ("off" as const),
    })),
  ];

  return (
    <ScreenScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 pb-2 pt-3"
      >
        {THREAD_BOARD_COLUMNS.map((column) => (
          <Chip
            key={column}
            label={`${m(COLUMN_LABELS[column])} ${columns[column].length}`}
            selected={column === selectedColumn}
            onPress={() => setSelectedColumn(column)}
          />
        ))}
      </ScrollView>
      <View className="flex-row items-center gap-2 px-4 pb-3">
        <Menu
          actions={projectMenuActions}
          onPressAction={({ nativeEvent }) =>
            setProjectKey(
              nativeEvent.event === "project:all"
                ? null
                : nativeEvent.event.slice("project:".length),
            )
          }
        >
          <Chip
            label={scope === undefined ? m(msg("All projects")) : scope.title}
            trailingIcon="chevron.down"
            size="small"
          />
        </Menu>
        <View className="flex-1" />
        {scope !== undefined && isTicketColumn ? (
          <Chip
            label={gt("New ticket")}
            icon="plus"
            size="small"
            onPress={() => promptNewTicket(scope.representative)}
          />
        ) : null}
      </View>
      {cards.length === 0 ? (
        <EmptyState
          variant="plain"
          title={gt("No threads here")}
          detail={
            isTicketColumn && scope === undefined
              ? gt("Pick a project to add a ticket.")
              : gt("Long-press a card to move it.")
          }
        />
      ) : (
        cards.map((thread, position) => (
          <BoardCard
            key={scopedThreadKey(thread.environmentId, thread.id)}
            thread={thread}
            projectTitle={titles.get(scopedProjectKey(thread.environmentId, thread.projectId))}
            now={now}
            actions={cardActions({
              thread,
              column: selectedColumn,
              position,
              count: cards.length,
              options,
              snoozePresetActions: snoozeActionsOf(thread),
              resolve: m,
            })}
            onAction={handleCardAction}
            onOpen={openThread}
          />
        ))
      )}
    </ScreenScrollView>
  );
}
