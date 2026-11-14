import { describe, expect, it } from "vite-plus/test";

import {
  groupThreadsByBoardColumn,
  planThreadBoardMove,
  planThreadBoardOrder,
  resolveThreadBoardColumn,
  type ThreadBoardThread,
} from "./threadBoard.logic";

const NOW = { now: "2026-11-14T10:00:00.000Z" };
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

describe("resolveThreadBoardColumn", () => {
  it("gives each stored stage its column", () => {
    expect(resolveThreadBoardColumn(makeThread(), NOW)).toBe("active");
    expect(resolveThreadBoardColumn(makeThread({ settledOverride: "active" }), NOW)).toBe("active");
    expect(resolveThreadBoardColumn(makeThread({ settledOverride: "backlog" }), NOW)).toBe(
      "backlog",
    );
    expect(resolveThreadBoardColumn(makeThread({ settledOverride: "ready" }), NOW)).toBe("ready");
    expect(resolveThreadBoardColumn(makeThread({ settledOverride: "settled" }), NOW)).toBe(
      "settled",
    );
  });

  it("puts an active thread with an open question in Needs You", () => {
    expect(resolveThreadBoardColumn(makeThread({ hasPendingApprovals: true }), NOW)).toBe(
      "needs-you",
    );
    expect(resolveThreadBoardColumn(makeThread({ hasPendingUserInput: true }), NOW)).toBe(
      "needs-you",
    );
    expect(
      resolveThreadBoardColumn(
        makeThread({
          runtime: { status: "failed", lastErrorClass: "usage_limit" } as never,
        }),
        NOW,
      ),
    ).toBe("needs-you");
  });

  it("keeps a failed thread in Active", () => {
    expect(
      resolveThreadBoardColumn(makeThread({ runtime: { status: "failed" } as never }), NOW),
    ).toBe("active");
  });

  it("puts archived first, then snoozed, before the stored stage", () => {
    const snoozedTicket = makeThread({ settledOverride: "backlog", snoozedUntil: LATER });
    expect(resolveThreadBoardColumn(snoozedTicket, NOW)).toBe("snoozed");
    expect(resolveThreadBoardColumn({ ...snoozedTicket, archivedAt: NOW.now }, NOW)).toBe(
      "archived",
    );
    expect(
      resolveThreadBoardColumn(makeThread({ snoozedUntil: "2026-11-14T09:59:00.000Z" }), NOW),
    ).toBe("active");
  });
});

describe("groupThreadsByBoardColumn", () => {
  it("sorts each column by the last update", () => {
    const columns = groupThreadsByBoardColumn(
      [
        makeThread({ id: "old" as never, updatedAt: "2026-11-14T08:00:00.000Z" }),
        makeThread({ id: "new" as never, updatedAt: "2026-11-14T09:30:00.000Z" }),
      ],
      NOW,
    );
    expect(columns.active.map((thread) => thread.id)).toEqual(["new", "old"]);
  });
});

