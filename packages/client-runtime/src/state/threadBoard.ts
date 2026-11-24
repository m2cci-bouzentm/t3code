import { scopeThreadRef, scopedThreadKey } from "../environment/scoped.ts";
import type { ArchivedSnapshotEntry } from "./archivedThreads.ts";
import { presentThreadShell } from "./models.ts";
import type { EnvironmentThreadShell } from "./shell.ts";
import { isShownUnderParent } from "./threadShell.ts";
import { effectiveSnoozed } from "./threadSettled.ts";
import { planPinnedReorder } from "./threadSort.ts";
import { resolveThreadStage } from "./threadStage.ts";

export const THREAD_BOARD_COLUMNS = [
  "backlog",
  "ready",
  "active",
  "needs-you",
  "snoozed",
  "settled",
  "archived",
] as const;
export type ThreadBoardColumn = (typeof THREAD_BOARD_COLUMNS)[number];

export const THREAD_BOARD_COLUMN_LABELS: Record<ThreadBoardColumn, string> = {
  backlog: "Backlog",
  ready: "Ready",
  active: "Active",
  "needs-you": "Needs You",
  snoozed: "Snoozed",
  settled: "Settled",
  archived: "Archived",
};

/** The agent or the clock moves a thread into these columns; a drag cannot. */
const COMPUTED_COLUMNS: ReadonlySet<ThreadBoardColumn> = new Set(["needs-you", "snoozed"]);

/** The columns that keep the order a drag gives; the others list the newest change first. */
const ORDERED_COLUMNS: ReadonlySet<ThreadBoardColumn> = new Set([
  "backlog",
  "ready",
  "active",
  "needs-you",
]);

/** The statuses of a thread that waits on its owner; web and mobile name them alike. */
const NEEDS_YOU_STATUSES: ReadonlySet<string> = new Set([
  "approval",
  "input",
  "request",
  "limited",
]);

export type ThreadBoardStep =
  | "unarchive"
  | "unsnooze"
  | "unsettle"
  | "settle"
  | "archive"
  | "stage-backlog"
  | "stage-ready";

export type ThreadBoardThread = EnvironmentThreadShell;

export interface ThreadBoardOptions {
  readonly now: string;
  /** The client's status of a thread, the one its thread list shows. */
  readonly status: (thread: ThreadBoardThread) => string;
}

export interface ThreadBoardOrderAssignment {
  readonly thread: ThreadBoardThread;
  readonly orderKey: string;
}

function threadBoardKey(thread: ThreadBoardThread): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/**
 * The threads of the board: the live ones and the archived ones a live copy does not cover,
 * without the threads that show under their parent, like the thread lists.
 */
export function listThreadBoardThreads(input: {
  readonly liveThreads: readonly ThreadBoardThread[];
  readonly archivedSnapshots: readonly ArchivedSnapshotEntry[];
  readonly delegatedUnderParent: ReadonlySet<string>;
}): ThreadBoardThread[] {
  const liveThreadKeys = new Set(input.liveThreads.map(threadBoardKey));
  const archivedThreads = input.archivedSnapshots
    .flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => presentThreadShell(environmentId, thread)),
    )
    .filter((thread) => !liveThreadKeys.has(threadBoardKey(thread)));
  return [...input.liveThreads, ...archivedThreads].filter(
    (thread) =>
      !isShownUnderParent(
        scopeThreadRef(thread.environmentId, thread.id),
        thread.lineage,
        input.delegatedUnderParent,
      ),
  );
}

/** Every thread has exactly one column: its stage, and an open thread is Active or Needs You. */
export function resolveThreadBoardColumn(
  thread: ThreadBoardThread,
  options: ThreadBoardOptions,
): ThreadBoardColumn {
  const stage = resolveThreadStage(thread, options);
  if (stage !== "open") return stage;
  if (NEEDS_YOU_STATUSES.has(options.status(thread))) return "needs-you";
  return "active";
}

function compareByLastUpdate(left: ThreadBoardThread, right: ThreadBoardThread): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

