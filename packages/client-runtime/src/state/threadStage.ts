import type { EnvironmentThreadShell } from "./shell.ts";
import { effectiveSnoozed } from "./threadSettled.ts";

export type ThreadStage = "archived" | "snoozed" | "settled" | "backlog" | "ready" | "open";

/**
 * The stage of a thread, from the fields that store it. This is the one place that reads them
 * together: an archive hides a snooze, and a snooze hides the stored stage, so a thread goes
 * back to its stage when it wakes. Every thread has exactly one stage.
 */
export function resolveThreadStage(
  thread: Pick<EnvironmentThreadShell, "archivedAt" | "settledOverride"> &
    Parameters<typeof effectiveSnoozed>[0],
  options: { readonly now: string },
): ThreadStage {
  if (thread.archivedAt !== null) return "archived";
  if (effectiveSnoozed(thread, options)) return "snoozed";
  if (thread.settledOverride === "settled") return "settled";
  if (thread.settledOverride === "backlog") return "backlog";
  if (thread.settledOverride === "ready") return "ready";
  return "open";
}

/**
 * A ticket waits on the board in Backlog or Ready; the list shows it once its first message
 * makes it active. A snoozed ticket is in Snoozed on the board, so the list shows it too.
 */
export function isTicketThread(
  thread: Parameters<typeof resolveThreadStage>[0],
  options: { readonly now: string },
): boolean {
  const stage = resolveThreadStage(thread, options);
  return stage === "backlog" || stage === "ready";
}
