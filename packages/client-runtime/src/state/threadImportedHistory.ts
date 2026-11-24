import type {
  OrchestrationV2ImportedHistoryMessage,
  OrchestrationV2ThreadTranscript,
  RunId,
} from "@t3tools/contracts";

/** The thread as it was when the run ended: the rows after that run are left out. */
export function threadTranscriptThroughRun(
  transcript: OrchestrationV2ThreadTranscript,
  runId: RunId,
): OrchestrationV2ThreadTranscript {
  const lastRow = transcript.items.findLastIndex((row) => row.item.runId === runId);
  return { ...transcript, items: transcript.items.slice(0, lastRow + 1) };
}

/** The conversation of the thread: what the user and the agent said, and the reasoning. */
export function importedHistoryFromTranscript(
  transcript: OrchestrationV2ThreadTranscript,
): OrchestrationV2ImportedHistoryMessage[] {
  return transcript.items.flatMap(({ item }): OrchestrationV2ImportedHistoryMessage[] => {
    if (item.type === "user_message") {
      return [{ role: "user", text: item.text, createdAt: item.updatedAt }];
    }
    if (item.type === "assistant_message") {
      return [{ role: "assistant", text: item.text, createdAt: item.updatedAt }];
    }
    if (item.type === "reasoning") {
      return [{ role: "reasoning", text: item.text, createdAt: item.updatedAt }];
    }
    return [];
  });
}