/** Threads with no order key come first, the newest change on top; then the keys, in order. */
function compareByOrderKey(left: ThreadBoardThread, right: ThreadBoardThread): number {
  if (left.activeOrderKey === null && right.activeOrderKey === null) {
    return compareByLastUpdate(left, right);
  }
  if (left.activeOrderKey === null) return -1;
  if (right.activeOrderKey === null) return 1;
  if (left.activeOrderKey === right.activeOrderKey) return compareByLastUpdate(left, right);
  return left.activeOrderKey < right.activeOrderKey ? -1 : 1;
}

export function groupThreadsByBoardColumn(
  threads: readonly ThreadBoardThread[],
  options: ThreadBoardOptions,
): Record<ThreadBoardColumn, ThreadBoardThread[]> {
  const columns: Record<ThreadBoardColumn, ThreadBoardThread[]> = {
    backlog: [],
    ready: [],
    active: [],
    "needs-you": [],
    snoozed: [],
    settled: [],
    archived: [],
  };
  for (const thread of threads) {
    columns[resolveThreadBoardColumn(thread, options)].push(thread);
  }
  for (const column of THREAD_BOARD_COLUMNS) {
    columns[column].sort(
      isThreadBoardOrderedColumn(column) ? compareByOrderKey : compareByLastUpdate,
    );
  }
  return columns;
}

export function isThreadBoardOrderedColumn(column: ThreadBoardColumn): boolean {
  return ORDERED_COLUMNS.has(column);
}

/**
 * The order keys that put a thread at a position of an ordered column; empty when the order
 * stays the same. `index` counts the cards of `shownThreads`, the moved thread included.
 */
export function planThreadBoardOrder(input: {
  /** The cards of the column as the board shows them, in order. */
  readonly shownThreads: readonly ThreadBoardThread[];
  /** Every thread of the column, the ones a filter hides too. */
  readonly columnThreads: readonly ThreadBoardThread[];
  readonly movedThread: ThreadBoardThread;
  readonly index: number;
}): ThreadBoardOrderAssignment[] {
  const movedKey = threadBoardKey(input.movedThread);
  const shownKeys = input.shownThreads.map(threadBoardKey);
  const orderedKeys = [
    ...shownKeys.slice(0, input.index).filter((key) => key !== movedKey),
    movedKey,
    ...shownKeys.slice(input.index).filter((key) => key !== movedKey),
  ];
  const isSameOrder =
    orderedKeys.length === shownKeys.length &&
    orderedKeys.every((key, position) => key === shownKeys[position]);
  if (isSameOrder) return [];
  const threadByKey = new Map(
    [...input.columnThreads, input.movedThread].map((thread) => [threadBoardKey(thread), thread]),
  );
  const keysById = new Map(
    [...threadByKey].map(([key, thread]) => [key, thread.activeOrderKey] as const),
  );
  return planPinnedReorder({ orderedIds: orderedKeys, keysById, movedId: movedKey }).map(
    ({ id, orderKey }) => ({ thread: threadByKey.get(id)!, orderKey }),
  );
}

export function isThreadBoardDropColumn(column: ThreadBoardColumn): boolean {
  return !COMPUTED_COLUMNS.has(column);
}

function stepsToActive(thread: ThreadBoardThread, options: { readonly now: string }) {
  const steps: ThreadBoardStep[] = [];
  if (effectiveSnoozed(thread, options)) steps.push("unsnooze");
  if (thread.settledOverride !== null && thread.settledOverride !== "active") {
    steps.push("unsettle");
  }
  return steps;
}

function stepsToColumn(
  thread: ThreadBoardThread,
  to: ThreadBoardColumn,
  options: { readonly now: string },
): ThreadBoardStep[] {
  switch (to) {
    case "archived":
      return ["archive"];
    case "settled":
      return ["settle"];
    case "backlog":
      return ["stage-backlog"];
    case "ready":
      return ["stage-ready"];
    case "active":
      return stepsToActive(thread, options);
    case "needs-you":
    case "snoozed":
      return [];
  }
}

/** The commands that move a thread to a column, in order; empty when the move is not possible. */
export function planThreadBoardMove(
  thread: ThreadBoardThread,
  to: ThreadBoardColumn,
  options: ThreadBoardOptions,
): ThreadBoardStep[] {
  const from = resolveThreadBoardColumn(thread, options);
  if (from === to) return [];
  const steps = stepsToColumn(thread, to, options);
  if (from !== "archived") return steps;
  if (!isThreadBoardDropColumn(to)) return [];
  return ["unarchive", ...steps];
}
