import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ThreadBoard } from "./ThreadBoard";
import type { ThreadBoardThread } from "./threadBoard.logic";

const NOW = "2026-11-14T10:00:00.000Z";

const PROJECT = {
  environmentId: "local",
  id: "project-1",
  title: "connectAI",
  workspaceRoot: "/work/connectAI",
} as unknown as EnvironmentProject;

function makeThread(overrides: Partial<ThreadBoardThread>): ThreadBoardThread {
  return {
    environmentId: "local",
    projectId: "project-1",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: overrides.id },
    archivedAt: null,
    settledOverride: null,
    snoozedUntil: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    interactionMode: "default",
    latestUserMessageAt: null,
    latestRun: null,
    runtime: null,
    updatedAt: "2026-11-14T09:00:00.000Z",
    ...overrides,
  } as ThreadBoardThread;
}

const THREADS = [
  makeThread({ id: "ticket" as never, title: "Write the importer", settledOverride: "backlog" }),
  makeThread({ id: "running" as never, title: "Fix the login bug" }),
  makeThread({ id: "asking" as never, title: "Pick a database", hasPendingUserInput: true }),
  makeThread({ id: "done" as never, title: "Ship the dashboard", settledOverride: "settled" }),
];

function renderBoard() {
  const onMove = vi.fn();
  const onCreate = vi.fn(async () => {});
  const onOpen = vi.fn();
  const board = (
    <ThreadBoard
      threads={THREADS}
      projects={[PROJECT]}
      allProjects={[PROJECT]}
      scopedProject={PROJECT}
      now={NOW}
      onProjectChange={() => {}}
      onOpen={onOpen}
      onMove={onMove}
      onCreate={onCreate}
    />
  );
  return { board, onMove, onCreate, onOpen };
}

describe("ThreadBoard", () => {
  it("shows each thread in exactly one column", async () => {
    const { board } = renderBoard();
    await using screen = await render(board, { router: false });

    const column = (name: string) => screen.getByRole("region", { name });
    await expect.element(column("Backlog").getByText("Write the importer")).toBeVisible();
    await expect.element(column("Active").getByText("Fix the login bug")).toBeVisible();
    await expect.element(column("Needs You").getByText("Pick a database")).toBeVisible();
    await expect.element(column("Settled").getByText("Ship the dashboard")).toBeVisible();
    expect(screen.getByTestId("thread-board-card").elements()).toHaveLength(4);
  });

  it("makes a ticket from a title in the Ready column", async () => {
    const { board, onCreate } = renderBoard();
    await using screen = await render(board, { router: false });

    await userEvent.fill(screen.getByRole("textbox", { name: "New Ready ticket" }), "  Add 2FA ");
    await userEvent.click(screen.getByRole("button", { name: "Add Ready ticket" }));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith(PROJECT, "Add 2FA", "ready");
    await expect.element(screen.getByRole("textbox", { name: "New Ready ticket" })).toHaveValue("");
  });

  it("moves a thread from its menu and offers only the possible columns", async () => {
    const { board, onMove } = renderBoard();
    await using screen = await render(board, { router: false });

    await userEvent.click(screen.getByRole("button", { name: "Move Pick a database" }));
    await expect.element(screen.getByRole("menuitem", { name: "Move to Settled" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Move to Active" }).elements()).toHaveLength(0);
    expect(screen.getByRole("menuitem", { name: "Move to Snoozed" }).elements()).toHaveLength(0);
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to Ready" }));

    expect(onMove).toHaveBeenCalledExactlyOnceWith(THREADS[2], "ready");
  });

  it("moves a dragged thread to the column it is dropped on", async () => {
    const { board, onMove } = renderBoard();
    await using screen = await render(board, { router: false });

    await userEvent.dragAndDrop(
      screen.getByText("Write the importer"),
      screen.getByRole("region", { name: "Ready" }),
    );

    expect(onMove).toHaveBeenCalledExactlyOnceWith(THREADS[0], "ready");
  });

  it("opens a thread from its title", async () => {
    const { board, onOpen } = renderBoard();
    await using screen = await render(board, { router: false });

    await userEvent.click(screen.getByRole("button", { name: "Fix the login bug" }));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(THREADS[1]);
  });
});
