import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  DEFAULT_BOARD_FILTERS,
  ThreadBoard,
  type BoardFilters,
  type BoardProject,
} from "./ThreadBoard";
import type { ThreadBoardThread } from "./threadBoard.logic";

const NOW = "2026-11-14T10:00:00.000Z";

/** A project with one copy on this machine and one copy on a second machine. */
function makeProject(id: string, displayName: string, isScratch = false): BoardProject {
  return {
    environmentId: "local",
    id,
    title: displayName,
    displayName,
    projectKey: `group:${id}`,
    workspaceRoot: `/work/${displayName}`,
    ...(isScratch ? { isScratch: true } : {}),
    memberProjects: [
      { environmentId: "local", id },
      { environmentId: "mac", id: `${id}-mac` },
    ],
  } as unknown as BoardProject;
}

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

const PROJECT = makeProject("project-1", "connectAI");
const OTHER_PROJECT = makeProject("project-2", "cercledeslangues");
const SCRATCH_PROJECT = makeProject("scratch", "No project", true);

const THREADS = [
  makeThread({ id: "ticket" as never, title: "Write the importer", settledOverride: "backlog" }),
  makeThread({ id: "running" as never, title: "Fix the login bug" }),
  makeThread({ id: "asking" as never, title: "Pick a database", hasPendingUserInput: true }),
  makeThread({ id: "done" as never, title: "Ship the dashboard", settledOverride: "settled" }),
];

const OTHER_THREAD = makeThread({
  id: "other" as never,
  projectId: "project-2" as never,
  title: "Translate the emails",
});

const MAC_THREAD = makeThread({
  id: "mac-thread" as never,
  environmentId: "mac" as never,
  projectId: "project-1-mac" as never,
  title: "Review the Mac build",
});

const ARCHIVED_THREAD = makeThread({
  id: "archived" as never,
  title: "Old experiment",
  archivedAt: "2026-11-01T10:00:00.000Z",
});

const SCRATCH_THREAD = makeThread({
  id: "scratch-thread" as never,
  projectId: "scratch" as never,
  title: "Quick question",
});

const ALL_THREADS = [...THREADS, OTHER_THREAD, MAC_THREAD, ARCHIVED_THREAD, SCRATCH_THREAD];
const ALL_PROJECT_LIST = [PROJECT, OTHER_PROJECT, SCRATCH_PROJECT];

function makeHandlers() {
  return {
    onMove: vi.fn(),
    onDelete: vi.fn(),
    onOpen: vi.fn(),
    onCreate: vi.fn(async () => {}),
  };
}

/** Holds the filters as the page does, so a test drives them through the board. */
function BoardHarness(props: {
  threads: readonly ThreadBoardThread[];
  initialFilters: BoardFilters;
  handlers: ReturnType<typeof makeHandlers>;
}) {
  const [filters, setFilters] = useState(props.initialFilters);
  return (
    <ThreadBoard
      threads={props.threads}
      projects={ALL_PROJECT_LIST}
      allProjects={ALL_PROJECT_LIST}
      filters={filters}
      now={NOW}
      onFiltersChange={setFilters}
      {...props.handlers}
    />
  );
}

function renderBoard(
  options: {
    threads?: readonly ThreadBoardThread[];
    filters?: Partial<BoardFilters>;
  } = {},
) {
  const handlers = makeHandlers();
  const board = (
    <BoardHarness
      threads={options.threads ?? THREADS}
      initialFilters={{ ...DEFAULT_BOARD_FILTERS, ...options.filters }}
      handlers={handlers}
    />
  );
  return { board, handlers };
}

const cards = (screen: { getByTestId: (id: string) => { elements: () => unknown[] } }) =>
  screen.getByTestId("thread-board-card").elements();

