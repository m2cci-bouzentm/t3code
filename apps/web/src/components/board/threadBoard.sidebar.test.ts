import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import {
  resolveThreadBoardColumn,
  type ThreadBoardThread,
} from "@t3tools/client-runtime/state/thread-board";
import { describe, expect, it } from "vite-plus/test";

import {
  isTicketThread,
  resolveSidebarThreadSection,
  resolveSidebarThreadStatus,
} from "../Sidebar.logic";

const NOW = { now: "2026-11-14T10:00:00.000Z", status: resolveSidebarThreadStatus };
const LATER = "2026-11-14T12:00:00.000Z";

function makeThread(overrides: Partial<ThreadBoardThread> = {}): ThreadBoardThread {
  return {
    id: "thread-1",
    environmentId: "local",
    activeOrderKey: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "thread-1" },
    archivedAt: null,
    settledOverride: null,
    snoozedUntil: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestUserMessageAt: null,
    latestRun: null,
    runtime: null,
    updatedAt: "2026-11-14T09:00:00.000Z",
    ...overrides,
  } as ThreadBoardThread;
}

describe("the board and the sidebar", () => {
  const SECTION_OF_COLUMN = {
    snoozed: "snoozed",
    settled: "settled",
    active: "active",
    "needs-you": "active",
  } as const;

  it("give each thread the same place, for each mix of the stored fields", () => {
    for (const settledOverride of [null, "active", "settled", "backlog", "ready"] as const) {
      for (const snoozedUntil of [null, LATER]) {
        for (const hasPendingApprovals of [false, true]) {
          const thread = makeThread({ settledOverride, snoozedUntil, hasPendingApprovals });
          const column = resolveThreadBoardColumn(thread, NOW);
          const isTicketColumn = column === "backlog" || column === "ready";
          expect(isTicketThread(thread, NOW)).toBe(isTicketColumn);
          if (isTicketColumn || column === "archived") continue;
          const section = resolveSidebarThreadSection({
            snoozed: effectiveSnoozed(thread, NOW),
            settled: thread.settledOverride === "settled",
            pinned: false,
          });
          expect(section).toBe(SECTION_OF_COLUMN[column]);
        }
      }
    }
  });
});
