import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { errorDisplayMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ModelSelection, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react-native";

import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { waitForThreadShell } from "./threadForkNavigation";
import { useOpenLinkedThread } from "./useOpenLinkedThread";

/**
 * Starts a subagent of `parent` that gets only `task`, on `modelSelection`, and opens its thread.
 * Its result returns to the parent. Resolves false when the subagent did not start.
 */
export function useStartSubagent() {
  const gt = useGT();
  const delegateTask = useAtomCommand(threadEnvironment.delegateTask, { reportFailure: false });
  const openLinkedThread = useOpenLinkedThread();

  return async (
    parent: ScopedThreadRef,
    task: string,
    modelSelection: ModelSelection,
  ): Promise<boolean> => {
    const result = await delegateTask({
      environmentId: parent.environmentId,
      input: { parentThreadId: parent.threadId, task, modelSelection, creationSource: "mobile" },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return false;
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        gt("Subagent not started"),
        errorDisplayMessage(error, m) ?? gt("Could not start the subagent."),
      );
      return false;
    }
    const childRef = scopeThreadRef(parent.environmentId, result.value);
    await waitForThreadShell(childRef);
    openLinkedThread(childRef);
    return true;
  };
}