describe("ThreadBoard", () => {
  it("shows each thread in exactly one column", async () => {
    const { board } = renderBoard();
    await using screen = await render(board, { router: false });

    const column = (name: string) => screen.getByRole("region", { name });
    await expect.element(column("Backlog").getByText("Write the importer")).toBeVisible();
    await expect.element(column("Active").getByText("Fix the login bug")).toBeVisible();
    await expect.element(column("Needs You").getByText("Pick a database")).toBeVisible();
    await expect.element(column("Settled").getByText("Ship the dashboard")).toBeVisible();
    await expect.element(column("Ready").getByText("No threads")).toBeVisible();
    expect(cards(screen)).toHaveLength(4);
  });

  it("makes a ticket in the project of the global filter", async () => {
    const { board, handlers } = renderBoard({ filters: { projectKey: PROJECT.projectKey } });
    await using screen = await render(board, { router: false });

    await userEvent.fill(screen.getByRole("textbox", { name: "New Ready ticket" }), "  Add 2FA ");
    await userEvent.click(screen.getByRole("button", { name: "Add Ready ticket" }));

    expect(handlers.onCreate).toHaveBeenCalledExactlyOnceWith(PROJECT, "Add 2FA", "ready");
    await expect.element(screen.getByRole("textbox", { name: "New Ready ticket" })).toHaveValue("");
  });

  it("asks for a project when the filters show more than one, and never offers a scratch project", async () => {
    const { board, handlers } = renderBoard({ threads: ALL_THREADS });
    await using screen = await render(board, { router: false });

    await userEvent.fill(screen.getByRole("textbox", { name: "New Backlog ticket" }), "Add Dutch");
    const projectSelect = screen.getByRole("combobox", { name: "Project for the new ticket" });
    expect(projectSelect.getByRole("option", { name: "No project" }).elements()).toHaveLength(0);
    await userEvent.selectOptions(projectSelect, "cercledeslangues");
    await userEvent.click(screen.getByRole("button", { name: "Add Backlog ticket" }));

    expect(handlers.onCreate).toHaveBeenCalledExactlyOnceWith(
      OTHER_PROJECT,
      "Add Dutch",
      "backlog",
    );
  });

  it("moves and deletes a thread from its menu and offers only the possible columns", async () => {
    const { board, handlers } = renderBoard();
    await using screen = await render(board, { router: false });

    await userEvent.click(screen.getByRole("button", { name: "Actions for Pick a database" }));
    await expect.element(screen.getByRole("menuitem", { name: "Move to Settled" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Move to Active" }).elements()).toHaveLength(0);
    expect(screen.getByRole("menuitem", { name: "Move to Snoozed" }).elements()).toHaveLength(0);
    await userEvent.click(screen.getByRole("menuitem", { name: "Move to Ready" }));
    expect(handlers.onMove).toHaveBeenCalledExactlyOnceWith(THREADS[2], "ready");

    await userEvent.click(screen.getByRole("button", { name: "Actions for Write the importer" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(handlers.onDelete).toHaveBeenCalledExactlyOnceWith(THREADS[0]);
  });

  it("moves a dragged thread to the column it is dropped on", async () => {
    const { board, handlers } = renderBoard();
    await using screen = await render(board, { router: false });

    await userEvent.dragAndDrop(
      screen.getByText("Write the importer"),
      screen.getByRole("region", { name: "Ready" }),
    );

    expect(handlers.onMove).toHaveBeenCalledExactlyOnceWith(THREADS[0], "ready");
  });

  it("opens a thread from its title", async () => {
    const { board, handlers } = renderBoard();
    await using screen = await render(board, { router: false });

    await userEvent.click(screen.getByRole("button", { name: "Fix the login bug" }));

    expect(handlers.onOpen).toHaveBeenCalledExactlyOnceWith(THREADS[1]);
  });

  it("counts in the quick filter exactly the cards on the board", async () => {
    const { board } = renderBoard({ threads: ALL_THREADS });
    await using screen = await render(board, { router: false });
    const quickFilter = screen.getByRole("group", { name: "Quick project filter" });

    // The archived connectAI thread is in the collapsed Archived column: no card, not counted.
    await expect
      .element(quickFilter.getByRole("button", { name: "connectAI, 5 threads" }))
      .toBeVisible();
    await expect
      .element(quickFilter.getByRole("button", { name: "No project, 1 thread" }))
      .toBeVisible();
    expect(cards(screen)).toHaveLength(7);

    await userEvent.click(screen.getByRole("button", { name: "Expand Archived" }));
    await expect
      .element(quickFilter.getByRole("button", { name: "connectAI, 6 threads" }))
      .toBeVisible();
    expect(cards(screen)).toHaveLength(8);
  });

  it("narrows to the picked projects, sends a new ticket there, and clears the filters", async () => {
    const { board, handlers } = renderBoard({ threads: ALL_THREADS });
    await using screen = await render(board, { router: false });
    const quickFilter = screen.getByRole("group", { name: "Quick project filter" });
    expect(screen.getByRole("button", { name: "Clear filters" }).elements()).toHaveLength(0);

    await userEvent.click(quickFilter.getByRole("button", { name: "cercledeslangues, 1 thread" }));
    await expect.element(screen.getByText("Translate the emails")).toBeVisible();
    expect(cards(screen)).toHaveLength(1);

    await userEvent.fill(screen.getByRole("textbox", { name: "New Backlog ticket" }), "Add Dutch");
    await userEvent.click(screen.getByRole("button", { name: "Add Backlog ticket" }));
    expect(handlers.onCreate).toHaveBeenCalledExactlyOnceWith(
      OTHER_PROJECT,
      "Add Dutch",
      "backlog",
    );

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(cards(screen)).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Clear filters" }).elements()).toHaveLength(0);
  });

  it("shows one project through the global filter, with no quick filter, until cleared", async () => {
    const { board } = renderBoard({ threads: ALL_THREADS });
    await using screen = await render(board, { router: false });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project" }), "connectAI");
    expect(cards(screen)).toHaveLength(5);
    expect(screen.getByRole("group", { name: "Quick project filter" }).elements()).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(cards(screen)).toHaveLength(7);
  });
});
