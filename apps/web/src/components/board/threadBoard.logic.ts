import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { planPinnedReorder } from "@t3tools/client-runtime/state/thread-sort";

import type { SidebarThreadSummary } from "../../types";
import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "../Sidebar.logic";

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

const NEEDS_YOU_STATUSES: ReadonlySet<SidebarThreadStatus> = new Set([
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

export type ThreadBoardThread = SidebarThreadSummary;

export interface ThreadBoardOrderAssignment {
  readonly thread: ThreadBoardThread;
  readonly orderKey: string;
}

function threadBoardKey(thread: ThreadBoardThread): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/** Every thread has exactly one column; the first rule that matches wins. */
export function resolveThreadBoardColumn(
  thread: ThreadBoardThread,
  options: { readonly now: string },
): ThreadBoardColumn {
  if (thread.archivedAt !== null) return "archived";
  if (effectiveSnoozed(thread, options)) return "snoozed";
  if (thread.settledOverride === "settled") return "settled";
  if (thread.settledOverride === "backlog") return "backlog";
  if (thread.settledOverride === "ready") return "ready";
  if (NEEDS_YOU_STATUSES.has(resolveSidebarThreadStatus(thread))) return "needs-you";
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
  options: { readonly now: string },
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
  options: { readonly now: string },
): ThreadBoardStep[] {
  const from = resolveThreadBoardColumn(thread, options);
  if (from === to) return [];
  const steps = stepsToColumn(thread, to, options);
  if (from !== "archived") return steps;
  if (!isThreadBoardDropColumn(to)) return [];
  return ["unarchive", ...steps];
}