describe("planThreadBoardOrder", () => {
  const first = makeThread({ id: "first" as never, updatedAt: "2026-11-14T09:03:00.000Z" });
  const second = makeThread({ id: "second" as never, updatedAt: "2026-11-14T09:02:00.000Z" });
  const third = makeThread({ id: "third" as never, updatedAt: "2026-11-14T09:01:00.000Z" });
  const column = [first, second, third];

  const applyOrder = (
    threads: readonly ThreadBoardThread[],
    moved: ThreadBoardThread,
    index: number,
  ) => {
    const order = planThreadBoardOrder({
      shownThreads: threads,
      columnThreads: threads,
      movedThread: moved,
      index,
    });
    const keyByThread = new Map(order.map(({ thread, orderKey }) => [thread.id, orderKey]));
    const keyed = [...new Set([...threads, moved])].map((thread) =>
      makeThread({
        ...thread,
        activeOrderKey: keyByThread.get(thread.id) ?? thread.activeOrderKey,
      }),
    );
    return { order, column: groupThreadsByBoardColumn(keyed, NOW).active };
  };

  it("puts a thread at the place of the drop", () => {
    const moved = applyOrder(column, third, 0);
    expect(moved.column.map((thread) => thread.id)).toEqual(["third", "first", "second"]);

    const movedAgain = applyOrder(moved.column, moved.column[0]!, 3);
    expect(movedAgain.column.map((thread) => thread.id)).toEqual(["first", "second", "third"]);
    expect(movedAgain.order).toHaveLength(1);
  });

  it("gives a thread from a different column a place", () => {
    const ticket = makeThread({ id: "ticket" as never, settledOverride: "backlog" });
    const moved = applyOrder(column, makeThread({ ...ticket, settledOverride: null }), 1);
    expect(moved.column.map((thread) => thread.id)).toEqual(["first", "ticket", "second", "third"]);
  });

  it("writes nothing when the order stays the same", () => {
    expect(applyOrder(column, second, 1).order).toEqual([]);
    expect(applyOrder(column, second, 2).order).toEqual([]);
  });

  it("keeps a thread with no order key above the ordered ones", () => {
    const ordered = applyOrder(column, third, 0).column;
    const fresh = makeThread({ id: "fresh" as never, updatedAt: "2026-11-14T08:00:00.000Z" });
    const withFresh = groupThreadsByBoardColumn([...ordered, fresh], NOW).active;
    expect(withFresh.map((thread) => thread.id)).toEqual(["fresh", "third", "first", "second"]);
  });
});

describe("planThreadBoardMove", () => {
  it("moves between the stored stages with one command", () => {
    expect(planThreadBoardMove(makeThread(), "backlog", NOW)).toEqual(["stage-backlog"]);
    expect(planThreadBoardMove(makeThread(), "ready", NOW)).toEqual(["stage-ready"]);
    expect(planThreadBoardMove(makeThread(), "settled", NOW)).toEqual(["settle"]);
    expect(planThreadBoardMove(makeThread(), "archived", NOW)).toEqual(["archive"]);
    expect(planThreadBoardMove(makeThread({ settledOverride: "ready" }), "active", NOW)).toEqual([
      "unsettle",
    ]);
    expect(planThreadBoardMove(makeThread({ settledOverride: "settled" }), "active", NOW)).toEqual([
      "unsettle",
    ]);
  });

  it("wakes a snoozed ticket and leaves its stage when it moves to Active", () => {
    const snoozedTicket = makeThread({ settledOverride: "backlog", snoozedUntil: LATER });
    expect(planThreadBoardMove(snoozedTicket, "active", NOW)).toEqual(["unsnooze", "unsettle"]);
    expect(planThreadBoardMove(makeThread({ snoozedUntil: LATER }), "active", NOW)).toEqual([
      "unsnooze",
    ]);
  });

  it("restores an archived thread before the move", () => {
    const archived = makeThread({ archivedAt: NOW.now, settledOverride: "settled" });
    expect(planThreadBoardMove(archived, "active", NOW)).toEqual(["unarchive", "unsettle"]);
    expect(planThreadBoardMove(archived, "ready", NOW)).toEqual(["unarchive", "stage-ready"]);
    expect(planThreadBoardMove(makeThread({ archivedAt: NOW.now }), "active", NOW)).toEqual([
      "unarchive",
    ]);
  });

  it("refuses a move into a computed column or within one column", () => {
    expect(planThreadBoardMove(makeThread(), "needs-you", NOW)).toEqual([]);
    expect(planThreadBoardMove(makeThread(), "snoozed", NOW)).toEqual([]);
    expect(planThreadBoardMove(makeThread(), "active", NOW)).toEqual([]);
    expect(planThreadBoardMove(makeThread({ hasPendingUserInput: true }), "active", NOW)).toEqual(
      [],
    );
    expect(planThreadBoardMove(makeThread({ archivedAt: NOW.now }), "snoozed", NOW)).toEqual([]);
  });
});
