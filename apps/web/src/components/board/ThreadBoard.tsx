import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadTicketStage } from "@t3tools/contracts";
import { ChevronRightIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { useState, type DragEvent, type FormEvent } from "react";

import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Toggle } from "../ui/toggle";
import {
  groupThreadsByBoardColumn,
  isThreadBoardDropColumn,
  planThreadBoardMove,
  THREAD_BOARD_COLUMN_LABELS,
  THREAD_BOARD_COLUMNS,
  type ThreadBoardColumn,
  type ThreadBoardThread,
} from "./threadBoard.logic";

export const ALL_PROJECTS = "";

/** A project as the sidebar groups it: its copies on every machine are one project. */
export type BoardProject = SidebarProjectSnapshot;

/** Each copy of a project, by `environmentId:projectId`, to the project it belongs to. */
export function indexBoardProjects(
  projects: readonly BoardProject[],
): ReadonlyMap<string, BoardProject> {
  const projectByMemberKey = new Map<string, BoardProject>();
  for (const project of projects) {
    for (const member of project.memberProjects) {
      projectByMemberKey.set(`${member.environmentId}:${member.id}`, project);
    }
  }
  return projectByMemberKey;
}

export function resolveThreadBoardProject(
  thread: Pick<ThreadBoardThread, "environmentId" | "projectId">,
  projectByMemberKey: ReadonlyMap<string, BoardProject>,
): BoardProject | undefined {
  return projectByMemberKey.get(`${thread.environmentId}:${thread.projectId}`);
}

interface QuickProject {
  readonly project: BoardProject;
  readonly threadCount: number;
}

/** The projects that have a thread on the board, the one with the most threads first. */
function listQuickProjects(
  threads: readonly ThreadBoardThread[],
  projectByMemberKey: ReadonlyMap<string, BoardProject>,
): QuickProject[] {
  const quickProjectByKey = new Map<string, QuickProject>();
  for (const thread of threads) {
    const project = resolveThreadBoardProject(thread, projectByMemberKey);
    if (project === undefined) continue;
    const counted = quickProjectByKey.get(project.projectKey);
    const threadCount = counted ? counted.threadCount + 1 : 1;
    quickProjectByKey.set(project.projectKey, { project, threadCount });
  }
  return [...quickProjectByKey.values()].sort(
    (left, right) => right.threadCount - left.threadCount,
  );
}

/** The one project the quick filter shows, which a new ticket then goes to. */
function soleQuickProject(
  quickProjects: readonly QuickProject[],
  quickProjectKeys: ReadonlySet<string>,
): BoardProject | undefined {
  if (quickProjectKeys.size !== 1) return undefined;
  return quickProjects.find(({ project }) => quickProjectKeys.has(project.projectKey))?.project;
}

function isThreadOfQuickProject(
  thread: ThreadBoardThread,
  projectByMemberKey: ReadonlyMap<string, BoardProject>,
  quickProjectKeys: ReadonlySet<string>,
): boolean {
  const project = resolveThreadBoardProject(thread, projectByMemberKey);
  if (project === undefined) return false;
  return quickProjectKeys.has(project.projectKey);
}

function ticketStageOfColumn(column: ThreadBoardColumn): ThreadTicketStage | null {
  if (column === "backlog" || column === "ready") return column;
  return null;
}

function resolveTicketProject(input: {
  scopedProject: BoardProject | undefined;
  projects: readonly BoardProject[];
  pickedProjectKey: string | null;
}): BoardProject | undefined {
  if (input.scopedProject) return input.scopedProject;
  const picked = input.projects.find((project) => project.projectKey === input.pickedProjectKey);
  if (picked) return picked;
  return input.projects[0];
}

