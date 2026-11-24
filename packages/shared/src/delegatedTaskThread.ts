import { ThreadId, type CommandId } from "@t3tools/contracts";

/** The start of every delegated task's thread id. */
export const DELEGATED_TASK_THREAD_PREFIX = "thread:delegated-task:";

/**
 * The thread a delegated task runs in, derived from the command that delegated it, so the server
 * and a client that sent the command name the same thread.
 */
export function delegatedTaskThreadId(commandId: CommandId): ThreadId {
  return ThreadId.make(`${DELEGATED_TASK_THREAD_PREFIX}${encodeURIComponent(commandId)}`);
}
