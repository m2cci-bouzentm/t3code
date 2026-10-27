import { useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ProviderInstanceId, ScopedThreadRef } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useThreadShell, waitForThreadShell } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { ProviderModelPicker } from "./ProviderModelPicker";

interface ModelChoice {
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
}

/** Starts a subagent of this thread with a chosen provider and model, then opens its thread. */
export function SubagentButton({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState("");
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [creating, setCreating] = useState(false);

  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(threadRef.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const delegateTask = useOrchestrationCommand(threadEnvironment.delegateTask, {
    reportFailure: false,
  });

  if (shell === null || shell.latestRun === null) return null;
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(
      deriveProviderInstanceEntries(providers),
      settings,
      shell.projectId,
    ),
  );
  const activeChoice = choice ?? shell.modelSelection;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    activeChoice.instanceId,
    activeChoice.model,
  );

  const createSubagent = async () => {
    setCreating(true);
    const result = await delegateTask({
      environmentId: threadRef.environmentId,
      input: {
        parentThreadId: threadRef.threadId,
        task: task.trim(),
        modelSelection: { instanceId: activeChoice.instanceId, model: activeChoice.model },
      },
    });
    if (result._tag === "Failure") {
      setCreating(false);
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not start the sub agent",
        description: error instanceof Error ? error.message : undefined,
      });
      return;
    }
    const childRef = scopeThreadRef(threadRef.environmentId, result.value);
    await waitForThreadShell(childRef);
    setCreating(false);
    setOpen(false);
    setTask("");
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(childRef) });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="xs" variant="ghost-muted" />}>
        <BotIcon aria-hidden />
        Sub agent
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <div className="flex flex-col gap-3">
          <PopoverTitle>Start a sub agent</PopoverTitle>
          <ProviderModelPicker
            environmentId={threadRef.environmentId}
            activeInstanceId={activeChoice.instanceId}
            model={activeChoice.model}
            lockedProvider={null}
            instanceEntries={instanceEntries}
            modelOptionsByInstance={modelOptionsByInstance}
            isComposerOwned={false}
            disabled={creating}
            onInstanceModelChange={(instanceId, model) => setChoice({ instanceId, model })}
          />
          <Textarea
            aria-label="Sub agent task"
            placeholder="The sub agent gets only this task. Its result returns to this thread."
            value={task}
            disabled={creating}
            onChange={(event) => setTask(event.target.value)}
          />
          <Button size="sm" disabled={creating || task.trim() === ""} onClick={createSubagent}>
            {creating ? "Starting..." : "Start"}
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
