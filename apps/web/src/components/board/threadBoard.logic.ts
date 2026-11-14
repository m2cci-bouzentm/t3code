import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

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
    columns[column].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  return columns;
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
