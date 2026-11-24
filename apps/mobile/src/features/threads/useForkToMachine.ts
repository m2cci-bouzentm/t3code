import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  importedHistoryFromTranscript,
  threadTranscriptThroughRun,
} from "@t3tools/client-runtime/state/thread-imported-history";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ThreadId,
  type EnvironmentId,
  type RunId,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import { useGT, useMessages } from "gt-react-native";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { uuidv4 } from "../../lib/uuid";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { orchestrationEnvironment } from "../../state/orchestration";
import { environmentThreadShells, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useHomeListOptions } from "../home/home-list-options";
import { buildHomeProjectScopes } from "../home/homeThreadList";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { resolveNewThreadDefaults } from "./newThreadDefaults";
import { waitForThreadShell } from "./threadForkNavigation";

export interface ForkMachine {
  readonly project: EnvironmentProject;
  readonly label: string;
}

/**
 * The other machines that have the thread's project, one project each: the project as the
 * thread lists group it across machines.
 */
function forkMachines(input: {
  readonly thread: EnvironmentThreadShell;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly labels: ReadonlyMap<EnvironmentId, string>;
}): ForkMachine[] {
  const { thread } = input;
  const scope = buildHomeProjectScopes(
    {
      projects: input.projects,
      environmentId: null,
      projectGroupingMode: input.projectGroupingMode,
    },
    m,
  ).find((candidate) =>
    candidate.projectRefs.some(
      (ref) => ref.environmentId === thread.environmentId && ref.projectId === thread.projectId,
    ),
  );
  if (scope === undefined) return [];
  const machines = new Map<EnvironmentId, ForkMachine>();
  for (const project of scope.projects) {
    const label = input.labels.get(project.environmentId);
    const isOtherMachine = project.environmentId !== thread.environmentId;
    if (!isOtherMachine || label === undefined || machines.has(project.environmentId)) continue;
    machines.set(project.environmentId, { project, label });
  }
  return [...machines.values()];
}

/**
 * Forks a thread at the end of a run onto another machine: a new thread in the same project
 * there, which starts with the conversation up to that run.
 */
export function useForkToMachine(source: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const messages = useMessages();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const { options } = useHomeListOptions(new Set(environments.map((entry) => entry.environmentId)));
  const thread = useAtomValue(
    environmentThreadShells.threadShellAtom(scopeThreadRef(source.environmentId, source.threadId)),
  );
  const loadTranscript = useAtomCommand(orchestrationEnvironment.threadTranscript, {
    reportFailure: false,
  });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const selectDetail = useSelectWorkspaceDetail();

  const labels = new Map(environments.map((entry) => [entry.environmentId, entry.label]));
  const machines =
    thread === null
      ? []
      : forkMachines({
          thread,
          projects,
          projectGroupingMode: options.projectGroupingMode,
          labels,
        });

  const fork = async (machine: ForkMachine, runId: RunId, title: string): Promise<void> => {
    const transcript = await loadTranscript({
      environmentId: source.environmentId,
      input: { threadId: source.threadId },
    });
    if (transcript._tag === "Failure") {
      if (isAtomCommandInterrupted(transcript)) return;
      Dialog.alert(
        gt("Fork not created"),
        errorDisplayMessage(squashAtomCommandFailure(transcript), messages) ??
          gt("This thread could not be read for the fork."),
      );
      return;
    }
    const defaults = resolveNewThreadDefaults(machine.project);
    if (defaults === null) {
      Dialog.alert(
        gt("Fork not created"),
        gt("No model is available for the fork on {machine}.", { machine: machine.label }),
      );
      return;
    }
    const targetThreadId = ThreadId.make(uuidv4());
    const created = await createThread({
      environmentId: machine.project.environmentId,
      input: {
        threadId: targetThreadId,
        projectId: machine.project.id,
        title,
        modelSelection: defaults.modelSelection,
        runtimeMode: defaults.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        importedHistory: importedHistoryFromTranscript(
          threadTranscriptThroughRun(transcript.value, runId),
        ),
      },
    });
    if (created._tag === "Failure") {
      if (isAtomCommandInterrupted(created)) return;
      Dialog.alert(
        gt("Fork not created"),
        errorDisplayMessage(squashAtomCommandFailure(created), messages) ??
          gt("The fork on {machine} failed.", { machine: machine.label }),
      );
      return;
    }
    const targetRef = scopeThreadRef(machine.project.environmentId, targetThreadId);
    const targetThreadReady = await waitForThreadShell(targetRef);
    if (!targetThreadReady) {
      Dialog.alert(
        gt("Fork created"),
        gt(
          "Its thread data did not reach this client. Reconnect and try opening it from the thread list.",
        ),
      );
      return;
    }
    selectDetail({
      name: "Thread",
      params: { environmentId: targetRef.environmentId, threadId: targetThreadId },
    });
  };

  return { machines, fork };
}