function ThreadBoardCard(props: {
  thread: ThreadBoardThread;
  column: ThreadBoardColumn;
  project: BoardProject | undefined;
  showProject: boolean;
  now: string;
  onOpen: (thread: ThreadBoardThread) => void;
  onMove: (thread: ThreadBoardThread, to: ThreadBoardColumn) => void;
  onDragStart: (thread: ThreadBoardThread) => void;
  onDragEnd: () => void;
}) {
  const { thread, column, project } = props;
  const pill = resolveThreadStatusPill({ thread });
  const moveTargets = THREAD_BOARD_COLUMNS.filter(
    (target) => planThreadBoardMove(thread, target, { now: props.now }).length > 0,
  );

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", thread.title);
    props.onDragStart(thread);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={props.onDragEnd}
      className="flex cursor-grab flex-col gap-1.5 rounded-md border bg-card p-2.5 text-sm shadow-xs active:cursor-grabbing"
      data-testid="thread-board-card"
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          disabled={column === "archived"}
          onClick={() => props.onOpen(thread)}
          className="min-w-0 flex-1 text-start leading-snug font-medium enabled:hover:underline"
        >
          <span className="line-clamp-3 break-words">{thread.title}</span>
        </button>
        <Menu>
          <MenuTrigger
            render={<Button size="icon-xs" variant="ghost" aria-label={`Move ${thread.title}`} />}
            className="shrink-0"
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {moveTargets.map((target) => (
              <MenuItem key={target} onClick={() => props.onMove(thread, target)}>
                Move to {THREAD_BOARD_COLUMN_LABELS[target]}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {props.showProject && project ? (
          <span className="flex min-w-0 items-center gap-1">
            <ProjectFavicon project={project} className="size-3.5 shrink-0" />
            <span className="truncate">{project.displayName}</span>
          </span>
        ) : null}
        {pill ? (
          <span className={cn("flex shrink-0 items-center gap-1", pill.colorClass)}>
            <span
              className={cn("size-1.5 rounded-full", pill.dotClass, pill.pulse && "animate-pulse")}
            />
            {pill.label}
          </span>
        ) : null}
        <span className="ms-auto shrink-0">{formatRelativeTimeLabel(thread.updatedAt)}</span>
      </div>
    </div>
  );
}

function NewTicketForm(props: {
  stage: ThreadTicketStage;
  projects: readonly BoardProject[];
  scopedProject: BoardProject | undefined;
  onCreate: (project: BoardProject, title: string, stage: ThreadTicketStage) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [pickedProjectKey, setPickedProjectKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pickedProject = resolveTicketProject({
    scopedProject: props.scopedProject,
    projects: props.projects,
    pickedProjectKey,
  });
  const trimmedTitle = title.trim();
  const cannotSubmit = trimmedTitle.length === 0 || pickedProject === undefined || submitting;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cannotSubmit) return;
    setSubmitting(true);
    await props.onCreate(pickedProject, trimmedTitle, props.stage);
    setSubmitting(false);
    setTitle("");
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          size="sm"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="New ticket"
          aria-label={`New ${THREAD_BOARD_COLUMN_LABELS[props.stage]} ticket`}
        />
        <Button
          type="submit"
          size="icon-sm"
          variant="outline"
          aria-label={`Add ${THREAD_BOARD_COLUMN_LABELS[props.stage]} ticket`}
          disabled={cannotSubmit}
        >
          <PlusIcon />
        </Button>
      </div>
      {props.scopedProject === undefined && pickedProject && title.length > 0 ? (
        <select
          value={pickedProject.projectKey}
          onChange={(event) => setPickedProjectKey(event.target.value)}
          aria-label="Project for the new ticket"
          className="h-7 rounded-md border bg-background px-1.5 text-xs"
        >
          {props.projects.map((project) => (
            <option key={project.projectKey} value={project.projectKey}>
              {project.displayName}
            </option>
          ))}
        </select>
      ) : null}
    </form>
  );
}

export function ThreadBoard(props: {
  /** Every thread of the shown scope, archived ones too. */
  threads: readonly ThreadBoardThread[];
  /** Projects a ticket can be made in. */
  projects: readonly BoardProject[];
  /** Every project, to name the cards of archived projects too. */
  allProjects: readonly BoardProject[];
  scopedProject: BoardProject | undefined;
  now: string;
  onProjectChange: (projectKey: string) => void;
  onOpen: (thread: ThreadBoardThread) => void;
  onMove: (thread: ThreadBoardThread, to: ThreadBoardColumn) => void;
  onCreate: (project: BoardProject, title: string, stage: ThreadTicketStage) => Promise<void>;
}) {
  const [draggedThread, setDraggedThread] = useState<ThreadBoardThread | null>(null);
  const [dropColumn, setDropColumn] = useState<ThreadBoardColumn | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [quickProjectKeys, setQuickProjectKeys] = useState<ReadonlySet<string>>(new Set());

  const { now, scopedProject } = props;
  const projectByMemberKey = indexBoardProjects(props.allProjects);
  const quickProjects = scopedProject ? [] : listQuickProjects(props.threads, projectByMemberKey);
  const shownQuickProjectKeys = new Set(
    quickProjects
      .map(({ project }) => project.projectKey)
      .filter((key) => quickProjectKeys.has(key)),
  );
  const shownThreads =
    shownQuickProjectKeys.size === 0
      ? props.threads
      : props.threads.filter((thread) =>
          isThreadOfQuickProject(thread, projectByMemberKey, shownQuickProjectKeys),
        );
  const columns = groupThreadsByBoardColumn(shownThreads, { now });
  const ticketProject = scopedProject ?? soleQuickProject(quickProjects, shownQuickProjectKeys);

  const handleDragOver = (event: DragEvent<HTMLElement>, column: ThreadBoardColumn) => {
    if (draggedThread === null) return;
    if (planThreadBoardMove(draggedThread, column, { now }).length === 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropColumn !== column) setDropColumn(column);
  };

  const handleDrop = (event: DragEvent<HTMLElement>, column: ThreadBoardColumn) => {
    event.preventDefault();
    const thread = draggedThread;
    setDraggedThread(null);
    setDropColumn(null);
    if (thread !== null) props.onMove(thread, column);
  };

  const handleDragEnd = () => {
    setDraggedThread(null);
    setDropColumn(null);
  };

  const handleQuickProjectToggle = (key: string, pressed: boolean) => {
    const next = new Set(shownQuickProjectKeys);
    if (pressed) next.add(key);
    else next.delete(key);
    setQuickProjectKeys(next);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-3">
        <select
          value={scopedProject ? scopedProject.projectKey : ALL_PROJECTS}
          onChange={(event) => props.onProjectChange(event.target.value)}
          aria-label="Project"
          className="h-7 max-w-64 rounded-md border bg-background px-1.5 text-sm"
        >
          <option value={ALL_PROJECTS}>All projects</option>
          {props.projects.map((project) => (
            <option key={project.projectKey} value={project.projectKey}>
              {project.displayName}
            </option>
          ))}
        </select>
        {quickProjects.length > 1 ? (
          <div
            role="group"
            aria-label="Quick project filter"
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            {quickProjects.map(({ project, threadCount }) => (
              <Toggle
                key={project.projectKey}
                size="xs"
                variant="outline"
                aria-label={`${project.displayName}, ${threadCount} ${threadCount === 1 ? "thread" : "threads"}`}
                pressed={shownQuickProjectKeys.has(project.projectKey)}
                onPressedChange={(pressed) => handleQuickProjectToggle(project.projectKey, pressed)}
              >
                <ProjectFavicon project={project} className="size-3.5 shrink-0" />
                <span>{project.displayName}</span>
                <span className="text-muted-foreground">{threadCount}</span>
              </Toggle>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {THREAD_BOARD_COLUMNS.map((column) => {
          const threads = columns[column];
          const collapsed = column === "archived" && !archivedOpen;
          const ticketStage = ticketStageOfColumn(column);
          return (
            <section
              key={column}
              aria-label={THREAD_BOARD_COLUMN_LABELS[column]}
              onDragOver={(event) => handleDragOver(event, column)}
              onDrop={(event) => handleDrop(event, column)}
              className={cn(
                "flex min-h-0 shrink-0 flex-col gap-2 rounded-lg border bg-muted/40 p-2",
                collapsed ? "w-40" : "w-72",
                dropColumn === column && "border-primary bg-primary/5",
                draggedThread !== null && !isThreadBoardDropColumn(column) && "opacity-60",
              )}
              data-testid={`thread-board-column-${column}`}
            >
              <header className="flex shrink-0 items-center gap-1.5 px-1 text-sm font-medium">
                {column === "archived" ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={archivedOpen ? "Collapse Archived" : "Expand Archived"}
                    onClick={() => setArchivedOpen(!archivedOpen)}
                  >
                    <ChevronRightIcon className={cn(archivedOpen && "rotate-90")} />
                  </Button>
                ) : null}
                <span>{THREAD_BOARD_COLUMN_LABELS[column]}</span>
                <span className="text-xs font-normal text-muted-foreground">{threads.length}</span>
              </header>
              {ticketStage ? (
                <NewTicketForm
                  stage={ticketStage}
                  projects={props.projects}
                  scopedProject={ticketProject}
                  onCreate={props.onCreate}
                />
              ) : null}
              {collapsed ? null : (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {threads.map((thread) => (
                    <ThreadBoardCard
                      key={scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}
                      thread={thread}
                      column={column}
                      project={resolveThreadBoardProject(thread, projectByMemberKey)}
                      showProject={scopedProject === undefined}
                      now={now}
                      onOpen={props.onOpen}
                      onMove={props.onMove}
                      onDragStart={setDraggedThread}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
