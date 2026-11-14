import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { ThreadTicketStage } from "@t3tools/contracts";
import { ChevronRightIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { useState, type DragEvent, type FormEvent } from "react";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
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

export function projectKey(project: Pick<EnvironmentProject, "environmentId" | "id">): string {
  return `${project.environmentId}:${project.id}`;
}

export function threadProjectKey(
  thread: Pick<ThreadBoardThread, "environmentId" | "projectId">,
): string {
  return `${thread.environmentId}:${thread.projectId}`;
}

function ticketStageOfColumn(column: ThreadBoardColumn): ThreadTicketStage | null {
  if (column === "backlog" || column === "ready") return column;
  return null;
}

function resolveTicketProject(input: {
  scopedProject: EnvironmentProject | undefined;
  projects: readonly EnvironmentProject[];
  pickedProjectKey: string | null;
}): EnvironmentProject | undefined {
  if (input.scopedProject) return input.scopedProject;
  const picked = input.projects.find((project) => projectKey(project) === input.pickedProjectKey);
  if (picked) return picked;
  return input.projects[0];
}

function ThreadBoardCard(props: {
  thread: ThreadBoardThread;
  column: ThreadBoardColumn;
  project: EnvironmentProject | undefined;
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
            <span className="truncate">{project.title}</span>
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
  projects: readonly EnvironmentProject[];
  scopedProject: EnvironmentProject | undefined;
  onCreate: (project: EnvironmentProject, title: string, stage: ThreadTicketStage) => Promise<void>;
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
          value={projectKey(pickedProject)}
          onChange={(event) => setPickedProjectKey(event.target.value)}
          aria-label="Project for the new ticket"
          className="h-7 rounded-md border bg-background px-1.5 text-xs"
        >
          {props.projects.map((project) => (
            <option key={projectKey(project)} value={projectKey(project)}>
              {project.title}
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
  projects: readonly EnvironmentProject[];
  /** Every project, to name the cards of archived projects too. */
  allProjects: readonly EnvironmentProject[];
  scopedProject: EnvironmentProject | undefined;
  now: string;
  onProjectChange: (projectKey: string) => void;
  onOpen: (thread: ThreadBoardThread) => void;
  onMove: (thread: ThreadBoardThread, to: ThreadBoardColumn) => void;
  onCreate: (project: EnvironmentProject, title: string, stage: ThreadTicketStage) => Promise<void>;
}) {
  const [draggedThread, setDraggedThread] = useState<ThreadBoardThread | null>(null);
  const [dropColumn, setDropColumn] = useState<ThreadBoardColumn | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  const { now, scopedProject } = props;
  const columns = groupThreadsByBoardColumn(props.threads, { now });
  const projectByKey = new Map(props.allProjects.map((project) => [projectKey(project), project]));

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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-3">
        <select
          value={scopedProject ? projectKey(scopedProject) : ALL_PROJECTS}
          onChange={(event) => props.onProjectChange(event.target.value)}
          aria-label="Project"
          className="h-7 max-w-64 rounded-md border bg-background px-1.5 text-sm"
        >
          <option value={ALL_PROJECTS}>All projects</option>
          {props.projects.map((project) => (
            <option key={projectKey(project)} value={projectKey(project)}>
              {project.title}
            </option>
          ))}
        </select>
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
                  scopedProject={scopedProject}
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
                      project={projectByKey.get(threadProjectKey(thread))}
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
