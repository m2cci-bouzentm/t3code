import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isTicketThread } from "@t3tools/client-runtime/state/thread-stage";
import { useMemo } from "react";

import { useThreadListNow } from "./use-thread-list-now";

/**
 * The threads a thread list shows, like the desktop sidebar: a ticket in Backlog or Ready waits
 * on the board until it moves to Active.
 */
export function useListedThreadShells(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const now = useThreadListNow(threads);
  return useMemo(
    () => threads.filter((thread) => !isTicketThread(thread, { now })),
    [threads, now],
  );
}
